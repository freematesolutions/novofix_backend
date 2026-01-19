// controllers/chatController.js
import mongoose from 'mongoose';
import Chat from '../models/Communication/Chat.js';
import Message from '../models/Communication/Message.js';
import Booking from '../models/Service/Booking.js';
import Proposal from '../models/Service/Proposal.js';
import Client from '../models/User/Client.js';
import Provider from '../models/User/Provider.js';
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
      const { text, attachments, type = 'text', replyTo } = req.body;

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

      // Determinar senderModel basado en la posición del usuario en ESTE chat específico
      // No en sus roles globales, para soportar correctamente usuarios duales
      const userIdStr = req.user._id.toString();
      const chatClientId = chat.participants.client?.toString();
      const chatProviderId = chat.participants.provider?.toString();
      
      const senderIsClient = userIdStr === chatClientId;
      const senderIsProvider = userIdStr === chatProviderId;
      
      let senderModel;
      if (senderIsClient) {
        senderModel = 'Client';
      } else if (senderIsProvider) {
        senderModel = 'Provider';
      } else {
        // Fallback: no debería ocurrir
        const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
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

      const message = new Message({
        chat: chatId,
        sender: req.user._id,
        senderModel,
        content: {
          text,
          attachments: attachments || []
        },
        type,
        status: 'sent',
        replyTo: validReplyTo
      });

      await message.save();
      console.log(`💾 Message saved: id=${message._id}, chat=${chatId}, sender=${req.user._id}, senderModel=${senderModel}, text="${text?.substring(0, 50)}...", replyTo=${validReplyTo || 'none'}`);

      // Si hay replyTo, popular para incluir en la respuesta
      if (validReplyTo) {
        await message.populate('replyTo', 'content sender');
      }

      // Actualizar último mensaje del chat
      chat.lastMessage = message._id;
      chat.metadata.lastActivity = new Date();

      // Incrementar contador de no leídos para el otro participante
      if (senderIsClient) {
        chat.unreadCount.provider += 1;
      } else {
        chat.unreadCount.client += 1;
      }

      await chat.save();

      // Emitir actualización de contadores al receptor (tendrá más no leídos)
      try {
        const recipientId = senderIsClient ? chatProviderId : chatClientId;
        if (recipientId) emitter.emitCountersUpdateToUserDebounced(recipientId, { reasons: ['chat_unread_inc'], chatId });
      } catch { /* ignore */ }

      // Emitir evento de socket para mensaje en tiempo real
      // Incluir datos del sender para notificaciones
      const messageWithSender = {
        ...message.toObject(),
        sender: {
          _id: String(req.user._id),
          id: String(req.user._id),
          profile: req.user.profile,
          providerProfile: req.user.providerProfile,
          email: req.user.email
        }
      };
      this.emitNewMessage(chat, messageWithSender);

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

      // Validar que chatId sea un ObjectId válido
      if (!mongoose.Types.ObjectId.isValid(chatId)) {
        console.log(`❌ Invalid chatId format: ${chatId}`);
        return res.status(400).json({
          success: false,
          message: 'Invalid chat ID format'
        });
      }

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

      // Only populate sender for non-system messages (senderModel !== 'System')
      const messages = await Message.find({ chat: chatId })
        .sort({ 'metadata.timestamp': -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean();

      // Manually populate sender for messages with valid senderModel to avoid refPath issues
      const populatedMessages = await Promise.all(
        messages.map(async (msg) => {
          if (msg.sender && msg.senderModel && msg.senderModel !== 'System') {
            try {
              const Model = msg.senderModel === 'Provider' ? Provider : Client;
              const senderData = await Model.findById(msg.sender)
                .select('profile providerProfile')
                .lean();
              return { ...msg, sender: senderData };
            } catch {
              return msg;
            }
          }
          return msg;
        })
      );

      console.log(`📬 Found ${populatedMessages.length} messages for chat ${chatId}`);

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
          messages: populatedMessages.reverse(), // Ordenar del más viejo al más nuevo
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
   * Agregar o quitar reacción de un mensaje
   */
  async toggleMessageReaction(req, res) {
    try {
      const { chatId, messageId } = req.params;
      const { emoji } = req.body;

      if (!emoji) {
        return res.status(400).json({
          success: false,
          message: 'Emoji is required'
        });
      }

      // Verificar acceso al chat
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

      // Buscar el mensaje
      const message = await Message.findOne({
        _id: messageId,
        chat: chatId
      });

      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      // Determinar userModel basado en la posición en el chat
      const userIdStr = req.user._id.toString();
      const chatClientId = chat.participants.client?.toString();
      const userModel = userIdStr === chatClientId ? 'Client' : 'Provider';

      // Buscar si ya existe una reacción del usuario con ese emoji
      const existingReactionIndex = message.reactions.findIndex(
        r => r.user.toString() === userIdStr && r.emoji === emoji
      );

      if (existingReactionIndex >= 0) {
        // Quitar reacción
        message.reactions.splice(existingReactionIndex, 1);
      } else {
        // Agregar reacción
        message.reactions.push({
          emoji,
          user: req.user._id,
          userModel,
          createdAt: new Date()
        });
      }

      await message.save();

      // Emitir actualización vía socket
      try {
        const io = getIO();
        const chatRoomName = `chat_${chatId}`;
        io.to(chatRoomName).emit('message_reaction', {
          chatId,
          messageId,
          reactions: message.reactions
        });
      } catch (err) {
        console.error('Error emitting reaction update:', err);
      }

      res.json({
        success: true,
        message: existingReactionIndex >= 0 ? 'Reaction removed' : 'Reaction added',
        data: { reactions: message.reactions }
      });
    } catch (error) {
      console.error('ChatController - toggleMessageReaction error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to toggle reaction'
      });
    }
  }

  /**
   * Emitir nuevo mensaje via Socket.io
   */
  async emitNewMessage(chat, message) {
    try {
      const io = getIO();

      // Asegurar conversión a string para los IDs
      const clientId = chat.participants?.client ? String(chat.participants.client._id || chat.participants.client) : null;
      const providerId = chat.participants?.provider ? String(chat.participants.provider._id || chat.participants.provider) : null;
      const chatId = String(chat._id);
      const senderId = message.sender?._id ? String(message.sender._id) : String(message.sender);

      console.log(`📤 Emitting new_message:`, {
        chatId,
        clientId,
        providerId,
        senderId,
        messageType: message.type
      });

      const payload = {
        chatId: String(chat._id),
        chat: String(chat._id),
        message: {
          ...message,
          _id: String(message._id),
          chatId: String(chat._id),
          chat: String(chat._id),
          createdAt: message.createdAt || new Date().toISOString()
        }
      };

      // Obtener usuarios en la sala del chat para evitar duplicados
      const chatRoomName = `chat_${chatId}`;
      const socketsInChatRoom = await io.in(chatRoomName).fetchSockets();
      const usersInChatRoom = new Set(socketsInChatRoom.map(s => s.userId));

      // Emitir a la sala del chat EXCEPTO al remitente (para usuarios que tienen el chat abierto)
      // Encontrar el socket del remitente para excluirlo
      const senderSocket = socketsInChatRoom.find(s => s.userId === senderId);
      if (senderSocket) {
        // Emitir a la sala excluyendo al remitente
        senderSocket.to(chatRoomName).emit('new_message', payload);
        console.log(`📤 Emitted new_message to room ${chatRoomName} (excluding sender ${senderId})`);
      } else {
        // El remitente no está en la sala, emitir a todos
        io.to(chatRoomName).emit('new_message', payload);
        console.log(`📤 Emitted new_message to room ${chatRoomName} (sender not in room)`);
      }

      // También emitir a las salas de usuario (para notificaciones globales)
      // Pero NO emitir al sender NI a usuarios que ya están en la sala del chat
      if (clientId && clientId !== senderId && !usersInChatRoom.has(clientId)) {
        console.log(`📤 Emitting to client room: user_${clientId}`);
        io.to(`user_${clientId}`).emit('new_message', payload);
      }

      if (providerId && providerId !== senderId && !usersInChatRoom.has(providerId)) {
        console.log(`📤 Emitting to provider room: user_${providerId}`);
        io.to(`user_${providerId}`).emit('new_message', payload);
      }

      console.log(`✅ Message emitted successfully`);
    } catch (error) {
      console.error('ChatController - emitNewMessage error:', error);
    }
  }
}

export default new ChatController();