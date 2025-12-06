// controllers/requestController.js
import ServiceRequest from '../models/Service/ServiceRequest.js';
import matchingService from '../services/internal/matchingService.js';
import notificationService from '../services/external/notificationService.js';
import * as agendaService from '../services/internal/agendaService.js';
import emitter from '../websocket/services/emitterService.js';

class RequestController {
  /**
   * Crear nueva solicitud de servicio
   */
  async createServiceRequest(req, res) {
    try {
      const {
        title,
        description,
        category,
        subcategory,
        urgency,
        address,
        coordinates,
        preferredDate,
        preferredTime,
        budget,
        photos,
        videos,
        visibility, // 'auto' o 'directed'
        saveAsDraft, // boolean opcional
        targetProviders // array opcional de IDs de proveedores específicos
      } = req.body;

      // Determinar cliente (usuario registrado o guest)
      let clientId = null;
      let guestSessionId = null;

      // Considerar a cualquier usuario autenticado como emisor de la solicitud
      // (RBAC ya restringe a client/provider para esta ruta)
      if (req.user && req.user._id) {
        clientId = req.user._id;
      } else if (req.session) {
        // Fallback para sesiones guest si en un futuro se permite crear como guest
        guestSessionId = req.session.sessionId;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Session or authentication required'
        });
      }

      // Calcular fecha de expiración
      const expiryDate = new Date();
      if (urgency === 'immediate') {
        expiryDate.setHours(expiryDate.getHours() + 24); // 24 horas para urgencia inmediata
      } else {
        expiryDate.setDate(expiryDate.getDate() + 7); // 7 días para programado
      }

  let initialStatus = saveAsDraft ? 'draft' : 'published';

      // Build GeoJSON point when possible
      const point = (coordinates && Number.isFinite(coordinates.lng) && Number.isFinite(coordinates.lat))
        ? { type: 'Point', coordinates: [Number(coordinates.lng), Number(coordinates.lat)] }
        : undefined;

      const serviceRequest = new ServiceRequest({
        client: clientId,
        guestSessionId,
        basicInfo: {
          title,
          description,
          category,
          subcategory,
          urgency
        },
        location: {
          address,
          coordinates: {
            lat: Number(coordinates?.lat),
            lng: Number(coordinates?.lng)
          },
          location: point
        },
        scheduling: {
          preferredDate: preferredDate ? new Date(preferredDate) : null,
          preferredTime,
          flexibility: req.body.flexibility || 'flexible'
        },
        budget: budget && typeof budget === 'object' 
          ? { amount: Number(budget.amount) || 0, currency: budget.currency || 'USD' }
          : { amount: 0, currency: 'USD' },
        media: {
          photos: photos || [],
          videos: videos || []
        },
        visibility: visibility || 'auto',
        status: initialStatus,
        expiryDate
      });

      await serviceRequest.save();

      // Publicación y notificación: si no hay elegibles por geo, mantener publicada si hay proveedores de la categoría
      if (initialStatus === 'published' && serviceRequest.visibility === 'auto') {
        try {
          const eligible = await matchingService.findEligibleProviders(serviceRequest._id);
          if (!eligible || (eligible.totalCount || 0) === 0) {
            // Fallback: ¿existen proveedores activos de la categoría aunque estén fuera de radio?
            const Provider = (await import('../models/User/Provider.js')).default;
            const fallbackCount = await Provider.countDocuments({
              'providerProfile.services.category': category,
              'subscription.status': 'active',
              isActive: true
            });
            if (fallbackCount > 0) {
              // Mantener publicada para que aparezca en Empleos por categoría; no notificar por ahora
              // (el proveedor podrá verla y enviar propuesta si su plan lo permite)
            } else {
              // Realmente no hay proveedores de esta categoría en la plataforma -> degradar a borrador
              serviceRequest.status = 'draft';
              initialStatus = 'draft';
              await serviceRequest.save();
            }
          }
        } catch (e) {
          // Si matching falla, mantener publicada si hay proveedores de la categoría
          try {
            const Provider = (await import('../models/User/Provider.js')).default;
            const fallbackCount = await Provider.countDocuments({
              'providerProfile.services.category': category,
              'subscription.status': 'active',
              isActive: true
            });
            if (fallbackCount === 0) {
              serviceRequest.status = 'draft';
              initialStatus = 'draft';
              await serviceRequest.save();
            }
          } catch {
            serviceRequest.status = 'draft';
            initialStatus = 'draft';
            await serviceRequest.save();
          }
        }
      }

      // Vincular a sesión guest si aplica
      if (guestSessionId && req.guest) {
        const guestController = require('./guestController');
        await guestController.linkServiceRequestToGuest({
          body: { serviceRequestId: serviceRequest._id },
          session: req.session
        }, { json: () => {} });
      }

      // Buscar proveedores elegibles y notificar según visibilidad
      let notificationResult;
      if (serviceRequest.status === 'published' && serviceRequest.visibility === 'auto') {
        // Si se especificaron proveedores específicos, notificar solo a ellos
        if (targetProviders && Array.isArray(targetProviders) && targetProviders.length > 0) {
          notificationResult = await matchingService.notifyProviders(
            serviceRequest._id,
            'directed',
            targetProviders
          );
        } else {
          // Notificar a todos los proveedores elegibles
          notificationResult = await matchingService.notifyProviders(
            serviceRequest._id,
            'auto'
          );
        }
      }

      // Emit real-time counters update to client (new open request)
      try { emitter.emitCountersUpdateToUser(clientId, { reason: 'request_created' }); } catch { /* ignore */ }
      // Emit to notified providers (if any)
      try {
        const providers = (notificationResult?.results || []).map(r => r?.provider).filter(Boolean);
        if (providers.length) emitter.emitCountersUpdateToUsers(providers, { reason: 'providers_notified' });
      } catch { /* ignore */ }

      res.status(201).json({
        success: true,
        message: initialStatus === 'draft'
          ? 'Service request saved as draft (no providers available yet)'
          : 'Service request created successfully',
        data: {
          request: serviceRequest,
          notifications: notificationResult
        }
      });
    } catch (error) {
      console.error('RequestController - createServiceRequest error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create service request',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Actualizar solicitud en estado editable (draft o published antes de recibir propuestas)
   */
  async updateServiceRequest(req, res) {
    try {
      const { id } = req.params;
      const allowedStatuses = ['draft', 'published'];
      const {
        title,
        description,
        category,
        subcategory,
        urgency,
        address,
        coordinates,
        preferredDate,
        preferredTime,
        budget,
        photos,
        videos,
        flexibility
      } = req.body;

      const sr = await ServiceRequest.findOne({ _id: id, client: req.user._id });
      if (!sr) {
        return res.status(404).json({ success: false, message: 'Service request not found' });
      }
      if (!allowedStatuses.includes(sr.status)) {
        return res.status(400).json({ success: false, message: 'Cannot update request in current status' });
      }
      // Si ya tiene propuestas y está published, restringir cambios críticos
      const hasProposals = Array.isArray(sr.proposals) && sr.proposals.length > 0;
      if (hasProposals && sr.status === 'published') {
        // Permitir solo descripción menor y medios adicionales
        if (title && title !== sr.basicInfo.title) {
          return res.status(400).json({ success: false, message: 'Title cannot be changed after proposals are received' });
        }
        if (category && category !== sr.basicInfo.category) {
          return res.status(400).json({ success: false, message: 'Category cannot be changed after proposals are received' });
        }
      }

      if (title) sr.basicInfo.title = String(title).trim();
      if (description) sr.basicInfo.description = String(description).trim();
      if (category) sr.basicInfo.category = category;
      if (subcategory !== undefined) sr.basicInfo.subcategory = subcategory;
      if (urgency) sr.basicInfo.urgency = urgency;
      if (address) sr.location.address = address;
      if (coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)) {
        sr.location.coordinates = { lat: Number(coordinates.lat), lng: Number(coordinates.lng) };
        sr.location.location = { type: 'Point', coordinates: [Number(coordinates.lng), Number(coordinates.lat)] };
      }
      if (preferredDate !== undefined) sr.scheduling.preferredDate = preferredDate ? new Date(preferredDate) : null;
      if (preferredTime !== undefined) sr.scheduling.preferredTime = preferredTime || null;
      if (flexibility) sr.scheduling.flexibility = flexibility;
      if (budget && typeof budget === 'object') {
        sr.budget.amount = Number(budget.amount) || sr.budget.amount || 0;
        if (budget.currency) sr.budget.currency = budget.currency;
      }
      if (Array.isArray(photos)) sr.media.photos = photos;
      if (Array.isArray(videos)) sr.media.videos = videos;

      await sr.save();
      res.json({ success: true, message: 'Service request updated', data: { request: sr } });
    } catch (error) {
      console.error('RequestController - updateServiceRequest error:', error);
      res.status(500).json({ success: false, message: 'Failed to update service request' });
    }
  }

  /**
   * Publicar solicitud en draft
   */
  async publishServiceRequest(req, res) {
    try {
      const { id } = req.params;
      const sr = await ServiceRequest.findOne({ _id: id, client: req.user._id, status: 'draft' });
      if (!sr) {
        return res.status(404).json({ success: false, message: 'Draft service request not found' });
      }
      // Verificar proveedores elegibles antes de publicar
      try {
        const eligible = await matchingService.findEligibleProviders(sr._id, { forceRefresh: true });
        if (!eligible || eligible.totalCount === 0) {
          return res.status(409).json({
            success: false,
            message: 'Cannot publish: no providers available for this category yet'
          });
        }
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Provider eligibility check failed' });
      }
      sr.status = 'published';
      // Calcular expiración si no existe
      if (!sr.expiryDate) {
        const expiryDate = new Date();
        if (sr.basicInfo.urgency === 'immediate') expiryDate.setHours(expiryDate.getHours() + 24);
        else expiryDate.setDate(expiryDate.getDate() + 7);
        sr.expiryDate = expiryDate;
      }
      await sr.save();
      // Notificar proveedores si visibilidad auto
      let notificationResult;
      if (sr.visibility === 'auto') {
        notificationResult = await matchingService.notifyProviders(sr._id, 'auto');
      }
      // Emit counters update for client and providers
      try { emitter.emitCountersUpdateToUser(req.user._id, { reason: 'request_published' }); } catch {/* ignore */}
      try {
        const providers = (notificationResult?.results || []).map(r => r?.provider).filter(Boolean);
        if (providers.length) emitter.emitCountersUpdateToUsers(providers, { reason: 'providers_notified' });
      } catch {/* ignore */}
      res.json({ success: true, message: 'Service request published', data: { request: sr, notifications: notificationResult } });
    } catch (error) {
      console.error('RequestController - publishServiceRequest error:', error);
      res.status(500).json({ success: false, message: 'Failed to publish service request' });
    }
  }

  /**
   * Archivar solicitud (sin borrar) sólo si no está active/completed
   */
  async archiveServiceRequest(req, res) {
    try {
      const { id } = req.params;
      const sr = await ServiceRequest.findOne({ _id: id, client: req.user._id });
      if (!sr) return res.status(404).json({ success: false, message: 'Service request not found' });
      if (['active', 'completed'].includes(sr.status)) {
        return res.status(400).json({ success: false, message: 'Cannot archive active or completed request' });
      }
      sr.status = 'archived';
      sr.metadata.archivedAt = new Date();
      await sr.save();
      // Emit counters update to client and any previously notified/selected providers
      try { emitter.emitCountersUpdateToUser(req.user._id, { reason: 'request_archived' }); } catch {/* ignore */}
      try {
        const providers = [
          ...(Array.isArray(sr.selectedProviders) ? sr.selectedProviders : []),
          ...((sr.eligibleProviders || []).map(ep => ep.provider))
        ].filter(Boolean);
        if (providers.length) emitter.emitCountersUpdateToUsers(providers, { reason: 'request_archived' });
      } catch {/* ignore */}
      res.json({ success: true, message: 'Service request archived', data: { request: sr } });
    } catch (error) {
      console.error('RequestController - archiveServiceRequest error:', error);
      res.status(500).json({ success: false, message: 'Failed to archive service request' });
    }
  }

  /**
   * Re-publicar solicitud archivada (reset expiración y estado)
   */
  async republishServiceRequest(req, res) {
    try {
      const { id } = req.params;
      const sr = await ServiceRequest.findOne({ _id: id, client: req.user._id, status: 'archived' });
      if (!sr) return res.status(404).json({ success: false, message: 'Archived service request not found' });
      sr.status = 'published';
      const expiryDate = new Date();
      if (sr.basicInfo.urgency === 'immediate') expiryDate.setHours(expiryDate.getHours() + 24); else expiryDate.setDate(expiryDate.getDate() + 7);
      sr.expiryDate = expiryDate;
      await sr.save();
      let notificationResult;
      if (sr.visibility === 'auto') {
        notificationResult = await matchingService.notifyProviders(sr._id, 'auto');
      }
      // Emit counters update to client and notified providers
      try { emitter.emitCountersUpdateToUser(req.user._id, { reason: 'request_republished' }); } catch {/* ignore */}
      try {
        const providers = (notificationResult?.results || []).map(r => r?.provider).filter(Boolean);
        if (providers.length) emitter.emitCountersUpdateToUsers(providers, { reason: 'providers_notified' });
      } catch {/* ignore */}
      res.json({ success: true, message: 'Service request republished', data: { request: sr, notifications: notificationResult } });
    } catch (error) {
      console.error('RequestController - republishServiceRequest error:', error);
      res.status(500).json({ success: false, message: 'Failed to republish service request' });
    }
  }

  /**
   * Obtener solicitudes de servicio (con filtros)
   */
  async getServiceRequests(req, res) {
    try {
      const { 
        status, 
        category, 
        urgency, 
        page = 1, 
        limit = 10,
        userType 
      } = req.query;

      let query = {};
      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        sort: { createdAt: -1 },
        populate: [
          { path: 'client', select: 'profile contact' },
          { path: 'acceptedProposal', populate: { path: 'provider', select: 'providerProfile' } },
          { path: 'selectedProviders', select: 'providerProfile' },
          { path: 'eligibleProviders.provider', select: 'providerProfile' }
        ],
        select: '+metadata.proposalCount' // Include proposal counter
      };

      // Este controlador es reutilizado en rutas de cliente y proveedor.
      // Para ruta de cliente (clientOnly middleware) garantizamos aislamiento por usuario.
      // Para proveedor (providerOnly middleware) aplicamos lógica de visibilidad.
      const routeBase = req.baseUrl || '';
      const isClientRoute = routeBase.includes('/client');
      const isProviderRoute = routeBase.includes('/provider');

      if (isClientRoute) {
        // Siempre limitar a solicitudes del cliente autenticado (independiente de rol field inconsistencies)
        query.client = req.user._id;
      } else if (isProviderRoute) {
          // Mostrar solicitudes publicadas/activas para categorías del proveedor
          // e incluir cualquier solicitud dirigida al proveedor o donde fue notificado explícitamente
          const base = { status: { $in: ['published', 'active'] } };
          const svc = Array.isArray(req.user?.providerProfile?.services) ? req.user.providerProfile.services : [];
          const byCategory = svc.length > 0 ? { ...base, 'basicInfo.category': { $in: svc.map(s => s.category) } } : base;
          const directed = { ...base, visibility: 'directed', selectedProviders: req.user._id };
          const notified = { ...base, 'eligibleProviders.provider': req.user._id };
          // Combine with OR to guarantee visibility when client selected this provider
          query = { $or: [byCategory, directed, notified] };
      } else {
        // Fallback defensivo: si no sabemos la ruta, evitar exponer datos y devolver vacío.
        query.client = req.user._id;
      }

      // Aplicar filtros adicionales de forma segura
      const extraFilters = {};
      if (status) extraFilters.status = status;
      if (category) extraFilters['basicInfo.category'] = category;
      if (urgency) extraFilters['basicInfo.urgency'] = urgency;

      if (Object.keys(extraFilters).length > 0) {
        if (query && query.$or) {
          query = { $and: [ query, extraFilters ] };
        } else {
          query = { ...query, ...extraFilters };
        }
      }

      const requests = await ServiceRequest.find(query)
        .skip((options.page - 1) * options.limit)
        .limit(options.limit)
        .sort(options.sort)
        .select(options.select)
        .populate(options.populate);

      const total = await ServiceRequest.countDocuments(query);

      res.json({
        success: true,
        data: {
          requests,
          pagination: {
            page: options.page,
            limit: options.limit,
            total,
            pages: Math.ceil(total / options.limit)
          }
        }
      });
    } catch (error) {
      console.error('RequestController - getServiceRequests error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get service requests'
      });
    }
  }

  /**
   * Obtener solicitud específica
   */
  async getServiceRequest(req, res) {
    try {
      const { id } = req.params;

      let query = { _id: id };
      const routeBase = req.baseUrl || '';
      const isClientRoute = routeBase.includes('/client');
      const isProviderRoute = routeBase.includes('/provider');

      if (isClientRoute) {
        query.client = req.user._id;
      } else if (isProviderRoute) {
        // Permitir ver si está publicada/activa y es de su categoría, o si fue dirigida a este proveedor, o si fue notificado
        const base = { _id: id, status: { $in: ['published', 'active'] } };
        const svc = Array.isArray(req.user?.providerProfile?.services) ? req.user.providerProfile.services : [];
        const byCategory = svc.length > 0 ? { ...base, 'basicInfo.category': { $in: svc.map(s => s.category) } } : base;
        const directed = { ...base, visibility: 'directed', selectedProviders: req.user._id };
        const notified = { ...base, 'eligibleProviders.provider': req.user._id };
        query = { $or: [byCategory, directed, notified] };
      } else {
        // Fallback: sólo devolver si es dueño
        query.client = req.user._id;
      }

      const serviceRequest = await ServiceRequest.findOne(query)
        .populate('client', 'profile contact')
        .populate('proposals')
        .populate('acceptedProposal')
        .populate('eligibleProviders.provider', 'providerProfile subscription');

      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message: 'Service request not found'
        });
      }

      // Incrementar contador de vistas para proveedores
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
      if (userRoles.includes('provider')) {
        await ServiceRequest.findByIdAndUpdate(id, {
          $inc: { 'metadata.providerViews': 1 }
        });
      }

      res.json({
        success: true,
        data: { request: serviceRequest }
      });
    } catch (error) {
      console.error('RequestController - getServiceRequest error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get service request'
      });
    }
  }

  /**
   * Notificar proveedores específicos (flujo dirigido)
   */
  async notifySpecificProviders(req, res) {
    try {
      const { id } = req.params;
      const { providerIds } = req.body;

      const serviceRequest = await ServiceRequest.findOne({
        _id: id,
        client: req.user._id,
        status: 'published'
      });

      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message: 'Service request not found or not authorized'
        });
      }

      // Buscar proveedores elegibles y notificar solo los seleccionados
      const notificationResult = await matchingService.notifyProviders(
        id,
        'directed',
        providerIds
      );

      // Actualizar visibilidad a dirigida
      serviceRequest.visibility = 'directed';
      serviceRequest.selectedProviders = providerIds;
      await serviceRequest.save();

  // Real-time counters: update for selected providers and client
  try { emitter.emitCountersUpdateToUsers(providerIds, { reason: 'request_directed' }); } catch { /* ignore */ }
  try { emitter.emitCountersUpdateToUser(req.user._id, { reason: 'request_directed' }); } catch { /* ignore */ }

      res.json({
        success: true,
        message: 'Providers notified successfully',
        data: notificationResult
      });
    } catch (error) {
      console.error('RequestController - notifySpecificProviders error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to notify providers'
      });
    }
  }

  /**
   * Buscar proveedores para invitación dirigida (cliente)
   * Filtros: q (texto), category, lat/lng (opcional), limit
   * Ordenados por: 1) Suscripción (premium > standard > free), 2) Rating
   */
  async searchProviders(req, res) {
    try {
      const { q, category, lat, lng, limit = 10 } = req.query;
      const Provider = (await import('../models/User/Provider.js')).default;
      const { SERVICE_CATEGORIES } = await import('../config/categories.js');

      const base = {
        isActive: true,
        'subscription.status': 'active'
      };
      if (category) {
        base['providerProfile.services.category'] = category;
      }

      const select = {
        email: 1,
        'profile.firstName': 1,
        'profile.profileImage': 1,
        'providerProfile.businessName': 1,
        'providerProfile.businessDescription': 1,
        'providerProfile.rating.average': 1,
        'providerProfile.rating.count': 1,
        'providerProfile.services': 1,
        'providerProfile.portfolio': 1,
        'subscription.plan': 1,
        'providerProfile.serviceArea.location': 1,
        'providerProfile.serviceArea.address': 1
      };

      const lim = Math.min(Math.max(parseInt(limit) || 10, 1), 50);
      const hasCoords = lat != null && lng != null && !isNaN(Number(lat)) && !isNaN(Number(lng));

      // Búsqueda inteligente por texto con NLP
      let orText = [];
      if (q && String(q).trim().length > 0) {
        const searchText = String(q).trim().toLowerCase();
        const words = searchText.split(/\s+/).filter(w => w.length > 2);
        
        orText = [];
        
        // Buscar cada palabra en múltiples campos
        words.forEach(word => {
          const wordRegex = { $regex: word, $options: 'i' };
          orText.push(
            { 'providerProfile.businessName': wordRegex },
            { 'profile.firstName': wordRegex },
            { 'providerProfile.businessDescription': wordRegex },
            { 'providerProfile.services.category': wordRegex },
            { 'providerProfile.services.description': wordRegex },
            { 'providerProfile.serviceArea.address': wordRegex }
          );
        });
        
        // También buscar frase completa
        const searchRegex = { $regex: searchText, $options: 'i' };
        orText.push(
          { 'providerProfile.businessName': searchRegex },
          { 'providerProfile.businessDescription': searchRegex },
          { 'providerProfile.services.description': searchRegex }
        );
        
        // Buscar categorías que coincidan parcialmente
        const matchingCategories = SERVICE_CATEGORIES.filter(cat => 
          cat.toLowerCase().includes(searchText.toLowerCase()) ||
          searchText.toLowerCase().includes(cat.toLowerCase()) ||
          words.some(word => cat.toLowerCase().includes(word))
        );
        
        if (matchingCategories.length > 0) {
          orText.push({ 'providerProfile.services.category': { $in: matchingCategories } });
        }
      }

      let docs = [];
      
      if (hasCoords) {
        docs = await Provider.find({
          ...base,
          ...(orText.length ? { $or: orText } : {}),
          'providerProfile.serviceArea.location': {
            $near: {
              $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
              $maxDistance: 50000
            }
          }
        }).select(select).limit(lim).lean();
      } else {
        docs = await Provider.find({
          ...base,
          ...(orText.length ? { $or: orText } : {})
        }).select(select).limit(lim).lean();
      }

      // Calcular score para cada proveedor
      const scoringService = (await import('../services/internal/scoringService.js')).default;
      const providersWithScore = await Promise.all(
        docs.map(async (p) => {
          const scoreData = await scoringService.calculateProviderScore(p);
          return {
            ...p,
            score: scoreData.total,
            scoreBreakdown: scoreData.breakdown
          };
        })
      );

      // Ordenar por suscripción y score
      const planOrder = { pro: 3, basic: 2, free: 1 };
      providersWithScore.sort((a, b) => {
        const planA = planOrder[a.subscription?.plan] || 0;
        const planB = planOrder[b.subscription?.plan] || 0;
        if (planA !== planB) return planB - planA; // Primero por plan (mayor a menor)
        
        // Luego por score (mayor a menor)
        return b.score - a.score;
      });

      return res.json({ success: true, data: { providers: providersWithScore } });
    } catch (error) {
      console.error('RequestController - searchProviders error:', error);
      res.status(500).json({ success: false, message: 'Failed to search providers' });
    }
  }

  /**
   * Cancelar solicitud de servicio
   */
  async cancelServiceRequest(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const serviceRequest = await ServiceRequest.findOne({
        _id: id,
        client: req.user._id
      });

      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message: 'Service request not found'
        });
      }

      if (!['draft', 'published'].includes(serviceRequest.status)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel request in current status'
        });
      }

      serviceRequest.status = 'cancelled';
      serviceRequest.cancellationReason = reason;
      
      // Eliminar fotos/videos de Cloudinary si existen
      const photosToDelete = serviceRequest.photos || [];
      if (photosToDelete.length > 0) {
        try {
          const cloudinary = (await import('../config/cloudinary.js')).default;
          for (const photo of photosToDelete) {
            if (photo.cloudinaryId) {
              try {
                await cloudinary.uploader.destroy(photo.cloudinaryId, {
                  resource_type: photo.type === 'video' ? 'video' : 'image'
                });
                console.log(`✅ Deleted from Cloudinary: ${photo.cloudinaryId}`);
              } catch (deleteError) {
                console.error(`Failed to delete ${photo.cloudinaryId} from Cloudinary:`, deleteError);
                // Continuar con el siguiente archivo
              }
            }
          }
        } catch (cloudinaryError) {
          console.error('Failed to initialize Cloudinary for deletion:', cloudinaryError);
          // Continuar con la cancelación aunque falle la eliminación
        }
      }
      
      await serviceRequest.save();

      // Notificar a proveedores que ya enviaron propuestas
      if (serviceRequest.proposals.length > 0) {
        await notificationService.sendBulkNotifications({
          userIds: serviceRequest.proposals.map(p => p.provider),
          type: 'REQUEST_CANCELLED',
          data: {
            requestId: id,
            requestTitle: serviceRequest.basicInfo.title
          }
        });
      }

      // Emit counters update for client and any providers involved (notified/selected/proposals)
      try { emitter.emitCountersUpdateToUser(req.user._id, { reason: 'request_cancelled' }); } catch {/* ignore */}
      try {
        const providers = [
          ...(Array.isArray(serviceRequest.selectedProviders) ? serviceRequest.selectedProviders : []),
          ...((serviceRequest.eligibleProviders || []).map(ep => ep.provider)),
          ...((serviceRequest.proposals || []).map(p => p.provider))
        ].filter(Boolean);
        if (providers.length) emitter.emitCountersUpdateToUsers(providers, { reason: 'request_cancelled' });
      } catch {/* ignore */}

      res.json({
        success: true,
        message: 'Service request cancelled successfully'
      });
    } catch (error) {
      console.error('RequestController - cancelServiceRequest error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel service request'
      });
    }
  }

  /**
   * Elegibilidad para una solicitud existente del cliente
   */
  async getRequestEligibility(req, res) {
    try {
      const { id } = req.params;
      // Asegurar propiedad
      const sr = await ServiceRequest.findOne({ _id: id, client: req.user._id });
      if (!sr) return res.status(404).json({ success: false, message: 'Service request not found' });

      const { eligibleProviders, totalCount } = await matchingService.findEligibleProviders(id, { forceRefresh: true });

      // Responder con conteo y un pequeño resumen (no exponer datos sensibles)
      const preview = (eligibleProviders || []).slice(0, 5).map(ep => ({
        provider: ep.provider,
        score: ep.score,
        profile: ep.profile?.businessName ? { businessName: ep.profile.businessName, plan: ep.profile.subscription } : undefined
      }));

      return res.json({
        success: true,
        data: {
          totalEligible: totalCount || 0,
          top: preview
        }
      });
    } catch (error) {
      console.error('RequestController - getRequestEligibility error:', error);
      res.status(500).json({ success: false, message: 'Failed to compute eligibility' });
    }
  }

  /**
   * Obtener categorías que tienen proveedores activos registrados
   */
  async getActiveCategories(req, res) {
    try {
      const Provider = (await import('../models/User/Provider.js')).default;
      const { SERVICE_CATEGORIES } = await import('../config/categories.js');

      // Obtener categorías únicas de proveedores activos
      const activeCategories = await Provider.distinct('providerProfile.services.category', {
        'subscription.status': 'active',
        isActive: true
      });

      // Filtrar para asegurar que son válidas y ordenar
      const validCategories = activeCategories
        .filter(cat => SERVICE_CATEGORIES.includes(cat))
        .sort((a, b) => a.localeCompare(b, 'es'));

      // Obtener conteo de proveedores por categoría
      const categoriesWithCount = await Promise.all(
        validCategories.map(async (category) => {
          const count = await Provider.countDocuments({
            'providerProfile.services.category': category,
            'subscription.status': 'active',
            isActive: true
          });
          return { value: category, label: category, providerCount: count };
        })
      );

      res.json({
        success: true,
        data: {
          categories: categoriesWithCount,
          total: validCategories.length
        }
      });
    } catch (error) {
      console.error('RequestController - getActiveCategories error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get active categories'
      });
    }
  }

  /**
   * Elegibilidad preliminar (preview) para datos de formulario sin guardar
   * Aplica scoring con fórmula: ((Rating Promedio × Factor Volumen) + Puntos por Consistencia) × Multiplicador del Plan
   */
  async getEligibilityPreview(req, res) {
    try {
      const { category, urgency, lat, lng, include, limit } = req.query;
      if (!category) return res.status(400).json({ success: false, message: 'category required' });

      const Provider = (await import('../models/User/Provider.js')).default;
      const scoringService = (await import('../services/internal/scoringService.js')).default;
      const subscriptionService = (await import('../services/internal/subscriptionService.js')).default;

      const baseQuery = {
        'providerProfile.services.category': category,
        'subscription.status': 'active',
        isActive: true
      };

      // Try geo filter when coordinates provided; fallback to category-only
      const hasCoords = lat != null && lng != null && !isNaN(Number(lat)) && !isNaN(Number(lng));
      const isImmediate = String(urgency || '').toLowerCase() === 'immediate';
      const maxDistance = isImmediate ? 15000 : 50000; // meters

      let providers = [];
      let total = 0;
      let geoApplied = false;

      if (hasCoords) {
        try {
          // Usar $geoNear aggregation para obtener distancia
          const nearResults = await Provider.aggregate([
            {
              $geoNear: {
                near: {
                  type: 'Point',
                  coordinates: [Number(lng), Number(lat)]
                },
                distanceField: 'distance',
                maxDistance: maxDistance,
                spherical: true,
                query: baseQuery
              }
            },
            {
              $limit: Math.min(Math.max(parseInt(limit) || 5, 1), 20)
            }
          ]);
          providers = nearResults;
          total = nearResults.length;
          geoApplied = true;
          console.log(`📍 Geo query successful: ${providers.length} providers within ${maxDistance}m`);
        } catch (e) {
          console.warn('⚠️ Geo query failed, falling back to category-only:', e.message);
          const lim = Math.min(Math.max(parseInt(limit) || 5, 1), 20);
          providers = await Provider.find(baseQuery).limit(lim).lean();
          total = await Provider.countDocuments(baseQuery);
          geoApplied = false;
          console.log(`📍 Category-only query: ${providers.length} providers found`);
        }
      } else {
        // Without coordinates, return category-only
        const lim = Math.min(Math.max(parseInt(limit) || 5, 1), 20);
        providers = await Provider.find(baseQuery).limit(lim).lean();
        total = await Provider.countDocuments(baseQuery);
        geoApplied = false;
      }

      console.log(`📊 Found ${providers.length} providers for category ${category}, include=${include}`);

      // Si se solicitan detalles, aplicar scoring y ordenar
      if (String(include).toLowerCase() === 'details') {
        if (providers.length === 0) {
          return res.json({
            success: true,
            data: {
              totalEligible: 0,
              geoApplied,
              providers: []
            }
          });
        }
        // NO filtrar por límite de leads - mostrar todos pero indicar disponibilidad
        console.log(`🔍 Processing ${providers.length} providers for scoring...`);
        const eligibleProviders = await Promise.all(
          providers.map(async (p, idx) => {
            const canLead = await subscriptionService.canReceiveLead(p);
            
            // Calcular score completo
            const scoreData = await scoringService.calculateProviderScore(p);
            
            const status = canLead ? 'available' : 'limit_reached';
            console.log(`${canLead ? '✅' : '⚠️'} Provider ${idx + 1}: ${p.providerProfile?.businessName || 'N/A'} - Score: ${scoreData.total.toFixed(2)} - Status: ${status}`);

            return {
              _id: p._id,
              businessName: p.providerProfile?.businessName || p.profile?.firstName || 'Proveedor',
              rating: p.providerProfile?.rating?.average || 0,
              plan: p.subscription?.plan || 'free',
              score: scoreData.total,
              scoreBreakdown: scoreData.breakdown,
              distance: p.distance || null,
              canReceiveLeads: canLead,
              availabilityStatus: status,
              profile: p.profile,
              portfolio: p.providerProfile?.portfolio || []
            };
          })
        );

        // Ordenar: primero los que pueden recibir leads, luego por score
        eligibleProviders.sort((a, b) => {
          if (a.canReceiveLeads !== b.canReceiveLeads) {
            return b.canReceiveLeads ? 1 : -1;
          }
          return b.score - a.score;
        });
        
        const availableCount = eligibleProviders.filter(p => p.canReceiveLeads).length;
        console.log(`📊 Total providers: ${eligibleProviders.length}, Available: ${availableCount}, Limit reached: ${eligibleProviders.length - availableCount}`);

        return res.json({
          success: true,
          data: {
            totalEligible: eligibleProviders.length,
            geoApplied,
            providers: eligibleProviders
          }
        });
      }

      // Sin detalles, solo contar
      return res.json({
        success: true,
        data: {
          totalEligible: total,
          geoApplied
        }
      });
    } catch (error) {
      console.error('RequestController - getEligibilityPreview error:', error);
      res.status(500).json({ success: false, message: 'Failed to compute eligibility preview' });
    }
  }
}

const requestController = new RequestController();
export default requestController;