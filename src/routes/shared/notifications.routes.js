// routes/shared/notifications.routes.js
import express from 'express';
const router = express.Router();
import {
  authenticateJWT,
  requireAuth
} from '../../middlewares/auth/jwtAuth.js';
import User from '../../models/User/User.js';
import Notification from '../../models/Communication/Notification.js';

// Middlewares para usuarios autenticados
router.use(authenticateJWT);
router.use(requireAuth);

// Obtener notificaciones del usuario
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ user: req.user._id }),
      Notification.countDocuments({ user: req.user._id, read: false })
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get notifications'
    });
  }
});

// Marcar notificación como leída
router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Notification.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// Marcar todas como leídas
router.put('/read-all', async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true, readAt: new Date() } });
    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
});

// Preferencias de notificación
router.get('/preferences', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('preferences');
    
    res.json({
      success: true,
      data: {
        preferences: user.preferences?.notifications || {}
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get notification preferences'
    });
  }
});

router.put('/preferences', async (req, res) => {
  try {
    const { email, push, sms } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        'preferences.notifications': {
          email: email !== undefined ? email : true,
          push: push !== undefined ? push : true,
          sms: sms !== undefined ? sms : false
        }
      }
    });

    res.json({
      success: true,
      message: 'Notification preferences updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update notification preferences'
    });
  }
});

export default router;