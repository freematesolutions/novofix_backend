// routes/shared/reviews.routes.js
import express from 'express';
const router = express.Router();
import reviewController from '../../controllers/reviewController.js';
import {
  authenticateJWT,
  requireAuth
} from '../../middlewares/auth/jwtAuth.js';
import { 
  clientOnly,
  providerOnly,
  anyUser,
  clientOrProvider 
} from '../../middlewares/auth/rbacMiddleware.js';

// Rutas públicas - obtener reviews de proveedores
router.get('/provider/:providerId', anyUser, reviewController.getProviderReviews);

// Rutas protegidas
router.use(authenticateJWT);
router.use(requireAuth);

// Clientes - crear y gestionar reviews
router.post('/booking/:bookingId', clientOnly, reviewController.createReview);
router.put('/:reviewId/report', clientOrProvider, reviewController.reportReview);
// Obtener review por booking (cliente o proveedor involucrado)
router.get('/booking/:bookingId', clientOrProvider, reviewController.getReviewByBooking);

// Proveedores - responder a reviews
router.put('/:reviewId/response', providerOnly, reviewController.respondToReview);
router.patch('/:reviewId/response', providerOnly, reviewController.updateReviewResponse);
router.delete('/:reviewId/response', providerOnly, reviewController.deleteReviewResponse);

export default router;