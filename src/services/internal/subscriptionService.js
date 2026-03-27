// services/internal/subscriptionService.js
import Provider from '../../models/User/Provider.js';
import SubscriptionPlan from '../../models/Payment/SubscriptionPlan.js';
import stripeService from '../external/payment/stripeService.js';
import notificationService from '../external/notificationService.js';

// ─── Plan seed data aligned to business requirements ───
function getPlansSeed() {
  return [
  {
    name: 'free',
    displayName: 'Básico',
    price: { monthly: 0, currency: 'USD' },
    features: {
      leadLimit: -1,            // leads ilimitados (Programados en lote)
      leadTypes: ['scheduled'],  // solo leads programados
      scheduledLeadBatchHour: 18, // leads entregados diariamente a las 6 PM
      visibilityMultiplier: 1.0,
      maxPortfolioVideos: 1,
      verifiedBadge: false,
      performanceReports: false,
      profileViewsVisible: false,
      vipSupport: false,
      urgentLeadPriority: 0,
      benefits: ['multiple_categories']
    },
    stripePriceId: '',           // no Stripe price for free
    isActive: true,
    metadata: {
      description: 'Ranking básico, portafolio (máx. 1 video), leads programados (diariamente a las 6 PM)',
      descriptionEn: 'Basic ranking, portfolio (max 1 video), scheduled leads (daily at 6 PM)',
      order: 1
    }
  },
  {
    name: 'expert',
    displayName: 'Experto',
    price: { monthly: 4.99, currency: 'USD' },
    features: {
      leadLimit: -1,                        // leads ilimitados
      leadTypes: ['scheduled', 'urgent'],    // programados + urgentes
      scheduledLeadBatchHour: -1,            // acceso inmediato (sin lote)
      visibilityMultiplier: 1.5,
      maxPortfolioVideos: -1,                // ilimitado
      verifiedBadge: true,
      performanceReports: false,
      profileViewsVisible: true,
      vipSupport: false,
      urgentLeadPriority: 1,                 // prioridad base para urgentes
      benefits: ['verified_badge', 'profile_views', 'multiple_categories']
    },
    stripePriceId: process.env.STRIPE_PRICE_EXPERT || '',
    isActive: true,
    metadata: {
      description: 'Notificación inmediata, badge verificado, leads ilimitados, visitas al perfil',
      descriptionEn: 'Instant notifications, verified badge, unlimited leads, profile views',
      order: 2,
      mostPopular: true
    }
  },
  {
    name: 'elite',
    displayName: 'Élite',
    price: { monthly: 9.99, currency: 'USD' },
    features: {
      leadLimit: -1,
      leadTypes: ['scheduled', 'urgent'],
      scheduledLeadBatchHour: -1,            // acceso inmediato (sin lote)
      visibilityMultiplier: 2.0,             // máxima visibilidad / top resultados
      maxPortfolioVideos: -1,
      verifiedBadge: true,
      performanceReports: true,
      profileViewsVisible: true,
      vipSupport: true,
      urgentLeadPriority: 2,                 // urgentes llegan primero que expertos
      benefits: ['verified_badge', 'profile_views', 'performance_reports', 'vip_support', 'urgent_leads_first', 'featured_listing', 'multiple_categories']
    },
    stripePriceId: process.env.STRIPE_PRICE_ELITE || '',
    isActive: true,
    metadata: {
      description: 'Top resultados, urgentes primero, reportes mensuales, soporte VIP',
      descriptionEn: 'Top results, urgent leads first, monthly reports, VIP support',
      order: 3
    }
  }
  ];
}

// ─── Helpers ───

function startOfNextPeriod(from = new Date()) {
  const start = new Date(from);
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  return { start, end };
}

/**
 * Calculate hours remaining until the next occurrence of a given hour (0-23).
 * E.g. batchHour=18 → hours until next 6 PM.
 */
function hoursUntilNextBatchHour(batchHour = 18) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(batchHour, 0, 0, 0);
  if (now >= target) {
    target.setDate(target.getDate() + 1);
  }
  return (target - now) / (1000 * 60 * 60);
}

// ─── Public API ───

async function ensurePlansSeeded() {
  const plansSeed = getPlansSeed();
  const existing = await SubscriptionPlan.find({ name: { $in: plansSeed.map(p => p.name) } }).lean();
  const have = new Set(existing.map(p => p.name));
  const toCreate = plansSeed.filter(p => !have.has(p.name));
  if (toCreate.length) {
    await SubscriptionPlan.insertMany(toCreate);
  }
  // Sync existing plans: price, features, metadata, and stripePriceId
  for (const seed of plansSeed) {
    if (have.has(seed.name)) {
      const update = { price: seed.price, features: seed.features, metadata: seed.metadata };
      if (seed.stripePriceId) update.stripePriceId = seed.stripePriceId;
      await SubscriptionPlan.updateOne({ name: seed.name }, { $set: update });
    }
  }
}

async function getPlan(planName) {
  const plansSeed = getPlansSeed();
  const plan = await SubscriptionPlan.findOne({ name: planName, isActive: true }).lean();
  if (plan) {
    // Self-heal legacy records that were seeded before STRIPE_PRICE_* existed
    if (!plan.stripePriceId && ['expert', 'elite'].includes(plan.name)) {
      const seed = plansSeed.find(p => p.name === plan.name);
      if (seed?.stripePriceId) {
        await SubscriptionPlan.updateOne(
          { name: plan.name },
          { $set: { stripePriceId: seed.stripePriceId } }
        );
        return { ...plan, stripePriceId: seed.stripePriceId };
      }
    }
    return plan;
  }
  return plansSeed.find(p => p.name === planName) || plansSeed[0];
}

async function getAllActivePlans() {
  await ensurePlansSeeded();
  return SubscriptionPlan.find({ isActive: true }).sort({ 'metadata.order': 1 }).lean();
}

// ─── Stripe Customer management ───

async function getOrCreateStripeCustomer(provider) {
  // If we already have a stored customer ID, verify it still exists in Stripe
  if (provider.subscription?.stripeCustomerId) {
    try {
      const existing = await stripeService.stripe.customers.retrieve(
        provider.subscription.stripeCustomerId
      );
      // If the customer was deleted, fall through to create a new one
      if (!existing.deleted) {
        return provider.subscription.stripeCustomerId;
      }
      console.warn(`[Subscription] Stripe customer ${provider.subscription.stripeCustomerId} was deleted — creating new one`);
    } catch (err) {
      // Customer doesn't exist in this Stripe account — create a fresh one
      console.warn(`[Subscription] Stored stripeCustomerId ${provider.subscription.stripeCustomerId} is invalid (${err.code || err.message}) — creating new one`);
    }
  }

  const customer = await stripeService.createCustomer({
    email: provider.email,
    name: provider.providerProfile?.businessName || `${provider.profile?.firstName || ''} ${provider.profile?.lastName || ''}`.trim(),
    metadata: { providerId: provider._id.toString() }
  });
  await Provider.findByIdAndUpdate(provider._id, {
    $set: { 'subscription.stripeCustomerId': customer.id }
  });
  return customer.id;
}

// ─── Checkout Session (Stripe hosted) ───

async function createCheckoutSession(provider, planName, successUrl, cancelUrl) {
  await ensurePlansSeeded();
  const plan = await getPlan(planName);
  if (!plan || plan.name === 'free') {
    throw new Error('Cannot create checkout for free plan');
  }
  if (!plan.stripePriceId) {
    throw new Error('Stripe Price ID not configured for this plan. Set STRIPE_PRICE_EXPERT and STRIPE_PRICE_ELITE in env.');
  }

  const customerId = await getOrCreateStripeCustomer(provider);

  const session = await stripeService.stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: {
        providerId: provider._id.toString(),
        planName: plan.name
      }
    },
    metadata: {
      providerId: provider._id.toString(),
      planName: plan.name
    },
    allow_promotion_codes: true,
    phone_number_collection: { enabled: false }
  });

  return session;
}

// ─── Cancel subscription ───

async function cancelSubscription(providerId, immediate = false) {
  const provider = await Provider.findById(providerId).lean();
  if (!provider?.subscription?.stripeSubscriptionId) {
    // No Stripe subscription — just downgrade to free locally
    await changePlanLocal(providerId, 'free');
    return { downgraded: true };
  }

  if (immediate) {
    await stripeService.stripe.subscriptions.cancel(provider.subscription.stripeSubscriptionId);
  } else {
    await stripeService.stripe.subscriptions.update(provider.subscription.stripeSubscriptionId, {
      cancel_at_period_end: true
    });
    await Provider.findByIdAndUpdate(providerId, {
      $set: { 'subscription.cancelAtPeriodEnd': true }
    });
  }
  return { cancelAtPeriodEnd: !immediate };
}

// ─── Reactivate (undo cancel_at_period_end) ───

async function reactivateSubscription(providerId) {
  const provider = await Provider.findById(providerId).lean();
  if (!provider?.subscription?.stripeSubscriptionId) {
    throw new Error('No active Stripe subscription to reactivate');
  }
  await stripeService.stripe.subscriptions.update(provider.subscription.stripeSubscriptionId, {
    cancel_at_period_end: false
  });
  await Provider.findByIdAndUpdate(providerId, {
    $set: { 'subscription.cancelAtPeriodEnd': false }
  });
  return { reactivated: true };
}

// ─── Webhook event handlers ───

async function handleSubscriptionEvent(event) {
  const eventType = event.type;
  const data = event.data.object; // Stripe Subscription or Invoice object

  switch (eventType) {
    case 'checkout.session.completed': {
      const { providerId, planName } = data.metadata || {};
      if (!providerId) break;
      const subscriptionId = data.subscription;
      // Fetch full subscription from Stripe to get period dates
      const sub = await stripeService.stripe.subscriptions.retrieve(subscriptionId);
      await Provider.findByIdAndUpdate(providerId, {
        $set: {
          'subscription.plan': planName,
          'subscription.status': 'active',
          'subscription.stripeSubscriptionId': sub.id,
          'subscription.stripeCustomerId': data.customer,
          'subscription.currentPeriodStart': new Date(sub.current_period_start * 1000),
          'subscription.currentPeriodEnd': new Date(sub.current_period_end * 1000),
          'subscription.cancelAtPeriodEnd': false,
          'subscription.leadsUsed': 0
        }
      });
      console.log(`[Subscription] checkout.session.completed — provider ${providerId} → plan ${planName}`);
      // Send bell notification
      try {
        await notificationService.sendProviderNotification({
          providerId,
          type: 'SUBSCRIPTION_ACTIVATED',
          priority: 'high',
          data: { planName }
        });
      } catch (notifErr) {
        console.warn('[Subscription] Failed to send activation notification:', notifErr.message);
      }
      break;
    }

    case 'invoice.paid': {
      // Recurring payment succeeded
      const subscriptionId = data.subscription;
      if (!subscriptionId) break;
      const sub = await stripeService.stripe.subscriptions.retrieve(subscriptionId);
      const providerId = sub.metadata?.providerId;
      if (!providerId) break;
      await Provider.findByIdAndUpdate(providerId, {
        $set: {
          'subscription.status': 'active',
          'subscription.currentPeriodStart': new Date(sub.current_period_start * 1000),
          'subscription.currentPeriodEnd': new Date(sub.current_period_end * 1000),
          'subscription.leadsUsed': 0,
          'subscription.cancelAtPeriodEnd': sub.cancel_at_period_end || false
        }
      });
      console.log(`[Subscription] invoice.paid — provider ${providerId} renewed`);
      break;
    }

    case 'invoice.payment_failed': {
      const subscriptionId = data.subscription;
      if (!subscriptionId) break;
      const sub = await stripeService.stripe.subscriptions.retrieve(subscriptionId);
      const providerId = sub.metadata?.providerId;
      if (!providerId) break;
      await Provider.findByIdAndUpdate(providerId, {
        $set: { 'subscription.status': 'past_due' }
      });
      console.warn(`[Subscription] invoice.payment_failed — provider ${providerId} → past_due`);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = data;
      const providerId = sub.metadata?.providerId;
      if (!providerId) break;
      const planName = sub.metadata?.planName || 'free';
      const stripeStatus = sub.status; // active | past_due | canceled | unpaid
      const mappedStatus = ['active', 'past_due', 'canceled'].includes(stripeStatus) ? stripeStatus : 'inactive';
      await Provider.findByIdAndUpdate(providerId, {
        $set: {
          'subscription.plan': planName,
          'subscription.status': mappedStatus,
          'subscription.currentPeriodStart': new Date(sub.current_period_start * 1000),
          'subscription.currentPeriodEnd': new Date(sub.current_period_end * 1000),
          'subscription.cancelAtPeriodEnd': sub.cancel_at_period_end || false
        }
      });
      console.log(`[Subscription] customer.subscription.updated — provider ${providerId} → ${mappedStatus} (${planName})`);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = data;
      const providerId = sub.metadata?.providerId;
      if (!providerId) break;
      // Downgrade to free
      await changePlanLocal(providerId, 'free');
      console.log(`[Subscription] customer.subscription.deleted — provider ${providerId} → free`);
      // Send bell notification
      try {
        await notificationService.sendProviderNotification({
          providerId,
          type: 'SUBSCRIPTION_DOWNGRADED',
          priority: 'medium',
          data: { planName: 'free' }
        });
      } catch (notifErr) {
        console.warn('[Subscription] Failed to send downgrade notification:', notifErr.message);
      }
      break;
    }

    default:
      console.log(`[Subscription] Unhandled event: ${eventType}`);
  }
}

// ─── Local plan change (no Stripe interaction) ───

async function changePlanLocal(providerId, planName) {
  const plan = await getPlan(planName);
  if (!plan) throw new Error('Invalid plan');
  const updates = {
    'subscription.plan': plan.name,
    'subscription.status': 'active'
  };
  if (plan.name === 'free') {
    updates['subscription.stripeSubscriptionId'] = null;
    updates['subscription.cancelAtPeriodEnd'] = false;
  }
  await Provider.findByIdAndUpdate(providerId, { $set: updates });
}

// ─── Period & Lead management ───

function isPeriodExpired(provider) {
  const end = provider?.subscription?.currentPeriodEnd ? new Date(provider.subscription.currentPeriodEnd) : null;
  return !end || end < new Date();
}

async function ensureActivePeriod(provider) {
  if (isPeriodExpired(provider)) {
    const { start, end } = startOfNextPeriod(new Date());
    await Provider.findByIdAndUpdate(provider._id, {
      $set: {
        'subscription.currentPeriodStart': start,
        'subscription.currentPeriodEnd': end,
        'subscription.leadsUsed': 0
      }
    });
    provider.subscription.currentPeriodStart = start;
    provider.subscription.currentPeriodEnd = end;
    provider.subscription.leadsUsed = 0;
  }
}

async function canReceiveLead(providerOrId) {
  const provider = (providerOrId && typeof providerOrId === 'object' && providerOrId.subscription !== undefined)
    ? providerOrId
    : await Provider.findById(providerOrId).lean();
  if (!provider) return false;

  const plan = await getPlan(provider.subscription?.plan || 'free');

  // Provider must have active subscription
  if ((provider.subscription?.status || 'active') !== 'active') return false;

  await ensureActivePeriod(provider);

  const leadLimit = plan.features.leadLimit;
  if (leadLimit < 0) return true; // unlimited

  const used = provider.subscription?.leadsUsed || 0;
  return used < leadLimit;
}

/**
 * Check if a provider can receive a specific urgency type of lead.
 * Returns { allowed, delayHours } where delayHours > 0 means delayed notification.
 */
async function canReceiveLeadByUrgency(providerOrId, urgency = 'scheduled') {
  const provider = (providerOrId && typeof providerOrId === 'object' && providerOrId.subscription !== undefined)
    ? providerOrId
    : await Provider.findById(providerOrId).lean();
  if (!provider) return { allowed: false, delayHours: 0 };

  const plan = await getPlan(provider.subscription?.plan || 'free');
  const leadTypes = plan.features.leadTypes || ['scheduled'];

  // Urgent leads: only expert/elite
  if (urgency === 'immediate' || urgency === 'urgent') {
    if (!leadTypes.includes('urgent')) {
      return { allowed: false, delayHours: 0 };
    }
    return { allowed: true, delayHours: 0 };
  }

  // Scheduled leads: all plans, but free-plan gets batched at a fixed hour (e.g. 6 PM)
  const batchHour = plan.features.scheduledLeadBatchHour;
  if (batchHour != null && batchHour >= 0) {
    return { allowed: true, delayHours: hoursUntilNextBatchHour(batchHour) };
  }
  return { allowed: true, delayHours: 0 };
}

async function incrementLeadUsage(providerId) {
  const provider = await Provider.findById(providerId).lean();
  if (!provider) return;
  await ensureActivePeriod(provider);
  await Provider.findByIdAndUpdate(providerId, {
    $inc: { 'subscription.leadsUsed': 1 },
    $set: { 'subscription.lastLeadAt': new Date() }
  });
}

// ─── Referral helpers ───

const REFERRAL_DAYS_PER_SIGNUP = 7;   // 7 días de Plan Experto por cada referido
const REFERRAL_MAX_DAYS = 30;          // Máximo acumulable: 1 mes (30 días)

/**
 * Check if the referral promotion is still active.
 * Controlled by REFERRAL_PROGRAM_END_DATE env variable.
 */
function isReferralProgramActive() {
  const endDate = process.env.REFERRAL_PROGRAM_END_DATE;
  if (!endDate) return true; // If no end date set, program is always active
  const end = new Date(endDate);
  return !isNaN(end.getTime()) && new Date() < end;
}

/**
 * Apply a referral code when a new user (client or provider) registers.
 * Awards 7 days of Expert plan to the referrer, capped at 30 days total.
 * 
 * @param {string} referralCode - The referral code used
 * @param {object} newUser - { userId, role } of the user who registered
 * @returns {{ referrerId, daysAwarded, totalDays, bonusExpiresAt } | null}
 */
async function applyReferralCode(referralCode, newUser = {}) {
  // Check if referral program is still active
  if (!isReferralProgramActive()) {
    return null;
  }

  const referrer = await Provider.findOne({ 'referral.code': referralCode });
  if (!referrer) return null;

  // Don't allow self-referral
  if (newUser.userId && String(referrer._id) === String(newUser.userId)) {
    return null;
  }

  // Calculate new earned days (cap at 30)
  const currentEarned = referrer.referral?.earnedDays || 0;
  if (currentEarned >= REFERRAL_MAX_DAYS) {
    // Already at maximum — still track the referral but award 0 days
    await Provider.updateOne(
      { _id: referrer._id },
      {
        $inc: { 'referral.referralsCount': 1 },
        $push: {
          'referral.referredUsers': {
            userId: newUser.userId || null,
            userRole: newUser.role || 'provider',
            daysAwarded: 0,
            registeredAt: new Date()
          }
        }
      }
    );
    return { referrerId: referrer._id, daysAwarded: 0, totalDays: REFERRAL_MAX_DAYS, bonusExpiresAt: referrer.referral?.bonusExpiresAt };
  }

  const daysToAdd = Math.min(REFERRAL_DAYS_PER_SIGNUP, REFERRAL_MAX_DAYS - currentEarned);
  const newTotalDays = currentEarned + daysToAdd;

  // Calculate bonus expiry: extend from current expiry or start from now
  const now = new Date();
  let bonusExpiresAt;
  if (referrer.referral?.bonusActive && referrer.referral?.bonusExpiresAt && new Date(referrer.referral.bonusExpiresAt) > now) {
    // Extend existing bonus
    bonusExpiresAt = new Date(referrer.referral.bonusExpiresAt);
    bonusExpiresAt.setDate(bonusExpiresAt.getDate() + daysToAdd);
  } else {
    // Start fresh bonus
    bonusExpiresAt = new Date(now);
    bonusExpiresAt.setDate(bonusExpiresAt.getDate() + newTotalDays);
  }

  // Activate Expert plan bonus for the referrer
  const updateFields = {
    'referral.earnedDays': newTotalDays,
    'referral.bonusExpiresAt': bonusExpiresAt,
    'referral.bonusActive': true
  };

  // If the provider is currently on 'free' plan (no paid Stripe subscription),
  // upgrade them to 'expert' temporarily via referral bonus
  const hasPaidSubscription = referrer.subscription?.stripeSubscriptionId;
  if (!hasPaidSubscription && (referrer.subscription?.plan === 'free' || !referrer.subscription?.plan)) {
    updateFields['subscription.plan'] = 'expert';
    updateFields['subscription.status'] = 'active';
    updateFields['subscription.currentPeriodStart'] = now;
    updateFields['subscription.currentPeriodEnd'] = bonusExpiresAt;
  }

  await Provider.updateOne(
    { _id: referrer._id },
    {
      $set: updateFields,
      $inc: { 'referral.referralsCount': 1 },
      $push: {
        'referral.referredUsers': {
          userId: newUser.userId || null,
          userRole: newUser.role || 'provider',
          daysAwarded: daysToAdd,
          registeredAt: now
        }
      }
    }
  );

  return {
    referrerId: referrer._id,
    daysAwarded: daysToAdd,
    totalDays: newTotalDays,
    bonusExpiresAt
  };
}

// ─── Review Milestones ───
// Milestone 1: First review received → motivational notification
// Milestone 2: 3 reviews received → 3 days Expert Plan free
const REVIEW_MILESTONE_DAYS = 3;

/**
 * Check review milestones for a provider after receiving a new review.
 * Returns { milestone, daysAwarded } or null if no new milestone.
 */
async function checkReviewMilestones(providerId) {
  const provider = await Provider.findById(providerId);
  if (!provider) return null;

  const Review = (await import('../../models/Service/Review.js')).default;
  const reviewCount = await Review.countDocuments({ provider: providerId, status: 'active' });

  // Milestone 1: First review (motivational — no days awarded)
  if (reviewCount >= 1 && !provider.reviewMilestones?.firstReviewAcknowledged) {
    provider.reviewMilestones = provider.reviewMilestones || {};
    provider.reviewMilestones.firstReviewAcknowledged = true;
    await provider.save();

    // Send motivational notification: "You got your first review! Get 2 more to earn 3 days Expert."
    try {
      await notificationService.sendProviderNotification({
        providerId,
        type: 'REVIEW_MILESTONE_FIRST',
        data: { reviewCount, daysToEarn: REVIEW_MILESTONE_DAYS, reviewsNeeded: 3 - reviewCount }
      });
    } catch (e) { console.warn('[Milestones] notification failed:', e.message); }

    return { milestone: 'first_review', daysAwarded: 0 };
  }

  // Milestone 2: 3 reviews → award REVIEW_MILESTONE_DAYS of Expert
  if (reviewCount >= 3 && !provider.reviewMilestones?.threeReviewsRewarded) {
    provider.reviewMilestones = provider.reviewMilestones || {};
    provider.reviewMilestones.threeReviewsRewarded = true;

    // Award days — same logic as referral bonus
    const now = new Date();
    const currentExpiry = provider.referral?.bonusExpiresAt ? new Date(provider.referral.bonusExpiresAt) : null;
    const baseDate = (currentExpiry && currentExpiry > now) ? currentExpiry : now;
    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + REVIEW_MILESTONE_DAYS);

    provider.referral = provider.referral || {};
    provider.referral.earnedDays = (provider.referral.earnedDays || 0) + REVIEW_MILESTONE_DAYS;
    provider.referral.bonusExpiresAt = newExpiry;
    provider.referral.bonusActive = true;

    // Upgrade to expert if on free plan (set proper period bounds)
    const hasPaidSubscription = provider.subscription?.stripeSubscriptionId;
    if (!hasPaidSubscription && (!provider.subscription?.plan || provider.subscription.plan === 'free')) {
      provider.subscription = provider.subscription || {};
      provider.subscription.plan = 'expert';
      provider.subscription.status = 'active';
      provider.subscription.currentPeriodStart = now;
      provider.subscription.currentPeriodEnd = newExpiry;
    }

    await provider.save();

    // Send reward notification
    try {
      await notificationService.sendProviderNotification({
        providerId,
        type: 'REVIEW_MILESTONE_THREE',
        data: { reviewCount, daysAwarded: REVIEW_MILESTONE_DAYS }
      });
    } catch (e) { console.warn('[Milestones] notification failed:', e.message); }

    return { milestone: 'three_reviews', daysAwarded: REVIEW_MILESTONE_DAYS };
  }

  return null;
}

/**
 * Check and expire referral bonuses that have passed their expiry date.
 * Called periodically or on subscription status check.
 */
async function checkReferralBonusExpiry(providerId) {
  const provider = await Provider.findById(providerId).lean();
  if (!provider?.referral?.bonusActive) return false;

  const now = new Date();
  const expiresAt = provider.referral?.bonusExpiresAt ? new Date(provider.referral.bonusExpiresAt) : null;

  if (!expiresAt || expiresAt > now) return false;

  // Bonus expired — downgrade to free if no paid Stripe subscription
  const hasPaidSubscription = provider.subscription?.stripeSubscriptionId;
  const updates = {
    'referral.bonusActive': false
  };

  if (!hasPaidSubscription) {
    updates['subscription.plan'] = 'free';
    updates['subscription.status'] = 'active';
  }

  await Provider.updateOne({ _id: providerId }, { $set: updates });

  // Notify the provider that their referral bonus has expired
  try {
    await notificationService.sendProviderNotification({
      providerId,
      type: 'REFERRAL_BONUS_EXPIRED',
      data: {}
    });
  } catch (e) {
    console.warn('[Subscription] REFERRAL_BONUS_EXPIRED notification failed:', e.message);
  }

  return true; // bonus was expired
}

export default {
  getPlansSeed,
  ensurePlansSeeded,
  getPlan,
  getAllActivePlans,
  getOrCreateStripeCustomer,
  createCheckoutSession,
  cancelSubscription,
  reactivateSubscription,
  handleSubscriptionEvent,
  changePlanLocal,
  canReceiveLead,
  canReceiveLeadByUrgency,
  incrementLeadUsage,
  applyReferralCode,
  checkReferralBonusExpiry,
  isReferralProgramActive,
  checkReviewMilestones,
  REFERRAL_DAYS_PER_SIGNUP,
  REFERRAL_MAX_DAYS,
  REVIEW_MILESTONE_DAYS
};
