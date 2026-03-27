// services/internal/nudgeProcessor.js
// Polls the PendingNudge collection periodically and sends due nudges.
// Replaces volatile setTimeout — survives server restarts and deployments.
import PendingNudge from '../../models/Communication/PendingNudge.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
let intervalId = null;

/**
 * Schedule a review nudge (client side — "rate your completed service").
 * @param {{ bookingId, clientId, providerId, providerName }} data
 * @param {number} delayMs — default 24 hours
 */
export async function scheduleReviewNudge({ bookingId, clientId, providerId, providerName }, delayMs = 24 * 60 * 60 * 1000) {
  const scheduledAt = new Date(Date.now() + delayMs);
  await PendingNudge.create({
    type: 'review_nudge',
    scheduledAt,
    data: { bookingId, clientId, providerId, providerName }
  });
}

/**
 * Schedule a response nudge (provider side — "a review awaits your reply").
 * @param {{ reviewId, providerId }} data
 * @param {number} delayMs — default 48 hours
 */
export async function scheduleResponseNudge({ reviewId, providerId }, delayMs = 48 * 60 * 60 * 1000) {
  const scheduledAt = new Date(Date.now() + delayMs);
  await PendingNudge.create({
    type: 'response_nudge',
    scheduledAt,
    data: { reviewId, providerId }
  });
}

/**
 * Process all due nudges. Called by the polling interval.
 */
async function processDueNudges() {
  const now = new Date();
  const dueNudges = await PendingNudge.find({
    processed: false,
    scheduledAt: { $lte: now }
  }).limit(50); // batch limit to avoid overload

  if (dueNudges.length === 0) return;

  // Lazy-import heavy dependencies to avoid circular imports at module load
  const notificationService = (await import('../external/notificationService.js')).default;
  const Review = (await import('../../models/Service/Review.js')).default;
  const Booking = (await import('../../models/Service/Booking.js')).default;

  for (const nudge of dueNudges) {
    try {
      if (nudge.type === 'review_nudge') {
        await processReviewNudge(nudge, { notificationService, Review, Booking });
      } else if (nudge.type === 'response_nudge') {
        await processResponseNudge(nudge, { notificationService, Review });
      }
    } catch (err) {
      console.warn(`[NudgeProcessor] Error processing nudge ${nudge._id}:`, err.message);
    }
    // Mark as processed regardless (don't retry failed nudges forever)
    nudge.processed = true;
    await nudge.save();
  }
}

/**
 * Send a "rate your service" nudge to a client, 24h after booking completion.
 */
async function processReviewNudge(nudge, { notificationService, Review, Booking }) {
  const { bookingId, clientId, providerName } = nudge.data;

  const booking = await Booking.findById(bookingId);
  if (!booking || booking.status !== 'completed') return;

  // Skip if nudge was already sent (legacy field) or review already exists
  if (booking.reviewNudge?.nudgeSentAt) return;
  const existingReview = await Review.findOne({ booking: bookingId });
  if (existingReview) return;

  await notificationService.sendClientNotification({
    clientId,
    type: 'REVIEW_NUDGE',
    data: { bookingId, providerName: providerName || '' }
  });

  // Mark nudge as sent on the booking (backward compat)
  await Booking.updateOne(
    { _id: bookingId },
    { $set: { 'reviewNudge.nudgeSentAt': new Date(), 'reviewNudge.nudgeCount': 1 } }
  );
}

/**
 * Send a "respond to review" nudge to a provider, 48h after receiving a review.
 */
async function processResponseNudge(nudge, { notificationService, Review }) {
  const { reviewId, providerId } = nudge.data;

  const review = await Review.findById(reviewId).lean();
  if (!review) return;

  // Skip if provider already responded
  if (review.providerResponse?.comment) return;

  await notificationService.sendProviderNotification({
    providerId,
    type: 'REVIEW_RESPONSE_NUDGE',
    data: { reviewId, rating: review.rating?.overall || 0 }
  });
}

/**
 * Start the polling loop. Call once at server startup.
 */
export function startNudgeProcessor() {
  if (intervalId) return; // already running

  // Process any overdue nudges immediately (e.g., accumulated during downtime)
  processDueNudges().catch(err => {
    console.warn('[NudgeProcessor] Initial processing error:', err.message);
  });

  intervalId = setInterval(() => {
    processDueNudges().catch(err => {
      console.warn('[NudgeProcessor] Polling error:', err.message);
    });
  }, POLL_INTERVAL_MS);

  console.log('[NudgeProcessor] Started — polling every 5 minutes');
}

/**
 * Stop the polling loop (for graceful shutdown / tests).
 */
export function stopNudgeProcessor() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export default {
  scheduleReviewNudge,
  scheduleResponseNudge,
  startNudgeProcessor,
  stopNudgeProcessor
};
