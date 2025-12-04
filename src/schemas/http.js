// schemas/http.js
import Joi from 'joi';
import { SERVICE_CATEGORIES } from '../config/categories.js';

const categories = SERVICE_CATEGORIES; // Usar las 26 categorías sincronizadas
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
  address: Joi.string().min(3).max(300).required(),
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required()
  }).required(),
  preferredDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null, ''),
  preferredTime: Joi.string().allow('', null),
  flexibility: Joi.string().valid('strict','flexible','very_flexible').allow(null),
  budget: Joi.object({
    amount: Joi.number().positive().required(),
    currency: Joi.string().uppercase().length(3).default('USD')
  }).required(),
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
  amount: Joi.number().positive().required(),
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
});

export default {
  createServiceRequestSchema,
  updateServiceRequestSchema,
  proposalDraftUpdateSchema,
  proposalSendSchema,
  objectIdParam
};
