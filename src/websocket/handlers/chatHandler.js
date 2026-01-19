import { EVENTS } from '../constants/socketEvents.js';
import { ROOMS } from '../constants/socketRooms.js';
import { messageSchema, typingSchema, chatActionSchema } from '../schemas/messageSchema.js';
import Chat from '../../models/Communication/Chat.js';
import Message from '../../models/Communication/Message.js';
import emitter from '../services/emitterService.js';

export class ChatHandler {
  constructor(io) {
    this.io = io;
  }

  initialize(socket) {
    console.log(`🎯 ChatHandler.initialize: Binding events for socket ${socket.id}, userId=${socket.userId}`);
    // Bind event handlers (validation done inside each handler)
    socket.on(EVENTS.CHAT.JOIN, (data) => {
      console.log(`📥 Event ${EVENTS.CHAT.JOIN} received from socket ${socket.id}`);
      this.handleJoinChat(socket, data);
    });
    socket.on(EVENTS.CHAT.LEAVE, (data) => {
      console.log(`📥 Event ${EVENTS.CHAT.LEAVE} received from socket ${socket.id}`);
      this.handleLeaveChat(socket, data);
    });
    socket.on(EVENTS.CHAT.MESSAGE.SEND, (data) => {
      console.log(`📥 Event ${EVENTS.CHAT.MESSAGE.SEND} received from socket ${socket.id}, data=`, data);
      this.handleMessage(socket, data);
    });
    socket.on(EVENTS.CHAT.TYPING.START, (data) => this.handleTypingStart(socket, data));
    socket.on(EVENTS.CHAT.TYPING.STOP, (data) => this.handleTypingStop(socket, data));
    console.log(`✅ ChatHandler events bound for socket ${socket.id}`);
  }

  async handleJoinChat(socket, data) {
    try {
      // Validate data
      const { error, value } = chatActionSchema.validate(data);
      if (error) {
        return socket.emit(EVENTS.CHAT.MESSAGE.ERROR, {
          error: error.details.map(d => d.message).join(', ')
        });
      }

      const { chatId } = value;

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
        error: error.message
      });
    }
  }

  handleLeaveChat(socket, data) {
    try {
      // Validate data
      const { error, value } = chatActionSchema.validate(data);
      if (error) {
        return socket.emit(EVENTS.CHAT.MESSAGE.ERROR, {
          error: error.details.map(d => d.message).join(', ')
        });
      }

      const { chatId } = value;
      socket.leave(ROOMS.CHAT(chatId));
      console.log(`User ${socket.userId} left chat: ${chatId}`);
    } catch (error) {
      socket.emit(EVENTS.CHAT.MESSAGE.ERROR, {
        error: error.message
      });
    }
  }

  async handleMessage(socket, messageData) {
    console.log(`📨 handleMessage called: userId=${socket.userId}, userRole=${socket.userRole}, data=`, messageData);
    try {
      // Validate data
      const { error, value } = messageSchema.validate(messageData);
      if (error) {
        console.log(`❌ Message validation failed:`, error.details);
        return socket.emit(EVENTS.CHAT.MESSAGE.ERROR, {
          error: error.details.map(d => d.message).join(', ')
        });
      }

      console.log(`✅ Message validated:`, value);

      const { chatId, content, type, replyTo } = value;
      
      // Obtener el chat primero para determinar el rol del sender en este contexto
      const chat = await Chat.findById(chatId).select('participants unreadCount type relatedTo');
      if (!chat) {
        throw new Error('Chat not found');
      }
      
      // Determinar senderModel basado en la posición del usuario en el chat
      // No en sus roles globales, sino en si es el cliente o proveedor DE ESTE CHAT
      const senderIdStr = socket.userId;
      const chatClientId = chat.participants.client?.toString();
      const chatProviderId = chat.participants.provider?.toString();
      
      const senderIsClient = senderIdStr === chatClientId;
      const senderIsProvider = senderIdStr === chatProviderId;
      
      // Determinar senderModel por su posición en el chat
      let senderModel;
      if (senderIsClient) {
        senderModel = 'Client';
      } else if (senderIsProvider) {
        senderModel = 'Provider';
      } else {
        // Fallback: no debería ocurrir, pero usar lógica anterior por seguridad
        const userRoles = Array.isArray(socket.userData?.roles) ? socket.userData.roles : [socket.userRole];
        const isProvider = userRoles.includes('provider');
        const isClient = userRoles.includes('client');
        senderModel = (isProvider && !isClient) ? 'Provider' : 'Client';
      }

      // Validar replyTo si se proporciona
      let validReplyTo = null;
      if (replyTo) {
        const replyMessage = await Message.findOne({ _id: replyTo, chat: chatId });
        if (replyMessage) {
          validReplyTo = replyTo;
        }
      }
      
      console.log(`📝 Creating message: chatId=${chatId}, sender=${socket.userId}, senderModel=${senderModel}, senderIsClient=${senderIsClient}, senderIsProvider=${senderIsProvider}, replyTo=${validReplyTo || 'none'}`);
      
      // Crear mensaje en la base de datos
      const message = new Message({
        chat: chatId,
        sender: socket.userId,
        senderModel: senderModel,
        content,
        type,
        status: 'sent',
        replyTo: validReplyTo
      });

      await message.save();
      
      // Populate replyTo para incluir en la respuesta
      if (validReplyTo) {
        await message.populate('replyTo', 'content sender');
      }
      
      console.log(`💾 Message saved successfully: id=${message._id}`);

      // Determinar el receptor (el otro participante)
      const recipientId = senderIsClient 
        ? chatProviderId 
        : chatClientId;

      // Incrementar no leídos para el otro participante
      try {
        if (senderIsClient) {
          chat.unreadCount.provider = (chat.unreadCount?.provider || 0) + 1;
        } else {
          chat.unreadCount.client = (chat.unreadCount?.client || 0) + 1;
        }
        await chat.save();
        if (recipientId) {
          emitter.emitCountersUpdateToUserDebounced(recipientId, { reasons: ['chat_unread_inc'], chatId });
        }
      } catch { /* ignore */ }

      // Preparar payload del mensaje
      const messagePayload = {
        _id: String(message._id),
        chatId: String(chatId),
        chat: String(chatId),
        sender: {
          ...socket.userData,
          _id: String(socket.userData._id || socket.userData.id),
          id: String(socket.userData._id || socket.userData.id)
        },
        senderModel,
        content,
        type,
        createdAt: new Date().toISOString(),
        timestamp: new Date(),
        status: 'delivered',
        localId: value.localId,
        replyTo: validReplyTo
      };

      // Emitir a todos en la sala del chat (excepto al remitente)
      const roomName = ROOMS.CHAT(chatId);
      const socketsInRoom = await this.io.in(roomName).fetchSockets();
      console.log(`📡 Emitting to room ${roomName}, sockets in room: ${socketsInRoom.length}, excluding sender ${socket.id}`);
      socketsInRoom.forEach(s => console.log(`   - Socket ${s.id}, userId=${s.userId}`));
      
      socket.to(roomName).emit(EVENTS.CHAT.MESSAGE.RECEIVED, messagePayload);
      console.log(`📤 Emitted ${EVENTS.CHAT.MESSAGE.RECEIVED} to room ${roomName}`);

      // TAMBIÉN emitir al usuario receptor directamente (para notificaciones cuando no tiene el chat abierto)
      // PERO solo si el receptor NO está en la sala del chat (para evitar duplicados)
      if (recipientId) {
        // Verificar si el receptor está en la sala del chat
        const recipientInChatRoom = socketsInRoom.some(s => s.userId === recipientId);
        
        if (!recipientInChatRoom) {
          const userRoom = ROOMS.USER(recipientId);
          console.log(`📡 Recipient not in chat room, emitting to user room ${userRoom} for notifications`);
          this.io.to(userRoom).emit(EVENTS.CHAT.MESSAGE.RECEIVED, {
            ...messagePayload,
            chatType: chat.type,
            relatedTo: chat.relatedTo
          });
        } else {
          console.log(`📡 Recipient ${recipientId} already in chat room, skipping user room emission to avoid duplicate`);
        }
      }

      // Confirmar al remitente con el ID real del mensaje
      socket.emit(EVENTS.CHAT.MESSAGE.SENT, {
        _id: message._id,
        chatId: chatId,
        chat: chatId,
        localId: value.localId,
        createdAt: new Date().toISOString(),
        timestamp: new Date(),
        status: 'sent',
        content,
        type,
        sender: socket.userData,
        senderModel,
        replyTo: validReplyTo
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

  handleTypingStart(socket, data) {
    try {
      // Validate data
      const { error, value } = typingSchema.validate(data);
      if (error) {
        return;
      }

      const { chatId } = value;
      socket.to(ROOMS.CHAT(chatId)).emit(EVENTS.CHAT.TYPING.USER_TYPING, {
        userId: socket.userId,
        userName: socket.userData.name,
        chatId
      });
    } catch (error) {
      // Silent fail for typing indicators
    }
  }

  handleTypingStop(socket, data) {
    try {
      // Validate data
      const { error, value } = typingSchema.validate(data);
      if (error) {
        return;
      }

      const { chatId } = value;
      socket.to(ROOMS.CHAT(chatId)).emit(EVENTS.CHAT.TYPING.USER_STOPPED_TYPING, {
        userId: socket.userId,
        chatId
      });
    } catch (error) {
      // Silent fail for typing indicators
    }
  }
}