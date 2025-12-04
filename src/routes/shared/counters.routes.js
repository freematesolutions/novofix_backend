// routes/shared/counters.routes.js
import express from 'express';
const router = express.Router();
import countersController from '../../controllers/countersController.js';
import { authenticateJWT, requireAuth } from '../../middlewares/auth/jwtAuth.js';

// Authenticated users (client/provider/admin) can request counters
router.use(authenticateJWT);
router.use(requireAuth);

router.get('/', countersController.getCounters);

export default router;
