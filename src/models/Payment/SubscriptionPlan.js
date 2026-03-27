// models/Payment/SubscriptionPlan.js
import mongoose from 'mongoose';

const subscriptionPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: ['free', 'expert', 'elite'],
    required: true,
    unique: true
  },
  displayName: {
    type: String,
    required: true
  },
  price: {
    monthly: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'USD'
    }
  },
  features: {
    // Leads: -1 = ilimitado
    leadLimit: { type: Number, required: true },
    // Tipos de leads que recibe el plan
    leadTypes: {
      type: [String],
      enum: ['scheduled', 'urgent'],
      default: ['scheduled']
    },
    // Hora del lote diario para leads programados (-1 = inmediato, 0-23 = hora del día)
    scheduledLeadBatchHour: { type: Number, default: -1 },
    // Multiplicador de visibilidad en ranking / buscador
    visibilityMultiplier: { type: Number, required: true, min: 1.0 },
    // Máximo de videos en portafolio (-1 = ilimitado)
    maxPortfolioVideos: { type: Number, default: 1 },
    // Badge verificado visible en perfil
    verifiedBadge: { type: Boolean, default: false },
    // Acceso a reportes de rendimiento
    performanceReports: { type: Boolean, default: false },
    // Visitas al perfil visibles
    profileViewsVisible: { type: Boolean, default: false },
    // Soporte VIP
    vipSupport: { type: Boolean, default: false },
    // Prioridad de leads urgentes (mayor = recibe antes)
    urgentLeadPriority: { type: Number, default: 0 },
    // Beneficios legacy / extras
    benefits: [{
      type: String,
      enum: [
        'priority_support',
        'advanced_analytics',
        'custom_profile',
        'featured_listing',
        'whatsapp_integration',
        'multiple_categories',
        'verified_badge',
        'profile_views',
        'performance_reports',
        'vip_support',
        'urgent_leads_first'
      ]
    }]
  },
  // Stripe Price ID — vacío para plan gratuito
  stripePriceId: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  metadata: {
    description: String,
    descriptionEn: String,
    mostPopular: { type: Boolean, default: false },
    order: Number
  }
}, {
  timestamps: true
});

export default mongoose.model('SubscriptionPlan', subscriptionPlanSchema);