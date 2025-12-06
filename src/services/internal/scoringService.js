// services/internal/scoringService.js
import Provider from '../../models/User/Provider.js';
import Booking from '../../models/Service/Booking.js';
import Review from '../../models/Service/Review.js';
import Proposal from '../../models/Service/Proposal.js';
import subscriptionService from './subscriptionService.js';

class ScoringService {
  constructor() {}

  async calculateProviderScore(provider) {
    try {
      const providerId = provider._id || provider;

      // Si se pasa solo el ID (string u ObjectId), poblar datos necesarios
      const isIdOnly = typeof provider === 'string' || 
                       (provider.constructor && provider.constructor.name === 'ObjectId') ||
                       !provider.providerProfile;
      
      if (isIdOnly) {
        provider = await Provider.findById(providerId)
          .populate('providerProfile.rating')
          .lean();
        
        if (!provider) {
          console.warn('ScoringService - Provider not found:', providerId);
          return { total: 0, breakdown: {}, details: {} };
        }
      }

      // Asegurarse de que providerProfile existe
      if (!provider.providerProfile) {
        console.warn('ScoringService - Provider has no providerProfile:', providerId);
        return { total: 0, breakdown: {}, details: {} };
      }

      const { rating = {}, stats = {} } = provider.providerProfile;
      const subscription = provider.subscription;

      // 1. Rating Promedio × Factor Volumen
      const ratingVolumeScore = this.calculateRatingVolumeScore(rating, stats);

      // 2. Puntos por Consistencia
      const consistencyPoints = await this.calculateConsistencyPoints(providerId);

  // 3. Multiplicador del Plan (desde SubscriptionPlan)
  const planDef = await subscriptionService.getPlan(subscription?.plan || 'free');
  const planMultiplier = planDef?.features?.visibilityMultiplier || 1.0;

      // Fórmula: (((Rating Promedio × Factor Volumen) + Puntos por Consistencia) × Multiplicador del Plan)
      const totalScore = ((ratingVolumeScore + consistencyPoints) * planMultiplier);

      // Actualizar score del proveedor si no es cálculo temporal
      if (provider._id) {
        await Provider.findByIdAndUpdate(providerId, {
          $set: {
            'score.total': totalScore,
            'score.lastCalculated': new Date(),
            'score.factors': {
              ratingVolume: ratingVolumeScore,
              consistencyPoints: consistencyPoints,
              planMultiplier: planMultiplier
            }
          }
        });
      }

      return {
        total: Math.round(totalScore * 100) / 100, // Redondear a 2 decimales
        breakdown: {
          ratingVolume: Math.round(ratingVolumeScore * 100) / 100,
          consistencyPoints: Math.round(consistencyPoints * 100) / 100,
          planMultiplier: planMultiplier
        },
        details: {
          averageRating: rating?.average || 0,
          completedJobs: stats?.completedJobs || 0,
          responseRate: stats?.responseRate || 0,
          subscriptionPlan: subscription?.plan
        }
      };
    } catch (error) {
      console.error('ScoringService - calculateProviderScore error:', error);
      throw error;
    }
  }

  calculateRatingVolumeScore(rating, stats) {
    const averageRating = rating?.average || 0;
    const completedJobs = stats?.completedJobs || 0;
    
    // Factor Volumen: logaritmo natural de trabajos completados + 1
    // Para evitar penalizar nuevos proveedores y dar ventaja a experimentados
    const volumeFactor = Math.log(completedJobs + 1);
    
    // Normalizar a escala 0-5
    const normalizedVolumeFactor = Math.min(volumeFactor, 3) / 3 * 5;
    
    return averageRating * normalizedVolumeFactor;
  }

  async calculateConsistencyPoints(providerId) {
    try {
      // Obtener métricas recientes (últimos 90 días)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const recentBookings = await Booking.find({
        provider: providerId,
        status: 'completed',
        createdAt: { $gte: ninetyDaysAgo }
      }).lean();

      const recentReviews = await Review.find({
        provider: providerId,
        createdAt: { $gte: ninetyDaysAgo }
      }).lean();

      if (recentBookings.length === 0) {
        return 2.5; // Puntuación base para nuevos proveedores
      }

      let consistencyScore = 0;

      // 1. Tasa de finalización (30%)
      const completionRate = await this.calculateCompletionRate(providerId, ninetyDaysAgo);
      consistencyScore += completionRate * 0.3 * 5;

      // 2. Puntualidad (25%)
      const punctualityScore = await this.calculatePunctualityScore(providerId, ninetyDaysAgo);
      consistencyScore += punctualityScore * 0.25 * 5;

      // 3. Calidad consistente (25%)
      const qualityConsistency = this.calculateQualityConsistency(recentReviews);
      consistencyScore += qualityConsistency * 0.25 * 5;

      // 4. Tasa de respuesta (20%)
      const responseRate = await this.calculateResponseRate(providerId, ninetyDaysAgo);
      consistencyScore += responseRate * 0.2 * 5;

      return Math.min(consistencyScore, 5); // Máximo 5 puntos
    } catch (error) {
      console.error('ScoringService - calculateConsistencyPoints error:', error);
      return 2.5; // Puntuación base en caso de error
    }
  }

  async calculateCompletionRate(providerId, sinceDate) {
    const totalBookings = await Booking.countDocuments({
      provider: providerId,
      createdAt: { $gte: sinceDate },
      status: { $in: ['confirmed', 'in_progress', 'completed', 'cancelled'] }
    });

    const completedBookings = await Booking.countDocuments({
      provider: providerId,
      createdAt: { $gte: sinceDate },
      status: 'completed'
    });

    return totalBookings > 0 ? completedBookings / totalBookings : 1;
  }

  async calculatePunctualityScore(providerId, sinceDate) {
    const bookings = await Booking.find({
      provider: providerId,
      status: 'completed',
      createdAt: { $gte: sinceDate },
      'schedule.scheduledDate': { $exists: true }
    }).lean();

    if (bookings.length === 0) return 1;

    let onTimeCount = 0;

    for (const booking of bookings) {
      const scheduledDate = new Date(booking.schedule.scheduledDate);
      const actualStart = booking.statusHistory.find(
        h => h.status === 'in_progress'
      )?.timestamp;

      if (actualStart) {
        const timeDiff = Math.abs(actualStart - scheduledDate) / (1000 * 60); // diferencia en minutos
        if (timeDiff <= 30) { // Considerado puntual si llega dentro de 30 minutos
          onTimeCount++;
        }
      }
    }

    return onTimeCount / bookings.length;
  }

  calculateQualityConsistency(reviews) {
    if (reviews.length === 0) return 1;

    const ratings = reviews.map(r => r.rating.overall);
    const average = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    
    // Calcular desviación estándar para medir consistencia
    const squaredDiffs = ratings.map(r => Math.pow(r - average, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / ratings.length;
    const standardDeviation = Math.sqrt(variance);

    // Menor desviación = mayor consistencia
    return Math.max(0, 1 - (standardDeviation / 2));
  }

  async calculateResponseRate(providerId, sinceDate) {
    // Esta métrica requeriría tracking de tiempo de respuesta a propuestas
    // Por ahora usamos un placeholder
    const proposals = await Proposal.find({
      provider: providerId,
      createdAt: { $gte: sinceDate }
    }).lean();

    if (proposals.length === 0) return 1;

    const quickResponses = proposals.filter(p => {
      const responseTime = p.metadata?.responseTime; // en minutos
      return responseTime && responseTime <= 120; // 2 horas
    }).length;

    return quickResponses / proposals.length;
  }
}

const scoringService = new ScoringService();
export default scoringService;