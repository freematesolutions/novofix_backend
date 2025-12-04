// models/System/PasswordResetToken.js
import mongoose from 'mongoose';

const passwordResetTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  tokenHash: {
    type: String,
    required: true,
    index: true
  },
  // Marca de uso para invalidar después de consumir
  usedAt: {
    type: Date,
    default: null
  },
  // Fecha de expiración
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  },
  // Metadatos opcionales
  createdAt: {
    type: Date,
    default: Date.now
  },
  ip: String,
  userAgent: String
});

passwordResetTokenSchema.index({ user: 1, tokenHash: 1 }, { unique: true });

const PasswordResetToken = mongoose.model('PasswordResetToken', passwordResetTokenSchema);
export default PasswordResetToken;
