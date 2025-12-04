// routes/provider/proposals.routes.js
import express from 'express';
const router = express.Router();
import proposalController from '../../controllers/proposalController.js';
import requestController from '../../controllers/requestController.js';
import bookingController from '../../controllers/bookingController.js';
import {
  authenticateJWT,
  requireAuth
} from '../../middlewares/auth/jwtAuth.js';
import { 
  providerOnly, 
  requireActiveSubscription,
  checkLeadLimit
} from '../../middlewares/auth/rbacMiddleware.js';
import { validateBody } from '../../middlewares/utils/validate.js';
import { proposalDraftUpdateSchema, proposalSendSchema } from '../../schemas/http.js';

// Todas las rutas requieren autenticación de proveedor
router.use(authenticateJWT);
router.use(requireAuth);
router.use(providerOnly);

// Rutas de solicitudes disponibles para proveedores
router.get('/requests', requestController.getServiceRequests);
router.get('/requests/:id', requestController.getServiceRequest);

// Rutas de propuestas
router.get('/', proposalController.getProviderProposals);
// Context endpoint: plan, lead usage, commission preview (does not block on limit)
router.get('/context', requireActiveSubscription, proposalController.getProposalContext);
router.post('/requests/:serviceRequestId', 
  requireActiveSubscription, 
  checkLeadLimit, 
  validateBody(proposalSendSchema),
  proposalController.sendProposal
);
// Ciclo de propuesta en borrador
router.post('/requests/:serviceRequestId/draft', proposalController.createDraft);
router.put('/:proposalId', validateBody(proposalDraftUpdateSchema), proposalController.updateDraft);
router.post('/:proposalId/send', requireActiveSubscription, checkLeadLimit, validateBody(proposalSendSchema), proposalController.sendDraft);
router.post('/:proposalId/cancel', proposalController.cancelProposal);

// Rutas de bookings/reservas del proveedor
router.get('/bookings', bookingController.getBookings.bind(bookingController));
router.get('/bookings/:id', (req, res) => {
  bookingController.getBookings(req, res); // Filtrado por ID específico
});
router.put('/bookings/:id/status', bookingController.updateBookingStatus.bind(bookingController));
router.post('/bookings/:id/evidence', bookingController.uploadServiceEvidence.bind(bookingController));

export default router;