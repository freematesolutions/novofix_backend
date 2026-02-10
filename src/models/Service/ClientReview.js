// models/Service/ClientReview.js
// Reseña del proveedor hacia el cliente (bidireccional)
import mongoose from 'mongoose';

const clientReviewSchema = new mongoose.Schema({
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
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
      communication: { type: Number, min: 1, max: 5 },     // Comunicación clara
      punctuality: { type: Number, min: 1, max: 5 },        // Puntualidad/disponibilidad
      respect: { type: Number, min: 1, max: 5 },            // Trato respetuoso
      clarity: { type: Number, min: 1, max: 5 },            // Claridad en requerimientos
      payment: { type: Number, min: 1, max: 5 }             // Pago a tiempo
    }
  },
  review: {
    comment: {
      type: String,
      maxLength: 1000
    }
  },
  // Feedback sobre la plataforma NovoFix (desde perspectiva del proveedor)
  platformFeedback: {
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String, maxLength: 500 },
    wouldRecommend: Boolean,
    // Aspectos específicos de la plataforma para proveedores
    aspects: {
      easeOfUse: { type: Number, min: 1, max: 5 },          // Facilidad de uso
      clientQuality: { type: Number, min: 1, max: 5 },      // Calidad de clientes
      paymentProcess: { type: Number, min: 1, max: 5 },     // Proceso de pago
      support: { type: Number, min: 1, max: 5 }             // Soporte de NovoFix
    },
    translations: {
      es: { comment: String },
      en: { comment: String }
    }
  },
  // Traducciones del comentario de la reseña
  translations: {
    es: { comment: String },
    en: { comment: String }
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
  }
}, {
  timestamps: true
});

// Índices
clientReviewSchema.index({ booking: 1 }, { unique: true });
clientReviewSchema.index({ provider: 1, createdAt: -1 });
clientReviewSchema.index({ client: 1, createdAt: -1 });
clientReviewSchema.index({ 'rating.overall': -1 });
clientReviewSchema.index({ 'platformFeedback.rating': -1 });

export default mongoose.model('ClientReview', clientReviewSchema);
