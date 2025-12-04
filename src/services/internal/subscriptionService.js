// services/internal/subscriptionService.js
import Provider from '../../models/User/Provider.js';
import SubscriptionPlan from '../../models/Payment/SubscriptionPlan.js';

const PLANS_SEED = [
  {
    name: 'free',
    displayName: 'Gratis',
    price: { monthly: 0, currency: 'USD' },
    features: {
      leadLimit: 1,
      visibilityMultiplier: 1.0,
      commissionRate: 15,
      benefits: ['multiple_categories']
    },
    stripePriceId: 'price_free',
    isActive: true,
    metadata: { description: 'Plan gratuito para comenzar', order: 1 }
  },
  {
    name: 'basic',
    displayName: 'Básico',
    price: { monthly: 10, currency: 'USD' },
    features: {
      leadLimit: 5,
      visibilityMultiplier: 1.2,
      commissionRate: 12,
      benefits: ['priority_support', 'advanced_analytics']
    },
    stripePriceId: 'price_basic',
    isActive: true,
    metadata: { description: 'Más visibilidad y 5 leads/mes', order: 2, mostPopular: true }
  },
  {
    name: 'pro',
    displayName: 'Pro',
    price: { monthly: 19, currency: 'USD' },
    features: {
      leadLimit: -1,
      visibilityMultiplier: 1.5,
      commissionRate: 8,
      benefits: ['priority_support', 'advanced_analytics', 'featured_listing', 'custom_profile']
    },
    stripePriceId: 'price_pro',
    isActive: true,
    metadata: { description: 'Visibilidad máxima y leads ilimitados', order: 3 }
  }
];

function startOfNextPeriod(from = new Date()) {
  // monthly billing: next period ends in 30 days (simplified)
  const start = new Date(from);
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  return { start, end };
}

async function ensurePlansSeeded() {
  const existing = await SubscriptionPlan.find({ name: { $in: PLANS_SEED.map(p => p.name) } }).lean();
  const have = new Set(existing.map(p => p.name));
  const toCreate = PLANS_SEED.filter(p => !have.has(p.name));
  if (toCreate.length) {
    await SubscriptionPlan.insertMany(toCreate);
  }
}

async function getPlan(planName) {
  const plan = await SubscriptionPlan.findOne({ name: planName, isActive: true }).lean();
  if (plan) return plan;
  // fallback to seed snapshot if DB empty in test
  return PLANS_SEED.find(p => p.name === planName) || PLANS_SEED[0];
}

function isPeriodExpired(provider) {
  const end = provider?.subscription?.currentPeriodEnd ? new Date(provider.subscription.currentPeriodEnd) : null;
  return !end || end < new Date();
}

async function ensureActivePeriod(provider) {
  // if no period or expired, reset counters and set new period
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
  const provider = typeof providerOrId === 'object' ? providerOrId : await Provider.findById(providerOrId).lean();
  if (!provider) return false;

  const plan = await getPlan(provider.subscription?.plan || 'free');
  // allow only active subscriptions; free will be set active on registration
  if ((provider.subscription?.status || 'inactive') !== 'active') return false;

  await ensureActivePeriod(provider);

  const leadLimit = plan.features.leadLimit;
  if (leadLimit < 0) return true; // unlimited

  const used = provider.subscription?.leadsUsed || 0;
  return used < leadLimit;
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

async function computeMonthlyCharge(provider) {
  const plan = await getPlan(provider.subscription?.plan || 'free');
  let amount = plan.price.monthly;

  // Apply 50% referral discount if available (max 3 months tracked via referral.discountMonths)
  const discountMonths = provider.referral?.discountMonths || 0;
  let discountApplied = 0;
  if (amount > 0 && discountMonths > 0) {
    discountApplied = amount * 0.5;
    amount = amount - discountApplied;
  }

  return {
    currency: plan.price.currency || 'USD',
    plan: plan.name,
    base: plan.price.monthly,
    discount: Math.round(discountApplied * 100) / 100,
    total: Math.max(0, Math.round(amount * 100) / 100)
  };
}

async function applyMonthlyRenewal(providerId) {
  const provider = await Provider.findById(providerId).lean();
  if (!provider) return null;
  // compute charge with potential discount
  const charge = await computeMonthlyCharge(provider);

  // decrement referral discountMonths if applied
  if (charge.discount > 0 && (provider.referral?.discountMonths || 0) > 0) {
    await Provider.findByIdAndUpdate(providerId, { $inc: { 'referral.discountMonths': -1 } });
  }

  const { start, end } = startOfNextPeriod(new Date());
  await Provider.findByIdAndUpdate(providerId, {
    $set: {
      'subscription.currentPeriodStart': start,
      'subscription.currentPeriodEnd': end,
      'subscription.leadsUsed': 0
    }
  });

  return charge;
}

async function changePlan(providerId, newPlanName) {
  const plan = await getPlan(newPlanName);
  if (!plan) throw new Error('Invalid plan');
  await Provider.findByIdAndUpdate(providerId, {
    $set: {
      'subscription.plan': plan.name,
      'subscription.status': 'active',
      'billing.commissionRate': plan.features.commissionRate
    }
  });
}

async function applyReferralCode(referralCode) {
  const referrer = await Provider.findOne({ 'referral.code': referralCode }).lean();
  if (!referrer) return null;
  const nextMonths = Math.min((referrer.referral?.discountMonths || 0) + 1, 3);
  await Provider.updateOne(
    { _id: referrer._id },
    {
      $inc: { 'referral.referralsCount': 1 },
      $set: { 'referral.discountMonths': nextMonths }
    }
  );
  return referrer._id;
}

export default {
  ensurePlansSeeded,
  getPlan,
  canReceiveLead,
  incrementLeadUsage,
  computeMonthlyCharge,
  applyMonthlyRenewal,
  changePlan,
  applyReferralCode
};
