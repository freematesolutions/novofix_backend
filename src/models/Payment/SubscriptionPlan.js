// models/Payment/SubscriptionPlan.js
import mongoose from 'mongoose';

const subscriptionPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: ['free', 'basic', 'pro'],
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
    leadLimit: {
      type: Number, // -1 para ilimitado
      required: true
    },
    visibilityMultiplier: {
      type: Number,
      required: true,
      min: 1.0
    },
    commissionRate: {
      type: Number, // porcentaje
      required: true,
      min: 0,
      max: 100
    },
    benefits: [{
      type: String,
      enum: [
        'priority_support',
        'advanced_analytics',
        'custom_profile',
        'featured_listing',
        'whatsapp_integration',
        'multiple_categories'
      ]
    }]
  },
  stripePriceId: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  metadata: {
    description: String,
    mostPopular: { type: Boolean, default: false },
    order: Number
  }
}, {
  timestamps: true
});

export default mongoose.model('SubscriptionPlan', subscriptionPlanSchema);