// routes/shared/stripeWebhook.routes.js
// This route MUST receive the raw body (not parsed JSON) for signature verification.
// It is mounted in app.js BEFORE express.json() AND before session/auth middleware
// because Stripe webhooks are server-to-server calls that don't carry JWT/sessions.
import express from 'express';
import stripeService from '../../services/external/payment/stripeService.js';
import subscriptionService from '../../services/internal/subscriptionService.js';

const router = express.Router();

/**
 * GET /webhooks/stripe
 * Health-check so visiting the URL in a browser confirms the endpoint exists.
 * Stripe never sends GET — this is purely informational.
 */
router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Stripe webhook endpoint is active. Only POST requests from Stripe are processed.',
    method: 'GET (informational only)'
  });
});

/**
 * POST /webhooks/stripe
 * Stripe sends events here. We verify the signature and process subscription events.
 */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const isDev = process.env.NODE_ENV !== 'production';
  const isPlaceholder = !secret || secret.includes('REPLACE');

  let event;

  try {
    if (isPlaceholder && isDev) {
      // ─── DEV fallback: no real webhook secret configured yet ───
      // Parse the body as JSON directly (UNSAFE — never do this in production)
      console.warn('[StripeWebhook] ⚠️  DEV MODE: Skipping signature verification (STRIPE_WEBHOOK_SECRET is placeholder)');
      event = JSON.parse(req.body.toString());
    } else if (isPlaceholder) {
      // ─── PRODUCTION with no secret → reject ───
      console.error('[StripeWebhook] ❌ STRIPE_WEBHOOK_SECRET not configured — webhook rejected');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    } else {
      // ─── Normal path: verify Stripe signature ───
      if (!signature) {
        console.warn('[StripeWebhook] Missing stripe-signature header');
        return res.status(400).json({ error: 'Missing signature' });
      }
      event = stripeService.stripe.webhooks.constructEvent(
        req.body,       // raw Buffer
        signature,
        secret
      );
    }
  } catch (err) {
    console.error('[StripeWebhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Process the event asynchronously but respond 200 quickly
  try {
    console.log(`[StripeWebhook] Processing event: ${event.type} (${event.id || 'no-id'})`);
    await subscriptionService.handleSubscriptionEvent(event);
  } catch (err) {
    // Log but don't fail — Stripe will retry
    console.error('[StripeWebhook] Error processing event:', event.type, err.message);
  }

  // Always acknowledge receipt to Stripe
  res.json({ received: true });
});

export default router;
