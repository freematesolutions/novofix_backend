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
import cloudinary from '../config/cloudinary.js';
import { scheduleReviewNudge } from '../services/internal/nudgeProcessor.js';

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
        status: 'completed',
        statusHistory: [{
          status: 'completed',
          timestamp: new Date(),
          notes: 'Booking created from accepted proposal — service hired'
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
      const { status, page = 1, limit = 10, viewRole } = req.query;

      let query = {};
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
      
      // Si se especifica viewRole (para usuarios multirol), usarlo
      // Si no, usar lógica por defecto
      const activeRole = viewRole || (userRoles.includes('provider') ? 'provider' : 'client');
      
      // Filtrar según rol activo
      if (activeRole === 'client' && userRoles.includes('client')) {
        query.client = req.user._id;
      } else if (activeRole === 'provider' && userRoles.includes('provider')) {
        query.provider = req.user._id;
      } else if (userRoles.includes('client')) {
        // Fallback: si el viewRole solicitado no coincide con los roles del usuario
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
      const { type, urls, descriptions } = req.body; // type: 'before' or 'after'

      // Validate evidence type (only before and after are allowed)
      if (!['before', 'after'].includes(type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid evidence type. Only "before" and "after" are allowed.'
        });
      }

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
        status: { $in: ['confirmed', 'provider_en_route', 'in_progress'] }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found or not in a completable state'
        });
      }

      // Marcar como completed si aún no lo está
      if (['confirmed', 'provider_en_route', 'in_progress'].includes(booking.status)) {
        booking.status = 'completed';
        booking.statusHistory.push({
          status: 'completed',
          timestamp: new Date(),
          notes: 'Client confirmed service completion'
        });
        await booking.save();
      }

      // Procesar pago (integrar con Stripe)
      await this.processPayment(booking);

      // Notificar al proveedor que el servicio fue confirmado como completado
      try {
        await notificationService.sendProviderNotification({
          providerId: booking.provider,
          type: 'BOOKING_STATUS_UPDATE',
          data: {
            bookingId: booking._id,
            status: 'completed',
            clientName: req.user.profile?.firstName || 'Cliente'
          }
        });
      } catch (err) {
        console.warn('confirmServiceCompletion: failed to notify provider', err?.message);
      }

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
   * Simplificado: confirmed → completed directamente
   */
  isValidStatusTransition(fromStatus, toStatus) {
    const validTransitions = {
      'confirmed': ['completed', 'cancelled'],
      'provider_en_route': ['in_progress', 'completed', 'cancelled'],
      'in_progress': ['completed', 'cancelled'],
      'completed': [], // Estado final
      'cancelled': [] // Estado final
    };

    return validTransitions[fromStatus]?.includes(toStatus) || false;
  }

  /**
   * Guardar factura en el booking y notificar al cliente
   */
  async saveInvoice(req, res) {
    try {
      const { id } = req.params;
      const {
        invoiceNumber, invoiceDate, dueDate,
        items, subtotal, discount, taxRate, tax, shipping, total, currency, notes,
        pdfUrl,
        businessInfo, clientInfo
      } = req.body;

      const booking = await Booking.findOne({
        _id: id,
        provider: req.user._id
      }).populate('client', 'profile')
        .populate('provider', 'providerProfile profile');

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Guardar datos de factura
      booking.invoice = {
        invoiceNumber,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : null,
        items: (items || []).map(it => ({
          description: it.description,
          qty: Number(it.qty) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          total: Number(it.total) || 0
        })),
        subtotal: Number(subtotal) || 0,
        discount: Number(discount) || 0,
        taxRate: Number(taxRate) || 0,
        tax: Number(tax) || 0,
        shipping: Number(shipping) || 0,
        total: Number(total) || 0,
        currency: currency || 'USD',
        notes: notes || '',
        pdfUrl: pdfUrl || '',
        businessInfo: {
          name: businessInfo?.name || '',
          address: businessInfo?.address || '',
          phone: businessInfo?.phone || '',
          email: businessInfo?.email || ''
        },
        clientInfo: {
          name: clientInfo?.name || '',
          address: clientInfo?.address || '',
          city: clientInfo?.city || '',
          state: clientInfo?.state || '',
          zip: clientInfo?.zip || ''
        },
        sentAt: new Date(),
        sentViaChat: true
      };

      // Forzar que Mongoose detecte el cambio en el sub-documento
      booking.markModified('invoice');

      await booking.save();
      console.log(`✅ Invoice saved for booking ${id} — sentAt: ${booking.invoice.sentAt}`);

      // Notificar al cliente
      const providerName = booking.provider?.providerProfile?.businessName
        || `${booking.provider?.profile?.firstName || ''} ${booking.provider?.profile?.lastName || ''}`.trim()
        || 'Profesional';

      try {
        await notificationService.sendClientNotification({
          clientId: booking.client._id || booking.client,
          type: 'INVOICE_RECEIVED',
          priority: 'high',
          data: {
            bookingId: booking._id,
            providerName,
            invoiceNumber,
            amount: total,
            currency: currency || 'USD'
          }
        });
      } catch (notifErr) {
        console.warn('BookingController - saveInvoice: notification failed', notifErr?.message);
      }

      // Emitir actualización de contadores al cliente
      try {
        emitter.emitCountersUpdateToUser(booking.client._id || booking.client, { reason: 'invoice_received' });
      } catch { /* ignore */ }

      res.json({
        success: true,
        message: 'Invoice saved successfully',
        data: { invoice: booking.invoice }
      });
    } catch (error) {
      console.error('BookingController - saveInvoice error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save invoice'
      });
    }
  }

  /**
   * Marcar factura como vista por el cliente y notificar al proveedor.
   * POST /bookings/:id/invoice-viewed
   */
  async markInvoiceViewed(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      const booking = await Booking.findOne({
        _id: id,
        client: userId
      }).populate('client', 'profile')
        .populate('provider', 'providerProfile profile');

      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
      }

      if (!booking.invoice?.sentAt) {
        return res.status(400).json({ success: false, message: 'No invoice sent for this booking' });
      }

      // Si ya fue vista, no re-notificar
      if (booking.invoice.viewedAt) {
        return res.json({
          success: true,
          message: 'Invoice already marked as viewed',
          data: { viewedAt: booking.invoice.viewedAt }
        });
      }

      // Marcar como vista
      booking.invoice.viewedAt = new Date();
      booking.invoice.viewedBy = userId;
      booking.markModified('invoice');
      await booking.save();

      console.log(`👁️ Invoice viewed for booking ${id} by client ${userId}`);

      // Notificar al proveedor
      const clientName = `${booking.client?.profile?.firstName || ''} ${booking.client?.profile?.lastName || ''}`.trim() || 'Cliente';

      try {
        await notificationService.sendProviderNotification({
          providerId: booking.provider._id || booking.provider,
          type: 'INVOICE_VIEWED',
          priority: 'medium',
          data: {
            bookingId: booking._id,
            clientName,
            invoiceNumber: booking.invoice.invoiceNumber || '',
            amount: booking.invoice.total || '',
            currency: booking.invoice.currency || 'USD'
          }
        });
      } catch (notifErr) {
        console.warn('BookingController - markInvoiceViewed: notification failed', notifErr?.message);
      }

      // Emitir actualización de contadores al proveedor
      try {
        emitter.emitCountersUpdateToUser(booking.provider._id || booking.provider, { reason: 'invoice_viewed' });
      } catch { /* ignore */ }

      res.json({
        success: true,
        message: 'Invoice marked as viewed',
        data: { viewedAt: booking.invoice.viewedAt }
      });
    } catch (error) {
      console.error('BookingController - markInvoiceViewed error:', error);
      res.status(500).json({ success: false, message: 'Failed to mark invoice as viewed' });
    }
  }

  /**
   * Proxy para servir el PDF de la factura directamente desde el servidor.
   * Resuelve el problema de Cloudinary 401 en raw resources.
   * GET /bookings/:id/invoice-pdf
   */
  async getInvoicePdf(req, res) {
    try {
      const { id } = req.params;
      const booking = await Booking.findById(id).select('invoice client provider');

      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
      }

      // Verificar ownership
      const userId = req.user._id.toString();
      const isOwner = [booking.client?.toString(), booking.provider?.toString()].includes(userId);
      if (!isOwner) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }

      const pdfUrl = booking.invoice?.pdfUrl;
      if (!pdfUrl) {
        return res.status(404).json({ success: false, message: 'No invoice PDF available' });
      }

      // Generate an API-authenticated Cloudinary download URL
      let fetchUrl = pdfUrl;
      try {
        const parsed = new URL(pdfUrl);
        if (parsed.hostname.includes('cloudinary')) {
          const pathParts = parsed.pathname.split('/').filter(Boolean);
          // pathParts: ['cloud_name', 'raw', 'upload', 'v123456', 'folder/file.pdf']
          const resourceType = pathParts[1] || 'raw';
          let publicIdStart = 3;
          if (pathParts[3] && /^v\d+$/.test(pathParts[3])) {
            publicIdStart = 4;
          }
          const publicId = pathParts.slice(publicIdStart).join('/');

          // private_download_url generates an API endpoint URL with full auth:
          // https://api.cloudinary.com/v1_1/{cloud}/raw/download?api_key=...&signature=...
          fetchUrl = cloudinary.utils.private_download_url(publicId, '', {
            resource_type: resourceType,
            type: 'upload',
            expires_at: Math.floor(Date.now() / 1000) + 3600
          });
          console.log('BookingController - getInvoicePdf: Using private_download_url for', publicId);
        }
      } catch (urlErr) {
        console.warn('BookingController - getInvoicePdf: Could not generate download URL, using original:', urlErr.message);
      }

      // Fetch the PDF using the authenticated URL
      let response = await fetch(fetchUrl);
      // If the private_download_url failed but we have the original URL, try it directly
      if (!response.ok && fetchUrl !== pdfUrl) {
        console.warn(`BookingController - getInvoicePdf: private_download_url returned ${response.status}, retrying with original URL`);
        response = await fetch(pdfUrl);
      }
      if (!response.ok) {
        console.error(`BookingController - getInvoicePdf: Cloudinary returned ${response.status} for ${fetchUrl}`);
        return res.status(502).json({ success: false, message: 'Failed to fetch invoice PDF from storage' });
      }

      const contentType = response.headers.get('content-type') || 'application/pdf';
      const fileName = `Invoice_${booking.invoice?.invoiceNumber || id}.pdf`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      // Stream the response body to the client
      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      console.error('BookingController - getInvoicePdf error:', error);
      res.status(500).json({ success: false, message: 'Failed to proxy invoice PDF' });
    }
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
      // Verificar si hay un PaymentIntent para procesar
      if (!booking.payment?.stripePaymentIntentId) {
        console.log('BookingController - processPayment: No payment intent found, skipping payment processing');
        return { skipped: true, reason: 'No payment intent' };
      }

      // Confirmar/verificar pago en Stripe
      const paymentResult = await stripeService.confirmPayment(booking.payment.stripePaymentIntentId);

      // Si el pago requiere acción del cliente, no marcarlo como completado
      if (paymentResult.requiresAction) {
        console.log('BookingController - processPayment: Payment requires client action');
        return { pending: true, status: paymentResult.status };
      }

      // Si el pago fue exitoso, actualizar estado
      if (paymentResult.status === 'succeeded') {
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
            clientName: booking.client?.profile?.firstName || 'Cliente'
          }
        });
        
        return { success: true };
      }

      return { pending: true, status: paymentResult.status };
    } catch (error) {
      console.error('BookingController - processPayment error:', error);
      // No propagar el error - el pago puede procesarse luego
      // pero la confirmación de finalización debe continuar
      return { error: true, message: error.message };
    }
  }

  /**
   * Habilitar sistema de reviews
   */
  async enableReviewSystem(booking) {
    try {
      // Enviar notificación inmediata al cliente (REVIEW_REQUEST)
      await notificationService.sendClientNotification({
        clientId: booking.client,
        type: 'REVIEW_REQUEST',
        data: {
          bookingId: booking._id,
          providerName: booking.provider.providerProfile.businessName
        }
      });

      // Programar un nudge de seguimiento a las 24 horas si el cliente no deja reseña
      await scheduleReviewNudge({
        bookingId: booking._id,
        clientId: booking.client,
        providerId: booking.provider._id,
        providerName: booking.provider.providerProfile?.businessName || ''
      });
    } catch (error) {
      console.error('BookingController - enableReviewSystem error:', error);
    }
  }

  /**
   * Programar un nudge de reseña 24 horas después de completar el servicio.
   * Si el cliente ya dejó reseña, no se envía.
   * @deprecated Use scheduleReviewNudge from nudgeProcessor instead. Kept for backward compat.
   */
  scheduleReviewNudge(bookingId, clientId, provider) {
    // Now handled by persistent nudgeProcessor — this method is a no-op
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