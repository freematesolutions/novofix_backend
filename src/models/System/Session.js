// models/System/Session.js
import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  // Optional stable client identifier (from header X-Client-Id)
  clientId: {
    type: String,
    index: true,
    sparse: true,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  userType: {
    type: String,
    enum: ['guest', 'client', 'provider', 'admin']
  },
  guestData: {
    email: String,
    phone: String,
    temporaryContact: {
      firstName: String,
      lastName: String,
      phone: String
    },
    serviceRequests: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest'
    }]
  },
  deviceInfo: {
    userAgent: String,
    ipAddress: String,
    deviceType: String
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  },
  metadata: {
    createdAt: { type: Date, default: Date.now },
    loginAttempts: { type: Number, default: 0 },
    blocked: { type: Boolean, default: false }
  }
});

// El índice sessionId ya está definido como unique en el esquema
sessionSchema.index({ user: 1 });
sessionSchema.index({ lastActivity: 1 });

const Session = mongoose.model('Session', sessionSchema);
export default Session;