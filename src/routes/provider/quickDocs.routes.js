// routes/provider/quickDocs.routes.js
//
// Flujo 2 — "Vía Rápida en Vivo" (QuickDoc) — rutas del PROFESIONAL.
// Disponibles para cualquier profesional autenticado: SIN requireActiveSubscription,
// SIN checkLeadLimit y SIN comisión (decisión D).
import express from 'express';
import quickDocController from '../../controllers/quickDocController.js';
import { authenticateJWT, requireAuth } from '../../middlewares/auth/jwtAuth.js';
import { providerOnly } from '../../middlewares/auth/rbacMiddleware.js';
import { validateBody, validateParams } from '../../middlewares/utils/validate.js';
import { objectIdParam } from '../../schemas/http.js';
import { createQuickDocSchema, convertQuickDocSchema } from '../../schemas/quickDoc.schemas.js';

const router = express.Router();

router.use(authenticateJWT);
router.use(requireAuth);
router.use(providerOnly);

router.get('/', quickDocController.listQuickDocs);
router.post('/', validateBody(createQuickDocSchema), quickDocController.createQuickDoc);
router.get('/:id', validateParams(objectIdParam), quickDocController.getQuickDoc);
router.get('/:id/pdf', validateParams(objectIdParam), quickDocController.getProviderQuickDocPdf);
router.post('/:id/share-link', validateParams(objectIdParam), quickDocController.regenerateShareLink);
router.post('/:id/convert', validateParams(objectIdParam), validateBody(convertQuickDocSchema), quickDocController.convertToInvoice);
router.post('/:id/cancel', validateParams(objectIdParam), quickDocController.cancelQuickDoc);

export default router;
