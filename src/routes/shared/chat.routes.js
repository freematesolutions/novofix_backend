// routes/shared/chat.routes.js
import express from 'express';
const router = express.Router();
import chatController from '../../controllers/chatController.js';
import Booking from '../../models/Service/Booking.js';
import {
  authenticateJWT,
  requireAuth
} from '../../middlewares/auth/jwtAuth.js';
import { clientOrProvider } from '../../middlewares/auth/rbacMiddleware.js';

// Middlewares para usuarios autenticados (cliente o proveedor)
router.use(authenticateJWT);
router.use(requireAuth);
router.use(clientOrProvider);

// Obtener chats del usuario
router.get('/', chatController.getUserChats.bind(chatController));

// Crear o obtener chat para una propuesta (negociación antes de aceptar)
router.post('/proposal/:proposalId', chatController.createOrGetProposalChat.bind(chatController));

// Crear chat para solicitar más información sobre una solicitud de servicio
router.post('/request/:requestId/info', chatController.createInfoRequestChat.bind(chatController));

// Crear o obtener chat de consulta directa (cliente → proveedor)
router.post('/inquiry/:providerId', chatController.createOrGetInquiryChat.bind(chatController));

// Obtener mensajes de conversación unificada (todos los chats con un participante)
router.get('/conversation/:participantId/messages', chatController.getConversationMessages.bind(chatController));

// Aceptar/Rechazar chat de consulta (proveedor)
router.patch('/:chatId/accept', chatController.acceptChat.bind(chatController));
router.patch('/:chatId/decline', chatController.declineChat.bind(chatController));

// Gestión de mensajes específicos del chat
router.get('/:chatId/messages', chatController.getChatMessages.bind(chatController));
router.post('/:chatId/messages', chatController.sendMessage.bind(chatController));

// Reacciones a mensajes
router.patch('/:chatId/messages/:messageId/reactions', chatController.toggleMessageReaction.bind(chatController));

// Crear chat para booking (usado internamente)
router.post('/booking/:bookingId', async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.bookingId,
      $or: [
        { client: req.user._id },
        { provider: req.user._id }
      ]
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or access denied'
      });
    }

    const chat = await chatController.createBookingChat(booking);
    
    res.status(201).json({
      success: true,
      data: { chat }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create chat'
    });
  }
});

export default router;