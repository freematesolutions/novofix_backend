// services/external/notificationService.js
import resendService from './email/resendService.js';
import whatsappService from './messaging/whatsappService.js';
import Notification from '../../models/Communication/Notification.js';
import User from '../../models/User/User.js';
import ServiceRequest from '../../models/Service/ServiceRequest.js';

class NotificationService {
  constructor() {
    this.channels = ['email', 'whatsapp', 'in_app'];
  }

  async sendProviderNotification({ providerId, serviceRequestId, type, priority = 'medium', data = {} }) {
    try {
      const provider = await User.findById(providerId).lean();
      if (!provider) throw new Error('Provider not found');

      let serviceRequest = null;
      if (type !== 'WELCOME_PROVIDER' && serviceRequestId) {
        serviceRequest = await ServiceRequest.findById(serviceRequestId)
          .populate('client')
          .lean();
        if (!serviceRequest) {
          throw new Error('ServiceRequest not found');
        }
      }

      const notificationData = this.buildNotificationData(provider, serviceRequest, type, data);
      const notificationPromises = [];

      // Notificación por email (solo si hay plantilla definida)
      if (provider.preferences?.notifications?.email && notificationData.emailTemplate) {
        notificationPromises.push(
          this.sendEmailNotification(provider, notificationData)
        );
      }

      // Notificación por WhatsApp (solo si hay plantilla definida)
      if (provider.preferences?.notifications?.sms && provider.profile?.phone && notificationData.whatsappTemplate) {
        notificationPromises.push(
          this.sendWhatsAppNotification(provider, notificationData)
        );
      }

      // Notificación en app (userType requerido por el modelo Notification)
      notificationPromises.push(
        this.createInAppNotification(providerId, 'Provider', notificationData)
      );

      await Promise.allSettled(notificationPromises);

      return {
        success: true,
        channels: notificationData.channels,
        message: 'Notifications sent successfully'
      };
    } catch (error) {
      console.error('NotificationService - sendProviderNotification error:', error);
      throw error;
    }
  }

  buildNotificationData(provider, serviceRequest, type, extra = {}) {
    const baseData = {
      type,
      recipient: {
        id: provider._id,
        email: provider.email,
        name: provider.profile?.firstName || 'Proveedor'
      },
      serviceRequest: serviceRequest ? {
        id: serviceRequest._id,
        title: serviceRequest.basicInfo.title,
        category: serviceRequest.basicInfo.category,
        urgency: serviceRequest.basicInfo.urgency,
        location: serviceRequest.location.address
      } : null,
      channels: [],
      timestamp: new Date()
    };

    switch (type) {
      case 'WELCOME_PROVIDER':
        return {
          ...baseData,
          subject: '¡Bienvenido a la plataforma! 🎉',
          message: `Gracias por unirte, ${extra.businessName || baseData.recipient.name}. Configura tu perfil y empieza a recibir solicitudes.`,
          actionUrl: `/provider/onboarding`,
          priority: 'medium'
        };

      case 'NEW_REQUEST':
        return {
          ...baseData,
          subject: 'Nueva solicitud de servicio disponible',
          emailTemplate: 'new_request',
          whatsappTemplate: 'new_service_request',
          message: `Tienes una nueva solicitud de ${serviceRequest.basicInfo.category} en ${serviceRequest.location.address}`,
          actionUrl: `/provider/requests/${serviceRequest._id}`,
          priority: 'high'
        };

      case 'PROPOSAL_ACCEPTED':
        return {
          ...baseData,
          subject: '¡Tu propuesta ha sido aceptada!',
          emailTemplate: 'proposal_accepted',
          whatsappTemplate: 'proposal_accepted',
          message: `El cliente ha aceptado tu propuesta para ${serviceRequest.basicInfo.title}`,
          actionUrl: `/provider/bookings/${serviceRequest._id}`,
          priority: 'high'
        };

      default:
        return baseData;
    }
  }

  async sendEmailNotification(provider, notificationData) {
    try {
      const emailData = {
        to: provider.email,
        subject: notificationData.subject,
        template: notificationData.emailTemplate,
        data: {
          providerName: provider.profile?.firstName,
          serviceRequest: notificationData.serviceRequest,
          actionUrl: `${process.env.FRONTEND_URL}${notificationData.actionUrl}`
        }
      };

      await resendService.sendEmail(emailData);
      notificationData.channels.push('email');

      return { channel: 'email', status: 'sent' };
    } catch (error) {
      console.error('NotificationService - sendEmailNotification error:', error);
      return { channel: 'email', status: 'failed', error: error.message };
    }
  }

  async sendWhatsAppNotification(provider, notificationData) {
    try {
      if (!provider.profile?.phone) {
        return { channel: 'whatsapp', status: 'skipped', reason: 'No phone number' };
      }

      const messageData = {
        to: provider.profile.phone,
        template: notificationData.whatsappTemplate,
        parameters: {
          provider_name: provider.profile.firstName,
          service_type: notificationData.serviceRequest.category,
          location: notificationData.serviceRequest.location
        }
      };

      await whatsappService.sendTemplateMessage(messageData);
      notificationData.channels.push('whatsapp');

      return { channel: 'whatsapp', status: 'sent' };
    } catch (error) {
      console.error('NotificationService - sendWhatsAppNotification error:', error);
      return { channel: 'whatsapp', status: 'failed', error: error.message };
    }
  }

  async createInAppNotification(userId, userType, notificationData) {
    try {
      const notification = new Notification({
        user: userId,
        userType,
        type: notificationData.type,
        title: notificationData.subject,
        message: notificationData.message,
        data: {
          serviceRequestId: notificationData.serviceRequest?.id,
          actionUrl: notificationData.actionUrl
        },
        priority: notificationData.priority,
        read: false
      });

      await notification.save();
      notificationData.channels.push('in_app');

      // Emitir evento Socket.io para notificación en tiempo real
  this.emitRealTimeNotification(userId, notification);

      return { channel: 'in_app', status: 'created' };
    } catch (error) {
      console.error('NotificationService - createInAppNotification error:', error);
      return { channel: 'in_app', status: 'failed', error: error.message };
    }
  }

  async emitRealTimeNotification(userId, notification) {
    const emitterService = (await import('../../websocket/services/emitterService.js')).default;
    emitterService.emitNotification(userId, {
      id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      timestamp: notification.createdAt
    });
  }

  async sendClientNotification({ clientId, type, priority = 'medium', data = {} }) {
    try {
      const client = await User.findById(clientId).lean();
      if (!client) throw new Error('Client not found');

      const notificationData = this.buildClientNotificationData(client, type, data);

      // En este primer paso priorizamos la notificación in-app (campana)
      await this.createInAppNotification(clientId, 'Client', {
        ...notificationData,
        priority
      });

      // Email / WhatsApp opcionales en el futuro (plantillas y preferencias de cliente)
      return { success: true, channels: ['in_app'], message: 'Client notification created' };
    } catch (error) {
      console.error('NotificationService - sendClientNotification error:', error);
      throw error;
    }
  }

  buildClientNotificationData(client, type, extra = {}) {
    const base = {
      type,
      recipient: {
        id: client._id,
        email: client.email,
        name: client.profile?.firstName || 'Cliente'
      },
      channels: [],
      timestamp: new Date()
    };

    switch (type) {
      case 'WELCOME_CLIENT':
        return {
          ...base,
          subject: '¡Bienvenido! 🎉',
          message: `Gracias por registrarte, ${base.recipient.name}. Crea tu primera solicitud cuando quieras.`,
          actionUrl: '/mis-solicitudes/nueva',
          priority: 'medium'
        };
      case 'BOOKING_CONFIRMED':
        return {
          ...base,
          subject: '¡Tu reserva está confirmada!',
          message: extra?.message || 'Hemos confirmado tu reserva con el profesional.',
          actionUrl: '/reservas',
          priority: 'high'
        };
      default:
        return {
          ...base,
          subject: extra?.subject || 'Notificación',
          message: extra?.message || 'Tienes una nueva notificación',
          actionUrl: extra?.actionUrl || '/notificaciones',
          priority: extra?.priority || 'medium'
        };
    }
  }

  async sendAdminNotification({ adminId, type, priority = 'medium', data = {} }) {
    try {
      const admin = await User.findById(adminId).lean();
      if (!admin) throw new Error('Admin not found');

      const notificationData = this.buildAdminNotificationData(admin, type, data);
      await this.createInAppNotification(adminId, 'Admin', {
        ...notificationData,
        priority
      });
      return { success: true, channels: ['in_app'], message: 'Admin notification created' };
    } catch (error) {
      console.error('NotificationService - sendAdminNotification error:', error);
      throw error;
    }
  }

  buildAdminNotificationData(admin, type, extra = {}) {
    const base = {
      type,
      recipient: {
        id: admin._id,
        email: admin.email,
        name: admin.profile?.firstName || 'Admin'
      },
      channels: [],
      timestamp: new Date()
    };

    switch (type) {
      case 'WELCOME_ADMIN':
        return {
          ...base,
          subject: 'Bienvenido al panel de administración',
          message: 'Revisa el estado del sistema y configura planes y moderación.',
          actionUrl: '/admin',
          priority: 'medium'
        };
      default:
        return {
          ...base,
          subject: extra?.subject || 'Notificación administrativa',
          message: extra?.message || 'Tienes una nueva notificación administrativa',
          actionUrl: extra?.actionUrl || '/admin',
          priority: extra?.priority || 'medium'
        };
    }
  }
}

const notificationService = new NotificationService();
export default notificationService;