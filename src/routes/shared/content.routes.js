// routes/shared/content.routes.js
//
// Endpoints PÚBLICOS del CMS — solo lectura, cacheados, sin autenticación.
// Sirven los textos editoriales (Términos, Privacidad, Sobre Nosotros, Hero,
// Datos de contacto) y la lista de FAQ al frontend.

import express from 'express';
import cmsController from '../../controllers/cmsController.js';
import siteSettingsController from '../../controllers/siteSettingsController.js';
import { validateParams, validateQuery } from '../../middlewares/utils/validate.js';
import { contentKeyParamSchema, publicLocaleQuerySchema, faqQuerySchema } from '../../schemas/cms.schemas.js';

const router = express.Router();

// Site settings públicos (deben ir ANTES de '/:key' para no caer en el matcher genérico).
router.get('/home-video', siteSettingsController.getPublicHomeHeroVideo);

// FAQ debe ir ANTES de '/:key' para que no caiga en el matcher genérico.
router.get('/faq', validateQuery(faqQuerySchema), cmsController.getPublicFaq);

// Overrides editoriales de categorías de servicio (labels + descripciones).
// El frontend lo consume al boot para mergear en i18n sin romper fallback.
router.get(
  '/service-categories',
  validateQuery(publicLocaleQuerySchema),
  cmsController.getPublicServiceCategories
);

router.get(
  '/:key',
  validateParams(contentKeyParamSchema),
  validateQuery(publicLocaleQuerySchema),
  cmsController.getPublicContent
);

export default router;
