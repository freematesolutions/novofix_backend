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

// Clientes - obtener bookings pendientes de reseña (para nudge banner)
router.get('/pending', clientOnly, reviewController.getPendingReviews.bind(reviewController));

// Clientes - obtener todas sus reseñas enviadas ("Mis Reseñas")
router.get('/my-reviews', clientOnly, reviewController.getMyReviews.bind(reviewController));

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

// ========== RESEÑAS DEL PROVEEDOR HACIA EL CLIENTE ==========
// Proveedor califica al cliente y opcionalmente a la plataforma
router.post('/client/booking/:bookingId', providerOnly, reviewController.createClientReview.bind(reviewController));
// Obtener reseña de cliente por booking
router.get('/client/booking/:bookingId', clientOrProvider, reviewController.getClientReviewByBooking.bind(reviewController));
// Verificar si ya existe reseña de cliente
router.get('/client/booking/:bookingId/exists', providerOnly, reviewController.checkClientReviewExists.bind(reviewController));

export default router;