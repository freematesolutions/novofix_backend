// models/Communication/Chat.js
import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
  participants: {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      required: true
    }
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'archived', 'blocked'],
    default: 'active'
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  unreadCount: {
    client: { type: Number, default: 0 },
    provider: { type: Number, default: 0 }
  },
  metadata: {
    createdAt: { type: Date, default: Date.now },
    lastActivity: Date
  }
});

chatSchema.index({ 'participants.client': 1, 'participants.provider': 1 });
chatSchema.index({ booking: 1 });
chatSchema.index({ 'metadata.lastActivity': -1 });

const Chat = mongoose.model('Chat', chatSchema);
export default Chat;
