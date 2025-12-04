// models/Service/ServiceRequest.js
import mongoose from 'mongoose';
import { SERVICE_CATEGORIES } from '../../config/categories.js';

const serviceRequestSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  guestSessionId: String, // Para requests de usuarios no registrados
  basicInfo: {
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true
    },
    category: {
      type: String,
      enum: SERVICE_CATEGORIES,
      required: true
    },
    subcategory: String,
    urgency: {
      type: String,
      enum: ['immediate', 'scheduled'],
      required: true
    }
  },
  location: {
    address: {
      type: String,
      required: true
    },
    city: String,
    state: String,
    zipCode: String,
    // Convenience numeric coordinates (not used for geo queries)
    coordinates: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    },
    // GeoJSON point for geospatial queries ($near, etc.)
    location: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: {
        type: [Number] // [lng, lat]
      }
    },
    instructions: String
  },
  scheduling: {
    preferredDate: Date,
    preferredTime: String,
    flexibility: {
      type: String,
      enum: ['strict', 'flexible', 'very_flexible']
    }
  },
  budget: {
    amount: { type: Number, min: 0 },
    currency: { type: String, default: 'USD' }
  },
  media: {
    photos: [{
      url: String,
      cloudinaryId: String,
      caption: String
    }],
    videos: [{
      url: String,
      cloudinaryId: String,
      caption: String
    }]
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'active', 'expired', 'cancelled', 'completed', 'archived'],
    default: 'draft'
  },
  visibility: {
    type: String,
    enum: ['auto', 'directed'],
    default: 'auto'
  },
  selectedProviders: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider'
  }],
  eligibleProviders: [{
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider'
    },
    score: Number,
    notified: { type: Boolean, default: false },
    notifiedAt: Date
  }],
  proposals: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Proposal'
  }],
  acceptedProposal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Proposal'
  },
  expiryDate: Date,
  metadata: {
    views: { type: Number, default: 0 },
    providerViews: { type: Number, default: 0 },
    proposalCount: { type: Number, default: 0 },
    lastProviderNotified: Date,
    archivedAt: Date
  }
}, {
  timestamps: true
});

// Índices para búsqueda y matching
serviceRequestSchema.index({ 'basicInfo.category': 1 });
// Use GeoJSON point for 2dsphere queries
serviceRequestSchema.index({ 'location.location': '2dsphere' });
serviceRequestSchema.index({ 'basicInfo.urgency': 1 });
serviceRequestSchema.index({ status: 1, createdAt: -1 });
serviceRequestSchema.index({ expiryDate: 1 }, { expireAfterSeconds: 0 });

const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);
export default ServiceRequest;

// Sanitize invalid GeoJSON before saving to avoid 2dsphere index errors
serviceRequestSchema.pre('validate', function(next) {
  try {
    const loc = this?.location?.location;
    if (!loc) return next();
    const coords = loc.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
      this.location.location = undefined; // drop invalid geometry
    }
    next();
  } catch (e) {
    next();
  }
});