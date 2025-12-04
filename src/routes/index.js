// routes/index.js
import express from 'express';
import authRoutes from './auth/auth.routes.js';
import guestRoutes from './auth/guest.routes.js';
import clientRequestRoutes from './client/requests.routes.js';
import providerProposalRoutes from './provider/proposals.routes.js';
import providerServiceRoutes from './provider/services.routes.js';
import providerSubscriptionRoutes from './provider/subscription.routes.js';
import bookingRoutes from './shared/bookings.routes.js';
import paymentsRoutes from './shared/payments.routes.js';
import chatRoutes from './shared/chat.routes.js';
import reviewRoutes from './shared/reviews.routes.js';
import adminRoutes from './admin/users.routes.js';
import uploadRoutes from './shared/uploads.routes.js';
import notificationRoutes from './shared/notifications.routes.js';
import countersRoutes from './shared/counters.routes.js';

const router = express.Router();

// Configurar rutas con sus prefijos
router.use('/auth', authRoutes);
router.use('/guest', guestRoutes);
router.use('/client', clientRequestRoutes);
router.use('/provider/proposals', providerProposalRoutes);
router.use('/provider/services', providerServiceRoutes);
router.use('/provider/subscription', providerSubscriptionRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentsRoutes);
router.use('/chats', chatRoutes);
router.use('/reviews', reviewRoutes);
router.use('/admin', adminRoutes);
router.use('/uploads', uploadRoutes);
router.use('/notifications', notificationRoutes);
router.use('/counters', countersRoutes);


// Ruta raíz de la API
router.get('/', (req, res) => {
  res.json({ message: 'API funcionando correctamente' });
});

// Ruta de status
router.get('/status', async (req, res) => {
  try {
    // Si usas mongoose y redisClient, asegúrate de importarlos aquí
    const mongoose = (await import('mongoose')).default;
    const redisClient = (await import('../config/redis.js')).default;
    const [dbStatus, redisStatus, redisPing] = await Promise.all([
      mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      redisClient.getStatus(),
      redisClient.ping()
    ]);
    res.json({
      success: true,
      data: {
        server: 'running',
        database: dbStatus,
        redis: {
          ...redisStatus,
          ping: redisPing
        },
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Status check failed'
    });
  }
});

// Ruta de health check
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running smoothly',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Ruta de 404 para API
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

export default router;