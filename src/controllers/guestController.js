// controllers/guestController.js
import mongoose from 'mongoose';
import Session from '../models/System/Session.js';
import ServiceRequest from '../models/Service/ServiceRequest.js';
import Client from '../models/User/Client.js';
import { findMatchingCategories, getSuggestions, normalizeText, STOPWORDS } from '../config/searchKeywords.js';

class GuestController {
  /**
   * Sugerencias de búsqueda en tiempo real (público, ligero)
   * Devuelve categorías detectadas para mostrar chips/badges en el frontend
   */
  async searchSuggestions(req, res) {
    try {
      const { q } = req.query;
      if (!q || String(q).trim().length < 2) {
        return res.json({ success: true, data: { suggestions: [] } });
      }
      const suggestions = getSuggestions(String(q).trim());
      res.json({ success: true, data: { suggestions } });
    } catch (error) {
      console.error('GuestController - searchSuggestions error:', error);
      res.json({ success: true, data: { suggestions: [] } });
    }
  }

  /**
   * Buscar proveedores (público, sin autenticación)
   * Búsqueda inteligente bilingüe con normalización + fuzzy matching
   */
  async searchProvidersPublic(req, res) {
    try {
      const { q, category, location: locationQuery, lat, lng, limit = 20 } = req.query;
      const Provider = (await import('../models/User/Provider.js')).default;
      const scoringService = (await import('../services/internal/scoringService.js')).default;

      // Consulta base más flexible - no requerir suscripción activa obligatoriamente
      const base = {
        isActive: true
      };
      if (category) {
        // Filtrar SOLO por el servicio principal (primer elemento del array)
        base['providerProfile.services.0.category'] = category;
      }

      const select = {
        email: 1,
        'profile.firstName': 1,
        'profile.avatar': 1,
        'providerProfile.businessName': 1,
        'providerProfile.description': 1,
        'providerProfile.businessDescription': 1,
        'providerProfile.rating.average': 1,
        'providerProfile.rating.count': 1,
        'providerProfile.rating.breakdown': 1,
        'providerProfile.services': 1,
        'providerProfile.additionalServices': 1,
        'providerProfile.portfolio': 1,
        'providerProfile.stats': 1,
        'subscription.plan': 1,
        'subscription.status': 1,
        'providerProfile.serviceArea.location': 1,
        'providerProfile.serviceArea.address': 1,
        'providerProfile.serviceArea.zones': 1,
        'providerProfile.serviceArea.radius': 1
      };

      const lim = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
      const hasCoords = lat != null && lng != null && !isNaN(Number(lat)) && !isNaN(Number(lng));

      // ─── Búsqueda inteligente bilingüe con diccionario centralizado ───
      let orText = [];
      let detectedCategories = [];

      if (q && String(q).trim().length > 0) {
        const searchText = String(q).trim();
        const normalized = normalizeText(searchText);
        console.log(`🔍 Smart search: "${searchText}" → normalized: "${normalized}"`);

        // Extraer palabras significativas (sin stopwords, min length 2)
        const words = normalized.split(/\s+/).filter(w => w.length >= 2 && !STOPWORDS.has(w));
        console.log(`📝 Significant words: [${words.join(', ')}]`);

        // 1. Buscar categorías con diccionario bilingüe + fuzzy matching
        const matchedCategories = findMatchingCategories(searchText);
        if (matchedCategories.size > 0) {
          detectedCategories = Array.from(matchedCategories);
          console.log(`🎯 Detected categories: ${detectedCategories.join(', ')}`);
          // Agregar match por categoría principal — alta prioridad
          orText.push({ 'providerProfile.services.0.category': { $in: detectedCategories } });
        }

        // 2. Búsqueda por palabras en campos clave (limitada a max 5 palabras más relevantes)
        const topWords = words.slice(0, 5);
        topWords.forEach(word => {
          if (word.length < 2) return;
          const wordRegex = { $regex: word, $options: 'i' };
          orText.push(
            { 'providerProfile.businessName': wordRegex },
            { 'providerProfile.description': wordRegex },
            { 'providerProfile.businessDescription': wordRegex },
            { 'providerProfile.services.0.category': wordRegex },
            { 'providerProfile.services.description': wordRegex }
          );
        });

        // 3. Búsqueda por frase completa en campos principales
        if (normalized.length >= 3) {
          const phraseRegex = { $regex: normalized, $options: 'i' };
          orText.push(
            { 'providerProfile.businessName': phraseRegex },
            { 'providerProfile.description': phraseRegex },
            { 'providerProfile.businessDescription': phraseRegex }
          );
        }

        // 4. Si no se encontraron categorías, buscar también en address y firstName
        if (matchedCategories.size === 0 && words.length > 0) {
          words.slice(0, 3).forEach(word => {
            if (word.length < 3) return;
            const wordRegex = { $regex: word, $options: 'i' };
            orText.push(
              { 'profile.firstName': wordRegex },
              { 'providerProfile.serviceArea.address': wordRegex }
            );
          });
        }
      }

      // 5. Búsqueda por ubicación (texto) — filtro en address/zones
      if (locationQuery && String(locationQuery).trim().length > 0) {
        const locText = String(locationQuery).trim();
        const locRegex = { $regex: locText, $options: 'i' };
        // Agregar como condición AND si hay texto, o como OR si no hay
        if (orText.length > 0) {
          // Combinamos: resultados deben coincidir con texto Y estar en la ubicación
          base.$or = orText;
          base.$and = base.$and || [];
          base.$and.push({
            $or: [
              { 'providerProfile.serviceArea.address': locRegex },
              { 'providerProfile.serviceArea.zones': locRegex }
            ]
          });
          orText = []; // Ya movido a base
        } else {
          orText.push(
            { 'providerProfile.serviceArea.address': locRegex },
            { 'providerProfile.serviceArea.zones': locRegex }
          );
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

      console.log(`🔍 Found ${docs.length} providers for: "${q || 'all'}" (category: ${category || 'all'}, location: ${locationQuery || 'all'})`);

      // Calcular score para cada proveedor
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
        if (planA !== planB) return planB - planA;
        
        // Luego por score
        return b.score - a.score;
      });

      res.json({
        success: true,
        data: {
          providers: providersWithScore,
          detectedCategories // Devolver categorías detectadas al frontend
        }
      });
    } catch (error) {
      console.error('GuestController - searchProvidersPublic error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search providers'
      });
    }
  }

  /**
   * Obtener profesionales destacados del sistema (público)
   * Retorna los mejores proveedores ordenados por score general
   */
  async getFeaturedProviders(req, res) {
    try {
      const { limit = 10 } = req.query;
      const Provider = (await import('../models/User/Provider.js')).default;
      const Review = (await import('../models/Service/Review.js')).default;
      const scoringService = (await import('../services/internal/scoringService.js')).default;

      const lim = Math.min(Math.max(parseInt(limit) || 10, 1), 20);

      // Buscar proveedores activos con rating y trabajos completados
      const providers = await Provider.find({
        isActive: true,
        'providerProfile.services': { $exists: true, $ne: [] },
        // Preferir proveedores con al menos algún trabajo o rating
        $or: [
          { 'providerProfile.rating.count': { $gt: 0 } },
          { 'providerProfile.stats.completedJobs': { $gt: 0 } },
          { 'providerProfile.portfolio': { $exists: true, $ne: [] } }
        ]
      }).select({
        email: 1,
        'profile.firstName': 1,
        'profile.avatar': 1,
        'providerProfile.businessName': 1,
        'providerProfile.description': 1,
        'providerProfile.businessDescription': 1,
        'providerProfile.rating.average': 1,
        'providerProfile.rating.count': 1,
        'providerProfile.rating.breakdown': 1,
        'providerProfile.services': 1,
        'providerProfile.additionalServices': 1,
        'providerProfile.portfolio': 1,
        'providerProfile.stats': 1,
        'subscription.plan': 1,
        'subscription.status': 1,
        'providerProfile.serviceArea.address': 1
      }).lean();

      console.log(`📊 Found ${providers.length} providers for featured section`);

      // Calcular score para cada proveedor
      const providersWithScore = await Promise.all(
        providers.map(async (p) => {
          const scoreData = await scoringService.calculateProviderScore(p);
          return {
            ...p,
            score: scoreData.total,
            scoreBreakdown: scoreData.breakdown
          };
        })
      );

      // Ordenar primero por plan (pro > basic > free), luego por score
      const planOrder = { pro: 3, basic: 2, free: 1 };
      providersWithScore.sort((a, b) => {
        const planA = planOrder[a.subscription?.plan] || 0;
        const planB = planOrder[b.subscription?.plan] || 0;
        if (planA !== planB) return planB - planA;
        return b.score - a.score;
      });

      // Limitar resultados
      const featuredProviders = providersWithScore.slice(0, lim);

      // Obtener reseñas destacadas para cada proveedor (1 reseña más reciente con rating >= 4)
      const providersWithReviews = await Promise.all(
        featuredProviders.map(async (provider) => {
          const featuredReview = await Review.findOne({
            provider: provider._id,
            status: 'active',
            'rating.overall': { $gte: 4 }
          })
          .sort({ createdAt: -1 })
          .select({
            'rating.overall': 1,
            'review.comment': 1,
            'review.title': 1,
            'translations': 1,
            'originalLanguage': 1,
            createdAt: 1
          })
          .populate('client', 'profile.firstName profile.avatar')
          .lean();

          return {
            ...provider,
            featuredReview: featuredReview || null
          };
        })
      );

      console.log(`✅ Returning ${providersWithReviews.length} featured providers`);

      res.json({
        success: true,
        data: { 
          providers: providersWithReviews,
          total: providersWithReviews.length
        }
      });
    } catch (error) {
      console.error('GuestController - getFeaturedProviders error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get featured providers'
      });
    }
  }

  /**
   * Obtener testimonios destacados (reseñas con fotos de trabajos y feedback de plataforma)
   * Para la sección de testimonios en Home - Incluye tanto clientes como profesionales
   * 
   * GALERÍA DE TRABAJOS REALIZADOS:
   * - Fotos de reseñas de clientes
   * - Fotos de reseñas de profesionales  
   * - Portafolio de profesionales destacados
   * - Evidencias de trabajos completados (before/during/after)
   * 
   * Ordenados por: rating → plan (pro>basic>free) → calificación
   */
  async getFeaturedTestimonials(req, res) {
    try {
      const { limit = 12 } = req.query;
      const Review = (await import('../models/Service/Review.js')).default;
      const ClientReview = (await import('../models/Service/ClientReview.js')).default;
      const Booking = (await import('../models/Service/Booking.js')).default;
      const Provider = (await import('../models/User/Provider.js')).default;

      const lim = Math.min(Math.max(parseInt(limit) || 12, 1), 30);

      // 1. Obtener reseñas de CLIENTES con fotos en la reseña
      const reviewsWithPhotos = await Review.find({
        status: 'active',
        'rating.overall': { $gte: 1 },
        'review.photos': { $exists: true, $ne: [] }
      })
      .sort({ 'rating.overall': -1, createdAt: -1 })
      .limit(lim)
      .select({
        'rating.overall': 1,
        'review.title': 1,
        'review.comment': 1,
        'review.photos': 1,
        'translations': 1,
        'originalLanguage': 1,
        'platformFeedback': 1,
        'booking': 1,
        createdAt: 1
      })
      .populate('client', 'profile.firstName profile.avatar')
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .lean();

      // 2. Obtener reseñas de CLIENTES con feedback de plataforma
      const clientPlatformTestimonials = await Review.find({
        status: 'active',
        'platformFeedback.rating': { $gte: 1 },
        'platformFeedback.comment': { $exists: true, $ne: '' }
      })
      .sort({ 'platformFeedback.rating': -1, createdAt: -1 })
      .limit(Math.floor(lim / 2))
      .select({
        'rating.overall': 1,
        'review.title': 1,
        'review.comment': 1,
        'review.photos': 1,
        'translations': 1,
        'originalLanguage': 1,
        'platformFeedback': 1,
        'booking': 1,
        createdAt: 1
      })
      .populate('client', 'profile.firstName profile.avatar')
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .lean();

      // 3. Obtener reseñas de PROFESIONALES (ClientReview) con feedback de plataforma
      const providerPlatformTestimonials = await ClientReview.find({
        'platformFeedback.rating': { $gte: 1 },
        'platformFeedback.comment': { $exists: true, $ne: '' }
      })
      .sort({ 'platformFeedback.rating': -1, createdAt: -1 })
      .limit(Math.floor(lim / 2))
      .select({
        'rating.overall': 1,
        'rating.categories': 1,
        'comment': 1,
        'platformFeedback': 1,
        'translations': 1,
        'originalLanguage': 1,
        createdAt: 1
      })
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .populate('client', 'profile.firstName profile.avatar')
      .lean();

      // 3.5. Obtener reseñas normales de clientes (con cualquier calificación)
      const regularClientReviews = await Review.find({
        status: 'active',
        'rating.overall': { $gte: 1 },
        'review.comment': { $exists: true, $ne: '' }
      })
      .sort({ 'rating.overall': -1, createdAt: -1 })
      .limit(lim)
      .select({
        'rating.overall': 1,
        'rating.categories': 1,
        'review.title': 1,
        'review.comment': 1,
        'review.photos': 1,
        'translations': 1,
        'originalLanguage': 1,
        'platformFeedback': 1,
        'booking': 1,
        createdAt: 1
      })
      .populate('client', 'profile.firstName profile.avatar')
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .lean();

      // 4. Obtener bookings con evidencias (fotos del trabajo) que tengan reviews
      const bookingIds = [...reviewsWithPhotos, ...clientPlatformTestimonials]
        .map(r => r.booking)
        .filter(Boolean);
      
      const bookingsWithEvidence = await Booking.find({
        _id: { $in: bookingIds },
        $or: [
          { 'serviceEvidence.before.0': { $exists: true } },
          { 'serviceEvidence.during.0': { $exists: true } },
          { 'serviceEvidence.after.0': { $exists: true } }
        ]
      })
      .select('_id serviceEvidence')
      .lean();

      // Crear mapa de evidencias por booking
      const evidenceMap = new Map();
      bookingsWithEvidence.forEach(b => {
        const allPhotos = [
          ...(b.serviceEvidence?.before || []),
          ...(b.serviceEvidence?.during || []),
          ...(b.serviceEvidence?.after || [])
        ].filter(p => p.url);
        if (allPhotos.length > 0) {
          evidenceMap.set(b._id.toString(), allPhotos);
        }
      });

      // 5. También buscar reviews sin fotos pero cuyos bookings SÍ tienen evidencias
      const reviewsWithBookingEvidence = await Review.find({
        status: 'active',
        'rating.overall': { $gte: 1 },
        booking: { $in: Array.from(evidenceMap.keys()).map(id => new mongoose.Types.ObjectId(id)) },
        $or: [
          { 'review.photos': { $exists: false } },
          { 'review.photos': { $size: 0 } }
        ]
      })
      .sort({ 'rating.overall': -1, createdAt: -1 })
      .limit(Math.floor(lim / 2))
      .select({
        'rating.overall': 1,
        'review.title': 1,
        'review.comment': 1,
        'translations': 1,
        'originalLanguage': 1,
        'platformFeedback': 1,
        'booking': 1,
        createdAt: 1
      })
      .populate('client', 'profile.firstName profile.avatar')
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .lean();

      // Combinar y deduplicar todos los testimonios
      const allTestimonialsMap = new Map();
      
      // Agregar reseñas de clientes con fotos en review
      reviewsWithPhotos.forEach(r => {
        const bookingEvidence = r.booking ? evidenceMap.get(r.booking.toString()) : null;
        allTestimonialsMap.set(r._id.toString(), {
          ...r,
          userRole: 'client',
          type: 'work_photo',
          providerName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
          providerAvatar: r.provider?.profile?.avatar || null,
          providerServices: r.provider?.providerProfile?.services || [],
          userName: r.client?.profile?.firstName || 'Cliente',
          userAvatar: r.client?.profile?.avatar || null,
          // Combinar fotos de review + evidencias del booking
          allPhotos: [
            ...(r.review?.photos || []),
            ...(bookingEvidence || [])
          ],
          hasPlatformFeedback: !!(r.platformFeedback?.rating || r.platformFeedback?.comment)
        });
      });

      // Agregar reseñas con evidencias del booking (sin fotos en review)
      reviewsWithBookingEvidence.forEach(r => {
        if (allTestimonialsMap.has(r._id.toString())) return;
        const bookingEvidence = r.booking ? evidenceMap.get(r.booking.toString()) : null;
        if (!bookingEvidence || bookingEvidence.length === 0) return;
        
        allTestimonialsMap.set(r._id.toString(), {
          ...r,
          userRole: 'client',
          type: 'work_photo',
          providerName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
          providerAvatar: r.provider?.profile?.avatar || null,
          providerServices: r.provider?.providerProfile?.services || [],
          userName: r.client?.profile?.firstName || 'Cliente',
          userAvatar: r.client?.profile?.avatar || null,
          allPhotos: bookingEvidence,
          hasPlatformFeedback: !!(r.platformFeedback?.rating || r.platformFeedback?.comment)
        });
      });

      // Agregar testimonios de plataforma de clientes
      clientPlatformTestimonials.forEach(r => {
        const existing = allTestimonialsMap.get(r._id.toString());
        if (existing) {
          existing.hasPlatformFeedback = true;
        } else {
          const bookingEvidence = r.booking ? evidenceMap.get(r.booking.toString()) : null;
          allTestimonialsMap.set(r._id.toString(), {
            ...r,
            userRole: 'client',
            type: 'platform_feedback',
            providerName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
            providerAvatar: r.provider?.profile?.avatar || null,
            providerServices: r.provider?.providerProfile?.services || [],
            userName: r.client?.profile?.firstName || 'Cliente',
            userAvatar: r.client?.profile?.avatar || null,
            allPhotos: [
              ...(r.review?.photos || []),
              ...(bookingEvidence || [])
            ],
            hasPlatformFeedback: true
          });
        }
      });

      // Agregar testimonios de plataforma de PROFESIONALES
      providerPlatformTestimonials.forEach(r => {
        // Usar ID diferente para evitar colisiones con reviews normales
        const uniqueId = `provider_${r._id.toString()}`;
        allTestimonialsMap.set(uniqueId, {
          _id: r._id,
          userRole: 'provider',
          type: 'platform_feedback',
          rating: r.rating,
          review: { comment: r.comment },
          translations: r.translations,
          originalLanguage: r.originalLanguage,
          platformFeedback: r.platformFeedback,
          createdAt: r.createdAt,
          // Para profesionales, el "userName" es el profesional
          userName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
          userAvatar: r.provider?.profile?.avatar || null,
          providerServices: r.provider?.providerProfile?.services || [],
          // Info del cliente que atendió
          clientName: r.client?.profile?.firstName || 'Cliente',
          clientAvatar: r.client?.profile?.avatar || null,
          allPhotos: [],
          hasPlatformFeedback: true
        });
      });

      // Agregar reseñas regulares de clientes (sin fotos ni platformFeedback pero con buen rating)
      regularClientReviews.forEach(r => {
        if (allTestimonialsMap.has(r._id.toString())) return; // Evitar duplicados
        const bookingEvidence = r.booking ? evidenceMap.get(r.booking.toString()) : null;
        allTestimonialsMap.set(r._id.toString(), {
          ...r,
          userRole: 'client',
          type: 'service_review',
          providerName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
          providerAvatar: r.provider?.profile?.avatar || null,
          providerServices: r.provider?.providerProfile?.services || [],
          userName: r.client?.profile?.firstName || 'Cliente',
          userAvatar: r.client?.profile?.avatar || null,
          allPhotos: [
            ...(r.review?.photos || []),
            ...(bookingEvidence || [])
          ],
          hasPlatformFeedback: !!(r.platformFeedback?.rating || r.platformFeedback?.comment)
        });
      });

      const testimonials = Array.from(allTestimonialsMap.values())
        .sort((a, b) => {
          // Priorizar los que tienen fotos
          if (a.allPhotos?.length && !b.allPhotos?.length) return -1;
          if (!a.allPhotos?.length && b.allPhotos?.length) return 1;
          // Priorizar los que tienen platformFeedback
          if (a.hasPlatformFeedback && !b.hasPlatformFeedback) return -1;
          if (!a.hasPlatformFeedback && b.hasPlatformFeedback) return 1;
          // Luego por rating
          return (b.rating?.overall || b.platformFeedback?.rating || 0) - (a.rating?.overall || a.platformFeedback?.rating || 0);
        })
        .slice(0, lim);

      // =====================================================
      // GALERÍA DE TRABAJOS REALIZADOS - FUENTES MÚLTIPLES
      // =====================================================
      
      // Mapeo de prioridad de planes para ordenamiento
      const planPriority = { pro: 3, basic: 2, free: 1 };
      
      // Array para almacenar todos los archivos de trabajo
      const allWorkMedia = [];

      // 1. FOTOS DE RESEÑAS DE CLIENTES (source: 'client_review')
      testimonials.forEach(t => {
        if (t.allPhotos?.length && t.userRole === 'client') {
          t.allPhotos.slice(0, 4).forEach(photo => {
            allWorkMedia.push({
              url: photo.url,
              cloudinaryId: photo.cloudinaryId,
              type: photo.type || 'image', // Para detectar videos
              source: 'client_review',
              sourceLabel: { es: 'Reseña de cliente', en: 'Client review' },
              reviewId: t._id,
              rating: t.rating?.overall || t.platformFeedback?.rating || 0,
              providerName: t.providerName,
              providerAvatar: t.providerAvatar,
              providerId: t.provider?._id,
              providerPlan: 'free', // Las reseñas no tienen plan directo
              userName: t.userName,
              userAvatar: t.userAvatar,
              userRole: t.userRole,
              category: t.providerServices?.[0]?.category || 'Reparaciones',
              caption: photo.description || null,
              createdAt: t.createdAt
            });
          });
        }
      });

      // 2. FOTOS DE RESEÑAS DE PROFESIONALES (source: 'provider_review')
      testimonials.forEach(t => {
        if (t.allPhotos?.length && t.userRole === 'provider') {
          t.allPhotos.slice(0, 4).forEach(photo => {
            allWorkMedia.push({
              url: photo.url,
              cloudinaryId: photo.cloudinaryId,
              type: photo.type || 'image',
              source: 'provider_review',
              sourceLabel: { es: 'Reseña de profesional', en: 'Professional review' },
              reviewId: t._id,
              rating: t.rating?.overall || t.platformFeedback?.rating || 0,
              providerName: t.userName,
              providerAvatar: t.userAvatar,
              providerId: t.provider?._id,
              providerPlan: 'free',
              userName: t.clientName,
              userAvatar: t.clientAvatar,
              userRole: t.userRole,
              category: t.providerServices?.[0]?.category || 'Reparaciones',
              caption: photo.description || null,
              createdAt: t.createdAt
            });
          });
        }
      });

      // 3. PORTAFOLIO DE PROFESIONALES DESTACADOS (source: 'portfolio')
      const providersWithPortfolio = await Provider.find({
        isActive: true,
        'providerProfile.portfolio.0': { $exists: true },
        'providerProfile.rating.average': { $gte: 1 }
      })
      .sort({ 
        'subscription.plan': -1, 
        'providerProfile.rating.average': -1,
        'score.total': -1 
      })
      .limit(20)
      .select({
        'profile.firstName': 1,
        'profile.avatar': 1,
        'providerProfile.businessName': 1,
        'providerProfile.portfolio': 1,
        'providerProfile.services': 1,
        'providerProfile.rating': 1,
        'subscription.plan': 1,
        'score.total': 1
      })
      .lean();

      providersWithPortfolio.forEach(provider => {
        const portfolio = provider.providerProfile?.portfolio || [];
        const plan = provider.subscription?.plan || 'free';
        const rating = provider.providerProfile?.rating?.average || 0;
        
        portfolio.slice(0, 6).forEach(item => {
          allWorkMedia.push({
            url: item.url,
            cloudinaryId: item.cloudinaryId,
            type: item.type || 'image',
            source: 'portfolio',
            sourceLabel: { es: 'Portafolio del profesional', en: 'Professional portfolio' },
            reviewId: null,
            rating: rating,
            providerName: provider.providerProfile?.businessName || provider.profile?.firstName || 'Profesional',
            providerAvatar: provider.profile?.avatar || null,
            providerId: provider._id,
            providerPlan: plan,
            userName: null,
            userAvatar: null,
            userRole: 'provider',
            category: item.category || provider.providerProfile?.services?.[0]?.category || 'Reparaciones',
            caption: item.caption || null,
            createdAt: item.uploadedAt || new Date()
          });
        });
      });

      // 4. EVIDENCIAS DE TRABAJOS COMPLETADOS (source: 'service_evidence')
      const completedBookingsWithEvidence = await Booking.find({
        status: 'completed',
        $or: [
          { 'serviceEvidence.before.0': { $exists: true } },
          { 'serviceEvidence.during.0': { $exists: true } },
          { 'serviceEvidence.after.0': { $exists: true } }
        ]
      })
      .sort({ createdAt: -1 })
      .limit(30)
      .select({
        'serviceEvidence': 1,
        'provider': 1,
        'createdAt': 1
      })
      .populate('provider', 'profile.firstName profile.avatar providerProfile.businessName providerProfile.services providerProfile.rating subscription.plan')
      .lean();

      completedBookingsWithEvidence.forEach(booking => {
        const provider = booking.provider;
        if (!provider) return;
        
        const plan = provider.subscription?.plan || 'free';
        const rating = provider.providerProfile?.rating?.average || 0;
        const allEvidence = [
          ...(booking.serviceEvidence?.before || []).map(e => ({ ...e, phase: 'before' })),
          ...(booking.serviceEvidence?.during || []).map(e => ({ ...e, phase: 'during' })),
          ...(booking.serviceEvidence?.after || []).map(e => ({ ...e, phase: 'after' }))
        ].filter(e => e.url);

        allEvidence.slice(0, 4).forEach(evidence => {
          allWorkMedia.push({
            url: evidence.url,
            cloudinaryId: evidence.cloudinaryId,
            type: evidence.url?.includes('/video/') ? 'video' : 'image',
            source: 'service_evidence',
            sourceLabel: { es: 'Evidencia del trabajo', en: 'Work evidence' },
            evidencePhase: evidence.phase,
            reviewId: null,
            rating: rating,
            providerName: provider.providerProfile?.businessName || provider.profile?.firstName || 'Profesional',
            providerAvatar: provider.profile?.avatar || null,
            providerId: provider._id,
            providerPlan: plan,
            userName: null,
            userAvatar: null,
            userRole: 'provider',
            category: provider.providerProfile?.services?.[0]?.category || 'Reparaciones',
            caption: evidence.description || null,
            createdAt: evidence.uploadedAt || booking.createdAt
          });
        });
      });

      // ORDENAR TODOS LOS ARCHIVOS: rating → plan (pro>basic>free) → fecha
      allWorkMedia.sort((a, b) => {
        // 1. Por rating (mayor primero)
        const ratingDiff = (b.rating || 0) - (a.rating || 0);
        if (ratingDiff !== 0) return ratingDiff;
        
        // 2. Por plan (pro > basic > free)
        const planDiff = (planPriority[b.providerPlan] || 1) - (planPriority[a.providerPlan] || 1);
        if (planDiff !== 0) return planDiff;
        
        // 3. Por fecha (más reciente primero)
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      // Deduplicar por URL
      const seenUrls = new Set();
      const uniqueWorkMedia = allWorkMedia.filter(item => {
        if (seenUrls.has(item.url)) return false;
        seenUrls.add(item.url);
        return true;
      });

      // Mantener compatibilidad con formato anterior para workPhotos
      const workPhotos = uniqueWorkMedia.slice(0, 40).map(item => ({
        ...item,
        // Campos legacy para compatibilidad
        reviewId: item.reviewId,
        rating: item.rating,
        providerName: item.providerName,
        userName: item.userName,
        userRole: item.userRole,
        category: item.category
      }));

      console.log(`✅ Returning ${testimonials.length} testimonials with ${workPhotos.length} work media (reviews: ${allWorkMedia.filter(m => m.source.includes('review')).length}, portfolio: ${allWorkMedia.filter(m => m.source === 'portfolio').length}, evidence: ${allWorkMedia.filter(m => m.source === 'service_evidence').length})`);

      res.json({
        success: true,
        data: { 
          testimonials,
          workPhotos,
          total: testimonials.length
        }
      });
    } catch (error) {
      console.error('GuestController - getFeaturedTestimonials error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get testimonials'
      });
    }
  }

  /**
   * Obtener servicios activos (categorías con proveedores)
   */
  async getActiveServices(req, res) {
    try {
      const Provider = (await import('../models/User/Provider.js')).default;
      const { SERVICE_CATEGORIES_WITH_DESCRIPTION } = await import('../config/categories.js');

      // Obtener categorías con proveedores activos - consulta más flexible
      const providers = await Provider.find({
        isActive: true,
        'providerProfile.services': { $exists: true, $ne: [] }
      }).select('providerProfile.services subscription.status').lean();

      console.log(`📊 Found ${providers.length} providers in database`);

      // Total de proveedores únicos
      const totalUniqueProviders = providers.length;

      // Contar clientes activos para las estadísticas del hero
      const totalClients = await Client.countDocuments({ isActive: true });
      console.log(`👥 Found ${totalClients} active clients`);

      // Contar proveedores por categoría - SOLO por servicio principal (primer elemento)
      const categoryCounts = {};
      providers.forEach(p => {
        if (p.providerProfile?.services && Array.isArray(p.providerProfile.services) && p.providerProfile.services.length > 0) {
          // Solo contar el primer servicio (servicio principal)
          const mainService = p.providerProfile.services[0];
          if (mainService?.category) {
            categoryCounts[mainService.category] = (categoryCounts[mainService.category] || 0) + 1;
          }
        }
      });

      console.log('📋 Category counts (by main service):', categoryCounts);

      // Filtrar categorías con descripción y agregar conteo
      const services = SERVICE_CATEGORIES_WITH_DESCRIPTION
        .filter(cat => categoryCounts[cat.value] > 0)
        .map(cat => ({
          category: cat.value,
          description: cat.description,
          providerCount: categoryCounts[cat.value]
        }))
        .sort((a, b) => b.providerCount - a.providerCount); // Ordenar por cantidad de proveedores

      console.log(`✅ Returning ${services.length} active service categories with ${totalUniqueProviders} unique providers and ${totalClients} clients`);

      res.json({
        success: true,
        data: { 
          services,
          totalUniqueProviders,
          totalClients
        }
      });
    } catch (error) {
      console.error('GuestController - getActiveServices error:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({
        success: false,
        message: 'Failed to get active services'
      });
    }
  }

  /**
   * Obtener datos de sesión guest
   */
  async getGuestSession(req, res) {
    try {
      if (!req.session) {
        return res.status(400).json({
          success: false,
          message: 'No active session'
        });
      }

      const session = await Session.findById(req.session._id)
        .populate('guestData.serviceRequests');

      res.json({
        success: true,
        data: {
          session: {
            sessionId: session.sessionId,
            userType: session.userType,
            guestData: session.guestData,
            lastActivity: session.lastActivity
          }
        }
      });
    } catch (error) {
      console.error('GuestController - getGuestSession error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get session data'
      });
    }
  }

  /**
   * Actualizar datos de contacto temporal para guest
   */
  async updateGuestContact(req, res) {
    try {
      const { email, phone, firstName, lastName } = req.body;

      if (!req.session) {
        return res.status(400).json({
          success: false,
          message: 'No active session'
        });
      }

      const session = await Session.findByIdAndUpdate(
        req.session._id,
        {
          $set: {
            'guestData.email': email,
            'guestData.phone': phone,
            'guestData.temporaryContact': {
              firstName,
              lastName,
              phone
            }
          }
        },
        { new: true }
      );

      res.json({
        success: true,
        message: 'Guest contact updated successfully',
        data: {
          guestData: session.guestData
        }
      });
    } catch (error) {
      console.error('GuestController - updateGuestContact error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update guest contact'
      });
    }
  }

  /**
   * Vincular service request a sesión guest
   */
  async linkServiceRequestToGuest(req, res) {
    try {
      const { serviceRequestId } = req.body;

      if (!req.session) {
        return res.status(400).json({
          success: false,
          message: 'No active session'
        });
      }

      const session = await Session.findByIdAndUpdate(
        req.session._id,
        {
          $addToSet: {
            'guestData.serviceRequests': serviceRequestId
          }
        },
        { new: true }
      );

      // También actualizar el service request con el sessionId
      await ServiceRequest.findByIdAndUpdate(serviceRequestId, {
        $set: { guestSessionId: req.session.sessionId }
      });

      res.json({
        success: true,
        message: 'Service request linked to guest session',
        data: {
          linkedRequests: session.guestData.serviceRequests
        }
      });
    } catch (error) {
      console.error('GuestController - linkServiceRequestToGuest error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to link service request'
      });
    }
  }

  /**
   * Migrar datos de guest a usuario registrado
   */
  async migrateGuestToUser(req, res) {
    try {
      const { sessionId, targetUserId } = req.body;

      const session = await Session.findOne({ sessionId });
      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Guest session not found'
        });
      }

      // Transferir service requests
      if (session.guestData.serviceRequests?.length > 0) {
        await ServiceRequest.updateMany(
          {
            _id: { $in: session.guestData.serviceRequests },
            client: { $exists: false }
          },
          {
            $set: { 
              client: targetUserId,
              guestSessionId: null 
            }
          }
        );

        // Actualizar historial del cliente
        await Client.findByIdAndUpdate(targetUserId, {
          $addToSet: {
            'clientProfile.serviceHistory': {
              $each: session.guestData.serviceRequests
            }
          }
        });
      }

      // Eliminar sesión guest
      await Session.deleteOne({ _id: session._id });

      res.json({
        success: true,
        message: 'Guest data migrated successfully',
        data: {
          migratedRequests: session.guestData.serviceRequests?.length || 0
        }
      });
    } catch (error) {
      console.error('GuestController - migrateGuestToUser error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to migrate guest data'
      });
    }
  }

  /**
   * Obtener perfil público de un proveedor por ID
   * Incluye portafolio completo para mostrar en modal de perfil
   */
  async getProviderById(req, res) {
    try {
      const { providerId } = req.params;
      const Provider = (await import('../models/User/Provider.js')).default;
      const Review = (await import('../models/Service/Review.js')).default;

      const provider = await Provider.findById(providerId)
        .select({
          email: 1,
          'profile.firstName': 1,
          'profile.avatar': 1,
          'providerProfile.businessName': 1,
          'providerProfile.description': 1,
          'providerProfile.businessDescription': 1,
          'providerProfile.rating.average': 1,
          'providerProfile.rating.count': 1,
          'providerProfile.rating.breakdown': 1,
          'providerProfile.services': 1,
          'providerProfile.additionalServices': 1,
          'providerProfile.portfolio': 1,
          'providerProfile.stats': 1,
          'providerProfile.serviceArea.address': 1,
          'providerProfile.serviceArea.zones': 1,
          'subscription.plan': 1,
          'subscription.status': 1,
          createdAt: 1
        })
        .lean();

      if (!provider) {
        return res.status(404).json({
          success: false,
          message: 'Provider not found'
        });
      }

      // Obtener reseñas recientes del proveedor
      const reviews = await Review.find({
        provider: providerId,
        status: 'active'
      })
      .sort({ createdAt: -1 })
      .limit(5)
      .select({
        'rating.overall': 1,
        'rating.categories': 1,
        'review.comment': 1,
        'review.title': 1,
        'translations': 1,
        'originalLanguage': 1,
        createdAt: 1
      })
      .populate('client', 'profile.firstName profile.avatar')
      .lean();

      res.json({
        success: true,
        data: {
          provider: {
            ...provider,
            recentReviews: reviews
          }
        }
      });
    } catch (error) {
      console.error('GuestController - getProviderById error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get provider profile'
      });
    }
  }

  /**
   * Obtener reels (solo videos de portfolio de profesionales) — endpoint público
   * Retorna videos ordenados por rating → plan → fecha, con datos del profesional
   */
  async getReels(req, res) {
    try {
      const Provider = (await import('../models/User/Provider.js')).default;

      const planPriority = { pro: 3, basic: 2, free: 1 };

      // Buscar proveedores activos que tengan videos en su portfolio
      const providersWithVideos = await Provider.find({
        isActive: true,
        'providerProfile.portfolio': {
          $elemMatch: { type: 'video' }
        }
      })
      .sort({
        'subscription.plan': -1,
        'providerProfile.rating.average': -1,
        'score.total': -1
      })
      .limit(30)
      .select({
        'profile.firstName': 1,
        'profile.avatar': 1,
        'providerProfile.businessName': 1,
        'providerProfile.portfolio': 1,
        'providerProfile.services': 1,
        'providerProfile.rating': 1,
        'subscription.plan': 1,
        'score.total': 1
      })
      .lean();

      // Extraer solo los videos de cada portfolio
      const reels = [];
      providersWithVideos.forEach(provider => {
        const portfolio = provider.providerProfile?.portfolio || [];
        const plan = provider.subscription?.plan || 'free';
        const rating = provider.providerProfile?.rating?.average || 0;

        portfolio
          .filter(item => item.type === 'video')
          .forEach(item => {
            reels.push({
              _id: item._id?.toString() || `${provider._id}-${item.url}`,
              url: item.url,
              cloudinaryId: item.cloudinaryId,
              type: 'video',
              caption: item.caption || null,
              category: item.category || provider.providerProfile?.services?.[0]?.category || null,
              providerName: provider.providerProfile?.businessName || provider.profile?.firstName || 'Profesional',
              providerAvatar: provider.profile?.avatar || null,
              providerId: provider._id,
              providerPlan: plan,
              rating: rating,
              uploadedAt: item.uploadedAt || new Date()
            });
          });
      });

      // Ordenar: rating (desc) → plan (pro>basic>free) → fecha (reciente primero)
      reels.sort((a, b) => {
        const ratingDiff = (b.rating || 0) - (a.rating || 0);
        if (ratingDiff !== 0) return ratingDiff;
        const planDiff = (planPriority[b.providerPlan] || 1) - (planPriority[a.providerPlan] || 1);
        if (planDiff !== 0) return planDiff;
        return new Date(b.uploadedAt) - new Date(a.uploadedAt);
      });

      console.log(`🎬 Returning ${reels.length} reels from ${providersWithVideos.length} providers`);

      res.json({
        success: true,
        data: {
          reels,
          total: reels.length
        }
      });
    } catch (error) {
      console.error('GuestController - getReels error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get reels'
      });
    }
  }

  /**
   * Obtener pares Antes/Después de bookings completados — endpoint público
   * Devuelve pares agrupados por booking con info del proveedor
   */
  async getBeforeAfterPairs(req, res) {
    try {
      const Booking = (await import('../models/Service/Booking.js')).default;
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);

      const bookings = await Booking.find({
        status: 'completed',
        'serviceEvidence.before.0': { $exists: true },
        'serviceEvidence.after.0': { $exists: true }
      })
      .sort({ completedAt: -1, createdAt: -1 })
      .limit(limit)
      .select({
        'serviceEvidence.before': 1,
        'serviceEvidence.after': 1,
        'provider': 1,
        'serviceRequest': 1,
        'createdAt': 1,
        'completedAt': 1
      })
      .populate('provider', 'profile.firstName profile.avatar providerProfile.businessName providerProfile.services providerProfile.rating subscription.plan')
      .populate('serviceRequest', 'category description')
      .lean();

      const pairs = bookings
        .filter(b => b.provider && b.serviceEvidence?.before?.length > 0 && b.serviceEvidence?.after?.length > 0)
        .map(booking => {
          const provider = booking.provider;
          const beforeImg = booking.serviceEvidence.before.find(e => e.url && !e.url.includes('/video/')) || booking.serviceEvidence.before[0];
          const afterImg = booking.serviceEvidence.after.find(e => e.url && !e.url.includes('/video/')) || booking.serviceEvidence.after[0];

          if (!beforeImg?.url || !afterImg?.url) return null;

          return {
            id: booking._id,
            before: { url: beforeImg.url, description: beforeImg.description || null },
            after: { url: afterImg.url, description: afterImg.description || null },
            category: booking.serviceRequest?.category || provider.providerProfile?.services?.[0]?.category || 'general',
            description: booking.serviceRequest?.description || null,
            providerName: provider.providerProfile?.businessName || provider.profile?.firstName || 'Profesional',
            providerAvatar: provider.profile?.avatar || null,
            providerId: provider._id,
            providerPlan: provider.subscription?.plan || 'free',
            rating: provider.providerProfile?.rating?.average || 0,
            completedAt: booking.completedAt || booking.createdAt
          };
        })
        .filter(Boolean);

      console.log(`📸 Returning ${pairs.length} before/after pairs from ${bookings.length} completed bookings`);

      res.json({
        success: true,
        data: { pairs, total: pairs.length }
      });
    } catch (error) {
      console.error('GuestController - getBeforeAfterPairs error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get before/after pairs'
      });
    }
  }
}

const guestController = new GuestController();
export default guestController;