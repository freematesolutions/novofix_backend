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
    required: false // Optional for system messages
  },
  senderModel: {
    type: String,
    enum: ['Client', 'Provider', 'System'],
    required: true
  },
  content: {
    text: String,
    attachments: [{
      type: {
        type: String,
        enum: ['image', 'video', 'document', 'audio', 'location']
      },
      url: String,
      cloudinaryId: String,
      caption: String,
      metadata: Object
    }]
  },
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'document', 'system', 'location'],
    default: 'text'
  },
  // Respuesta a otro mensaje (reply)
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  // Reacciones al mensaje
  reactions: [{
    emoji: {
      type: String,
      required: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'reactions.userModel'
    },
    userModel: {
      type: String,
      enum: ['Client', 'Provider']
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
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