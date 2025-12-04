// controllers/chatController.js
import Chat from '../models/Communication/Chat.js';
import Message from '../models/Communication/Message.js';
import Booking from '../models/Service/Booking.js';
import { getIO } from '../config/socket.js';
import emitter from '../websocket/services/emitterService.js';

class ChatController {
  /**
   * Crear chat para una reserva
   */
  async createBookingChat(booking) {
    try {
      const existingChat = await Chat.findOne({
        'participants.client': booking.client,
        'participants.provider': booking.provider,
        booking: booking._id
      });

      if (existingChat) {
        return existingChat;
      }

      const chat = new Chat({
        participants: {
          client: booking.client,
          provider: booking.provider
        },
        booking: booking._id,
        status: 'active'
      });

      await chat.save();

      // Crear mensaje de sistema inicial
      await this.createSystemMessage(
        chat._id,
        'Chat iniciado para el servicio. Pueden coordinar detalles aquí.'
      );

      return chat;
    } catch (error) {
      console.error('ChatController - createBookingChat error:', error);
      throw error;
    }
  }

  /**
   * Enviar mensaje
   */
  async sendMessage(req, res) {
    try {
      const { chatId } = req.params;
      const { text, attachments, type = 'text' } = req.body;

      const chat = await Chat.findOne({
        _id: chatId,
        $or: [
          { 'participants.client': req.user._id },
          { 'participants.provider': req.user._id }
        ]
      });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found or access denied'
        });
      }

      // Determinar modelo del sender basado en roles múltiples
      // Para usuarios duales, priorizar el rol con el que están actuando
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
      // Si solo tiene un rol, usarlo; si tiene ambos, el contexto del chat determina
      const isClient = userRoles.includes('client');
      const isProvider = userRoles.includes('provider');
      // Por defecto, si es cliente o tiene ambos, usar Client (el proveedor responde desde Provider)
      const senderModel = (isProvider && !isClient) ? 'Provider' : 'Client';

      const message = new Message({
        chat: chatId,
        sender: req.user._id,
        senderModel,
        content: {
          text,
          attachments: attachments || []
        },
        type,
        status: 'sent'
      });

      await message.save();

      // Actualizar último mensaje del chat
      chat.lastMessage = message._id;
      chat.metadata.lastActivity = new Date();

      // Incrementar contador de no leídos para el otro participante
      if (senderModel === 'Client') {
        chat.unreadCount.provider += 1;
      } else {
        chat.unreadCount.client += 1;
      }

      await chat.save();

      // Emitir actualización de contadores al receptor (tendrá más no leídos)
      try {
        const recipientId = senderModel === 'Client' ? chat.participants.provider : chat.participants.client;
        if (recipientId) emitter.emitCountersUpdateToUserDebounced(recipientId, { reasons: ['chat_unread_inc'], chatId });
      } catch { /* ignore */ }

      // Emitir evento de socket para mensaje en tiempo real
      this.emitNewMessage(chat, message);

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: { message }
      });
    } catch (error) {
      console.error('ChatController - sendMessage error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send message'
      });
    }
  }

  /**
   * Obtener mensajes de un chat
   */
  async getChatMessages(req, res) {
    try {
      const { chatId } = req.params;
      const { page = 1, limit = 50 } = req.query;

      const chat = await Chat.findOne({
        _id: chatId,
        $or: [
          { 'participants.client': req.user._id },
          { 'participants.provider': req.user._id }
        ]
      });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found or access denied'
        });
      }

      const messages = await Message.find({ chat: chatId })
        .sort({ 'metadata.timestamp': -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .populate('sender', 'profile providerProfile');

      // Marcar mensajes como leídos
      await this.markMessagesAsRead(chatId, req.user._id);

      // Resetear contador de no leídos
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
      if (userRoles.includes('client')) {
        chat.unreadCount.client = 0;
      }
      if (userRoles.includes('provider')) {
        chat.unreadCount.provider = 0;
      }
      await chat.save();

      // Emitir actualización de contadores para el usuario que leyó (baja su contador de chats)
  try { emitter.emitCountersUpdateToUserDebounced(req.user._id, { reasons: ['chat_unread_clear'], chatId }); } catch { /* ignore */ }

      res.json({
        success: true,
        data: {
          messages: messages.reverse(), // Ordenar del más viejo al más nuevo
          chat,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: await Message.countDocuments({ chat: chatId })
          }
        }
      });
    } catch (error) {
      console.error('ChatController - getChatMessages error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get messages'
      });
    }
  }

  /**
   * Obtener chats del usuario
   */
  async getUserChats(req, res) {
    try {
      let query = {};
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];

      if (userRoles.includes('client')) {
        query = { 'participants.client': req.user._id };
      } else if (userRoles.includes('provider')) {
        query = { 'participants.provider': req.user._id };
      }

      const chats = await Chat.find(query)
        .populate('participants.client', 'profile')
        .populate('participants.provider', 'providerProfile')
        .populate('booking', 'basicInfo status')
        .populate('lastMessage')
        .sort({ 'metadata.lastActivity': -1 });

      res.json({
        success: true,
        data: { chats }
      });
    } catch (error) {
      console.error('ChatController - getUserChats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get chats'
      });
    }
  }

  /**
   * Crear mensaje de sistema
   */
  async createSystemMessage(chatId, text) {
    try {
      const message = new Message({
        chat: chatId,
        sender: null, // Mensaje de sistema
        senderModel: 'System',
        content: { text },
        type: 'system',
        status: 'sent'
      });

      await message.save();
      return message;
    } catch (error) {
      console.error('ChatController - createSystemMessage error:', error);
    }
  }

  /**
   * Marcar mensajes como leídos
   */
  async markMessagesAsRead(chatId, userId) {
    try {
      await Message.updateMany(
        {
          chat: chatId,
          sender: { $ne: userId },
          'readBy.user': { $ne: userId }
        },
        {
          $push: {
            readBy: {
              user: userId,
              userModel: (Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role]).includes('provider') && !(Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role]).includes('client') ? 'Provider' : 'Client',
              readAt: new Date()
            }
          },
          $set: { status: 'read' }
        }
      );
    } catch (error) {
      console.error('ChatController - markMessagesAsRead error:', error);
    }
  }

  /**
   * Emitir nuevo mensaje via Socket.io
   */
  emitNewMessage(chat, message) {
    try {
      const io = getIO();

      // Emitir a ambos participantes
      io.to(`user_${chat.participants.client}`).emit('new_message', {
        chatId: chat._id,
        message
      });

      io.to(`user_${chat.participants.provider}`).emit('new_message', {
        chatId: chat._id,
        message
      });
    } catch (error) {
      console.error('ChatController - emitNewMessage error:', error);
    }
  }
}

export default new ChatController();