// routes/client/requests.routes.js
import express from 'express';
const router = express.Router();
import requestController from '../../controllers/requestController.js';
import proposalController from '../../controllers/proposalController.js';
import bookingController from '../../controllers/bookingController.js';
import {
  authenticateJWT,
  requireAuth
} from '../../middlewares/auth/jwtAuth.js';
import { clientOnly } from '../../middlewares/auth/rbacMiddleware.js';
import { attachGuest } from '../../middlewares/auth/attachGuest.js';
import { validateBody } from '../../middlewares/utils/validate.js';
import { validateCategory } from '../../middlewares/utils/validateCategory.js';
import { createServiceRequestSchema, updateServiceRequestSchema } from '../../schemas/http.js';

// Aplicar middlewares
router.use(authenticateJWT);
router.use(attachGuest);

// Rutas de solicitudes de servicio
router.post('/requests', requireAuth, clientOnly, validateBody(createServiceRequestSchema), requestController.createServiceRequest);
router.get('/requests', requireAuth, clientOnly, validateCategory({ source: 'query', required: false }), requestController.getServiceRequests);
router.get('/requests/:id', requireAuth, clientOnly, requestController.getServiceRequest);
router.put('/requests/:id', requireAuth, clientOnly, validateBody(updateServiceRequestSchema), requestController.updateServiceRequest);
router.put('/requests/:id/cancel', requireAuth, clientOnly, requestController.cancelServiceRequest);
router.put('/requests/:id/publish', requireAuth, clientOnly, requestController.publishServiceRequest);
router.put('/requests/:id/archive', requireAuth, clientOnly, requestController.archiveServiceRequest);
router.put('/requests/:id/republish', requireAuth, clientOnly, requestController.republishServiceRequest);
// Elegibilidad
router.get('/requests/:id/eligibility', requireAuth, clientOnly, requestController.getRequestEligibility);
router.get('/eligibility', requireAuth, clientOnly, validateCategory({ source: 'query' }), requestController.getEligibilityPreview);

// Obtener categorías activas (con proveedores registrados)
router.get('/categories/active', requireAuth, clientOnly, requestController.getActiveCategories);

// Búsqueda de proveedores para invitación dirigida
router.get('/providers/search', requireAuth, clientOnly, requestController.searchProviders);

// Notificar proveedores específicos (flujo dirigido)
router.post('/requests/:id/notify-providers', requireAuth, clientOnly, requestController.notifySpecificProviders);

// Rutas de propuestas
router.get('/requests/:requestId/proposals', requireAuth, clientOnly, proposalController.getRequestProposals);
router.post('/proposals/:proposalId/accept', requireAuth, clientOnly, proposalController.acceptProposal);
router.post('/proposals/:proposalId/reject', requireAuth, clientOnly, proposalController.rejectProposal);

// Rutas de bookings/reservas
router.get('/bookings', requireAuth, clientOnly, bookingController.getBookings.bind(bookingController));
router.get('/bookings/:id', requireAuth, clientOnly, (req, res) => {
  bookingController.getBookings(req, res); // Implementación específica para un booking
});
router.post('/bookings/:id/confirm-completion', requireAuth, clientOnly, bookingController.confirmServiceCompletion.bind(bookingController));

export default router;