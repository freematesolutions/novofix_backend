// controllers/reviewController.js
import Review from '../models/Service/Review.js';
import Booking from '../models/Service/Booking.js';
import Provider from '../models/User/Provider.js';
import scoringService from '../services/internal/scoringService.js';

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
   */
  async createReview(req, res) {
    try {
      const { bookingId } = req.params;
      const { overall, categories, title, comment, photos } = req.body;

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

      const review = new Review({
        booking: bookingId,
        client: req.user._id,
        provider: booking.provider._id,
        rating: {
          overall,
          categories: {
            professionalism: categories.professionalism,
            quality: categories.quality,
            punctuality: categories.punctuality,
            communication: categories.communication,
            value: categories.value || overall
          }
        },
        review: {
          title,
          comment,
          photos: photos || []
        },
        status: 'active'
      });

      await review.save();

      // Actualizar rating del proveedor
      await this.updateProviderRating(booking.provider._id);

      // Recalcular score del proveedor
      await scoringService.calculateProviderScore(booking.provider._id);

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

      // Calcular promedios por categoría
      const categories = ['professionalism', 'quality', 'punctuality', 'communication', 'value'];
      const categoryAverages = {};

      categories.forEach(category => {
        const sum = reviews.reduce((sum, review) => sum + (review.rating.categories[category] || 0), 0);
        categoryAverages[category] = sum / reviews.length;
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
}

export default new ReviewController();