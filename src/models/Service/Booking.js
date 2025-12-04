// models/Service/Booking.js
import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: true
  },
  proposal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Proposal',
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
  schedule: {
    scheduledDate: {
      type: Date,
      required: true
    },
    scheduledTime: String,
    estimatedDuration: Number,
    timezone: String
  },
  status: {
    type: String,
    enum: [
      'confirmed',
      'provider_en_route',
      'in_progress',
      'completed',
      'cancelled',
      'disputed'
    ],
    default: 'confirmed'
  },
  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    notes: String,
    location: {
      coordinates: {
        lat: Number,
        lng: Number
      },
      address: String
    }
  }],
  payment: {
    totalAmount: Number,
    commission: {
      rate: Number,
      amount: Number
    },
    providerEarnings: Number,
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    stripePaymentIntentId: String,
    paymentMethod: String,
    paidAt: Date
  },
  serviceEvidence: {
    before: [{
      url: String,
      cloudinaryId: String,
      description: String,
      uploadedAt: Date
    }],
    during: [{
      url: String,
      cloudinaryId: String,
      description: String,
      uploadedAt: Date
    }],
    after: [{
      url: String,
      cloudinaryId: String,
      description: String,
      uploadedAt: Date
    }]
  },
  realTimeTracking: {
    providerLocation: {
      coordinates: {
        lat: Number,
        lng: Number
      },
      timestamp: Date,
      address: String
    },
    checkIn: {
      time: Date,
      location: {
        coordinates: {
          lat: Number,
          lng: Number
        },
        address: String
      }
    },
    checkOut: {
      time: Date,
      location: {
        coordinates: {
          lat: Number,
          lng: Number
        },
        address: String
      }
    }
  },
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat'
  },
  warranty: {
    provided: Boolean,
    duration: Number, // días
    startDate: Date,
    endDate: Date,
    terms: String
  },
  cancellation: {
    cancelledBy: {
      type: String,
      enum: ['client', 'provider', 'system']
    },
    reason: String,
    cancelledAt: Date,
    penaltyApplied: Boolean,
    penaltyAmount: Number
  },
  reminders: [{
    type: {
      type: String,
      enum: ['email', 'sms', 'push']
    },
    scheduledFor: Date,
    sent: { type: Boolean, default: false },
    sentAt: Date
  }]
}, {
  timestamps: true
});

// Índices para tracking y reporting
bookingSchema.index({ client: 1, createdAt: -1 });
bookingSchema.index({ provider: 1, status: 1 });
bookingSchema.index({ 'schedule.scheduledDate': 1 });
bookingSchema.index({ status: 1, 'schedule.scheduledDate': 1 });

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;