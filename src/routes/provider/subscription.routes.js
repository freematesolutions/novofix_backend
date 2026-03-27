// routes/provider/subscription.routes.js
import express from 'express';
import { authenticateJWT, requireAuth } from '../../middlewares/auth/jwtAuth.js';
import { providerOnly } from '../../middlewares/auth/rbacMiddleware.js';
import subscriptionService from '../../services/internal/subscriptionService.js';
import Provider from '../../models/User/Provider.js';

const router = express.Router();

router.use(authenticateJWT);
router.use(requireAuth);
router.use(providerOnly);

// ─── List active plans ───
router.get('/plans', async (req, res) => {
  try {
    const plans = await subscriptionService.getAllActivePlans();
    res.json({ success: true, data: { plans } });
  } catch (error) {
    console.error('GET /provider/subscription/plans error:', error);
    res.status(500).json({ success: false, message: 'Failed to load plans' });
  }
});

// ─── Current subscription status ───
router.get('/status', async (req, res) => {
  try {
    // Check and expire referral bonus if needed
    await subscriptionService.checkReferralBonusExpiry(req.user._id);

    const provider = await Provider.findById(req.user._id).lean();
    const canLead = await subscriptionService.canReceiveLead(provider);
    const plan = await subscriptionService.getPlan(provider.subscription?.plan || 'free');

    // Count active reviews for milestone progress
    let reviewCount = 0;
    try {
      const Review = (await import('../../models/Service/Review.js')).default;
      reviewCount = await Review.countDocuments({ provider: req.user._id, status: 'active' });
    } catch { /* non-critical */ }

    res.json({
      success: true,
      data: {
        subscription: provider.subscription,
        plan,
        canReceiveLead: canLead,
        referral: {
          code: provider.referral?.code || '',
          earnedDays: provider.referral?.earnedDays || 0,
          referralsCount: provider.referral?.referralsCount || 0,
          bonusActive: provider.referral?.bonusActive || false,
          bonusExpiresAt: provider.referral?.bonusExpiresAt || null,
          maxDays: subscriptionService.REFERRAL_MAX_DAYS,
          daysPerSignup: subscriptionService.REFERRAL_DAYS_PER_SIGNUP,
          programActive: subscriptionService.isReferralProgramActive()
        },
        reviewMilestones: {
          firstReviewAcknowledged: provider.reviewMilestones?.firstReviewAcknowledged || false,
          threeReviewsRewarded: provider.reviewMilestones?.threeReviewsRewarded || false,
          reviewCount,
          daysAvailable: subscriptionService.REVIEW_MILESTONE_DAYS
        }
      }
    });
  } catch (error) {
    console.error('GET /provider/subscription/status error:', error);
    res.status(500).json({ success: false, message: 'Failed to get subscription status' });
  }
});

// ─── Create Stripe Checkout Session (upgrade to paid plan) ───
router.post('/checkout', async (req, res) => {
  try {
    const { planName } = req.body || {};
    if (!['expert', 'elite'].includes(planName)) {
      return res.status(400).json({ success: false, message: 'Invalid plan. Choose expert or elite.' });
    }

    const provider = await Provider.findById(req.user._id).lean();
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const successUrl = `${frontendUrl}/plan?checkout=success&plan=${planName}`;
    const cancelUrl = `${frontendUrl}/plan?checkout=canceled`;

    const session = await subscriptionService.createCheckoutSession(
      provider,
      planName,
      successUrl,
      cancelUrl
    );

    res.json({
      success: true,
      data: { checkoutUrl: session.url, sessionId: session.id }
    });
  } catch (error) {
    console.error('POST /provider/subscription/checkout error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create checkout session' });
  }
});

// ─── Downgrade to Free (no Stripe interaction needed for downgrade) ───
router.post('/downgrade', async (req, res) => {
  try {
    const provider = await Provider.findById(req.user._id).lean();
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    // Cancel Stripe subscription if exists, at period end
    const result = await subscriptionService.cancelSubscription(req.user._id, false);
    
    res.json({
      success: true,
      message: result.downgraded 
        ? 'Plan changed to free' 
        : 'Subscription will be canceled at end of current period',
      data: result
    });
  } catch (error) {
    console.error('POST /provider/subscription/downgrade error:', error);
    res.status(500).json({ success: false, message: 'Failed to downgrade plan' });
  }
});

// ─── Cancel subscription (at end of period) ───
router.post('/cancel', async (req, res) => {
  try {
    const result = await subscriptionService.cancelSubscription(req.user._id, false);
    res.json({ success: true, message: 'Subscription will cancel at end of period', data: result });
  } catch (error) {
    console.error('POST /provider/subscription/cancel error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel subscription' });
  }
});

// ─── Reactivate (undo cancellation) ───
router.post('/reactivate', async (req, res) => {
  try {
    const result = await subscriptionService.reactivateSubscription(req.user._id);
    res.json({ success: true, message: 'Subscription reactivated', data: result });
  } catch (error) {
    console.error('POST /provider/subscription/reactivate error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to reactivate' });
  }
});

// ─── Apply referral code (provider applies code manually from Plan page) ───
router.post('/apply-referral', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }

    // Check if referral program is still active
    if (!subscriptionService.isReferralProgramActive()) {
      return res.status(400).json({ success: false, message: 'Referral program has ended' });
    }

    const result = await subscriptionService.applyReferralCode(code, {
      userId: req.user._id,
      role: 'provider'
    });
    if (!result) return res.status(404).json({ success: false, message: 'Referral code not found' });

    await Provider.findByIdAndUpdate(req.user._id, { $set: { 'referral.referredBy': result.referrerId } });

    // Notify the referrer about their bonus
    try {
      const notificationService = (await import('../../services/external/notificationService.js')).default;
      const currentProvider = await Provider.findById(req.user._id).lean();
      await notificationService.sendProviderNotification({
        providerId: result.referrerId,
        type: 'REFERRAL_BONUS',
        data: {
          daysAwarded: result.daysAwarded,
          totalDays: result.totalDays,
          bonusExpiresAt: result.bonusExpiresAt,
          newUserName: currentProvider?.providerProfile?.businessName || 'Un profesional',
          newUserRole: 'provider'
        }
      });
    } catch (notifErr) {
      console.warn('Referral bonus notification failed:', notifErr?.message);
    }

    res.json({
      success: true,
      message: 'Referral code applied successfully',
      data: {
        daysAwarded: result.daysAwarded,
        totalDays: result.totalDays,
        bonusExpiresAt: result.bonusExpiresAt
      }
    });
  } catch (error) {
    console.error('POST /provider/subscription/apply-referral error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply referral code' });
  }
});

// ─── Get referral program info (public for the provider) ───
router.get('/referral-info', async (req, res) => {
  try {
    const provider = await Provider.findById(req.user._id).lean();
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    // Check and expire bonus if needed
    await subscriptionService.checkReferralBonusExpiry(req.user._id);
    const fresh = await Provider.findById(req.user._id).lean();

    res.json({
      success: true,
      data: {
        code: fresh.referral?.code || '',
        earnedDays: fresh.referral?.earnedDays || 0,
        referralsCount: fresh.referral?.referralsCount || 0,
        bonusActive: fresh.referral?.bonusActive || false,
        bonusExpiresAt: fresh.referral?.bonusExpiresAt || null,
        referredUsers: (fresh.referral?.referredUsers || []).map(u => ({
          userRole: u.userRole,
          daysAwarded: u.daysAwarded,
          registeredAt: u.registeredAt
        })),
        maxDays: subscriptionService.REFERRAL_MAX_DAYS,
        daysPerSignup: subscriptionService.REFERRAL_DAYS_PER_SIGNUP,
        programActive: subscriptionService.isReferralProgramActive(),
        programEndDate: process.env.REFERRAL_PROGRAM_END_DATE || null
      }
    });
  } catch (error) {
    console.error('GET /provider/subscription/referral-info error:', error);
    res.status(500).json({ success: false, message: 'Failed to load referral info' });
  }
});

export default router;
