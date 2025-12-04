// routes/shared/bookings.routes.js
import express from 'express';
import bookingController from '../../controllers/bookingController.js';
import reviewController from '../../controllers/reviewController.js';
import { authenticateJWT, requireAuth } from '../../middlewares/auth/jwtAuth.js';
import { clientOrProvider, clientOnly, providerOnly } from '../../middlewares/auth/rbacMiddleware.js';
import Booking from '../../models/Service/Booking.js';

const router = express.Router();

// Middlewares comunes
router.use(authenticateJWT);
router.use(requireAuth);
router.use(clientOrProvider);

// Rutas compartidas (cliente y proveedor)
router.get('/', bookingController.getBookings);
router.get('/:id', async (req, res) => {
  // Obtener booking específico con verificación de ownership
  try {
    let query = { _id: req.params.id };
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];

    // Filtrar según rol
    if (userRoles.includes('client')) {
      query.client = req.user._id;
    } else if (userRoles.includes('provider')) {
      query.provider = req.user._id;
    }

    const booking = await Booking.findOne(query)
      .populate('serviceRequest', 'basicInfo location')
      .populate('client', 'profile')
      .populate('provider', 'providerProfile')
      .populate('proposal', 'pricing timing terms');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: { booking }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get booking'
    });
  }
});

// Rutas específicas de cliente
router.post('/:id/confirm-completion', clientOnly, bookingController.confirmServiceCompletion.bind(bookingController));

// Rutas específicas de proveedor
router.put('/:id/status', providerOnly, bookingController.updateBookingStatus.bind(bookingController));
router.post('/:id/evidence', providerOnly, bookingController.uploadServiceEvidence.bind(bookingController));

// Rutas de reviews (después de completar el servicio)
router.post('/:bookingId/reviews', clientOnly, reviewController.createReview);
router.get('/:bookingId/reviews', (req, res) => {
  // Obtener review específica de un booking
  reviewController.getProviderReviews(req, res);
});

export default router;