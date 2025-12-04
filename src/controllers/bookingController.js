// controllers/bookingController.js
import Booking from '../models/Service/Booking.js';
import Proposal from '../models/Service/Proposal.js';
import ServiceRequest from '../models/Service/ServiceRequest.js';
import Chat from '../models/Communication/Chat.js';
import agendaService from '../services/internal/agendaService.js';
import notificationService from '../services/external/notificationService.js';
import chatController from './chatController.js';
import stripeService from '../services/external/payment/stripeService.js';
import { SocketService } from '../websocket/services/socketService.js';
import emitter from '../websocket/services/emitterService.js';

class BookingController {
  /**
   * Crear booking a partir de propuesta aceptada
   */
  async createBookingFromProposal(proposal) {
    try {
      const { serviceRequest, provider, pricing, timing, terms } = proposal;

      // Derivar fecha y hora seguras para el booking
      const derivedDate = timing?.startDate || serviceRequest?.scheduling?.preferredDate || new Date();
      let derivedTime = serviceRequest?.scheduling?.preferredTime;
      const derivedDuration = (typeof timing?.estimatedHours === 'number' && timing.estimatedHours > 0)
        ? timing.estimatedHours
        : 1; // 1 hora por defecto

      if (!derivedTime) {
        try {
          const slots = await agendaService.getProviderAvailableSlots(provider._id, derivedDate);
          if (Array.isArray(slots) && slots.length > 0) {
            derivedTime = slots[0];
          } else {
            derivedTime = '09:00';
          }
        } catch {
          derivedTime = '09:00';
        }
      }

      // Intentar bloquear disponibilidad; si hay conflicto, continuar sin bloquear para no romper la creación
      try {
        await agendaService.blockProviderAvailability(
          provider._id,
          proposal._id, // referencia temporal
          {
            scheduledDate: derivedDate,
            scheduledTime: derivedTime,
            estimatedDuration: derivedDuration
          }
        );
      } catch (e) {
        console.warn('createBookingFromProposal: could not block availability, continuing', e?.message || e);
      }

      const booking = new Booking({
        serviceRequest: serviceRequest._id,
        proposal: proposal._id,
        client: serviceRequest.client,
        provider: provider._id,
        schedule: {
          scheduledDate: derivedDate,
          scheduledTime: derivedTime,
          estimatedDuration: derivedDuration,
          timezone: 'UTC-5' // Por defecto, debería venir del cliente
        },
        status: 'confirmed',
        statusHistory: [{
          status: 'confirmed',
          timestamp: new Date(),
          notes: 'Booking created from accepted proposal'
        }],
        payment: {
          totalAmount: pricing.amount,
          commission: {
            rate: proposal.commission.rate,
            amount: proposal.commission.amount
          },
          providerEarnings: pricing.amount - proposal.commission.amount,
          status: 'pending'
        },
        warranty: terms.warranty
      });

      await booking.save();

      // Crear chat para esta reserva
  const chat = await chatController.createBookingChat(booking);

      // Agregar recordatorios
      await this.scheduleReminders(booking);

      return booking;
    } catch (error) {
      console.error('BookingController - createBookingFromProposal error:', error);
      throw error;
    }
  }

  /**
   * Obtener bookings del usuario
   */
  async getBookings(req, res) {
    try {
      const { status, page = 1, limit = 10 } = req.query;

      let query = {};
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
      
      // Filtrar según rol
      if (userRoles.includes('client')) {
        query.client = req.user._id;
      } else if (userRoles.includes('provider')) {
        query.provider = req.user._id;
      }

      if (status) query.status = status;

      const bookings = await Booking.find(query)
        .populate('serviceRequest', 'basicInfo location')
        .populate('client', 'profile contact')
        .populate('provider', 'providerProfile')
        .populate('proposal', 'pricing timing terms')
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
      console.error('BookingController - getBookings error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get bookings'
      });
    }
  }

  /**
   * Actualizar estado del servicio (proveedor)
   */
  async updateBookingStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, notes, location } = req.body;

      const booking = await Booking.findOne({
        _id: id,
        provider: req.user._id
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Validar transición de estado
      if (!this.isValidStatusTransition(booking.status, status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${booking.status} to ${status}`
        });
      }

      // Actualizar estado
      booking.status = status;
      booking.statusHistory.push({
        status,
        timestamp: new Date(),
        notes,
        location: location ? {
          coordinates: location.coordinates,
          address: location.address
        } : undefined
      });

      // Acciones específicas por estado
      switch (status) {
        case 'provider_en_route':
          // Iniciar compartir ubicación en tiempo real
          await this.startLocationSharing(booking);
          break;
        case 'in_progress':
          // Marcar check-in
          booking.realTimeTracking.checkIn = {
            time: new Date(),
            location: location
          };
          break;
        case 'completed':
          // Marcar check-out y preparar para pago
          booking.realTimeTracking.checkOut = {
            time: new Date(),
            location: location
          };
          await this.initiatePayment(booking);
          break;
      }

      await booking.save();

      // Notificar al cliente del cambio de estado
      await notificationService.sendClientNotification({
        clientId: booking.client,
        type: 'BOOKING_STATUS_UPDATE',
        data: {
          bookingId: booking._id,
          status,
          providerName: req.user.providerProfile.businessName,
          notes
        }
      });

      // Real-time counters update for both client and provider (bookings counts may change)
      try { emitter.emitCountersUpdateToUser(booking.client, { reason: 'booking_status' }); } catch { /* ignore */ }
      try { emitter.emitCountersUpdateToUser(booking.provider, { reason: 'booking_status' }); } catch { /* ignore */ }

      res.json({
        success: true,
        message: `Booking status updated to ${status}`,
        data: { booking }
      });
    } catch (error) {
      console.error('BookingController - updateBookingStatus error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update booking status'
      });
    }
  }

  /**
   * Subir evidencia multimedia del servicio
   */
  async uploadServiceEvidence(req, res) {
    try {
      const { id } = req.params;
      const { type, urls, descriptions } = req.body; // type: 'before', 'during', 'after'

      const booking = await Booking.findOne({
        _id: id,
        provider: req.user._id
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Crear objetos de evidencia
      const evidenceItems = urls.map((url, index) => ({
        url,
        cloudinaryId: req.files?.[index]?.cloudinaryId, // Asumiendo que multer-cloudinary procesó los archivos
        description: descriptions?.[index] || '',
        uploadedAt: new Date()
      }));

      // Agregar a la sección correspondiente
      booking.serviceEvidence[type].push(...evidenceItems);
      await booking.save();

      // Notificar al cliente si es evidencia "after" (trabajo completado)
      if (type === 'after') {
        await notificationService.sendClientNotification({
          clientId: booking.client,
          type: 'SERVICE_EVIDENCE_UPLOADED',
          data: {
            bookingId: booking._id,
            evidenceType: type,
            itemsCount: evidenceItems.length
          }
        });
      }

      res.json({
        success: true,
        message: 'Service evidence uploaded successfully',
        data: {
          evidence: evidenceItems
        }
      });
    } catch (error) {
      console.error('BookingController - uploadServiceEvidence error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload service evidence'
      });
    }
  }

  /**
   * Confirmar finalización del servicio (cliente)
   */
  async confirmServiceCompletion(req, res) {
    try {
      const { id } = req.params;

      const booking = await Booking.findOne({
        _id: id,
        client: req.user._id,
        status: 'completed'
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found or not completed'
        });
      }

      // Procesar pago (integrar con Stripe)
      await this.processPayment(booking);

      // Habilitar sistema de reviews
      await this.enableReviewSystem(booking);

      // Liberar disponibilidad del proveedor
      await agendaService.releaseProviderAvailability(booking.provider, booking._id);

      // Emit counters update for both parties (bookings count and possibly requests/proposals state)
      try {
        const emitter = (await import('../websocket/services/emitterService.js')).default;
        emitter.emitCountersUpdateToUser(booking.client, { reason: 'booking_completed' });
        emitter.emitCountersUpdateToUser(booking.provider, { reason: 'booking_completed' });
      } catch {/* ignore */}

      res.json({
        success: true,
        message: 'Service completion confirmed',
        data: {
          booking,
          paymentStatus: booking.payment.status,
          reviewEnabled: true
        }
      });
    } catch (error) {
      console.error('BookingController - confirmServiceCompletion error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to confirm service completion'
      });
    }
  }

  /**
   * Programar recordatorios
   */
  async scheduleReminders(booking) {
    try {
      const reminders = [];

      // Recordatorio 24 horas antes
      const dayBefore = new Date(booking.schedule.scheduledDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      reminders.push({
        type: 'email',
        scheduledFor: dayBefore,
        sent: false
      });

      // Recordatorio 2 horas antes
      const twoHoursBefore = new Date(booking.schedule.scheduledDate);
      twoHoursBefore.setHours(twoHoursBefore.getHours() - 2);
      reminders.push({
        type: 'sms',
        scheduledFor: twoHoursBefore,
        sent: false
      });

      booking.reminders = reminders;
      await booking.save();

      // Aquí se integraría con un sistema de jobs (node-cron, agenda, bull)
      console.log('Reminders scheduled for booking:', booking._id);
    } catch (error) {
      console.error('BookingController - scheduleReminders error:', error);
    }
  }

  /**
   * Validar transición de estados
   */
  isValidStatusTransition(fromStatus, toStatus) {
    const validTransitions = {
      'confirmed': ['provider_en_route', 'cancelled'],
      'provider_en_route': ['in_progress', 'cancelled'],
      'in_progress': ['completed', 'cancelled'],
      'completed': [], // Estado final
      'cancelled': [] // Estado final
    };

    return validTransitions[fromStatus]?.includes(toStatus) || false;
  }

  /**
   * Iniciar proceso de pago
   */
  async initiatePayment(booking) {
    try {
      // Integración con Stripe - crear Payment Intent
  const paymentIntent = await stripeService.createPaymentIntent({
        amount: booking.payment.totalAmount * 100, // Convertir a centavos
        currency: 'usd',
        metadata: {
          bookingId: booking._id.toString(),
          clientId: booking.client.toString(),
          providerId: booking.provider.toString()
        }
      });

      booking.payment.stripePaymentIntentId = paymentIntent.id;
      await booking.save();

      // Enviar email al cliente con link de pago
      await notificationService.sendClientNotification({
        clientId: booking.client,
        type: 'PAYMENT_REQUIRED',
        data: {
          bookingId: booking._id,
          amount: booking.payment.totalAmount,
          paymentUrl: `${process.env.FRONTEND_URL}/payment/${paymentIntent.id}`
        }
      });
    } catch (error) {
      console.error('BookingController - initiatePayment error:', error);
    }
  }

  /**
   * Procesar pago
   */
  async processPayment(booking) {
    try {
      // Confirmar pago en Stripe
      await stripeService.confirmPayment(booking.payment.stripePaymentIntentId);

      // Actualizar estado de pago
      booking.payment.status = 'completed';
      booking.payment.paidAt = new Date();
      await booking.save();

      // Notificar al proveedor del pago recibido
      await notificationService.sendProviderNotification({
        providerId: booking.provider,
        type: 'PAYMENT_RECEIVED',
        data: {
          bookingId: booking._id,
          amount: booking.payment.providerEarnings,
          clientName: booking.client.profile.firstName
        }
      });
    } catch (error) {
      console.error('BookingController - processPayment error:', error);
      throw error;
    }
  }

  /**
   * Habilitar sistema de reviews
   */
  async enableReviewSystem(booking) {
    try {
      // Esta función prepara el sistema para que el cliente pueda dejar una review
      // La creación real de la review se maneja en el ReviewController
      
      await notificationService.sendClientNotification({
        clientId: booking.client,
        type: 'REVIEW_REQUEST',
        data: {
          bookingId: booking._id,
          providerName: booking.provider.providerProfile.businessName
        }
      });
    } catch (error) {
      console.error('BookingController - enableReviewSystem error:', error);
    }
  }

  /**
   * Iniciar compartir ubicación en tiempo real
   */
  async startLocationSharing(booking) {
    try {
      // Esta función inicializa el sistema de compartir ubicación en tiempo real
      // Se integraría con Socket.io para actualizaciones en vivo
      
  const socketIO = new SocketService();
      await socketIO.initialize();
      await socketIO.emitToUser(booking.provider, 'START_LOCATION_SHARING', { bookingId: booking._id });
    } catch (error) {
      console.error('BookingController - startLocationSharing error:', error);
    }
  }
}

export default new BookingController();