// controllers/proposalController.js
import Proposal from '../models/Service/Proposal.js';
import ServiceRequest from '../models/Service/ServiceRequest.js';
import Provider from '../models/User/Provider.js';
import notificationService from '../services/external/notificationService.js';
import scoringService from '../services/internal/scoringService.js';
import bookingController from './bookingController.js';
import emitter from '../websocket/services/emitterService.js';

class ProposalController {
  constructor() {
    // Bind all methods to preserve 'this' context when used as route handlers
    this.getProposalContext = this.getProposalContext.bind(this);
    this.createDraft = this.createDraft.bind(this);
    this.updateDraft = this.updateDraft.bind(this);
    this.sendProposal = this.sendProposal.bind(this);
    this.sendDraft = this.sendDraft.bind(this);
    this.getProviderProposals = this.getProviderProposals.bind(this);
    this.getRequestProposals = this.getRequestProposals.bind(this);
    this.acceptProposal = this.acceptProposal.bind(this);
    this.rejectProposal = this.rejectProposal.bind(this);
    this.cancelProposal = this.cancelProposal.bind(this);
    this.calculateResponseRate = this.calculateResponseRate.bind(this);
  }

  /**
   * Helper: derive commission rate (decimal) from provider billing or plan
   */
  deriveCommissionRate(provider) {
    const raw = provider?.billing?.commissionRate;
    if (typeof raw === 'number' && raw > 0) {
      // Stored as percentage (e.g. 15, 12, 8)
      return raw / 100;
    }
    const plan = provider?.subscription?.plan;
    if (plan === 'pro') return 0.08;
    if (plan === 'basic') return 0.12;
    return 0.15; // free default
  }

  /**
   * GET /provider/proposals/context
   * Returns current plan, lead usage and commission info for UI preview.
   */
  async getProposalContext(req, res) {
    try {
      // Verificar que el usuario sea proveedor (rol único o en roles múltiples)
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
      const isProvider = userRoles.includes('provider');
      
      if (!isProvider) {
        return res.status(403).json({ 
          success: false, 
          message: 'Only providers can access proposal context',
          currentRole: req.user?.role,
          availableRoles: userRoles
        });
      }

      // Fresh provider document to ensure latest counters
      const provider = await Provider.findById(req.user._id);
      if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

      const plan = provider.subscription?.plan || 'free';
      const commissionRateDecimal = this.deriveCommissionRate(provider);
      const commissionRatePercent = Math.round(commissionRateDecimal * 100);

      // Lead limit logic (mirrors rbacMiddleware but non-blocking)
      const limits = {
        free: { leadLimit: 1 },
        basic: { leadLimit: 5 },
        pro: { leadLimit: -1 }
      };
      const leadLimit = (limits[plan] || limits.free).leadLimit;
      const startOfMonth = new Date();
      startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
      const proposalsThisMonth = await Proposal.countDocuments({
        provider: provider._id,
        createdAt: { $gte: startOfMonth },
        status: { $in: ['sent','viewed','accepted'] }
      });
      const unlimited = leadLimit < 0;
      const remaining = unlimited ? -1 : Math.max(leadLimit - proposalsThisMonth, 0);

      res.json({
        success: true,
        data: {
          plan,
          subscriptionStatus: provider.subscription?.status,
          commissionRatePercent,
          commissionRateDecimal,
          leadLimit,
          leadsUsed: proposalsThisMonth,
          remaining,
          unlimited,
          upgradeRequired: !unlimited && remaining <= 0,
          currentPeriodStart: provider.subscription?.currentPeriodStart,
          currentPeriodEnd: provider.subscription?.currentPeriodEnd
        }
      });
    } catch (error) {
      console.error('ProposalController - getProposalContext error:', error);
      res.status(500).json({ success: false, message: 'Failed to get proposal context' });
    }
  }
  /**
   * Crear propuesta en borrador
   */
  async createDraft(req, res) {
    try {
      const { serviceRequestId } = req.params;
      const { message } = req.body || {};

      const serviceRequest = await ServiceRequest.findOne({ _id: serviceRequestId, status: { $in: ['published'] } });
      if (!serviceRequest) {
        return res.status(404).json({ success: false, message: 'Service request not found or not available' });
      }

      // Evitar duplicar propuestas del mismo proveedor
      const existing = await Proposal.findOne({ serviceRequest: serviceRequestId, provider: req.user._id });
      if (existing) return res.status(400).json({ success: false, message: 'Proposal already exists for this service request' });

      const proposal = await Proposal.create({
        serviceRequest: serviceRequestId,
        provider: req.user._id,
        message: message || '',
        status: 'draft'
      });
      return res.status(201).json({ success: true, message: 'Draft created', data: { proposal } });
    } catch (error) {
      console.error('ProposalController - createDraft error:', error);
      res.status(500).json({ success: false, message: 'Failed to create draft' });
    }
  }

  /**
   * Actualizar propuesta en borrador (o enviada si permitimos edición menor)
   */
  async updateDraft(req, res) {
    try {
      const { proposalId } = req.params;
      const {
        amount,
        breakdown,
        estimatedHours,
        startDate,
        completionDate,
        availability,
        warranty,
        materialsIncluded,
        cleanupIncluded,
        additionalTerms,
        message
      } = req.body || {};

      const proposal = await Proposal.findOne({ _id: proposalId, provider: req.user._id });
      if (!proposal) return res.status(404).json({ success: false, message: 'Proposal not found' });
      if (!['draft', 'sent', 'viewed'].includes(proposal.status)) {
        return res.status(400).json({ success: false, message: 'Cannot update proposal in current status' });
      }

      if (amount !== undefined) {
        proposal.pricing = proposal.pricing || {};
        proposal.pricing.amount = Number(amount);
        proposal.pricing.currency = proposal.pricing.currency || 'USD';
        if (breakdown) proposal.pricing.breakdown = breakdown;
      }
      if (estimatedHours !== undefined || startDate !== undefined || completionDate !== undefined || availability !== undefined) {
        proposal.timing = proposal.timing || {};
        if (estimatedHours !== undefined) proposal.timing.estimatedHours = Number(estimatedHours);
        if (startDate !== undefined) proposal.timing.startDate = startDate ? new Date(startDate) : null;
        if (completionDate !== undefined) proposal.timing.completionDate = completionDate ? new Date(completionDate) : null;
        if (availability !== undefined) proposal.timing.availability = availability || [];
      }
      if (warranty !== undefined || materialsIncluded !== undefined || cleanupIncluded !== undefined || additionalTerms !== undefined) {
        proposal.terms = proposal.terms || {};
        if (warranty !== undefined) proposal.terms.warranty = warranty;
        if (materialsIncluded !== undefined) proposal.terms.materialsIncluded = !!materialsIncluded;
        if (cleanupIncluded !== undefined) proposal.terms.cleanupIncluded = !!cleanupIncluded;
        if (additionalTerms !== undefined) proposal.terms.additionalTerms = additionalTerms || '';
      }
      if (message !== undefined) proposal.message = String(message).trim();

      await proposal.save();
      res.json({ success: true, message: 'Proposal updated', data: { proposal } });
    } catch (error) {
      console.error('ProposalController - updateDraft error:', error);
      res.status(500).json({ success: false, message: 'Failed to update proposal' });
    }
  }

  /**
   * Enviar propuesta en borrador (aplica validaciones de plan y límite)
   */
  async sendDraft(req, res) {
    try {
      const { proposalId } = req.params;

      const proposal = await Proposal.findOne({ _id: proposalId, provider: req.user._id }).populate('serviceRequest');
      if (!proposal) return res.status(404).json({ success: false, message: 'Proposal not found' });
      if (proposal.status !== 'draft') return res.status(400).json({ success: false, message: 'Only drafts can be sent' });
      // Suscripción y límite ya verificados por middlewares requireActiveSubscription & checkLeadLimit (en rutas)

      // Completar campos mínimos y calcular comisión (normalizar rate)
      const amount = Number(proposal?.pricing?.amount || 0);
      if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Amount is required to send proposal' });
      const commissionRate = this.deriveCommissionRate(req.user);
      proposal.commission = { rate: commissionRate, amount: Math.round(amount * commissionRate * 100) / 100 };
      proposal.status = 'sent';
      proposal.expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await proposal.save();

      // Vincular a la request si aún no estaba
      await ServiceRequest.findByIdAndUpdate(proposal.serviceRequest, { $addToSet: { proposals: proposal._id }, $inc: { 'metadata.proposalCount': 1 } });

      // Notificar al cliente
      await notificationService.sendClientNotification({
        clientId: proposal.serviceRequest.client,
        type: 'NEW_PROPOSAL',
        data: {
          requestId: proposal.serviceRequest._id,
          proposalId: proposal._id,
          providerName: req.user.providerProfile?.businessName,
          amount: amount
        }
      });

      // Real-time counters updates for provider and client
      try { emitter.emitCountersUpdateToUser(req.user._id, { reason: 'proposal_sent' }); } catch { /* ignore */ }
      try { emitter.emitCountersUpdateToUser(proposal.serviceRequest.client, { reason: 'proposal_received' }); } catch { /* ignore */ }

      // WebSocket: notificar al cliente sobre nueva propuesta
      try {
        emitter.emitToUser(proposal.serviceRequest.client.toString(), 'NEW_PROPOSAL_RECEIVED', {
          requestId: proposal.serviceRequest._id,
          requestTitle: proposal.serviceRequest.basicInfo?.title || 'Solicitud',
          proposalId: proposal._id,
          providerName: req.user.providerProfile?.businessName || 'Proveedor',
          amount: amount
        });
      } catch (err) {
        console.error('Error emitting NEW_PROPOSAL_RECEIVED:', err);
      }

      res.json({ success: true, message: 'Proposal sent', data: { proposal } });
    } catch (error) {
      console.error('ProposalController - sendDraft error:', error);
      res.status(500).json({ success: false, message: 'Failed to send draft' });
    }
  }

  /** Cancelar propuesta por el proveedor si no ha sido aceptada */
  async cancelProposal(req, res) {
    try {
      const { proposalId } = req.params;
      const proposal = await Proposal.findOne({ _id: proposalId, provider: req.user._id });
      if (!proposal) return res.status(404).json({ success: false, message: 'Proposal not found' });
      if (!['draft','sent','viewed'].includes(proposal.status)) return res.status(400).json({ success: false, message: 'Cannot cancel proposal in current status' });
      proposal.status = 'cancelled';
      await proposal.save();
      // Emit counters update to provider and client (proposal removed from active)
      try {
        const sr = await ServiceRequest.findById(proposal.serviceRequest).select('client');
        const emitter = (await import('../websocket/services/emitterService.js')).default;
        emitter.emitCountersUpdateToUser(req.user._id, { reason: 'proposal_cancelled' });
        if (sr?.client) emitter.emitCountersUpdateToUser(sr.client, { reason: 'proposal_cancelled' });
      } catch {/* ignore */}
      res.json({ success: true, message: 'Proposal cancelled', data: { proposal } });
    } catch (error) {
      console.error('ProposalController - cancelProposal error:', error);
      res.status(500).json({ success: false, message: 'Failed to cancel proposal' });
    }
  }

  /** Rechazar propuesta por el cliente */
  async rejectProposal(req, res) {
    try {
      const { proposalId } = req.params;
      const proposal = await Proposal.findById(proposalId).populate('serviceRequest');
      if (!proposal) return res.status(404).json({ success: false, message: 'Proposal not found' });
      if (String(proposal.serviceRequest.client) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
      if (!['sent','viewed'].includes(proposal.status)) return res.status(400).json({ success: false, message: 'Cannot reject proposal in current status' });
      proposal.status = 'rejected';
      await proposal.save();
      res.json({ success: true, message: 'Proposal rejected', data: { proposal } });
    } catch (error) {
      console.error('ProposalController - rejectProposal error:', error);
      res.status(500).json({ success: false, message: 'Failed to reject proposal' });
    }
  }
  /**
   * Enviar propuesta a solicitud de servicio
   */
  async sendProposal(req, res) {
    try {
      const { serviceRequestId } = req.params;
      const {
        amount,
        breakdown,
        estimatedHours,
        startDate,
        completionDate,
        availability,
        warranty,
        materialsIncluded,
        cleanupIncluded,
        additionalTerms,
        message
      } = req.body;

      // Suscripción activa y lead limit ya verificados por middlewares en la ruta

      // Verificar solicitud de servicio
      const serviceRequest = await ServiceRequest.findOne({
        _id: serviceRequestId,
        status: 'published'
      });

      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message: 'Service request not found or not available'
        });
      }

      // Verificar que el proveedor sea elegible
      const isEligible = serviceRequest.eligibleProviders.some(
        ep => ep.provider.toString() === req.user._id.toString()
      );

      if (!isEligible && serviceRequest.visibility === 'auto') {
        return res.status(403).json({
          success: false,
          message: 'Provider not eligible for this service request'
        });
      }

      // Verificar que no haya enviado ya una propuesta
      const existingProposal = await Proposal.findOne({
        serviceRequest: serviceRequestId,
        provider: req.user._id
      });

      if (existingProposal) {
        return res.status(400).json({
          success: false,
          message: 'Proposal already sent for this service request'
        });
      }

      // Obtener documento completo del proveedor para calcular comisión
      const provider = await Provider.findById(req.user._id);
      if (!provider) {
        return res.status(404).json({
          success: false,
          message: 'Provider not found'
        });
      }

      // Calcular comisión según plan del proveedor
      const commissionRate = this.deriveCommissionRate(provider);

      const proposal = new Proposal({
        serviceRequest: serviceRequestId,
        provider: req.user._id,
        pricing: {
          amount,
          currency: 'USD',
          breakdown: breakdown || {
            labor: amount * 0.7,
            materials: amount * 0.2,
            transportation: amount * 0.1,
            taxes: 0
          },
          paymentTerms: 'upon_completion'
        },
        timing: {
          estimatedHours,
          startDate: startDate ? new Date(startDate) : null,
          completionDate: completionDate ? new Date(completionDate) : null,
          availability: availability || []
        },
        terms: {
          warranty: warranty || { provided: false, duration: 0 },
          materialsIncluded: materialsIncluded || false,
          cleanupIncluded: cleanupIncluded || false,
          additionalTerms: additionalTerms || ''
        },
        message,
        commission: {
          rate: commissionRate,
          amount: Math.round(amount * commissionRate * 100) / 100
        },
        status: 'sent',
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 días
      });

      await proposal.save();

      // Actualizar service request con la nueva propuesta
      await ServiceRequest.findByIdAndUpdate(serviceRequestId, {
        $addToSet: { proposals: proposal._id },
        $inc: { 'metadata.proposalCount': 1 }
      });

      // Notificar al cliente
      await notificationService.sendClientNotification({
        clientId: serviceRequest.client,
        type: 'NEW_PROPOSAL',
        data: {
          requestId: serviceRequestId,
          requestTitle: serviceRequest.basicInfo.title,
          proposalId: proposal._id,
          providerName: req.user.providerProfile.businessName,
          amount: amount
        }
      });

      // Actualizar estadísticas del proveedor
      await this.updateProviderStats(req.user._id);

      // Real-time counters updates for provider and client
      try { emitter.emitCountersUpdateToUser(req.user._id, { reason: 'proposal_sent' }); } catch { /* ignore */ }
      try { emitter.emitCountersUpdateToUser(serviceRequest.client, { reason: 'proposal_received' }); } catch { /* ignore */ }

      // WebSocket: notificar al cliente sobre nueva propuesta
      try {
        emitter.emitToUser(serviceRequest.client.toString(), 'NEW_PROPOSAL_RECEIVED', {
          requestId: serviceRequestId,
          requestTitle: serviceRequest.basicInfo.title,
          proposalId: proposal._id,
          providerName: req.user.providerProfile?.businessName || 'Proveedor',
          amount: amount
        });
      } catch (err) {
        console.error('Error emitting NEW_PROPOSAL_RECEIVED:', err);
      }

      res.status(201).json({
        success: true,
        message: 'Proposal sent successfully',
        data: {
          proposal
        }
      });
    } catch (error) {
      console.error('ProposalController - sendProposal error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send proposal',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Obtener propuestas de un proveedor
   */
  async getProviderProposals(req, res) {
    try {
      const { status, page = 1, limit = 10 } = req.query;

      let query = { provider: req.user._id };
      if (status) query.status = status;

      const proposals = await Proposal.find(query)
        .populate('serviceRequest', 'basicInfo location scheduling status')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await Proposal.countDocuments(query);

      res.json({
        success: true,
        data: {
          proposals,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error('ProposalController - getProviderProposals error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get proposals'
      });
    }
  }

  /**
   * Obtener propuestas de una solicitud (para cliente)
   */
  async getRequestProposals(req, res) {
    try {
      const { requestId } = req.params;

      // Verificar que el cliente sea el dueño de la solicitud
      const serviceRequest = await ServiceRequest.findOne({
        _id: requestId,
        client: req.user._id
      });

      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message: 'Service request not found'
        });
      }

      // Solo mostrar propuestas enviadas o vistas (no borradores ni canceladas)
      const proposals = await Proposal.find({ 
        serviceRequest: requestId,
        status: { $in: ['sent', 'viewed', 'accepted', 'rejected'] }
      })
        .populate('provider', 'providerProfile subscription score')
        .sort({ 'pricing.amount': 1, createdAt: 1 });

      // Marcar propuestas como vistas
      await Proposal.updateMany(
        { serviceRequest: requestId, status: 'sent' },
        { $set: { status: 'viewed' } }
      );

      res.json({
        success: true,
        data: {
          proposals,
          request: {
            title: serviceRequest.basicInfo.title,
            budget: serviceRequest.budget,
            status: serviceRequest.status
          }
        }
      });
    } catch (error) {
      console.error('ProposalController - getRequestProposals error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get proposals'
      });
    }
  }

  /**
   * Aceptar propuesta (cliente)
   */
  async acceptProposal(req, res) {
    try {
      const { proposalId } = req.params;

      const proposal = await Proposal.findOne({
        _id: proposalId,
        status: { $in: ['sent', 'viewed'] }
      }).populate('serviceRequest provider');

      if (!proposal) {
        return res.status(404).json({
          success: false,
          message: 'Proposal not found or not available'
        });
      }

      // Verificar que el cliente sea el dueño de la solicitud
      if (proposal.serviceRequest.client.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to accept this proposal'
        });
      }

      // Verificar que la solicitud esté activa
      if (proposal.serviceRequest.status !== 'published') {
        return res.status(400).json({
          success: false,
          message: 'Service request is no longer available'
        });
      }

      // Actualizar estado de la propuesta
      proposal.status = 'accepted';
      await proposal.save();

      // Actualizar solicitud de servicio
      proposal.serviceRequest.status = 'active';
      proposal.serviceRequest.acceptedProposal = proposalId;
      await proposal.serviceRequest.save();

      // Crear booking (será implementado en BookingController)
  const booking = await bookingController.createBookingFromProposal(proposal);

      // Notificar al proveedor
      await notificationService.sendProviderNotification({
        providerId: proposal.provider._id,
        serviceRequestId: proposal.serviceRequest._id,
        type: 'PROPOSAL_ACCEPTED',
        data: {
          proposalId: proposal._id,
          requestTitle: proposal.serviceRequest.basicInfo.title,
          clientName: req.user.profile.firstName
        }
      });

      // Rechazar automáticamente otras propuestas
      await Proposal.updateMany(
        {
          serviceRequest: proposal.serviceRequest._id,
          _id: { $ne: proposalId },
          status: { $in: ['sent', 'viewed'] }
        },
        { $set: { status: 'rejected' } }
      );

      // Real-time counters updates for both parties (bookings and requests/proposals change)
      try { emitter.emitCountersUpdateToUser(req.user._id, { reason: 'proposal_accepted' }); } catch { /* ignore */ }
      try { emitter.emitCountersUpdateToUser(proposal.provider._id, { reason: 'proposal_accepted' }); } catch { /* ignore */ }
      try { emitter.emitCountersUpdateToUser(proposal.serviceRequest.client, { reason: 'proposal_accepted' }); } catch { /* ignore */ }

      res.json({
        success: true,
        message: 'Proposal accepted successfully',
        data: {
          proposal,
          booking
        }
      });
    } catch (error) {
      console.error('ProposalController - acceptProposal error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to accept proposal'
      });
    }
  }

  /**
   * Actualizar estadísticas del proveedor
   */
  async updateProviderStats(providerId) {
    try {
      const proposalCount = await Proposal.countDocuments({ provider: providerId });
      const acceptedProposals = await Proposal.countDocuments({
        provider: providerId,
        status: 'accepted'
      });

      const responseRate = await this.calculateResponseRate(providerId);

      await Provider.findByIdAndUpdate(providerId, {
        $set: {
          'providerProfile.stats.responseRate': responseRate,
          'providerProfile.stats.acceptanceRate': proposalCount > 0 ? 
            (acceptedProposals / proposalCount) * 100 : 0
        }
      });

      // Recalcular score del proveedor
      await scoringService.calculateProviderScore(providerId);
    } catch (error) {
      console.error('ProposalController - updateProviderStats error:', error);
    }
  }

  /**
   * Calcular tasa de respuesta del proveedor
   */
  async calculateResponseRate(providerId) {
    const totalRequests = await ServiceRequest.countDocuments({
      'eligibleProviders.provider': providerId,
      'eligibleProviders.notified': true
    });

    const respondedRequests = await Proposal.countDocuments({
      provider: providerId,
      status: { $in: ['sent', 'viewed', 'accepted'] }
    });

    return totalRequests > 0 ? (respondedRequests / totalRequests) * 100 : 0;
  }
}

export default new ProposalController();