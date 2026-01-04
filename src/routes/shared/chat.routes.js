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

// Gestión de mensajes específicos del chat
router.get('/:chatId/messages', chatController.getChatMessages.bind(chatController));
router.post('/:chatId/messages', chatController.sendMessage.bind(chatController));

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