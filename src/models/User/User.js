// models/User/User.js
import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: function() {
      return this.role !== 'guest';
    }
  },
  // role se maneja automáticamente por el discriminatorKey
  profile: {
    firstName: String,
    lastName: String,
    phone: String,
    avatar: String,
    dateOfBirth: Date
  },
  contact: {
    address: String,
    city: String,
    state: String,
    zipCode: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  // roles adicionales para soportar multi-rol (client, provider, admin)
  roles: {
    type: [String],
    default: []
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: Date,
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    },
    language: { type: String, default: 'es' }
  }
}, {
  timestamps: true,
  discriminatorKey: 'role'
});

userSchema.pre('save', async function(next) {
  // Hash password si cambió
  if (this.isModified('password')) {
    this.password = await bcryptjs.hash(this.password, 12);
  }

  // Asegurar coherencia entre role primario (discriminator) y roles[]
  const primary = String(this.role || '').toLowerCase();
  if (!Array.isArray(this.roles)) this.roles = [];
  if (primary && !this.roles.includes(primary)) this.roles.push(primary);

  // Si es provider, asegurar que incluye 'client' por jerarquía natural
  if (primary === 'provider' && !this.roles.includes('client')) {
    this.roles.push('client');
  }

  // Normalizar a minúsculas y únicos
  this.roles = Array.from(new Set(this.roles.map(r => String(r).toLowerCase())));

  next();
});

userSchema.methods.correctPassword = async function(candidatePassword, userPassword) {
  return await bcryptjs.compare(candidatePassword, userPassword);
};

const User = mongoose.model('User', userSchema);
export default User;