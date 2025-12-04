// routes/provider/services.routes.js
import express from 'express';
const router = express.Router();
import agendaService from '../../services/internal/agendaService.js';
import {
  authenticateJWT,
  requireAuth
} from '../../middlewares/auth/jwtAuth.js';
import { providerOnly } from '../../middlewares/auth/rbacMiddleware.js';
import Provider from '../../models/User/Provider.js';
import Proposal from '../../models/Service/Proposal.js';
import Booking from '../../models/Service/Booking.js';

// Middlewares para proveedores autenticados
router.use(authenticateJWT);
router.use(requireAuth);
router.use(providerOnly);

// Gestión de disponibilidad
router.get('/availability/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.json({ success: true, data: { slots: [] } });
    }
    const slots = await agendaService.getProviderAvailableSlots(req.user._id, date);
    res.json({
      success: true,
      data: { slots }
    });
  } catch (error) {
    console.error('GET /provider/services/availability/slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get available slots'
    });
  }
});

// Actualizar horarios de trabajo
router.put('/availability/schedule', async (req, res) => {
  try {
    const { workingHours, exceptions } = req.body;
    
    await Provider.findByIdAndUpdate(req.user._id, {
      $set: {
        'providerProfile.availability.workingHours': workingHours,
        'providerProfile.availability.exceptions': exceptions
      }
    });

    res.json({
      success: true,
      message: 'Availability schedule updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update availability schedule'
    });
  }
});

// Verificar conflicto de disponibilidad
router.post('/availability/check-conflict', async (req, res) => {
  try {
    const { date, time } = req.body;
    const hasConflict = await agendaService.checkAvailabilityConflict(req.user._id, date, time);
    
    res.json({
      success: true,
      data: { hasConflict }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check availability conflict'
    });
  }
});

// Obtener estadísticas del proveedor
router.get('/stats', async (req, res) => {
  try {
    const provider = await Provider.findById(req.user._id);
    
    const [
      totalProposals,
      acceptedProposals,
      completedBookings,
      totalRevenue
    ] = await Promise.all([
      Proposal.countDocuments({ provider: req.user._id }),
      Proposal.countDocuments({ provider: req.user._id, status: 'accepted' }),
      Booking.countDocuments({ provider: req.user._id, status: 'completed' }),
      Booking.aggregate([
        {
          $match: {
            provider: req.user._id,
            'payment.status': 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$payment.providerEarnings' }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        profile: provider.providerProfile,
        stats: {
          totalProposals,
          acceptedProposals,
          acceptanceRate: totalProposals > 0 ? (acceptedProposals / totalProposals) * 100 : 0,
          completedBookings,
          totalRevenue: totalRevenue[0]?.total || 0,
          averageRating: provider.providerProfile.rating.average
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get provider stats'
    });
  }
});

export default router;