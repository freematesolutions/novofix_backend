// models/Communication/Message.js
import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'senderModel',
    required: true
  },
  senderModel: {
    type: String,
    enum: ['Client', 'Provider'],
    required: true
  },
  content: {
    text: String,
    attachments: [{
      type: {
        type: String,
        enum: ['image', 'document', 'audio', 'location']
      },
      url: String,
      cloudinaryId: String,
      caption: String,
      metadata: Object
    }]
  },
  type: {
    type: String,
    enum: ['text', 'image', 'document', 'system', 'location'],
    default: 'text'
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'readBy.userModel'
    },
    userModel: {
      type: String,
      enum: ['Client', 'Provider']
    },
    readAt: Date
  }],
  metadata: {
    timestamp: { type: Date, default: Date.now },
    edited: { type: Boolean, default: false },
    editHistory: [{
      previousContent: String,
      editedAt: Date
    }],
    deleted: { type: Boolean, default: false },
    deletedAt: Date
  }
});

messageSchema.index({ chat: 1, 'metadata.timestamp': 1 });
messageSchema.index({ sender: 1, 'metadata.timestamp': 1 });

const Message = mongoose.model('Message', messageSchema);
export default Message;