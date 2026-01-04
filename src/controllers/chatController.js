// controllers/chatController.js
import Chat from '../models/Communication/Chat.js';
import Message from '../models/Communication/Message.js';
import Booking from '../models/Service/Booking.js';
import Proposal from '../models/Service/Proposal.js';
import { getIO } from '../config/socket.js';
import emitter from '../websocket/services/emitterService.js';

class ChatController {
  /**
   * Crear o obtener chat para una propuesta (negociación)
   * Permite al cliente y proveedor comunicarse antes de aceptar la propuesta
   */
  async createOrGetProposalChat(req, res) {
    try {
      const { proposalId } = req.params;

      // Obtener la propuesta con su solicitud
      const proposal = await Proposal.findById(proposalId).populate('serviceRequest');
      if (!proposal) {
        return res.status(404).json({
          success: false,
          message: 'Proposal not found'
        });
      }

      // Verificar que el usuario sea participante (cliente o proveedor)
      const isClient = proposal.serviceRequest.client.toString() === req.user._id.toString();
      const isProvider = proposal.provider.toString() === req.user._id.toString();
      
      if (!isClient && !isProvider) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this chat'
        });
      }

      // Buscar chat existente para esta propuesta
      let chat = await Chat.findOne({
        proposal: proposalId
      }).populate('participants.client', 'profile')
        .populate('participants.provider', 'providerProfile')
        .populate('lastMessage');

      if (!chat) {
        // Crear nuevo chat de negociación
        chat = new Chat({
          participants: {
            client: proposal.serviceRequest.client,
            provider: proposal.provider
          },
          proposal: proposalId,
          serviceRequest: proposal.serviceRequest._id,
          chatType: 'proposal_negotiation',
          status: 'active',
          metadata: {
            createdAt: new Date(),
            lastActivity: new Date()
          }
        });

        await chat.save();

        // Crear mensaje de sistema inicial
        await this.createSystemMessage(
          chat._id,
          `💬 Conversación iniciada sobre la propuesta de ${proposal.pricing?.amount ? Intl.NumberFormat('es-AR', { style: 'currency', currency: proposal.pricing.currency || 'USD' }).format(proposal.pricing.amount) : 'la propuesta'}. Pueden negociar términos y resolver dudas aquí.`
        );

        // Re-populate después de guardar
        chat = await Chat.findById(chat._id)
          .populate('participants.client', 'profile')
          .populate('participants.provider', 'providerProfile')
          .populate('lastMessage');
      }

      res.json({
        success: true,
        data: { 
          chat,
          proposal: {
            _id: proposal._id,
            amount: proposal.pricing?.amount,
            currency: proposal.pricing?.currency,
            message: proposal.message,
            status: proposal.status
          }
        }
      });
    } catch (error) {
      console.error('ChatController - createOrGetProposalChat error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create or get chat'
      });
    }
  }

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
        chatType: 'booking',
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
      console.log(`💾 Message saved: id=${message._id}, chat=${chatId}, sender=${req.user._id}, text="${text?.substring(0, 50)}..."`);

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

      console.log(`📖 getChatMessages: chatId=${chatId}, userId=${req.user._id}, page=${page}, limit=${limit}`);

      const chat = await Chat.findOne({
        _id: chatId,
        $or: [
          { 'participants.client': req.user._id },
          { 'participants.provider': req.user._id }
        ]
      });

      if (!chat) {
        console.log(`❌ Chat not found or access denied: chatId=${chatId}, userId=${req.user._id}`);
        return res.status(404).json({
          success: false,
          message: 'Chat not found or access denied'
        });
      }

      console.log(`✅ Chat found: participants.client=${chat.participants.client}, participants.provider=${chat.participants.provider}`);

      const messages = await Message.find({ chat: chatId })
        .sort({ 'metadata.timestamp': -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .populate('sender', 'profile providerProfile');

      console.log(`📬 Found ${messages.length} messages for chat ${chatId}`);

      // Determinar rol del usuario para marcar mensajes
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
      const isProvider = userRoles.includes('provider');
      const isClient = userRoles.includes('client');
      const userRole = (isProvider && !isClient) ? 'Provider' : 'Client';

      // Marcar mensajes como leídos
      await this.markMessagesAsRead(chatId, req.user._id, userRole);

      // Resetear contador de no leídos
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

      // Para usuarios con ambos roles, buscar donde sea cliente O proveedor
      const isClient = userRoles.includes('client');
      const isProvider = userRoles.includes('provider');
      
      if (isClient && isProvider) {
        // Usuario dual - buscar en ambos campos
        query = {
          $or: [
            { 'participants.client': req.user._id },
            { 'participants.provider': req.user._id }
          ]
        };
      } else if (isClient) {
        query = { 'participants.client': req.user._id };
      } else if (isProvider) {
        query = { 'participants.provider': req.user._id };
      }

      const chats = await Chat.find(query)
        .populate('participants.client', 'profile')
        .populate('participants.provider', 'providerProfile')
        .populate('booking', 'basicInfo status')
        .populate('proposal', 'pricing message status')
        .populate('serviceRequest', 'basicInfo status')
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
  async markMessagesAsRead(chatId, userId, userRole = 'Client') {
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
              userModel: userRole,
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

      const clientId = chat.participants.client?.toString() || chat.participants.client;
      const providerId = chat.participants.provider?.toString() || chat.participants.provider;
      const chatId = chat._id?.toString() || chat._id;

      console.log(`📤 Emitting new_message to users: client=${clientId}, provider=${providerId}, chatId=${chatId}`);

      // Emitir a la sala del chat (para usuarios que tienen el chat abierto)
      io.to(`chat_${chatId}`).emit('new_message', {
        chatId: chat._id,
        message
      });

      // También emitir a las salas de usuario (para notificaciones globales)
      if (clientId) {
        io.to(`user_${clientId}`).emit('new_message', {
          chatId: chat._id,
          message
        });
      }

      if (providerId) {
        io.to(`user_${providerId}`).emit('new_message', {
          chatId: chat._id,
          message
        });
      }

      console.log(`✅ Message emitted successfully to chat_${chatId}, user_${clientId}, user_${providerId}`);
    } catch (error) {
      console.error('ChatController - emitNewMessage error:', error);
    }
  }
}

export default new ChatController();