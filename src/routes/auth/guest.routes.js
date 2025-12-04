// routes/auth/guest.routes.js
import express from 'express';
import guestController from '../../controllers/guestController.js';
import ensureSession from '../../middlewares/auth/ensureSession.js';
import { attachGuest } from '../../middlewares/auth/attachGuest.js';

const router = express.Router();

// Rutas públicas (sin sesión)
router.get('/services/active', guestController.getActiveServices);
router.get('/providers/search', guestController.searchProvidersPublic);

// Todas las rutas siguientes requieren sesión
router.use(ensureSession);
router.use(attachGuest);

// Obtener datos de sesión guest
router.get('/session', guestController.getGuestSession);

// Actualizar información de contacto temporal
router.put('/contact', guestController.updateGuestContact);

// Vincular service request a sesión guest
router.post('/link-request', guestController.linkServiceRequestToGuest);

// Migrar datos de guest a usuario registrado (admin/sistema)
router.post('/migrate', guestController.migrateGuestToUser);

export default router;