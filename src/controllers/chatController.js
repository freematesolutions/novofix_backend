// controllers/chatController.js
import mongoose from 'mongoose';
import Chat from '../models/Communication/Chat.js';
import Message from '../models/Communication/Message.js';
import Booking from '../models/Service/Booking.js';
import Proposal from '../models/Service/Proposal.js';
import User from '../models/User/User.js';
import Client from '../models/User/Client.js';
import Provider from '../models/User/Provider.js';
import { getIO } from '../config/socket.js';
import emitter from '../websocket/services/emitterService.js';
import notificationService from '../services/external/notificationService.js';
import { rejectIfSelfHire, isSameUser } from '../utils/selfHireGuard.js';

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

      // Bloqueo de auto-contrato: la propuesta no puede pertenecer al mismo usuario
      // que también es el cliente de la solicitud (no debería existir, pero por defensa).
      if (isSameUser(proposal.provider, proposal.serviceRequest?.client)) {
        return res.status(400).json({
          success: false,
          code: 'SELF_HIRE_NOT_ALLOWED',
          message: 'A proposal cannot be exchanged between the same user.'
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
      }).populate('participants.client', 'profile providerProfile email')
        .populate('participants.provider', 'profile providerProfile email')
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
          providerAccepted: 'accepted',
          metadata: {
            createdAt: new Date(),
            lastActivity: new Date()
          }
        });

        await chat.save();

        // Crear mensaje de sistema inicial con datos para traducción
        const amount = proposal.pricing?.amount;
        const currency = proposal.pricing?.currency || 'USD';
        const formattedAmount = amount 
          ? Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(amount)
          : null;
        
        await this.createSystemMessage(
          chat._id,
          `💬 Conversación iniciada sobre la propuesta de ${formattedAmount || 'la propuesta'}. Pueden negociar términos y resolver dudas aquí.`,
          {
            key: 'chat.system.proposalStarted',
            params: {
              amount: amount || 0,
              currency: currency,
              formattedAmount: formattedAmount || ''
            }
          }
        );

        // Re-populate después de guardar
        chat = await Chat.findById(chat._id)
          .populate('participants.client', 'profile providerProfile email')
          .populate('participants.provider', 'profile providerProfile email')
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
   * Crear chat para solicitar más información sobre una solicitud de servicio
   * Permite al proveedor comunicarse con el cliente antes de enviar propuesta formal
   */
  async createInfoRequestChat(req, res) {
    try {
      const { requestId } = req.params;
      const { message, type } = req.body;

      // Importar ServiceRequest
      const ServiceRequest = (await import('../models/Service/ServiceRequest.js')).default;

      // Obtener la solicitud de servicio
      const serviceRequest = await ServiceRequest.findById(requestId);
      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message: 'Service request not found'
        });
      }

      // Verificar que sea un proveedor
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
      const isProvider = userRoles.includes('provider');
      if (!isProvider) {
        return res.status(403).json({
          success: false,
          message: 'Only providers can request more information'
        });
      }

      // Bloqueo de auto-contrato: el proveedor no puede pedir info sobre su propia solicitud
      if (rejectIfSelfHire(res, req.user?._id, serviceRequest.client, 'inquiry')) return;

      // Buscar chat existente para esta solicitud y proveedor
      let chat = await Chat.findOne({
        'participants.client': serviceRequest.client,
        'participants.provider': req.user._id,
        serviceRequest: requestId,
        chatType: 'info_request'
      }).populate('participants.client', 'profile providerProfile email')
        .populate('participants.provider', 'profile providerProfile email')
        .populate('lastMessage');

      if (!chat) {
        // Crear nuevo chat de solicitud de información
        chat = new Chat({
          participants: {
            client: serviceRequest.client,
            provider: req.user._id
          },
          serviceRequest: requestId,
          chatType: 'info_request',
          status: 'active',
          providerAccepted: 'accepted', // info_request es iniciado por el proveedor, auto-aceptado
          metadata: {
            createdAt: new Date(),
            lastActivity: new Date()
          }
        });

        await chat.save();

        // Crear mensaje de sistema inicial
        const providerName = req.user.providerProfile?.businessName || 
          `${req.user.providerProfile?.firstName || ''} ${req.user.providerProfile?.lastName || ''}`.trim() ||
          'Un profesional';
        
        await this.createSystemMessage(
          chat._id,
          `📋 ${providerName} necesita más información sobre tu solicitud antes de enviarte una propuesta.`,
          {
            key: 'chat.system.infoRequestStarted',
            params: { providerName }
          }
        );
      }

      // Crear el mensaje del proveedor solicitando información
      if (message && message.trim()) {
        const infoMessage = new Message({
          chat: chat._id,
          sender: req.user._id,
          senderModel: 'Provider',
          content: {
            text: message.trim(),
            attachments: []
          },
          type: 'text',
          status: 'sent'
        });

        await infoMessage.save();

        // Actualizar último mensaje del chat
        chat.lastMessage = infoMessage._id;
        chat.metadata.lastActivity = new Date();
        chat.unreadCount.client += 1;
        await chat.save();

        // Emitir evento de socket
        this.emitNewMessage(chat, {
          ...infoMessage.toObject(),
          sender: {
            _id: String(req.user._id),
            providerProfile: req.user.providerProfile
          }
        });

        // Notificar al cliente
        try {
          emitter.emitToUser(serviceRequest.client.toString(), 'NEW_MESSAGE', {
            chatId: chat._id,
            message: infoMessage
          });
          emitter.emitCountersUpdateToUser(serviceRequest.client, { reason: 'info_request_received' });
        } catch (err) {
          console.error('Error emitting info request notification:', err);
        }
      }

      // Re-populate
      chat = await Chat.findById(chat._id)
        .populate('participants.client', 'profile providerProfile email')
        .populate('participants.provider', 'profile providerProfile email')
        .populate('lastMessage');

      res.json({
        success: true,
        message: 'Information request sent',
        data: { chat }
      });
    } catch (error) {
      console.error('ChatController - createInfoRequestChat error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create info request chat'
      });
    }
  }

  /**
   * Crear o obtener chat de consulta directa (cliente → proveedor)
   * Permite al cliente comunicarse con un profesional antes de solicitar estimado
   */
  async createOrGetInquiryChat(req, res) {
    try {
      const { providerId } = req.params;
      const clientId = req.user._id;

      // Verificar que el usuario sea un cliente
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
      if (!userRoles.includes('client')) {
        return res.status(403).json({
          success: false,
          message: 'Only clients can start inquiry chats'
        });
      }

      // Verificar que el proveedor exista
      const provider = await Provider.findById(providerId).select('profile providerProfile email');
      if (!provider) {
        return res.status(404).json({
          success: false,
          message: 'Provider not found'
        });
      }

      // Evitar que el usuario chatee consigo mismo
      if (clientId.toString() === providerId.toString()) {
        return res.status(400).json({
          success: false,
          message: 'Cannot start a chat with yourself'
        });
      }

      // Buscar chat de consulta existente entre este cliente y proveedor
      let chat = await Chat.findOne({
        'participants.client': clientId,
        'participants.provider': providerId,
        chatType: 'inquiry'
      }).populate('participants.client', 'profile providerProfile email')
        .populate('participants.provider', 'profile providerProfile email')
        .populate('lastMessage');

      if (!chat) {
        // Crear nuevo chat de consulta
        chat = new Chat({
          participants: {
            client: clientId,
            provider: providerId
          },
          chatType: 'inquiry',
          status: 'active',
          providerAccepted: 'pending',
          metadata: {
            createdAt: new Date(),
            lastActivity: new Date()
          }
        });

        await chat.save();

        // Crear mensaje de sistema inicial
        const clientName = req.user.profile?.firstName || 'Un cliente';
        const providerName = provider.providerProfile?.businessName ||
          `${provider.profile?.firstName || ''} ${provider.profile?.lastName || ''}`.trim() ||
          'el profesional';

        await this.createSystemMessage(
          chat._id,
          `💬 ${clientName} ha iniciado una consulta con ${providerName}.`,
          {
            key: 'chat.system.inquiryStarted',
            params: { clientName, providerName }
          }
        );

        // Re-populate después de guardar
        chat = await Chat.findById(chat._id)
          .populate('participants.client', 'profile providerProfile email')
          .populate('participants.provider', 'profile providerProfile email')
          .populate('lastMessage');
      }

      // Obtener todos los chats entre este cliente y proveedor
      // para que el frontend pueda unirse a todas las salas WebSocket
      // y recibir mensajes del proveedor sin importar desde qué chat responda
      const allPairChats = await Chat.find({
        'participants.client': clientId,
        'participants.provider': providerId
      }).select('_id chatType status').lean();

      const relatedChats = allPairChats.map(c => ({
        _id: String(c._id),
        chatType: c.chatType,
        status: c.status
      }));

      res.json({
        success: true,
        data: { chat, relatedChats }
      });
    } catch (error) {
      console.error('ChatController - createOrGetInquiryChat error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create or get inquiry chat'
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
        status: 'active',
        providerAccepted: 'accepted'
      });

      await chat.save();

      // Crear mensaje de sistema inicial con datos para traducción
      await this.createSystemMessage(
        chat._id,
        'Chat iniciado para el servicio. Pueden coordinar detalles aquí.',
        {
          key: 'chat.system.bookingStarted',
          params: {}
        }
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
          providerProfile: req.user.providerProfile
        }
      };
      this.emitNewMessage(chat, messageWithSender);

      // Disparar notificación persistente (in-app + email según preferencia)
      // SOLO si el receptor NO está actualmente en la sala del chat (offline o con la
      // conversación cerrada). Así evitamos saturar mientras chatean en vivo.
      try {
        const recipientId = senderIsClient ? chatProviderId : chatClientId;
        const recipientType = senderIsClient ? 'Provider' : 'Client';
        if (recipientId) {
          const io = getIO();
          const chatRoomName = `chat_${chatId}`;
          const socketsInRoom = await io.in(chatRoomName).fetchSockets();
          const usersInRoom = new Set(socketsInRoom.map(s => s.userId));
          const recipientIsActive = usersInRoom.has(String(recipientId));

          if (!recipientIsActive) {
            const senderName =
              req.user.profile?.firstName ||
              req.user.profile?.businessName ||
              req.user.email ||
              '';
            const notifyData = {
              senderName,
              chatId: String(chatId),
              messagePreview: typeof text === 'string' ? text.slice(0, 120) : ''
            };
            if (recipientType === 'Client') {
              notificationService.sendClientNotification({
                clientId: recipientId,
                type: 'NEW_MESSAGE',
                priority: 'medium',
                data: notifyData
              }).catch(err => console.error('NEW_MESSAGE client notification error:', err?.message));
            } else {
              notificationService.sendProviderNotification({
                providerId: recipientId,
                type: 'NEW_MESSAGE',
                priority: 'medium',
                data: notifyData
              }).catch(err => console.error('NEW_MESSAGE provider notification error:', err?.message));
            }
          } else {
            console.log(`[Chat] Recipient ${recipientId} is in room — skipping persistent notification`);
          }
        }
      } catch (err) {
        console.error('NEW_MESSAGE notification dispatch error:', err?.message);
      }

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

      // Manually populate sender using base User model to handle multi-role users
      // (discriminated Client/Provider.findById fails when user's __t doesn't match senderModel)
      const populatedMessages = await Promise.all(
        messages.map(async (msg) => {
          if (msg.sender && msg.senderModel && msg.senderModel !== 'System') {
            try {
              const senderData = await User.findById(msg.sender)
                .select('profile providerProfile email')
                .lean();
              if (senderData) {
                // Ensure both _id and id are present as strings for consistent client-side comparison
                senderData.id = String(senderData._id);
                senderData._id = String(senderData._id);
              }
              return { ...msg, sender: senderData || String(msg.sender) };
            } catch {
              return { ...msg, sender: String(msg.sender) };
            }
          }
          return msg;
        })
      );

      console.log(`📬 Found ${populatedMessages.length} messages for chat ${chatId}`);

      // Determinar rol del usuario basado en su posición en ESTE chat específico
      // (no en sus roles globales, para soportar usuarios duales correctamente)
      const userIdStr = req.user._id.toString();
      const chatClientId = chat.participants.client?.toString();
      const chatProviderId = chat.participants.provider?.toString();
      const userIsClientInChat = userIdStr === chatClientId;
      const userIsProviderInChat = userIdStr === chatProviderId;
      const userRole = userIsProviderInChat ? 'Provider' : 'Client';

      // Marcar mensajes como leídos
      await this.markMessagesAsRead(chatId, req.user._id, userRole);

      // Resetear contador de no leídos solo para la posición del usuario en este chat
      if (userIsClientInChat) {
        chat.unreadCount.client = 0;
      }
      if (userIsProviderInChat) {
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
   * Obtener chats del usuario — agrupados por par de participantes (conversación unificada)
   * Cada par client+provider produce una sola entrada con todos los chats relacionados
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
        .populate('participants.client', 'profile providerProfile email')
        .populate('participants.provider', 'profile providerProfile email')
        .populate('booking', 'basicInfo status')
        .populate('proposal', 'pricing message status')
        .populate('serviceRequest', 'basicInfo status')
        .populate('lastMessage')
        .sort({ 'metadata.lastActivity': -1 });

      // Re-populate participants that failed due to discriminator mismatch
      // (e.g., a Provider-type user stored as participants.client)
      const populatedChats = await Promise.all(chats.map(async (chat) => {
        const chatObj = chat.toObject();
        if (chatObj.participants?.client && !chatObj.participants.client.profile) {
          try {
            const clientData = await User.findById(chatObj.participants.client._id || chatObj.participants.client)
              .select('profile providerProfile email')
              .lean();
            if (clientData) chatObj.participants.client = clientData;
          } catch { /* ignore */ }
        }
        if (chatObj.participants?.provider && !chatObj.participants.provider.providerProfile) {
          try {
            const providerData = await User.findById(chatObj.participants.provider._id || chatObj.participants.provider)
              .select('profile providerProfile email')
              .lean();
            if (providerData) chatObj.participants.provider = providerData;
          } catch { /* ignore */ }
        }
        return chatObj;
      }));

      // --- Agrupar chats por par de participantes ---
      const pairMap = new Map(); // key: "clientId_providerId" → conversation group
      for (const chat of populatedChats) {
        const clientId = String(chat.participants?.client?._id || chat.participants?.client);
        const providerId = String(chat.participants?.provider?._id || chat.participants?.provider);
        const pairKey = `${clientId}_${providerId}`;

        if (!pairMap.has(pairKey)) {
          pairMap.set(pairKey, {
            // Datos de la conversación unificada
            _id: pairKey, // ID virtual de la conversación
            conversationId: pairKey,
            participants: chat.participants,
            // El chat más reciente determina la info principal
            lastMessage: chat.lastMessage,
            metadata: { ...chat.metadata },
            // Contadores unificados
            unreadCount: { client: 0, provider: 0 },
            // Todos los chats individuales del par
            relatedChats: [],
            // Chat types presentes
            chatTypes: [],
            // Datos de propuesta y booking (si existen)
            proposal: null,
            booking: null,
            serviceRequest: null,
            // Estado de aceptación del proveedor (el más relevante)
            providerAccepted: 'accepted', // default si no hay inquiry/info_request
            // Chat primario (el más reciente para referencia)
            primaryChatId: String(chat._id),
            status: chat.status
          });
        }

        const group = pairMap.get(pairKey);
        
        // Agregar chat a la lista de relacionados
        group.relatedChats.push({
          _id: String(chat._id),
          chatType: chat.chatType,
          status: chat.status,
          providerAccepted: chat.providerAccepted || 'pending',
          booking: chat.booking,
          proposal: chat.proposal,
          serviceRequest: chat.serviceRequest,
          lastActivity: chat.metadata?.lastActivity,
          unreadCount: chat.unreadCount
        });

        // Agregar tipo si no existe
        if (!group.chatTypes.includes(chat.chatType)) {
          group.chatTypes.push(chat.chatType);
        }

        // Sumar contadores de no leídos
        group.unreadCount.client += (chat.unreadCount?.client || 0);
        group.unreadCount.provider += (chat.unreadCount?.provider || 0);

        // Mantener el lastMessage más reciente
        const chatActivity = chat.metadata?.lastActivity ? new Date(chat.metadata.lastActivity) : new Date(0);
        const groupActivity = group.metadata?.lastActivity ? new Date(group.metadata.lastActivity) : new Date(0);
        if (chatActivity > groupActivity) {
          group.lastMessage = chat.lastMessage;
          group.metadata.lastActivity = chat.metadata.lastActivity;
          group.primaryChatId = String(chat._id);
        }

        // Mantener referencia a propuesta, booking, serviceRequest si existen
        if (chat.proposal) group.proposal = chat.proposal;
        if (chat.booking) group.booking = chat.booking;
        if (chat.serviceRequest) group.serviceRequest = chat.serviceRequest;

        // Estado de aceptación: si hay algún inquiry/info_request pendiente, mostrar como pendiente
        if ((chat.chatType === 'inquiry' || chat.chatType === 'info_request') && 
            (chat.providerAccepted === 'pending' || chat.providerAccepted === 'declined')) {
          group.providerAccepted = chat.providerAccepted;
        }
      }

      // Convertir a array ordenado por última actividad
      const conversations = Array.from(pairMap.values())
        .sort((a, b) => {
          const ta = a.metadata?.lastActivity ? new Date(a.metadata.lastActivity) : new Date(0);
          const tb = b.metadata?.lastActivity ? new Date(b.metadata.lastActivity) : new Date(0);
          return tb - ta;
        });

      res.json({
        success: true,
        data: { chats: conversations }
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
   * Obtener mensajes de una conversación unificada (todos los chats entre dos participantes)
   * Combina mensajes de todos los chats entre el par, ordenados cronológicamente
   */
  async getConversationMessages(req, res) {
    try {
      const { participantId } = req.params;
      const { page = 1, limit = 80 } = req.query;
      const userId = req.user._id;
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];

      // Buscar todos los chats entre este usuario y el participante
      const chats = await Chat.find({
        $or: [
          { 'participants.client': userId, 'participants.provider': participantId },
          { 'participants.client': participantId, 'participants.provider': userId }
        ]
      }).select('_id chatType participants unreadCount').lean();

      if (!chats.length) {
        return res.status(404).json({
          success: false,
          message: 'No conversations found with this participant'
        });
      }

      const chatIds = chats.map(c => c._id);

      // Obtener mensajes de todos los chats combinados
      const totalMessages = await Message.countDocuments({ chat: { $in: chatIds } });
      const messages = await Message.find({ chat: { $in: chatIds } })
        .sort({ 'metadata.timestamp': -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean();

      // Crear mapa de chatId → chatType para anotar cada mensaje
      const chatTypeMap = {};
      for (const c of chats) {
        chatTypeMap[String(c._id)] = c.chatType;
      }

      // Manually populate sender
      const populatedMessages = await Promise.all(
        messages.map(async (msg) => {
          const enriched = {
            ...msg,
            chatType: chatTypeMap[String(msg.chat)] || 'booking'
          };
          if (msg.sender && msg.senderModel && msg.senderModel !== 'System') {
            try {
              const senderData = await User.findById(msg.sender)
                .select('profile providerProfile email')
                .lean();
              if (senderData) {
                // Ensure both _id and id are present as strings for consistent client-side comparison
                senderData.id = String(senderData._id);
                senderData._id = String(senderData._id);
              }
              return { ...enriched, sender: senderData || String(msg.sender) };
            } catch {
              return { ...enriched, sender: String(msg.sender) };
            }
          }
          return enriched;
        })
      );

      // Determinar rol del usuario basado en su posición en los chats (no en roles globales)
      // Todos los chats del par comparten los mismos participantes
      const firstChat = chats[0];
      const userIdStr = userId.toString();
      const chatClientId = firstChat.participants?.client?.toString();
      const chatProviderId = firstChat.participants?.provider?.toString();
      const userIsClientInChat = userIdStr === chatClientId;
      const userIsProviderInChat = userIdStr === chatProviderId;
      const userRole = userIsProviderInChat ? 'Provider' : 'Client';

      // Marcar mensajes como leídos en TODOS los chats del par
      for (const chatId of chatIds) {
        await this.markMessagesAsRead(chatId, userId, userRole);
      }

      // Resetear contadores de no leídos en todos los chats (basado en posición, no rol global)
      const updateField = userIsClientInChat ? { 'unreadCount.client': 0 } : { 'unreadCount.provider': 0 };
      await Chat.updateMany({ _id: { $in: chatIds } }, { $set: updateField });

      // Emitir actualización de contadores
      try { emitter.emitCountersUpdateToUserDebounced(userId, { reasons: ['conversation_unread_clear'] }); } catch { /* ignore */ }

      res.json({
        success: true,
        data: {
          messages: populatedMessages.reverse(),
          chatIds: chatIds.map(String),
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalMessages
          }
        }
      });
    } catch (error) {
      console.error('ChatController - getConversationMessages error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get conversation messages'
      });
    }
  }

  /**
   * Aceptar un chat de consulta (proveedor acepta la solicitud de conversación)
   */
  async acceptChat(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user._id;

      const chat = await Chat.findOne({
        _id: chatId,
        'participants.provider': userId,
        chatType: { $in: ['inquiry', 'info_request'] }
      });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found or not authorized'
        });
      }

      if (chat.providerAccepted === 'accepted') {
        return res.json({ success: true, message: 'Already accepted', data: { chat } });
      }

      chat.providerAccepted = 'accepted';
      chat.metadata.lastActivity = new Date();
      await chat.save();

      // Crear mensaje de sistema
      const providerName = req.user.providerProfile?.businessName ||
        `${req.user.profile?.firstName || ''} ${req.user.profile?.lastName || ''}`.trim() || 'El profesional';
      
      const systemMessage = await this.createSystemMessage(
        chat._id,
        `✅ ${providerName} ha aceptado la conversación.`,
        {
          key: 'chat.system.chatAccepted',
          params: { providerName }
        }
      );

      // Emitir mensaje de sistema via WebSocket para que aparezca en tiempo real
      if (systemMessage) {
        const systemMsgPayload = {
          ...systemMessage.toObject(),
          _id: String(systemMessage._id),
          chat: String(chat._id)
        };
        this.emitNewMessage(chat, systemMsgPayload);
      }

      // Notificar al cliente
      const clientId = chat.participants.client.toString();
      try {
        emitter.emitCountersUpdateToUserDebounced(clientId, { reasons: ['chat_accepted'] });
      } catch { /* ignore */ }

      res.json({
        success: true,
        message: 'Chat accepted',
        data: { chat }
      });
    } catch (error) {
      console.error('ChatController - acceptChat error:', error);
      res.status(500).json({ success: false, message: 'Failed to accept chat' });
    }
  }

  /**
   * Rechazar un chat de consulta (proveedor declina la solicitud de conversación)
   */
  async declineChat(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user._id;

      const chat = await Chat.findOne({
        _id: chatId,
        'participants.provider': userId,
        chatType: { $in: ['inquiry', 'info_request'] }
      });

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found or not authorized'
        });
      }

      chat.providerAccepted = 'declined';
      chat.status = 'archived';
      chat.metadata.lastActivity = new Date();
      await chat.save();

      // Crear mensaje de sistema
      const providerName = req.user.providerProfile?.businessName ||
        `${req.user.profile?.firstName || ''} ${req.user.profile?.lastName || ''}`.trim() || 'El profesional';

      const systemMessage = await this.createSystemMessage(
        chat._id,
        `❌ ${providerName} ha declinado la conversación.`,
        {
          key: 'chat.system.chatDeclined',
          params: { providerName }
        }
      );

      // Emitir mensaje de sistema via WebSocket para que aparezca en tiempo real
      if (systemMessage) {
        const systemMsgPayload = {
          ...systemMessage.toObject(),
          _id: String(systemMessage._id),
          chat: String(chat._id)
        };
        this.emitNewMessage(chat, systemMsgPayload);
      }

      // Notificar al cliente
      const clientId = chat.participants.client.toString();
      try {
        emitter.emitCountersUpdateToUserDebounced(clientId, { reasons: ['chat_declined'] });
      } catch { /* ignore */ }

      res.json({
        success: true,
        message: 'Chat declined',
        data: { chat }
      });
    } catch (error) {
      console.error('ChatController - declineChat error:', error);
      res.status(500).json({ success: false, message: 'Failed to decline chat' });
    }
  }

  /**
   * Crear mensaje de sistema
   * @param {string} chatId - ID del chat
   * @param {string} text - Texto del mensaje (fallback si no hay traducción)
   * @param {Object} translationData - Datos para traducción dinámica
   * @param {string} translationData.key - Clave de traducción (ej: 'chat.system.proposalStarted')
   * @param {Object} translationData.params - Parámetros para interpolación
   */
  async createSystemMessage(chatId, text, translationData = null) {
    try {
      const message = new Message({
        chat: chatId,
        sender: null, // Mensaje de sistema
        senderModel: 'System',
        content: { 
          text,
          // Agregar datos de traducción si se proporcionan
          ...(translationData && {
            translationKey: translationData.key,
            translationParams: translationData.params || {}
          })
        },
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