// routes/shared/content.routes.js
//
// Endpoints PÚBLICOS del CMS — solo lectura, cacheados, sin autenticación.
// Sirven los textos editoriales (Términos, Privacidad, Sobre Nosotros, Hero,
// Datos de contacto) y la lista de FAQ al frontend.

import express from 'express';
import cmsController from '../../controllers/cmsController.js';
import { validateParams, validateQuery } from '../../middlewares/utils/validate.js';
import { contentKeyParamSchema, publicLocaleQuerySchema, faqQuerySchema } from '../../schemas/cms.schemas.js';

const router = express.Router();

// FAQ debe ir ANTES de '/:key' para que no caiga en el matcher genérico.
router.get('/faq', validateQuery(faqQuerySchema), cmsController.getPublicFaq);

router.get(
  '/:key',
  validateParams(contentKeyParamSchema),
  validateQuery(publicLocaleQuerySchema),
  cmsController.getPublicContent
);

export default router;
