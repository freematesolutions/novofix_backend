// routes/provider/subscription.routes.js
import express from 'express';
import { authenticateJWT, requireAuth } from '../../middlewares/auth/jwtAuth.js';
import { providerOnly } from '../../middlewares/auth/rbacMiddleware.js';
import subscriptionService from '../../services/internal/subscriptionService.js';
import SubscriptionPlan from '../../models/Payment/SubscriptionPlan.js';
import Provider from '../../models/User/Provider.js';

const router = express.Router();

router.use(authenticateJWT);
router.use(requireAuth);
router.use(providerOnly);

// List active plans
router.get('/plans', async (req, res) => {
  try {
    await subscriptionService.ensurePlansSeeded();
    const plans = await SubscriptionPlan.find({ isActive: true })
      .sort({ 'metadata.order': 1 })
      .lean();
    res.json({ success: true, data: { plans } });
  } catch (error) {
    console.error('GET /provider/subscription/plans error:', error);
    res.status(500).json({ success: false, message: 'Failed to load plans' });
  }
});

// Current subscription status
router.get('/status', async (req, res) => {
  try {
    const provider = await Provider.findById(req.user._id).lean();
    const canLead = await subscriptionService.canReceiveLead(provider);
    const charge = await subscriptionService.computeMonthlyCharge(provider);
    res.json({
      success: true,
      data: {
        subscription: provider.subscription,
        plan: await subscriptionService.getPlan(provider.subscription?.plan || 'free'),
        canReceiveLead: canLead,
        monthlyCharge: charge
      }
    });
  } catch (error) {
    console.error('GET /provider/subscription/status error:', error);
    res.status(500).json({ success: false, message: 'Failed to get subscription status' });
  }
});

// Change plan
router.post('/change', async (req, res) => {
  try {
    const { planName } = req.body || {};
    if (!['free', 'basic', 'pro'].includes(planName)) {
      return res.status(400).json({ success: false, message: 'Invalid plan' });
    }
    await subscriptionService.changePlan(req.user._id, planName);
    const provider = await Provider.findById(req.user._id).lean();
    res.json({ success: true, message: 'Plan actualizado', data: { subscription: provider.subscription } });
  } catch (error) {
    console.error('POST /provider/subscription/change error:', error);
    res.status(500).json({ success: false, message: 'Failed to change plan' });
  }
});

// Apply referral code (current provider sets who referred them)
router.post('/apply-referral', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }
    const refId = await subscriptionService.applyReferralCode(code);
    if (!refId) return res.status(404).json({ success: false, message: 'Referral code not found' });
    await Provider.findByIdAndUpdate(req.user._id, { $set: { 'referral.referredBy': refId } });
    res.json({ success: true, message: 'Código aplicado' });
  } catch (error) {
    console.error('POST /provider/subscription/apply-referral error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply referral code' });
  }
});

export default router;
