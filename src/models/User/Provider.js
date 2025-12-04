// models/User/Provider.js
import mongoose from 'mongoose';
import User from './User.js';
import { SERVICE_CATEGORIES } from '../../config/categories.js';

const providerSchema = new mongoose.Schema({
  // Para soporte de auto-merge desde sesiones guest
  guestSessionId: String,
  mergeCandidate: {
    sessionId: String,
    email: String,
    merged: { type: Boolean, default: false }
  },
  // Permitir también tener perfil de cliente en proveedores (multi-rol)
  clientProfile: {
    serviceHistory: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking'
    }],
    favoriteProviders: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider'
    }],
    totalSpent: {
      type: Number,
      default: 0
    },
    serviceCount: {
      type: Number,
      default: 0
    }
  },
  providerProfile: {
    businessName: String,
    description: String,
    services: [{
      category: {
        type: String,
        enum: SERVICE_CATEGORIES,
        required: true
      },
      name: String, // Nombre específico del servicio
      description: String,
      subcategories: [String],
      experience: Number // años de experiencia
    }],
    qualifications: {
      licenses: [{
        type: String,
        number: String,
        expiry: Date
      }],
      certifications: [String],
      insurance: {
        hasInsurance: Boolean,
        provider: String,
        policyNumber: String,
        expiry: Date
      }
    },
    serviceArea: {
      radius: Number, // millas
      zones: [String],
      // Convenience numeric fields (may be provided by client)
      coordinates: {
        lat: Number,
        lng: Number
      },
      // GeoJSON point used for geospatial queries (authoritative for $near)
      location: {
        type: {
          type: String,
          enum: ['Point']
        },
        coordinates: {
          type: [Number] // [lng, lat]
        }
      }
    },
    availability: {
      workingHours: {
        monday: { start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' }, available: { type: Boolean, default: false } },
        tuesday: { start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' }, available: { type: Boolean, default: false } },
        wednesday: { start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' }, available: { type: Boolean, default: false } },
        thursday: { start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' }, available: { type: Boolean, default: false } },
        friday: { start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' }, available: { type: Boolean, default: false } },
        saturday: { start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' }, available: { type: Boolean, default: false } },
        sunday: { start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' }, available: { type: Boolean, default: false } }
      },
      exceptions: [{
        date: Date,
        reason: String,
        allDay: Boolean,
        startTime: String,
        endTime: String
      }]
    },
    rating: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
      breakdown: {
        professionalism: { type: Number, default: 0 },
        quality: { type: Number, default: 0 },
        punctuality: { type: Number, default: 0 },
        communication: { type: Number, default: 0 }
      }
    },
    stats: {
      completedJobs: { type: Number, default: 0 },
      responseRate: { type: Number, default: 0 },
      acceptanceRate: { type: Number, default: 0 },
      cancellationRate: { type: Number, default: 0 }
    },
    // Portfolio de trabajos realizados (imágenes y videos)
    portfolio: [{
      url: { type: String, required: true },
      cloudinaryId: String,
      type: { type: String, enum: ['image', 'video'], required: true },
      caption: String,
      category: { type: String, enum: SERVICE_CATEGORIES }, // Categoría asociada
      uploadedAt: { type: Date, default: Date.now }
    }]
  },
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'basic', 'pro'],
      default: 'free'
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'canceled', 'past_due'],
      default: 'inactive'
    },
    stripeSubscriptionId: String,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: Boolean,
    leadsUsed: { type: Number, default: 0 },
    lastLeadAt: Date
  },
  billing: {
    commissionRate: Number, // Según plan (15%, 12%, 8%)
    taxId: String,
    paymentMethod: {
      type: String,
      enum: ['bank_transfer', 'paypal', 'stripe']
    },
    bankAccount: {
      accountHolder: String,
      accountNumber: String,
      bankName: String,
      routingNumber: String
    }
  },
  referral: {
    code: String,
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider'
    },
    referralsCount: { type: Number, default: 0 },
    discountMonths: { type: Number, default: 0 }
  },
  score: {
    total: { type: Number, default: 0 },
    lastCalculated: Date,
    factors: {
      ratingVolume: Number,    // Rating Promedio × Factor Volumen
      consistencyPoints: Number, // Puntos por Consistencia
      planMultiplier: Number   // Multiplicador del Plan
    }
  }
});

// Índices para búsqueda eficiente
providerSchema.index({ 'providerProfile.services.category': 1 });
providerSchema.index(
  { 'providerProfile.serviceArea.location': '2dsphere' },
  { partialFilterExpression: { role: 'Provider' } }
);
providerSchema.index({ 'subscription.plan': 1, 'score.total': -1 });
providerSchema.index({ 'referral.code': 1 }, { unique: false });

const Provider = User.discriminator('Provider', providerSchema);
export default Provider;

// Sanitize invalid GeoJSON before saving
providerSchema.pre('validate', function(next) {
  try {
    const loc = this?.providerProfile?.serviceArea?.location;
    if (!loc) return next();
    const coords = loc.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
      // Remove invalid location to avoid 2dsphere index errors
      this.providerProfile.serviceArea.location = undefined;
    }
    next();
  } catch (e) {
    next();
  }
});