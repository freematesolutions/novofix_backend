// models/Communication/Notification.js
import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'userType'
  },
  userType: {
    type: String,
    required: true,
    enum: ['Client', 'Provider', 'Admin']
  },
  type: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: String,
  data: {
    type: Object,
    default: {}
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'failed'],
    default: 'sent'
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  expiresAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ read: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;