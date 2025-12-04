import { EVENTS } from '../constants/socketEvents.js';
import { ROOMS } from '../constants/socketRooms.js';
import { messageSchema, typingSchema, chatActionSchema } from '../schemas/messageSchema.js';
import { validatePayload } from '../middleware/schemaValidator.js';
import Chat from '../../models/Communication/Chat.js';
import Message from '../../models/Communication/Message.js';
import emitter from '../services/emitterService.js';

export class ChatHandler {
  constructor(io) {
    this.io = io;
  }

  initialize(socket) {
    // Bind event handlers
    socket.on(EVENTS.CHAT.JOIN, validatePayload(chatActionSchema), this.handleJoinChat.bind(this, socket));
    socket.on(EVENTS.CHAT.LEAVE, validatePayload(chatActionSchema), this.handleLeaveChat.bind(this, socket));
    socket.on(EVENTS.CHAT.MESSAGE.SEND, validatePayload(messageSchema), this.handleMessage.bind(this, socket));
    socket.on(EVENTS.CHAT.TYPING.START, validatePayload(typingSchema), this.handleTypingStart.bind(this, socket));
    socket.on(EVENTS.CHAT.TYPING.STOP, validatePayload(typingSchema), this.handleTypingStop.bind(this, socket));
  }

  async handleJoinChat(socket, { chatId }) {
    try {
      // Verificar acceso al chat
      const chat = await Chat.findOne({
        _id: chatId,
        $or: [
          { 'participants.client': socket.userId },
          { 'participants.provider': socket.userId }
        ]
      });

      if (!chat) {
        throw new Error('Chat not found or access denied');
      }

      socket.join(ROOMS.CHAT(chatId));
      console.log(`User ${socket.userId} joined chat: ${chatId}`);
    } catch (error) {
      socket.emit(EVENTS.CHAT.MESSAGE.ERROR, {
        chatId,
        error: error.message
      });
    }
  }

  handleLeaveChat(socket, { chatId }) {
    socket.leave(ROOMS.CHAT(chatId));
    console.log(`User ${socket.userId} left chat: ${chatId}`);
  }

  async handleMessage(socket, messageData) {
    const { chatId, content, type } = messageData;
    
    try {
      // Crear mensaje en la base de datos
      const message = new Message({
        chat: chatId,
        sender: socket.userId,
        senderModel: socket.userRole === 'client' ? 'Client' : 'Provider',
        content,
        type,
        status: 'sent'
      });

      await message.save();

      // Incrementar no leídos para el otro participante y emitir counters_update
      try {
        const chat = await Chat.findById(chatId).select('participants unreadCount');
        if (chat) {
          const senderIsClient = socket.userRole === 'client';
          if (senderIsClient) {
            chat.unreadCount.provider = (chat.unreadCount?.provider || 0) + 1;
            await chat.save();
            emitter.emitCountersUpdateToUserDebounced(chat.participants.provider, { reasons: ['chat_unread_inc'], chatId });
          } else {
            chat.unreadCount.client = (chat.unreadCount?.client || 0) + 1;
            await chat.save();
            emitter.emitCountersUpdateToUserDebounced(chat.participants.client, { reasons: ['chat_unread_inc'], chatId });
          }
        }
      } catch { /* ignore */ }

      // Emitir a todos en el chat (excepto al remitente)
      socket.to(ROOMS.CHAT(chatId)).emit(EVENTS.CHAT.MESSAGE.RECEIVED, {
        ...messageData,
        sender: socket.userData,
        timestamp: new Date(),
        status: 'delivered'
      });

      // Confirmar al remitente
      socket.emit(EVENTS.CHAT.MESSAGE.SENT, {
        ...messageData,
        timestamp: new Date(),
        status: 'sent'
      });

      console.log(`Message sent in chat ${chatId} by ${socket.userData.email}`);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit(EVENTS.CHAT.MESSAGE.ERROR, {
        error: 'Failed to send message',
        originalData: messageData
      });
    }
  }

  handleTypingStart(socket, { chatId }) {
    socket.to(ROOMS.CHAT(chatId)).emit(EVENTS.CHAT.TYPING.USER_TYPING, {
      userId: socket.userId,
      userName: socket.userData.name,
      chatId
    });
  }

  handleTypingStop(socket, { chatId }) {
    socket.to(ROOMS.CHAT(chatId)).emit(EVENTS.CHAT.TYPING.USER_STOPPED_TYPING, {
      userId: socket.userId,
      chatId
    });
  }
}