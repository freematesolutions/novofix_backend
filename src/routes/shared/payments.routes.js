// routes/shared/payments.routes.js
import express from 'express';
import { authenticateJWT, requireAuth } from '../../middlewares/auth/jwtAuth.js';
import { clientOnly } from '../../middlewares/auth/rbacMiddleware.js';
import stripeService from '../../services/external/payment/stripeService.js';
import Booking from '../../models/Service/Booking.js';

const router = express.Router();

router.use(authenticateJWT);
router.use(requireAuth);

// Obtener client_secret para un PaymentIntent de un booking del cliente
router.get('/intent/:id', clientOnly, async (req, res) => {
  try {
    const { id } = req.params; // PaymentIntent id

    // Verificar que el PaymentIntent pertenezca a un booking del cliente autenticado
    const booking = await Booking.findOne({
      'payment.stripePaymentIntentId': id,
      client: req.user._id
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Payment intent no encontrado para este usuario' });
    }

    const pi = await stripeService.getPaymentIntent(id);

    res.json({
      success: true,
      data: {
        clientSecret: pi.client_secret,
        amount: pi.amount,
        currency: pi.currency
      }
    });
  } catch (error) {
    console.error('payments.routes - GET /intent/:id error:', error);
    res.status(500).json({ success: false, message: 'No se pudo obtener el client_secret' });
  }
});

export default router;
