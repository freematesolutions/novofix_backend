// routes/admin/cms.routes.js
//
// Endpoints ADMIN del CMS — protegidos con JWT + rol admin + rate-limit propio.
// Permiten editar contenidos editoriales y FAQ sin redeploy.

import express from 'express';
import rateLimit from 'express-rate-limit';
import cmsController from '../../controllers/cmsController.js';
import { authenticateJWT, requireAuth } from '../../middlewares/auth/jwtAuth.js';
import { adminOnly } from '../../middlewares/auth/rbacMiddleware.js';
import { validateBody, validateParams } from '../../middlewares/utils/validate.js';
import {
  updateContentSchema,
  contentKeyParamSchema,
  rollbackParamSchema,
  createFaqSchema,
  updateFaqSchema,
  reorderFaqSchema
} from '../../schemas/cms.schemas.js';

const router = express.Router();

// Rate-limit dedicado a escrituras del CMS: 30 cambios por hora por IP.
// Bastante para uso editorial real (incluso intensivo) y suficiente para
// frenar bucles accidentales o abuso si una credencial admin se filtrase.
const cmsWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many CMS writes from this IP. Try again later.' }
});

// Todas las rutas exigen sesión válida + rol admin
router.use(authenticateJWT, requireAuth, adminOnly);

// ─── Contenidos ─────────────────────────────────────────────────────────────
router.get('/contents', cmsController.listContents);

router.get(
  '/contents/:key',
  validateParams(contentKeyParamSchema),
  cmsController.getContentForAdmin
);

router.get(
  '/contents/:key/history/:version',
  validateParams(contentKeyParamSchema),
  cmsController.getHistoryEntry
);

router.put(
  '/contents/:key',
  cmsWriteLimiter,
  validateParams(contentKeyParamSchema),
  validateBody(updateContentSchema),
  cmsController.updateContent
);

router.post(
  '/contents/:key/rollback/:version',
  cmsWriteLimiter,
  validateParams(rollbackParamSchema),
  cmsController.rollbackContent
);

// ─── FAQ ────────────────────────────────────────────────────────────────────
router.get('/faq', cmsController.listFaqAdmin);
router.post('/faq', cmsWriteLimiter, validateBody(createFaqSchema), cmsController.createFaq);
router.put('/faq/reorder', cmsWriteLimiter, validateBody(reorderFaqSchema), cmsController.reorderFaq);
router.put('/faq/:id', cmsWriteLimiter, validateBody(updateFaqSchema), cmsController.updateFaq);
router.delete('/faq/:id', cmsWriteLimiter, cmsController.deleteFaq);

export default router;
