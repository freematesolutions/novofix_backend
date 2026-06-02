// routes/admin/siteSettings.routes.js
//
// Endpoints ADMIN para ajustes del sitio (clave/valor). Por ahora sólo expone
// el setting 'home_hero_video' (Req 16).

import express from 'express';
import rateLimit from 'express-rate-limit';
import siteSettingsController from '../../controllers/siteSettingsController.js';
import { authenticateJWT, requireAuth } from '../../middlewares/auth/jwtAuth.js';
import { adminOnly } from '../../middlewares/auth/rbacMiddleware.js';

const router = express.Router();

// Rate-limit para escrituras: 30 cambios/hora por IP (mismo criterio que CMS).
const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many writes from this IP. Try again later.' }
});

router.use(authenticateJWT, requireAuth, adminOnly);

router.get('/home-video', siteSettingsController.getAdminHomeHeroVideo);
router.put('/home-video', writeLimiter, siteSettingsController.updateHomeHeroVideo);

export default router;
