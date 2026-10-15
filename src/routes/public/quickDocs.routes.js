// routes/public/quickDocs.routes.js
//
// Flujo 2 — "Vía Rápida en Vivo" (QuickDoc) — rutas PÚBLICAS por token.
// Sin autenticación: el acceso se controla por el token del link/QR.
import express from 'express';
import quickDocController from '../../controllers/quickDocController.js';
import { validateBody, validateParams } from '../../middlewares/utils/validate.js';
import { claimQuickDocSchema, quickDocTokenParam } from '../../schemas/quickDoc.schemas.js';

const router = express.Router();

// Ver documento (marca apertura + notifica al profesional)
router.get('/:token', validateParams(quickDocTokenParam), quickDocController.getPublicQuickDoc);

// Descargar/visualizar PDF (proxy Cloudinary)
router.get('/:token/pdf', validateParams(quickDocTokenParam), quickDocController.getPublicQuickDocPdf);

// Capturar correo + términos → cuenta en segundo plano
router.post('/:token/claim', validateParams(quickDocTokenParam), validateBody(claimQuickDocSchema), quickDocController.claimQuickDoc);

// Aceptar estimado
router.post('/:token/accept', validateParams(quickDocTokenParam), quickDocController.acceptPublicEstimate);

export default router;
