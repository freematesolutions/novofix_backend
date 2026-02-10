// models/Service/Review.js
import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true
  },
  rating: {
    overall: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    categories: {
      professionalism: { type: Number, min: 1, max: 5 },
      quality: { type: Number, min: 1, max: 5 },
      punctuality: { type: Number, min: 1, max: 5 },
      communication: { type: Number, min: 1, max: 5 },
      value: { type: Number, min: 1, max: 5 }
    }
  },
  review: {
    title: String,
    comment: {
      type: String,
      required: true
    },
    photos: [{
      url: String,
      cloudinaryId: String
    }]
  },
  providerResponse: {
    comment: String,
    respondedAt: Date,
    editedAt: Date
  },
  // Traducciones automáticas de la reseña y respuesta
  translations: {
    es: {
      title: String,
      comment: String,
      providerResponseComment: String
    },
    en: {
      title: String,
      comment: String,
      providerResponseComment: String
    }
  },
  originalLanguage: {
    type: String,
    enum: ['es', 'en'],
    default: 'es'
  },
  status: {
    type: String,
    enum: ['active', 'flagged', 'removed'],
    default: 'active'
  },
  moderation: {
    flagged: { type: Boolean, default: false },
    flaggedBy: {
      type: String,
      enum: ['system', 'admin', 'user']
    },
    flagReason: String,
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    moderatedAt: Date,
    action: {
      type: String,
      enum: ['approved', 'edited', 'removed']
    }
  },
  helpfulness: {
    helpful: { type: Number, default: 0 },
    notHelpful: { type: Number, default: 0 },
    reported: { type: Number, default: 0 }
  },
  // Feedback opcional sobre la plataforma NovoFix
  platformFeedback: {
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
    wouldRecommend: Boolean,
    translations: {
      es: { comment: String },
      en: { comment: String }
    }
  },
  metadata: {
    verifiedPurchase: { type: Boolean, default: true },
    editHistory: [{
      previousComment: String,
      editedAt: Date,
      reason: String
    }]
  }
}, {
  timestamps: true
});

// Índices para ratings y búsquedas
reviewSchema.index({ provider: 1, createdAt: -1 });
reviewSchema.index({ 'rating.overall': -1 });
reviewSchema.index({ booking: 1 }, { unique: true });
reviewSchema.index({ client: 1, provider: 1 });
// Índice para reviews con fotos (para la sección de testimonios)
reviewSchema.index({ 'review.photos': 1, status: 1, 'rating.overall': -1 });
// Índice para feedback de plataforma
reviewSchema.index({ 'platformFeedback.rating': -1 });

export default mongoose.model('Review', reviewSchema);