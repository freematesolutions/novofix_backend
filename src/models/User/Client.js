// models/User/Client.js
import mongoose from 'mongoose';
import User from './User.js';

const clientSchema = new mongoose.Schema({
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
  guestSessionId: String, // Para merge de sesión guest
  mergeCandidate: {
    sessionId: String,
    email: String,
    merged: { type: Boolean, default: false }
  }
});

const Client = User.discriminator('Client', clientSchema);
export default Client;