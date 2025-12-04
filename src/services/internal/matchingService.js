// services/internal/matchingService.js
import Provider from '../../models/User/Provider.js';
import ServiceRequest from '../../models/Service/ServiceRequest.js';
import scoringService from './scoringService.js';
import subscriptionService from './subscriptionService.js';
import redisClient from '../../config/redis.js';
import notificationService from '../external/notificationService.js';
import emitter from '../../websocket/services/emitterService.js';
import { EVENTS } from '../../websocket/constants/socketEvents.js';

class MatchingService {
  constructor() {
    this.cacheTTL = 300; // 5 minutos cache
  }

  async findEligibleProviders(serviceRequestId, options = {}) {
    try {
  const cacheKey = `eligible_providers:${serviceRequestId}`;
      
      // Verificar cache primero
      if (!options.forceRefresh) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return cached; // redisClient.get ya intenta parsear JSON
        }
      }

      const serviceRequest = await ServiceRequest.findById(serviceRequestId)
        .populate('client')
        .lean();

      if (!serviceRequest) {
        throw new Error('Service request not found');
      }

      const { category, urgency } = serviceRequest.basicInfo;
      const { coordinates } = serviceRequest.location;

      // Construir query base
      let query = {
        'providerProfile.services.category': category,
        'subscription.status': 'active',
        isActive: true
      };

      // Filtro por zona de servicio (geo-spatial)
      if (coordinates) {
        query['providerProfile.serviceArea.location'] = {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [coordinates.lng, coordinates.lat]
            },
            $maxDistance: (serviceRequest.basicInfo.urgency === 'immediate') ? 15000 : 50000 // ~9 millas o ~31 millas (15km o 50km en metros)
          }
        };
      }

      // Filtro por disponibilidad si es programado
      if (serviceRequest.basicInfo.urgency === 'scheduled' && serviceRequest.scheduling.preferredDate) {
        query = await this.addAvailabilityFilter(query, serviceRequest.scheduling);
      }

      let providers = await Provider.find(query)
        .populate('providerProfile.rating')
        .lean();

      // Filtrar por límites de leads del plan y periodo actual
      providers = await Promise.all(
        providers.map(async (p) => {
          const canLead = await subscriptionService.canReceiveLead(p);
          return canLead ? p : null;
        })
      ).then(list => list.filter(Boolean));

      // Calcular puntuación para cada proveedor
      const scoredProviders = await Promise.all(
        providers.map(async (provider) => {
          const score = await scoringService.calculateProviderScore(provider);
          return {
            provider: provider._id,
            score: score.total,
            details: score,
            profile: {
              businessName: provider.providerProfile.businessName,
              rating: provider.providerProfile.rating,
              services: provider.providerProfile.services,
              subscription: provider.subscription.plan,
              portfolio: provider.providerProfile.portfolio || []
            }
          };
        })
      );

      // Ordenar por puntuación descendente
      scoredProviders.sort((a, b) => b.score - a.score);

      const result = {
        serviceRequest: serviceRequestId,
        eligibleProviders: scoredProviders,
        totalCount: scoredProviders.length,
        calculatedAt: new Date()
      };

      // Cachear resultado
  // Guardar en cache con expiración (EX en segundos)
  await redisClient.set(cacheKey, result, { EX: this.cacheTTL });

      return result;
    } catch (error) {
      console.error('MatchingService - findEligibleProviders error:', error);
      throw error;
    }
  }

  async addAvailabilityFilter(query, scheduling) {
    const { preferredDate, preferredTime, flexibility } = scheduling;
    
    if (!preferredDate) return query;

    const targetDate = new Date(preferredDate);
    const dayOfWeek = targetDate.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();

    // Filtro básico por día de la semana y horas laborales
    query[`providerProfile.availability.workingHours.${dayOfWeek}.available`] = true;

    if (preferredTime) {
      // Lógica adicional para filtrar por franja horaria específica
      query[`providerProfile.availability.workingHours.${dayOfWeek}.start`] = {
        $lte: preferredTime
      };
      query[`providerProfile.availability.workingHours.${dayOfWeek}.end`] = {
        $gte: preferredTime
      };
    }

    return query;
  }

  async notifyProviders(serviceRequestId, notificationType = 'auto', selectedProviderIds = []) {
    try {
      let providersToNotify = [];

      if (notificationType === 'directed' && selectedProviderIds.length > 0) {
        // For directed notifications, honor client selection regardless of geo/category filters
        const ids = [...new Set(selectedProviderIds.map(String))];
        const providers = await Provider.find({ _id: { $in: ids } }).lean();
        providersToNotify = providers.map((p) => ({
          provider: p._id,
          score: 0,
          profile: {
            businessName: p?.providerProfile?.businessName,
            rating: p?.providerProfile?.rating,
            services: p?.providerProfile?.services,
            subscription: p?.subscription?.plan
          }
        }));
      } else {
        const { eligibleProviders } = await this.findEligibleProviders(serviceRequestId);
        providersToNotify = eligibleProviders;
      }

      // Limitar notificaciones según mejores puntuaciones
      const topProviders = providersToNotify.slice(0, 15); // Máximo 15 proveedores

      const notificationResults = await Promise.allSettled(
        topProviders.map(async (provider) => {
          try {
            // Incrementar uso de lead para el periodo actual del proveedor (aplica también a dirigidos)
            try { await subscriptionService.incrementLeadUsage(provider.provider); } catch { /* ignore */ }
            // Actualizar ServiceRequest con proveedores notificados (elegibles o dirigidos)
            await ServiceRequest.findByIdAndUpdate(serviceRequestId, {
              $addToSet: {
                eligibleProviders: {
                  provider: provider.provider,
                  score: provider.score || 0,
                  notified: true,
                  notifiedAt: new Date()
                }
              }
            });

            // Enviar notificación
            await notificationService.sendProviderNotification({
              providerId: provider.provider,
              serviceRequestId,
              type: 'NEW_REQUEST',
              priority: 'high'
            });

            // Real-time counters update for provider (new job available)
            try { emitter.emitCountersUpdateToUser(provider.provider, { reason: 'new_request' }); } catch { /* ignore */ }

            return {
              provider: provider.provider,
              notified: true,
              score: provider.score
            };
          } catch (error) {
            console.error(`Failed to notify provider ${provider.provider}:`, error);
            return {
              provider: provider.provider,
              notified: false,
              error: error.message
            };
          }
        })
      );

      return {
        totalNotified: notificationResults.filter(r => r.value?.notified).length,
        totalFailed: notificationResults.filter(r => !r.value?.notified).length,
        results: notificationResults.map(r => r.value)
      };
    } catch (error) {
      console.error('MatchingService - notifyProviders error:', error);
      throw error;
    }
  }
}

const matchingService = new MatchingService();
export default matchingService;