// schemas/http.js
import Joi from 'joi';
import { SERVICE_CATEGORIES } from '../config/categories.js';

const categories = SERVICE_CATEGORIES; // Usar las 16 categorías sincronizadas
const urgencies = ['immediate', 'scheduled'];

export const objectIdParam = Joi.object({
  id: Joi.string().length(24).hex().required()
});

export const createServiceRequestSchema = Joi.object({
  title: Joi.string().min(4).max(140).required(),
  description: Joi.string().min(10).max(5000).required(),
  category: Joi.string().valid(...categories).required(),
  subcategory: Joi.string().allow('', null),
  urgency: Joi.string().valid(...urgencies).required(),
  // Ubicación ahora es opcional para servicios remotos
  address: Joi.string().min(3).max(300).allow('', null),
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required()
  }).allow(null),
  preferredDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null, ''),
  preferredTime: Joi.string().allow('', null),
  flexibility: Joi.string().valid('strict','flexible','very_flexible').allow(null),
  budget: Joi.object({
    amount: Joi.number().positive().required(),
    currency: Joi.string().uppercase().length(3).default('USD')
  }).optional(),
  photos: Joi.array().items(Joi.object({
    url: Joi.string().uri().required(),
    cloudinaryId: Joi.string().allow('', null),
    caption: Joi.string().allow('', null)
  })).default([]),
  videos: Joi.array().items(Joi.object({
    url: Joi.string().uri().required(),
    cloudinaryId: Joi.string().allow('', null),
    caption: Joi.string().allow('', null)
  })).default([]),
  visibility: Joi.string().valid('auto','directed').default('auto'),
  saveAsDraft: Joi.boolean().default(false),
  // Array opcional de IDs de proveedores específicos a notificar (si no se envía, se notifica a todos los elegibles)
  targetProviders: Joi.array().items(Joi.string().length(24).hex()).default([])
});

export const updateServiceRequestSchema = Joi.object({
  title: Joi.string().min(4).max(140),
  description: Joi.string().min(10).max(5000),
  category: Joi.string().valid(...categories),
  subcategory: Joi.string().allow('', null),
  urgency: Joi.string().valid(...urgencies),
  address: Joi.string().min(3).max(300),
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required()
  }),
  preferredDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null,''),
  preferredTime: Joi.string().allow('', null),
  flexibility: Joi.string().valid('strict','flexible','very_flexible'),
  budget: Joi.object({
    amount: Joi.number().positive(),
    currency: Joi.string().uppercase().length(3)
  }),
  photos: Joi.array().items(Joi.object({
    url: Joi.string().uri().required(),
    cloudinaryId: Joi.string().allow('', null),
    caption: Joi.string().allow('', null)
  })),
  videos: Joi.array().items(Joi.object({
    url: Joi.string().uri().required(),
    cloudinaryId: Joi.string().allow('', null),
    caption: Joi.string().allow('', null)
  }))
}).min(1);

export const proposalDraftUpdateSchema = Joi.object({
  amount: Joi.number().positive(),
  amountMin: Joi.number().positive(),
  amountMax: Joi.number().positive(),
  isRange: Joi.boolean(),
  breakdown: Joi.object().unknown(true),
  estimatedHours: Joi.number().positive(),
  startDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null),
  completionDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null),
  availability: Joi.array().items(Joi.object({
    date: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()),
    timeSlots: Joi.array().items(Joi.string())
  })),
  warranty: Joi.object().unknown(true),
  materialsIncluded: Joi.boolean(),
  cleanupIncluded: Joi.boolean(),
  additionalTerms: Joi.string().allow('', null),
  message: Joi.string().allow('', null)
}).min(1);

export const proposalSendSchema = Joi.object({
  amount: Joi.number().positive().allow(null),
  amountMin: Joi.number().positive().allow(null),
  amountMax: Joi.number().positive().allow(null),
  isRange: Joi.boolean().allow(null),
  breakdown: Joi.object().unknown(true),
  estimatedHours: Joi.number().positive().allow(null),
  startDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null),
  completionDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null),
  availability: Joi.array().items(Joi.object({
    date: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()),
    timeSlots: Joi.array().items(Joi.string())
  })).allow(null),
  warranty: Joi.object().unknown(true).allow(null),
  materialsIncluded: Joi.boolean().allow(null),
  cleanupIncluded: Joi.boolean().allow(null),
  additionalTerms: Joi.string().allow('', null),
  message: Joi.string().allow('', null)
}).custom((value, helpers) => {
  // Validación personalizada: debe tener amount O (amountMin + amountMax con isRange)
  if (value.isRange) {
    if (!value.amountMin || !value.amountMax) {
      return helpers.error('any.custom', { message: 'When isRange is true, amountMin and amountMax are required' });
    }
    if (value.amountMin >= value.amountMax) {
      return helpers.error('any.custom', { message: 'amountMax must be greater than amountMin' });
    }
  } else {
    if (!value.amount) {
      return helpers.error('any.custom', { message: 'amount is required when isRange is false' });
    }
  }
  return value;
});

export default {
  createServiceRequestSchema,
  updateServiceRequestSchema,
  proposalDraftUpdateSchema,
  proposalSendSchema,
  objectIdParam
};
