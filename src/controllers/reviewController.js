// controllers/reviewController.js
import Review from '../models/Service/Review.js';
import ClientReview from '../models/Service/ClientReview.js';
import Booking from '../models/Service/Booking.js';
import Provider from '../models/User/Provider.js';
import scoringService from '../services/internal/scoringService.js';
import translationService from '../services/external/translationService.js';

class ReviewController {
  sanitizeText(text, { max = 1000 } = {}) {
    if (!text) return '';
    // Strip HTML tags
    let t = String(text).replace(/<[^>]*>/g, '');
    // Collapse whitespace
    t = t.replace(/\s+/g, ' ').trim();
    // Truncate
    if (t.length > max) t = t.slice(0, max);
    return t;
  }

  containsProfanity(text) {
    if (!text) return false;
    const bad = /(\bshit\b|\bfuck\b|\basshole\b|\bpendejo\b|\bidiota\b|\bmierda\b)/i;
    return bad.test(text);
  }
  /**
   * Crear review para un servicio completado
   * Incluye calificación del profesional y opcionalmente feedback sobre la plataforma
   */
  async createReview(req, res) {
    try {
      const { bookingId } = req.params;
      const { overall, categories, title, comment, photos, platformFeedback } = req.body;

      // Verificar que el booking existe y pertenece al cliente
      const booking = await Booking.findOne({
        _id: bookingId,
        client: req.user._id,
        status: 'completed'
      }).populate('provider');

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found or not authorized'
        });
      }

      // Verificar que no existe ya una review para este booking
      const existingReview = await Review.findOne({ booking: bookingId });
      if (existingReview) {
        return res.status(400).json({
          success: false,
          message: 'Review already exists for this booking'
        });
      }

      // Usar el overall como fallback para categorías no proporcionadas
      const safeCategories = categories || {};
      
      const reviewData = {
        booking: bookingId,
        client: req.user._id,
        provider: booking.provider._id,
        rating: {
          overall,
          categories: {
            professionalism: safeCategories.professionalism || overall,
            quality: safeCategories.quality || overall,
            punctuality: safeCategories.punctuality || overall,
            communication: safeCategories.communication || overall,
            value: safeCategories.value || overall
          }
        },
        review: {
          title,
          comment,
          photos: photos || []
        },
        status: 'active'
      };

      // Agregar feedback de plataforma si fue proporcionado
      if (platformFeedback && (platformFeedback.rating || platformFeedback.comment)) {
        reviewData.platformFeedback = {
          rating: platformFeedback.rating || null,
          comment: platformFeedback.comment || '',
          wouldRecommend: platformFeedback.wouldRecommend ?? true
        };

        // Traducir comentario de platformFeedback si existe
        if (platformFeedback.comment) {
          try {
            const pfOriginalLang = translationService.detectLanguage(platformFeedback.comment);
            const pfTranslations = await translationService.generateTranslations(
              { comment: platformFeedback.comment },
              pfOriginalLang
            );
            if (pfTranslations) {
              reviewData.platformFeedback.translations = pfTranslations;
            }
          } catch (pfTranslationError) {
            console.warn('[ReviewController] Platform feedback translation failed:', pfTranslationError.message);
          }
        }
      }

      const review = new Review(reviewData);

      // Generar traducciones del título y comentario ANTES de guardar
      try {
        const textToTranslate = { title: title || '', comment };
        const originalLang = translationService.detectLanguage(comment || title);
        const translations = await translationService.generateTranslations(
          textToTranslate,
          originalLang
        );
        if (translations) {
          review.translations = translations;
          review.originalLanguage = originalLang;
        }
      } catch (translationError) {
        console.warn('[ReviewController] Translation failed:', translationError.message);
      }

      await review.save();

      // Actualizar rating del proveedor
      await this.updateProviderRating(booking.provider._id);

      // Recalcular score del proveedor
      await scoringService.calculateProviderScore(booking.provider._id);

      // Verificar milestones de reseñas (primera reseña, 3 reseñas → días Experto gratis)
      try {
        const subscriptionService = (await import('../services/internal/subscriptionService.js')).default;
        await subscriptionService.checkReviewMilestones(booking.provider._id);
      } catch (milestoneErr) {
        console.warn('[ReviewController] Milestone check failed:', milestoneErr.message);
      }

      // Notificar al proveedor
  const notificationService = (await import('../services/external/notificationService.js')).default;
  await notificationService.sendProviderNotification({
        providerId: booking.provider._id,
        type: 'NEW_REVIEW',
        data: {
          reviewId: review._id,
          rating: overall,
          clientName: req.user.profile.firstName
        }
      });

      // Programar nudge de respuesta al proveedor (48h después si no responde)
      this.scheduleResponseNudge(review._id, booking.provider._id);

      res.status(201).json({
        success: true,
        message: 'Review created successfully',
        data: { review }
      });
    } catch (error) {
      console.error('ReviewController - createReview error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create review'
      });
    }
  }

  /**
   * Obtener reviews de un proveedor con filtros avanzados
   */
  async getProviderReviews(req, res) {
    try {
      const { providerId } = req.params;
      const { 
        page = 1, 
        limit = 10, 
        rating, 
        sort = 'recent',
        dateFilter,
        verified,
        withPhotos
      } = req.query;

      // Build query
      let query = { provider: providerId, status: 'active' };
      
      // Rating filter
      if (rating) {
        query['rating.overall'] = parseInt(rating);
      }
      
      // Date filter
      if (dateFilter) {
        const now = new Date();
        let startDate;
        
        switch (dateFilter) {
          case 'week':
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
          case 'month':
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            break;
          case 'quarter':
            startDate = new Date(now.setMonth(now.getMonth() - 3));
            break;
          case 'year':
            startDate = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
        }
        
        if (startDate) {
          query.createdAt = { $gte: startDate };
        }
      }
      
      // Verified purchase filter
      if (verified === 'true') {
        query['metadata.verifiedPurchase'] = true;
      }
      
      // With photos filter
      if (withPhotos === 'true') {
        query['review.photos'] = { $exists: true, $ne: [] };
      }

      // Build sort
      let sortOptions = { createdAt: -1 }; // default: recent
      
      switch (sort) {
        case 'oldest':
          sortOptions = { createdAt: 1 };
          break;
        case 'highest':
          sortOptions = { 'rating.overall': -1, createdAt: -1 };
          break;
        case 'lowest':
          sortOptions = { 'rating.overall': 1, createdAt: -1 };
          break;
        case 'helpful':
          sortOptions = { 'helpfulness.helpful': -1, createdAt: -1 };
          break;
      }

      const reviews = await Review.find(query)
        .populate('client', 'profile')
        .sort(sortOptions)
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await Review.countDocuments(query);

      // Calcular estadísticas de rating
      const ratingStats = await this.calculateRatingStats(providerId);

      res.json({
        success: true,
        data: {
          reviews,
          ratingStats,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error('ReviewController - getProviderReviews error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get reviews'
      });
    }
  }

  /**
   * Obtener la review asociada a un booking específico
   */
  async getReviewByBooking(req, res) {
    try {
      const { bookingId } = req.params;

      const review = await Review.findOne({ booking: bookingId })
        .populate('client', 'profile')
        .lean();

      if (!review) {
        return res.json({ success: true, data: { review: null } });
      }

      res.json({ success: true, data: { review } });
    } catch (error) {
      console.error('ReviewController - getReviewByBooking error:', error);
      res.status(500).json({ success: false, message: 'Failed to get review' });
    }
  }

  /**
   * Responder a una review (proveedor)
   */
  async respondToReview(req, res) {
    try {
      const { reviewId } = req.params;
      const rawComment = req.body?.comment;
      const comment = this.sanitizeText(rawComment, { max: 800 });
      if (!comment || comment.length < 3) {
        return res.status(400).json({ success: false, message: 'Comment too short' });
      }

      const review = await Review.findOne({
        _id: reviewId,
        provider: req.user._id
      });

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found or not authorized'
        });
      }

      review.providerResponse = {
        comment,
        respondedAt: new Date()
      };

      // Moderation pre-flag if profanity detected (soft flag)
      if (this.containsProfanity(comment)) {
        review.moderation.flagged = true;
        review.moderation.flaggedBy = 'system';
        review.moderation.flagReason = 'Profanity detected in provider response';
        review.status = 'flagged';
      }

      // Generar traducción de la respuesta del proveedor ANTES de guardar
      try {
        const originalLang = translationService.detectLanguage(comment);
        const translations = await translationService.generateTranslations(
          { providerResponseComment: comment },
          originalLang
        );
        if (translations) {
          // Merge con traducciones existentes
          if (!review.translations) review.translations = { es: {}, en: {} };
          review.translations.es.providerResponseComment = translations.es.providerResponseComment;
          review.translations.en.providerResponseComment = translations.en.providerResponseComment;
        }
      } catch (translationError) {
        console.warn('[ReviewController] Provider response translation failed:', translationError.message);
      }

      await review.save();

      // Notificar al cliente
  const notificationService = (await import('../services/external/notificationService.js')).default;
  await notificationService.sendClientNotification({
        clientId: review.client,
        type: 'REVIEW_RESPONSE',
        data: {
          reviewId: review._id,
          providerName: req.user.providerProfile.businessName
        }
      });

      res.json({
        success: true,
        message: 'Response added successfully',
        data: { review }
      });
    } catch (error) {
      console.error('ReviewController - respondToReview error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to respond to review'
      });
    }
  }

  /**
   * Editar respuesta a una review (proveedor)
   */
  async updateReviewResponse(req, res) {
    try {
      const { reviewId } = req.params;
      const rawComment = req.body?.comment;
      const comment = this.sanitizeText(rawComment, { max: 800 });
      if (!comment || comment.length < 3) {
        return res.status(400).json({ success: false, message: 'Comment too short' });
      }

      const review = await Review.findOne({
        _id: reviewId,
        provider: req.user._id
      });

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found or not authorized'
        });
      }

      if (!review.providerResponse || !review.providerResponse.comment) {
        return res.status(400).json({
          success: false,
          message: 'No existing response to update'
        });
      }

      review.providerResponse.comment = comment;
      review.providerResponse.editedAt = new Date();

      // Moderation pre-flag if profanity detected
      if (this.containsProfanity(comment)) {
        review.moderation.flagged = true;
        review.moderation.flaggedBy = 'system';
        review.moderation.flagReason = 'Profanity detected in provider response';
        review.status = 'flagged';
      }

      await review.save();

      // Notificar al cliente de actualización de respuesta
      const notificationService = (await import('../services/external/notificationService.js')).default;
      await notificationService.sendClientNotification({
        clientId: review.client,
        type: 'REVIEW_RESPONSE_UPDATED',
        data: {
          reviewId: review._id,
          providerName: req.user.providerProfile.businessName
        }
      });

      res.json({
        success: true,
        message: 'Response updated successfully',
        data: { review }
      });
    } catch (error) {
      console.error('ReviewController - updateReviewResponse error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update review response'
      });
    }
  }

  /**
   * Eliminar respuesta a una review (proveedor)
   */
  async deleteReviewResponse(req, res) {
    try {
      const { reviewId } = req.params;

      const review = await Review.findOne({
        _id: reviewId,
        provider: req.user._id
      });

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found or not authorized'
        });
      }

      if (!review.providerResponse || !review.providerResponse.comment) {
        return res.status(400).json({
          success: false,
          message: 'No response to delete'
        });
      }

      review.providerResponse = undefined;
      await review.save();

      // Notificar al cliente opcionalmente
      const notificationService = (await import('../services/external/notificationService.js')).default;
      await notificationService.sendClientNotification({
        clientId: review.client,
        type: 'REVIEW_RESPONSE_REMOVED',
        data: {
          reviewId: review._id,
          providerName: req.user.providerProfile.businessName
        }
      });

      res.json({
        success: true,
        message: 'Response deleted successfully'
      });
    } catch (error) {
      console.error('ReviewController - deleteReviewResponse error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete review response'
      });
    }
  }

  /**
   * Reportar review inapropiada
   */
  async reportReview(req, res) {
    try {
      const { reviewId } = req.params;
      const { reason } = req.body;

      const review = await Review.findById(reviewId);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found'
        });
      }

      review.moderation.flagged = true;
      review.moderation.flaggedBy = 'user';
      review.moderation.flagReason = reason;
      review.status = 'flagged';

      await review.save();

      // Notificar a administradores
  const adminController = (await import('./adminController.js')).default;
  await adminController.notifyModerators({
        type: 'REVIEW_FLAGGED',
        data: {
          reviewId: review._id,
          reporter: req.user._id,
          reason
        }
      });

      res.json({
        success: true,
        message: 'Review reported successfully'
      });
    } catch (error) {
      console.error('ReviewController - reportReview error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to report review'
      });
    }
  }

  /**
   * Actualizar rating del proveedor
   */
  async updateProviderRating(providerId) {
    try {
      const reviews = await Review.find({ 
        provider: providerId, 
        status: 'active' 
      });

      if (reviews.length === 0) return;

      const overallSum = reviews.reduce((sum, review) => sum + review.rating.overall, 0);
      const overallAvg = overallSum / reviews.length;

      // Calcular promedios por categoría (usar overall como fallback si la categoría es 0)
      const categories = ['professionalism', 'quality', 'punctuality', 'communication', 'value'];
      const categoryAverages = {};

      categories.forEach(category => {
        const sum = reviews.reduce((sum, review) => {
          // Si la categoría es 0 o undefined, usar el overall como fallback
          const categoryValue = review.rating.categories?.[category] || review.rating.overall;
          return sum + categoryValue;
        }, 0);
        categoryAverages[category] = Math.round((sum / reviews.length) * 10) / 10;
      });

      await Provider.findByIdAndUpdate(providerId, {
        $set: {
          'providerProfile.rating': {
            average: Math.round(overallAvg * 10) / 10, // 1 decimal
            count: reviews.length,
            breakdown: categoryAverages
          }
        }
      });
    } catch (error) {
      console.error('ReviewController - updateProviderRating error:', error);
    }
  }

  /**
   * Calcular estadísticas de rating
   */
  async calculateRatingStats(providerId) {
    const reviews = await Review.find({ provider: providerId, status: 'active' });
    
    if (reviews.length === 0) {
      return {
        average: 0,
        count: 0,
        distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
      };
    }

    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    
    reviews.forEach(review => {
      const rating = Math.round(review.rating.overall);
      distribution[rating] = (distribution[rating] || 0) + 1;
    });

    // Convertir a porcentajes
    Object.keys(distribution).forEach(rating => {
      distribution[rating] = Math.round((distribution[rating] / reviews.length) * 100);
    });

    const average = reviews.reduce((sum, review) => sum + review.rating.overall, 0) / reviews.length;

    // Calculate category averages
    const categories = ['professionalism', 'quality', 'punctuality', 'communication', 'value'];
    const categoryAverages = {};
    
    categories.forEach(cat => {
      const sum = reviews.reduce((s, r) => s + (r.rating?.categories?.[cat] || 0), 0);
      categoryAverages[cat] = reviews.length > 0 ? Math.round((sum / reviews.length) * 10) / 10 : 0;
    });

    return {
      averageRating: Math.round(average * 10) / 10,
      totalReviews: reviews.length,
      breakdown: distribution,
      categories: categoryAverages
    };
  }

  /**
   * Votar review como útil o no útil
   */
  async voteHelpful(req, res) {
    try {
      const { reviewId } = req.params;
      const { action } = req.body; // 'helpful' | 'notHelpful' | 'remove'

      if (!['helpful', 'notHelpful', 'remove'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Use helpful, notHelpful, or remove'
        });
      }

      const review = await Review.findById(reviewId);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found'
        });
      }

      // Initialize helpfulness if not exists
      if (!review.helpfulness) {
        review.helpfulness = { helpful: 0, notHelpful: 0, reported: 0 };
      }

      // For simplicity, we just increment/decrement counters
      // In a production app, you'd track which users voted to prevent double voting
      switch (action) {
        case 'helpful':
          review.helpfulness.helpful = (review.helpfulness.helpful || 0) + 1;
          break;
        case 'notHelpful':
          review.helpfulness.notHelpful = (review.helpfulness.notHelpful || 0) + 1;
          break;
        case 'remove':
          // Remove vote (would need user tracking in production)
          break;
      }

      await review.save();

      res.json({
        success: true,
        message: 'Vote recorded',
        data: {
          helpfulness: review.helpfulness
        }
      });
    } catch (error) {
      console.error('ReviewController - voteHelpful error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to record vote'
      });
    }
  }

  /**
   * Proveedor califica al cliente después de un servicio completado
   * Incluye opcionalmente feedback sobre la plataforma NovoFix
   */
  async createClientReview(req, res) {
    try {
      const { bookingId } = req.params;
      const { overall, categories, comment, platformFeedback } = req.body;

      // Verificar que el booking existe y pertenece al proveedor
      const booking = await Booking.findOne({
        _id: bookingId,
        provider: req.user._id,
        status: 'completed'
      }).populate('client');

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found or not authorized'
        });
      }

      // Verificar que no existe ya una client review para este booking
      const existingReview = await ClientReview.findOne({ booking: bookingId });
      if (existingReview) {
        return res.status(400).json({
          success: false,
          message: 'Client review already exists for this booking'
        });
      }

      // Usar el overall como fallback para categorías no proporcionadas
      const safeCategories = categories || {};
      
      const reviewData = {
        booking: bookingId,
        provider: req.user._id,
        client: booking.client._id,
        rating: {
          overall,
          categories: {
            communication: safeCategories.communication || overall,
            punctuality: safeCategories.punctuality || overall,
            respect: safeCategories.respect || overall,
            clarity: safeCategories.clarity || overall,
            payment: safeCategories.payment || overall
          }
        },
        review: {
          comment: comment || ''
        },
        status: 'active'
      };

      // Agregar feedback de plataforma si fue proporcionado
      if (platformFeedback && (platformFeedback.rating || platformFeedback.comment)) {
        const safeAspects = platformFeedback.aspects || {};
        reviewData.platformFeedback = {
          rating: platformFeedback.rating || null,
          comment: platformFeedback.comment || '',
          wouldRecommend: platformFeedback.wouldRecommend ?? true,
          aspects: {
            easeOfUse: safeAspects.easeOfUse || platformFeedback.rating || null,
            clientQuality: safeAspects.clientQuality || platformFeedback.rating || null,
            paymentProcess: safeAspects.paymentProcess || platformFeedback.rating || null,
            support: safeAspects.support || platformFeedback.rating || null
          }
        };

        // Traducir comentario de platformFeedback si existe
        if (platformFeedback.comment) {
          try {
            const pfOriginalLang = translationService.detectLanguage(platformFeedback.comment);
            const pfTranslations = await translationService.generateTranslations(
              { comment: platformFeedback.comment },
              pfOriginalLang
            );
            if (pfTranslations) {
              reviewData.platformFeedback.translations = pfTranslations;
            }
          } catch (pfTranslationError) {
            console.warn('[ReviewController] Platform feedback translation failed:', pfTranslationError.message);
          }
        }
      }

      const clientReview = new ClientReview(reviewData);

      // Generar traducciones del comentario ANTES de guardar
      if (comment) {
        try {
          const originalLang = translationService.detectLanguage(comment);
          const translations = await translationService.generateTranslations(
            { comment },
            originalLang
          );
          if (translations) {
            clientReview.translations = translations;
            clientReview.originalLanguage = originalLang;
          }
        } catch (translationError) {
          console.warn('[ReviewController] Client review translation failed:', translationError.message);
        }
      }

      await clientReview.save();

      // Actualizar rating del cliente (si tenemos esa funcionalidad)
      await this.updateClientRating(booking.client._id);

      // Notificar al cliente
      try {
        const notificationService = (await import('../services/external/notificationService.js')).default;
        await notificationService.sendClientNotification({
          clientId: booking.client._id,
          type: 'NEW_CLIENT_REVIEW',
          data: {
            reviewId: clientReview._id,
            rating: overall,
            providerName: req.user.providerProfile?.businessName || req.user.profile?.firstName
          }
        });
      } catch (notifError) {
        console.warn('[ReviewController] Client notification failed:', notifError.message);
      }

      res.status(201).json({
        success: true,
        message: 'Client review created successfully',
        data: { review: clientReview }
      });
    } catch (error) {
      console.error('ReviewController - createClientReview error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create client review'
      });
    }
  }

  /**
   * Actualizar rating promedio de un cliente
   */
  async updateClientRating(clientId) {
    try {
      const Client = (await import('../models/User/Client.js')).default;
      
      const reviews = await ClientReview.find({
        client: clientId,
        status: 'active'
      });

      if (reviews.length === 0) return;

      const avgRating = reviews.reduce((sum, r) => sum + r.rating.overall, 0) / reviews.length;
      
      await Client.findByIdAndUpdate(clientId, {
        'clientProfile.rating': {
          average: Math.round(avgRating * 10) / 10,
          count: reviews.length
        }
      });
    } catch (error) {
      console.warn('[ReviewController] Failed to update client rating:', error.message);
    }
  }

  /**
   * Obtener reseña del cliente para un booking (proveedor)
   */
  async getClientReviewByBooking(req, res) {
    try {
      const { bookingId } = req.params;
      
      const review = await ClientReview.findOne({ booking: bookingId })
        .populate('client', 'profile.firstName profile.avatar')
        .populate('provider', 'providerProfile.businessName profile.firstName')
        .lean();

      res.json({
        success: true,
        data: { review }
      });
    } catch (error) {
      console.error('ReviewController - getClientReviewByBooking error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get client review'
      });
    }
  }

  /**
   * Verificar si el proveedor ya calificó al cliente
   */
  async checkClientReviewExists(req, res) {
    try {
      const { bookingId } = req.params;
      
      const exists = await ClientReview.exists({ booking: bookingId });

      res.json({
        success: true,
        data: { exists: !!exists }
      });
    } catch (error) {
      console.error('ReviewController - checkClientReviewExists error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check client review'
      });
    }
  }

  /**
   * Obtener bookings completados sin reseña del cliente actual.
   * Usado para mostrar el banner de nudge en el frontend.
   */
  async getPendingReviews(req, res) {
    try {
      const clientId = req.user._id;

      // Bookings completados de este cliente
      const completedBookings = await Booking.find({
        client: clientId,
        status: 'completed'
      })
        .select('_id provider schedule.scheduledDate')
        .populate('provider', 'providerProfile.businessName providerProfile.avatar profile.firstName')
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean();

      if (!completedBookings.length) {
        return res.json({ success: true, data: { pendingReviews: [] } });
      }

      // Filtrar los que ya tienen reseña
      const bookingIds = completedBookings.map(b => b._id);
      const existingReviews = await Review.find({ booking: { $in: bookingIds } })
        .select('booking')
        .lean();
      const reviewedBookingIds = new Set(existingReviews.map(r => r.booking.toString()));

      const pendingReviews = completedBookings
        .filter(b => !reviewedBookingIds.has(b._id.toString()))
        .map(b => ({
          bookingId: b._id,
          providerName: b.provider?.providerProfile?.businessName || b.provider?.profile?.firstName || '',
          providerAvatar: b.provider?.providerProfile?.avatar || '',
          scheduledDate: b.schedule?.scheduledDate
        }));

      res.json({ success: true, data: { pendingReviews } });
    } catch (error) {
      console.error('ReviewController - getPendingReviews error:', error);
      res.status(500).json({ success: false, message: 'Failed to get pending reviews' });
    }
  }

  /**
   * Programar nudge de respuesta al proveedor 48h después de recibir una reseña.
   * Si el proveedor ya respondió, no se envía.
   * Persiste en DB — sobrevive reinicios del servidor.
   */
  async scheduleResponseNudge(reviewId, providerId) {
    try {
      const { scheduleResponseNudge: persistNudge } = await import('../services/internal/nudgeProcessor.js');
      await persistNudge({ reviewId, providerId });
    } catch (err) {
      console.warn('[ReviewController] scheduleResponseNudge error:', err.message);
    }
  }

  /**
   * Obtener todas las reseñas que el cliente actual ha enviado.
   * Devuelve reseñas con info del proveedor, booking y respuesta.
   */
  async getMyReviews(req, res) {
    try {
      const clientId = req.user._id;
      const { page = 1, limit = 20 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const [reviews, total] = await Promise.all([
        Review.find({ client: clientId, status: 'active' })
          .populate('provider', 'providerProfile.businessName providerProfile.avatar profile.firstName')
          .populate('booking', 'schedule.scheduledDate status')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        Review.countDocuments({ client: clientId, status: 'active' })
      ]);

      const mapped = reviews.map(r => ({
        _id: r._id,
        providerName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || '',
        providerAvatar: r.provider?.providerProfile?.avatar || '',
        rating: r.rating?.overall || 0,
        categories: r.rating?.categories || {},
        title: r.review?.title || '',
        comment: r.review?.comment || '',
        photos: r.review?.photos || [],
        providerResponse: r.providerResponse?.comment || null,
        providerRespondedAt: r.providerResponse?.respondedAt || null,
        scheduledDate: r.booking?.schedule?.scheduledDate,
        createdAt: r.createdAt,
        helpfulness: r.helpfulness || { helpful: 0, notHelpful: 0 }
      }));

      res.json({
        success: true,
        data: {
          reviews: mapped,
          pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) }
        }
      });
    } catch (error) {
      console.error('ReviewController - getMyReviews error:', error);
      res.status(500).json({ success: false, message: 'Failed to get my reviews' });
    }
  }
}

export default new ReviewController();