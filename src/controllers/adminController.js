// controllers/adminController.js
import User from '../models/User/User.js';
import Provider from '../models/User/Provider.js';
import ServiceRequest from '../models/Service/ServiceRequest.js';
import Booking from '../models/Service/Booking.js';
import Review from '../models/Service/Review.js';

class AdminController {
  /**
   * Dashboard de administración
   */
  async getDashboard(req, res) {
    try {
      const [
        totalUsers,
        totalProviders,
        totalClients,
        totalServiceRequests,
        totalBookings,
        recentBookings,
        pendingModeration
      ] = await Promise.all([
        User.countDocuments(),
        Provider.countDocuments(),
        User.countDocuments({ role: 'client' }),
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
      if (role) query.role = role;
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

      const user = await User.findByIdAndUpdate(
        userId,
        { 
          $set: { isActive },
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

      // Notificar al usuario del cambio
      const notificationService = (await import('../services/external/notificationService.js')).default;
      if (user.role === 'provider') {
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
      if (!allowed.includes(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role' });
      }

      // Evitar que el último admin se quede sin admins
      if (role !== 'admin') {
        const target = await User.findById(userId).select('role');
        if (!target) return res.status(404).json({ success: false, message: 'User not found' });

        if (target.role === 'admin') {
          const adminCount = await User.countDocuments({ role: 'admin', isActive: true, _id: { $ne: userId } });
          if (adminCount === 0) {
            return res.status(400).json({ success: false, message: 'Cannot remove the last active admin' });
          }
        }
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { role } },
        { new: true }
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