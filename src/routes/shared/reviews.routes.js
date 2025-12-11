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
router.get('/provider/:providerId', anyUser, reviewController.getProviderReviews.bind(reviewController));

// Rutas protegidas
router.use(authenticateJWT);
router.use(requireAuth);

// Clientes - crear y gestionar reviews
router.post('/booking/:bookingId', clientOnly, reviewController.createReview.bind(reviewController));
router.put('/:reviewId/report', clientOrProvider, reviewController.reportReview.bind(reviewController));
// Obtener review por booking (cliente o proveedor involucrado)
router.get('/booking/:bookingId', clientOrProvider, reviewController.getReviewByBooking.bind(reviewController));

// Helpful/Not Helpful - cualquier usuario autenticado puede votar
router.post('/:reviewId/helpful', clientOrProvider, reviewController.voteHelpful.bind(reviewController));

// Proveedores - responder a reviews
router.put('/:reviewId/response', providerOnly, reviewController.respondToReview.bind(reviewController));
router.patch('/:reviewId/response', providerOnly, reviewController.updateReviewResponse.bind(reviewController));
router.delete('/:reviewId/response', providerOnly, reviewController.deleteReviewResponse.bind(reviewController));

export default router;