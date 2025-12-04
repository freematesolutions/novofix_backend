// controllers/countersController.js
import ServiceRequest from '../models/Service/ServiceRequest.js';
import Proposal from '../models/Service/Proposal.js';
import Booking from '../models/Service/Booking.js';
import Chat from '../models/Communication/Chat.js';
import Notification from '../models/Communication/Notification.js';

class CountersController {
  async getCounters(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const userId = req.user._id;
      const roles = Array.isArray(req.user.roles) ? req.user.roles.map(r => String(r).toLowerCase()) : [];
      const hasClient = roles.includes('client') || String(req.user.role).toLowerCase() === 'client';
      const hasProvider = roles.includes('provider') || String(req.user.role).toLowerCase() === 'provider';

      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      const results = {
        notificationsUnread: 0,
        client: null,
        provider: null
      };

      // Notifications unread (applies to any role, per user)
      try {
        const userType = (String(req.user.role || '')[0] || '').toUpperCase() + String(req.user.role || '').slice(1).toLowerCase();
        // Fallback: if the primary role isn't in allowed values, try to infer from roles list
        const type = ['Client', 'Provider', 'Admin'].includes(userType)
          ? userType
          : (roles.includes('admin') ? 'Admin' : roles.includes('provider') ? 'Provider' : roles.includes('client') ? 'Client' : 'Client');
        results.notificationsUnread = await Notification.countDocuments({ user: userId, userType: type, read: false });
      } catch { /* ignore notifications errors */ }

      // Client counters
      if (hasClient) {
        const [requestsOpen, proposalsReceived, bookingsUpcoming, chatsUnread] = await Promise.all([
          // Open requests (published/active)
          ServiceRequest.countDocuments({ client: userId, status: { $in: ['published', 'active'] } }),
          // Proposals received on user's open requests
          (async () => {
            const openRequests = await ServiceRequest.find({ client: userId, status: { $in: ['published', 'active'] } }).select('_id').lean();
            if (!openRequests.length) return 0;
            const ids = openRequests.map(r => r._id);
            return Proposal.countDocuments({ serviceRequest: { $in: ids }, status: { $in: ['sent', 'viewed'] } });
          })(),
          // Upcoming bookings
          Booking.countDocuments({ client: userId, status: { $in: ['confirmed', 'provider_en_route', 'in_progress'] }, 'schedule.scheduledDate': { $gte: startOfToday } }),
          // Chats with unread messages
          Chat.countDocuments({ 'participants.client': userId, 'unreadCount.client': { $gt: 0 } })
        ]);

        results.client = {
          requestsOpen,
          proposalsReceived,
          bookingsUpcoming,
          chatsUnread
        };
      }

      // Provider counters
      if (hasProvider) {
        // Build visibility OR query for jobs
        const base = { status: { $in: ['published', 'active'] } };
        // Derive categories from provider profile when available
        let categories = [];
        try {
          const providerDoc = req.user.providerProfile ? req.user : (await (await import('../models/User/Provider.js')).default.findById(userId).select('providerProfile'));
          const svc = Array.isArray(providerDoc?.providerProfile?.services) ? providerDoc.providerProfile.services : [];
          categories = svc.map(s => s.category).filter(Boolean);
        } catch { /* ignore */ }

        const byCategory = categories.length > 0 ? { ...base, 'basicInfo.category': { $in: categories } } : base;
        const directed = { ...base, visibility: 'directed', selectedProviders: userId };
        const notified = { ...base, 'eligibleProviders.provider': userId };

        const [jobs, proposalsActive, bookingsUpcoming, chatsUnread, servicesCount] = await Promise.all([
          ServiceRequest.countDocuments({ $or: [byCategory, directed, notified] }),
          Proposal.countDocuments({ provider: userId, status: { $in: ['sent', 'viewed'] } }),
          Booking.countDocuments({ provider: userId, status: { $in: ['confirmed', 'provider_en_route', 'in_progress'] }, 'schedule.scheduledDate': { $gte: startOfToday } }),
          Chat.countDocuments({ 'participants.provider': userId, 'unreadCount.provider': { $gt: 0 } }),
          (async () => {
            try {
              const Provider = (await import('../models/User/Provider.js')).default;
              const p = await Provider.findById(userId).select('providerProfile.services').lean();
              return Array.isArray(p?.providerProfile?.services) ? p.providerProfile.services.length : 0;
            } catch { return 0; }
          })()
        ]);

        results.provider = {
          jobs,
          proposalsActive,
          bookingsUpcoming,
          chatsUnread,
          services: servicesCount
        };
      }

      return res.json({ success: true, data: results });
    } catch (error) {
      console.error('CountersController - getCounters error:', error);
      res.status(500).json({ success: false, message: 'Failed to load counters' });
    }
  }
}

const countersController = new CountersController();
export default countersController;
