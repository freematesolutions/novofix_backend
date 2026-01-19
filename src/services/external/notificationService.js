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

      // VERIFY_EMAIL: SIEMPRE enviar email (crítico para activación de cuenta)
      // Para otros tipos: respetar preferencias del usuario
      const isVerificationEmail = type === 'VERIFY_EMAIL';
      const shouldSendEmail = isVerificationEmail || 
        (provider.preferences?.notifications?.email !== false && notificationData.emailTemplate);

      if (shouldSendEmail && notificationData.emailTemplate) {
        console.log(`[NotificationService] Enviando email ${type} a ${provider.email}`);
        notificationPromises.push(
          this.sendEmailNotification(provider, notificationData)
        );
      }

      // Notificación por WhatsApp (solo si hay plantilla definida y número de teléfono)
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
          message: `Gracias por unirte, ${extra.businessName || baseData.recipient.name}. Configura tu perfil de proveedor y empieza a recibir solicitudes.`,
          actionUrl: `/perfil?section=provider-setup`,
          priority: 'medium'
        };

      case 'NEW_REQUEST':
        return {
          ...baseData,
          subject: 'Nueva solicitud de servicio disponible',
          emailTemplate: 'new_request',
          whatsappTemplate: 'new_service_request',
          message: `Tienes una nueva solicitud de ${serviceRequest.basicInfo.category} en ${serviceRequest.location.address}`,
          actionUrl: `/empleos/${serviceRequest._id}`,
          priority: 'high'
        };

      case 'PROPOSAL_ACCEPTED':
        return {
          ...baseData,
          subject: '¡Tu propuesta ha sido aceptada!',
          emailTemplate: 'proposal_accepted',
          whatsappTemplate: 'proposal_accepted',
          message: `El cliente ha aceptado tu propuesta para ${serviceRequest.basicInfo.title}`,
          actionUrl: `/reservas`,
          priority: 'high'
        };

      case 'VERIFY_EMAIL':
        return {
          ...baseData,
          subject: 'Verifica tu correo electrónico',
          message: 'Por favor verifica tu correo electrónico para activar tu cuenta.',
          actionUrl: extra.verifyUrl || '/verificar-email',
          priority: 'medium',
          emailTemplate: 'verify_email'
        };

      default:
        return baseData;
    }
  }

  async sendEmailNotification(provider, notificationData) {
    try {
      let emailData;
      if (notificationData.emailTemplate === 'verify_email') {
        // Solo pasar los datos requeridos para verificación
        emailData = {
          to: provider?.email || '',
          subject: notificationData.subject || 'Verifica tu correo electrónico',
          template: 'verify_email',
          data: {
            name: (provider && provider.profile && provider.profile.firstName) ? provider.profile.firstName : (provider?.email || ''),
            verifyUrl: notificationData.actionUrl || ''
          }
        };
      } else {
        // Solo pasar serviceRequest si existe y es objeto
        let safeServiceRequest = undefined;
        if (notificationData.serviceRequest && typeof notificationData.serviceRequest === 'object') {
          safeServiceRequest = notificationData.serviceRequest;
        }
        emailData = {
          to: provider?.email || '',
          subject: notificationData.subject || '',
          template: notificationData.emailTemplate,
          data: {
            providerName: (provider && provider.profile && provider.profile.firstName) ? provider.profile.firstName : '',
            serviceRequest: safeServiceRequest,
            actionUrl: notificationData.actionUrl ? `${process.env.FRONTEND_URL || ''}${notificationData.actionUrl}` : ''
          }
        };
      }

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

      // Siempre crear notificación in-app (campana)
      await this.createInAppNotification(clientId, 'Client', {
        ...notificationData,
        priority
      });

      // Enviar email de verificación si corresponde
      if (type === 'VERIFY_EMAIL') {
        // Usar plantilla simple para verificación, solo con los datos requeridos
        const verifyUrl = data.verifyUrl || notificationData.actionUrl || '/verificar-email';
        const emailData = {
          to: client.email,
          subject: notificationData.subject || 'Verifica tu correo electrónico',
          template: 'verify_email',
          data: {
            name: client.profile?.firstName || client.email,
            verifyUrl
          }
        };
        console.log(`[NotificationService] Enviando VERIFY_EMAIL a cliente: ${client.email}`);
        console.log(`[NotificationService] verifyUrl: ${verifyUrl}`);
        try {
          const result = await resendService.sendEmail(emailData);
          console.log(`[NotificationService] Email enviado exitosamente:`, result);
        } catch (err) {
          console.error('NotificationService - sendClientNotification VERIFY_EMAIL error:', err);
          console.error('NotificationService - Email data:', JSON.stringify(emailData, null, 2));
        }
      }

      return { success: true, channels: ['in_app', ...(type === 'VERIFY_EMAIL' ? ['email'] : [])], message: 'Client notification created' };
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
          subject: '¡Bienvenido a la plataforma! 🎉',
          message: `Gracias por unirte, ${base.recipient.name}. Configura tu perfil y comienza a explorar servicios.`,
          actionUrl: '/perfil?section=personal',
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
      case 'VERIFY_EMAIL':
        return {
          ...base,
          subject: 'Verifica tu correo electrónico',
          message: 'Por favor verifica tu correo electrónico para activar tu cuenta.',
          actionUrl: extra.verifyUrl || '/verificar-email',
          priority: 'medium',
          emailTemplate: 'verify_email'
        };
      case 'NEW_PROPOSAL':
        return {
          ...base,
          subject: '¡Nueva propuesta recibida! 💼',
          message: extra?.providerName 
            ? `${extra.providerName} te ha enviado una propuesta por $${extra.amount || 0} para tu solicitud.`
            : 'Has recibido una nueva propuesta de un profesional.',
          actionUrl: extra?.requestId ? `/mis-solicitudes/${extra.requestId}/propuestas` : '/mis-solicitudes',
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
          subject: '¡Bienvenido al panel de administración! 🎉',
          message: 'Gracias por unirte al equipo. Revisa el estado del sistema y configura planes y moderación.',
          actionUrl: '/perfil?section=personal',
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