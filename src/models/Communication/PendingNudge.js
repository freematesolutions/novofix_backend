// models/Communication/PendingNudge.js
// Persistent storage for scheduled nudge notifications.
// Replaces volatile setTimeout — nudges survive server restarts.
import mongoose from 'mongoose';

const pendingNudgeSchema = new mongoose.Schema({
  // Nudge type: 'review_nudge' (client, 24h) | 'response_nudge' (provider, 48h)
  type: {
    type: String,
    enum: ['review_nudge', 'response_nudge'],
    required: true
  },
  // When the nudge should be sent
  scheduledAt: {
    type: Date,
    required: true,
    index: true
  },
  // Whether this nudge has been processed (sent or skipped)
  processed: {
    type: Boolean,
    default: false,
    index: true
  },
  // Data needed to evaluate & send the nudge
  data: {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    reviewId: { type: mongoose.Schema.Types.ObjectId, ref: 'Review' },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    providerName: String
  }
}, {
  timestamps: true
});

// Compound index for efficient polling: find unprocessed nudges due now
pendingNudgeSchema.index({ processed: 1, scheduledAt: 1 });

const PendingNudge = mongoose.model('PendingNudge', pendingNudgeSchema);
export default PendingNudge;
