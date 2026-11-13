// controllers/adminController.js
import User from '../models/User/User.js';
import Provider from '../models/User/Provider.js';
import Client from '../models/User/Client.js';
import Admin from '../models/User/Admin.js';
import ServiceRequest from '../models/Service/ServiceRequest.js';
import Booking from '../models/Service/Booking.js';
import Review from '../models/Service/Review.js';
import PasswordResetToken from '../models/System/PasswordResetToken.js';
import Session from '../models/System/Session.js';
import resendService from '../services/external/email/resendService.js';

class AdminController {
  constructor() {
    // Bind all methods to preserve 'this' context when used as Express route callbacks
    this.getDashboard = this.getDashboard.bind(this);
    this.manageUsers = this.manageUsers.bind(this);
    this.updateUserStatus = this.updateUserStatus.bind(this);
    this.updateUserRole = this.updateUserRole.bind(this);
    this.setUserPassword = this.setUserPassword.bind(this);
    this.moderateReviews = this.moderateReviews.bind(this);
    this.takeReviewAction = this.takeReviewAction.bind(this);
    this.getReports = this.getReports.bind(this);
    this.notifyModerators = this.notifyModerators.bind(this);
  }

  /**
   * Dashboard de administración
   */
  async getDashboard(req, res) {
    try {
      const [
        totalUsers,
        totalProviders,
        totalClients,
        totalAdmins,
        totalServiceRequests,
        totalBookings,
        recentBookings,
        pendingModeration
      ] = await Promise.all([
        User.countDocuments(),
        // Discriminators guardan role capitalizado ('Provider','Client','Admin').
        // Usar los modelos discriminator cuenta exactamente por tipo primario.
        Provider.countDocuments(),
        Client.countDocuments(),
        Admin.countDocuments(),
        ServiceRequest.countDocuments(),
        Booking.countDocuments(),
        Booking.find().sort({ createdAt: -1 }).limit(10),
        Review.countDocuments({ status: 'flagged' })
      ]);

      // Estadísticas de ingresos (simplificado)
      const revenueStats = await this.calculateRevenueStats();

      res.json({
        success: true,
        data: {
          overview: {
            totalUsers,
            totalProviders,
            totalClients,
            totalAdmins,
            totalServiceRequests,
            totalBookings,
            pendingModeration
          },
          revenue: revenueStats,
          recentActivity: recentBookings
        }
      });
    } catch (error) {
      console.error('AdminController - getDashboard error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get dashboard data'
      });
    }
  }

  /**
   * Gestión de usuarios
   */
  async manageUsers(req, res) {
    try {
      const { role, status, page = 1, limit = 20 } = req.query;

      let query = {};
      // Los discriminators guardan role capitalizado ('Client','Provider','Admin').
      // El frontend envía el rol en minúscula, así que lo normalizamos.
      if (role) {
        const normalized = String(role).trim().toLowerCase();
        const roleMap = { client: 'Client', provider: 'Provider', admin: 'Admin' };
        query.role = roleMap[normalized] || role;
      }
      if (status) query.isActive = status === 'active';

      const users = await User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await User.countDocuments(query);

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error('AdminController - manageUsers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get users'
      });
    }
  }

  /**
   * Actualizar estado de usuario
   */
  async updateUserStatus(req, res) {
    try {
      const { userId } = req.params;
      const { isActive, reason } = req.body;

      // Al ACTIVAR manualmente desde admin: además de isActive, marcamos la cuenta
      // como verificada y limpiamos tokens de verificación pendientes. Esto es
      // necesario porque login() bloquea tanto por !isActive como por !emailVerified;
      // sin esto, un usuario "activado" por el admin seguiría sin poder acceder.
      // El admin asume la validación manual de la identidad (queda auditado en adminNotes).
      // Al DESACTIVAR solo se cambia isActive (no se revierte la verificación de email).
      const setFields = { isActive };
      if (isActive) {
        setFields.emailVerified = true;
        setFields.emailVerificationToken = null;
        setFields.emailVerificationTokenExpiresAt = null;
      }

      const user = await User.findByIdAndUpdate(
        userId,
        {
          $set: setFields,
          $push: {
            adminNotes: {
              action: isActive ? 'activated' : 'deactivated',
              reason,
              admin: req.user._id,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Notificar al usuario del cambio (role en discriminator es capitalizado)
      const notificationService = (await import('../services/external/notificationService.js')).default;
      if (String(user.role).toLowerCase() === 'provider') {
        await notificationService.sendProviderNotification({
          providerId: user._id,
          type: isActive ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED',
          data: { reason }
        });
      }

      res.json({
        success: true,
        message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
        data: { user }
      });
    } catch (error) {
      console.error('AdminController - updateUserStatus error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update user status'
      });
    }
  }

  /**
   * Actualizar rol de usuario
   */
  async updateUserRole(req, res) {
    try {
      const { userId } = req.params;
      const { role } = req.body; // 'client' | 'provider' | 'admin'

      const allowed = ['client', 'provider', 'admin'];
      const normalized = String(role || '').trim().toLowerCase();
      if (!allowed.includes(normalized)) {
        return res.status(400).json({ success: false, message: 'Invalid role' });
      }

      // Los discriminators de Mongoose guardan el role capitalizado.
      const roleMap = { client: 'Client', provider: 'Provider', admin: 'Admin' };
      const discriminatorRole = roleMap[normalized];

      // Evitar que el último admin se quede sin admins
      if (normalized !== 'admin') {
        const target = await User.findById(userId).select('role');
        if (!target) return res.status(404).json({ success: false, message: 'User not found' });

        if (String(target.role).toLowerCase() === 'admin') {
          const adminCount = await User.countDocuments({ role: 'Admin', isActive: true, _id: { $ne: userId } });
          if (adminCount === 0) {
            return res.status(400).json({ success: false, message: 'Cannot remove the last active admin' });
          }
        }
      }

      // Mantener coherencia: role primario (discriminator) + array roles[] en minúscula.
      // IMPORTANTE: Mongoose ignora cambios al discriminatorKey ('role') en updates salvo
      // que se indique overwriteDiscriminatorKey; sin esto el rol nunca se persistía.
      const user = await User.findByIdAndUpdate(
        userId,
        {
          $set: { role: discriminatorRole },
          $addToSet: { roles: normalized }
        },
        { new: true, overwriteDiscriminatorKey: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      res.json({ success: true, message: 'User role updated', data: { user } });
    } catch (error) {
      console.error('AdminController - updateUserRole error:', error);
      res.status(500).json({ success: false, message: 'Failed to update user role' });
    }
  }

  /**
   * Cambiar la contraseña de un usuario directamente (iniciado por admin)
   *
   * Seguridad:
   * - El admin NO conoce la contraseña actual del usuario (está hasheada). Para
   *   confirmar la acción, el admin se RE-AUTENTICA con su propia contraseña.
   * - La nueva contraseña se guarda hasheada por el hook pre('save') del modelo
   *   (bcrypt). Nunca se almacena ni se registra en texto plano.
   * - Se invalidan tokens de reseteo pendientes y las sesiones activas del usuario.
   * - Queda auditado en adminNotes (sin datos sensibles).
   * - Se notifica al usuario por email que su contraseña fue cambiada.
   */
  async setUserPassword(req, res) {
    try {
      const { userId } = req.params;
      const { newPassword, adminPassword } = req.body || {};

      // Validaciones de entrada
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
      }
      if (!adminPassword || typeof adminPassword !== 'string') {
        return res.status(400).json({ success: false, message: 'Admin password is required' });
      }

      // Re-autenticación: verificar la contraseña del propio admin
      const admin = await User.findById(req.user._id).select('+password');
      if (!admin || !(await admin.correctPassword(adminPassword, admin.password))) {
        return res.status(401).json({ success: false, message: 'Invalid admin password' });
      }

      const user = await User.findById(userId).select('+password');
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Establecer la nueva contraseña (el hook pre-save la hashea con bcrypt)
      user.password = newPassword;
      user.adminNotes = user.adminNotes || [];
      user.adminNotes.push({
        action: 'password_changed',
        reason: 'Admin-initiated password change',
        admin: req.user._id,
        timestamp: new Date()
      });
      await user.save();

      // Invalidar tokens de reseteo pendientes
      try {
        await PasswordResetToken.deleteMany({ user: user._id });
      } catch (e) {
        console.warn('Admin setUserPassword - token cleanup failed:', e?.message);
      }

      // Invalidar sesiones activas para forzar nuevo inicio de sesión
      let revokedSessions = 0;
      try {
        const result = await Session.deleteMany({ user: user._id });
        revokedSessions = result?.deletedCount || 0;
      } catch (e) {
        console.warn('Admin setUserPassword - session invalidation failed:', e?.message);
      }

      // Notificar al usuario (buena práctica de seguridad); no bloquea la respuesta
      try {
        const userLocale = user.preferences?.language || 'es';
        await resendService.sendEmail({
          to: user.email,
          template: 'password_reset_confirmed',
          data: {
            name: user.profile?.firstName || user.email,
            loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`,
            locale: userLocale
          },
          locale: userLocale
        });
      } catch (e) {
        console.warn('Admin setUserPassword - notification email failed:', e?.message);
      }

      return res.json({
        success: true,
        message: 'User password updated successfully',
        data: { revokedSessions }
      });
    } catch (error) {
      console.error('AdminController - setUserPassword error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update user password' });
    }
  }

  /**
   * Moderación de reviews
   */
  async moderateReviews(req, res) {
    try {
      const { status, page = 1, limit = 20 } = req.query;

      let query = {};
      if (status) query.status = status;

      const reviews = await Review.find(query)
        .populate('client', 'profile')
        .populate('provider', 'providerProfile')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await Review.countDocuments(query);

      res.json({
        success: true,
        data: {
          reviews,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error('AdminController - moderateReviews error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get reviews for moderation'
      });
    }
  }

  /**
   * Tomar acción sobre review
   */
  async takeReviewAction(req, res) {
    try {
      const { reviewId } = req.params;
      const { action, reason } = req.body;

      const review = await Review.findByIdAndUpdate(
        reviewId,
        {
          $set: {
            status: action === 'approve' ? 'active' : 'removed',
            'moderation.moderatedBy': req.user._id,
            'moderation.moderatedAt': new Date(),
            'moderation.action': action
          }
        },
        { new: true }
      );

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found'
        });
      }

      // Si se aprueba, actualizar rating del proveedor
      if (action === 'approve') {
        const reviewController = require('./reviewController');
        await reviewController.updateProviderRating(review.provider);
      }

      res.json({
        success: true,
        message: `Review ${action === 'approve' ? 'approved' : 'removed'} successfully`,
        data: { review }
      });
    } catch (error) {
      console.error('AdminController - takeReviewAction error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to take action on review'
      });
    }
  }

  /**
   * Reportes y analytics con gráficos
   */
  async getReports(req, res) {
    try {
      const { period = 'month' } = req.query; // week, month, quarter, year

      const dateRange = this.getDateRange(period);

      const [
        newUsers,
        newServiceRequests,
        completedBookings,
        revenue,
        bookingsByStatus,
        dailyTrends,
        weeklyComparison
      ] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: dateRange.start } }),
        ServiceRequest.countDocuments({ createdAt: { $gte: dateRange.start } }),
        Booking.countDocuments({ 
          status: 'completed', 
          createdAt: { $gte: dateRange.start } 
        }),
        this.calculatePeriodRevenue(dateRange),
        // Bookings by status for donut chart
        Booking.aggregate([
          { $match: { createdAt: { $gte: dateRange.start } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        // Daily trends for line chart
        Booking.aggregate([
          { $match: { createdAt: { $gte: dateRange.start } } },
          { 
            $group: { 
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } },
          { $limit: 30 },
          { $project: { date: '$_id', count: 1, _id: 0 } }
        ]),
        // Weekly comparison for bar chart
        Booking.aggregate([
          { $match: { createdAt: { $gte: dateRange.start } } },
          {
            $group: {
              _id: { $dayOfWeek: '$createdAt' },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } },
          {
            $project: {
              day: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$_id', 1] }, then: 'Dom' },
                    { case: { $eq: ['$_id', 2] }, then: 'Lun' },
                    { case: { $eq: ['$_id', 3] }, then: 'Mar' },
                    { case: { $eq: ['$_id', 4] }, then: 'Mié' },
                    { case: { $eq: ['$_id', 5] }, then: 'Jue' },
                    { case: { $eq: ['$_id', 6] }, then: 'Vie' },
                    { case: { $eq: ['$_id', 7] }, then: 'Sáb' }
                  ],
                  default: 'Otro'
                }
              },
              count: 1,
              _id: 0
            }
          }
        ])
      ]);

      // Métricas de proveedores
      const providerMetrics = await this.getProviderMetrics(dateRange);

      res.json({
        success: true,
        data: {
          period,
          dateRange,
          metrics: {
            newUsers,
            newServiceRequests,
            completedBookings,
            revenue,
            providerMetrics,
            bookingsByStatus,
            weeklyComparison
          },
          trends: {
            daily: dailyTrends
          }
        }
      });
    } catch (error) {
      console.error('AdminController - getReports error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate reports'
      });
    }
  }

  /**
   * Calcular estadísticas de ingresos
   */
  async calculateRevenueStats() {
    try {
      const currentMonth = new Date();
      currentMonth.setDate(1);
      currentMonth.setHours(0, 0, 0, 0);

      const lastMonth = new Date(currentMonth);
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      const [currentMonthRevenue, lastMonthRevenue, totalRevenue] = await Promise.all([
        Booking.aggregate([
          {
            $match: {
              'payment.status': 'completed',
              'payment.paidAt': { $gte: currentMonth }
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$payment.totalAmount' },
              commission: { $sum: '$payment.commission.amount' }
            }
          }
        ]),
        Booking.aggregate([
          {
            $match: {
              'payment.status': 'completed',
              'payment.paidAt': { $gte: lastMonth, $lt: currentMonth }
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$payment.totalAmount' },
              commission: { $sum: '$payment.commission.amount' }
            }
          }
        ]),
        Booking.aggregate([
          {
            $match: {
              'payment.status': 'completed'
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$payment.totalAmount' },
              commission: { $sum: '$payment.commission.amount' }
            }
          }
        ])
      ]);

      return {
        currentMonth: currentMonthRevenue[0] || { total: 0, commission: 0 },
        lastMonth: lastMonthRevenue[0] || { total: 0, commission: 0 },
        allTime: totalRevenue[0] || { total: 0, commission: 0 }
      };
    } catch (error) {
      console.error('AdminController - calculateRevenueStats error:', error);
      return {
        currentMonth: { total: 0, commission: 0 },
        lastMonth: { total: 0, commission: 0 },
        allTime: { total: 0, commission: 0 }
      };
    }
  }

  /**
   * Obtener rango de fechas para reportes
   */
  getDateRange(period) {
    const end = new Date();
    const start = new Date();

    switch (period) {
      case 'week':
        start.setDate(end.getDate() - 7);
        break;
      case 'month':
        start.setMonth(end.getMonth() - 1);
        break;
      case 'quarter':
        start.setMonth(end.getMonth() - 3);
        break;
      case 'year':
        start.setFullYear(end.getFullYear() - 1);
        break;
      default:
        start.setMonth(end.getMonth() - 1);
    }

    return { start, end };
  }

  /**
   * Calcular ingresos del período
   */
  async calculatePeriodRevenue(dateRange) {
    const result = await Booking.aggregate([
      {
        $match: {
          'payment.status': 'completed',
          'payment.paidAt': { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$payment.totalAmount' },
          totalCommission: { $sum: '$payment.commission.amount' },
          bookingCount: { $sum: 1 }
        }
      }
    ]);

    return result[0] || { totalRevenue: 0, totalCommission: 0, bookingCount: 0 };
  }

  /**
   * Obtener métricas de proveedores
   */
  async getProviderMetrics(dateRange) {
    const metrics = await Provider.aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange.start }
        }
      },
      {
        $group: {
          _id: '$subscription.plan',
          count: { $sum: 1 },
          avgRating: { $avg: '$providerProfile.rating.average' }
        }
      }
    ]);

    return metrics;
  }

  /**
   * Notificar moderadores
   */
  async notifyModerators(notification) {
    try {
      // Encontrar administradores activos
      const admins = await User.find({ role: 'admin', isActive: true });

      const notificationService = (await import('../services/external/notificationService.js')).default;
      
      await Promise.all(
        admins.map(admin => 
          notificationService.sendInAppNotification({
            userId: admin._id,
            type: notification.type,
            data: notification.data
          })
        )
      );
    } catch (error) {
      console.error('AdminController - notifyModerators error:', error);
    }
  }
}

export default new AdminController();