// models/Service/Proposal.js
import mongoose from 'mongoose';

const proposalSchema = new mongoose.Schema({
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: true
  },
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true
  },
  pricing: {
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'USD'
    },
    breakdown: {
      labor: Number,
      materials: Number,
      transportation: Number,
      taxes: Number
    },
    paymentTerms: {
      type: String,
      enum: ['full_upfront', '50_50', 'upon_completion'],
      default: 'upon_completion'
    }
  },
  timing: {
    estimatedHours: Number,
    startDate: Date,
    completionDate: Date,
    availability: [{
      date: Date,
      timeSlots: [String]
    }]
  },
  terms: {
    warranty: {
      provided: Boolean,
      duration: Number, // días
      conditions: String
    },
    materialsIncluded: Boolean,
    cleanupIncluded: Boolean,
    additionalTerms: String
  },
  message: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'cancelled'],
    default: 'draft'
  },
  attachments: [{
    type: {
      type: String,
      enum: ['photo', 'document', 'certificate']
    },
    url: String,
    cloudinaryId: String,
    description: String
  }],
  revisions: [{
    version: Number,
    pricing: {
      amount: Number,
      breakdown: Object
    },
    message: String,
    createdAt: { type: Date, default: Date.now }
  }],
  commission: {
    rate: Number, // % comisión según plan del provider
    amount: Number,
    calculatedAt: Date
  },
  expiryDate: Date,
  metadata: {
    viewCount: { type: Number, default: 0 },
    responseTime: Number, // minutos desde notificación hasta envío
    lastViewed: Date
  }
}, {
  timestamps: true
});

// Índices para consultas frecuentes
proposalSchema.index({ serviceRequest: 1, provider: 1 }, { unique: true });
proposalSchema.index({ status: 1, createdAt: -1 });
proposalSchema.index({ provider: 1, status: 1 });
proposalSchema.index({ expiryDate: 1 }, { expireAfterSeconds: 0 });

const Proposal = mongoose.model('Proposal', proposalSchema);
export default Proposal;