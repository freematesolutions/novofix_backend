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
      enum: ['email', 'sms', 'push', 'in_app']
    },
    scheduledFor: Date,
    sent: { type: Boolean, default: false },
    sentAt: Date,
    window: { type: String, enum: ['24h', '2h'], default: undefined }
  }],
  invoice: {
    invoiceNumber: String,
    invoiceDate: Date,
    dueDate: Date,
    items: [{
      description: String,
      qty: Number,
      unitPrice: Number,
      total: Number
    }],
    subtotal: Number,
    discount: Number,
    taxRate: Number,
    tax: Number,
    shipping: Number,
    total: Number,
    currency: { type: String, default: 'USD' },
    notes: String,
    pdfUrl: String,
    businessInfo: {
      name: String,
      address: String,
      phone: String,
      email: String
    },
    clientInfo: {
      name: String,
      address: String,
      city: String,
      state: String,
      zip: String
    },
    sentAt: Date,
    sentViaChat: { type: Boolean, default: false },
    viewedAt: Date,
    viewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  // Nudge de reseña: seguimiento de recordatorios enviados al cliente
  reviewNudge: {
    nudgeSentAt: { type: Date, default: null },
    nudgeCount: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Índices para tracking y reporting
bookingSchema.index({ client: 1, createdAt: -1 });
bookingSchema.index({ provider: 1, status: 1 });
bookingSchema.index({ 'schedule.scheduledDate': 1 });
bookingSchema.index({ status: 1, 'schedule.scheduledDate': 1 });

/**
 * Middleware: cuando un booking pasa a estado 'completed' (o se crea
 * directamente con ese estado, como ocurre en el flujo de aceptación
 * de propuesta), incrementamos el contador real de contrataciones
 * del proveedor (providerProfile.stats.completedJobs).
 *
 * Esto es la fuente única de verdad para el badge "contrataciones"
 * en las tarjetas de proveedor del frontend. Antes este campo nunca
 * se actualizaba y los badges siempre mostraban 0.
 */
bookingSchema.pre('save', function trackCompletionTransition(next) {
  // Marcar si esta operación debe disparar el incremento en post-save
  if (this.isNew) {
    this.__incrementCompletedJobs = this.status === 'completed';
  } else if (this.isModified('status') && this.status === 'completed') {
    this.__incrementCompletedJobs = true;
  } else {
    this.__incrementCompletedJobs = false;
  }
  next();
});

bookingSchema.post('save', async function syncProviderCompletedJobs(doc, next) {
  try {
    if (doc.__incrementCompletedJobs && doc.provider) {
      const Provider = mongoose.model('Provider');
      await Provider.updateOne(
        { _id: doc.provider },
        { $inc: { 'providerProfile.stats.completedJobs': 1 } }
      );
    }
  } catch (err) {
    // No bloqueamos el flujo principal por un error de stats
    console.warn('[Booking.post(save)] Failed to increment provider completedJobs:', err?.message);
  } finally {
    if (typeof next === 'function') next();
  }
});

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;