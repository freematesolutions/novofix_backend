// routes/admin/users.routes.js
import express from 'express';
import adminController from '../../controllers/adminController.js';
import { authenticateJWT, requireAuth } from '../../middlewares/auth/jwtAuth.js';
import { adminOnly } from '../../middlewares/auth/rbacMiddleware.js';
import ServiceRequest from '../../models/Service/ServiceRequest.js';
import Booking from '../../models/Service/Booking.js';

const router = express.Router();

// Todas las rutas requieren permisos de administrador
router.use(authenticateJWT);
router.use(requireAuth);
router.use(adminOnly);

// Dashboard y overview
router.get('/dashboard', adminController.getDashboard);

// Gestión de usuarios
router.get('/users', adminController.manageUsers);
router.put('/users/:userId/status', adminController.updateUserStatus);
router.put('/users/:userId/role', adminController.updateUserRole);

// Moderación de contenido
router.get('/reviews/moderation', adminController.moderateReviews);
router.put('/reviews/:reviewId/moderate', adminController.takeReviewAction);

// Reportes y analytics
router.get('/reports', adminController.getReports);

// Gestión de servicios y solicitudes
router.get('/service-requests', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let query = {};
    if (status) query.status = status;

    const requests = await ServiceRequest.find(query)
      .populate('client', 'profile')
      .populate('acceptedProposal')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await ServiceRequest.countDocuments(query);

    res.json({
      success: true,
      data: {
        requests,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get service requests'
    });
  }
});

// Gestión de bookings
router.get('/bookings', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let query = {};
    if (status) query.status = status;

    const bookings = await Booking.find(query)
      .populate('client', 'profile')
      .populate('provider', 'providerProfile')
      .populate('serviceRequest', 'basicInfo')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get bookings'
    });
  }
});

export default router;