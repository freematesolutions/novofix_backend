// schemas/cms.schemas.js
//
// Validación de payloads del panel admin del CMS.
// El frontend público no envía nada — solo GET — así que aquí no hay esquema
// para rutas públicas.

import Joi from 'joi';
import { CMS_CONTENT_KEYS } from '../models/Content/CmsContent.js';
import { FAQ_CATEGORIES } from '../models/Content/FaqItem.js';

const LOCALES = ['es', 'en'];

// Sección individual editable dentro de un contenido.
const sectionInputSchema = Joi.object({
  id: Joi.string().trim().max(64).pattern(/^[a-z0-9_-]+$/i).required(),
  label: Joi.string().trim().max(200).allow(''),
  bodyMarkdown: Joi.string().max(100_000).allow('')
});

// PUT /api/admin/cms/contents/:key
export const updateContentSchema = Joi.object({
  locale: Joi.string().valid(...LOCALES).required(),
  title: Joi.string().trim().max(280).required(),
  sections: Joi.array().items(sectionInputSchema).max(50).required()
});

// Params: clave del contenido (debe ser una de las permitidas).
export const contentKeyParamSchema = Joi.object({
  key: Joi.string().valid(...CMS_CONTENT_KEYS).required()
});

// Params para rollback: key + version numérica positiva.
export const rollbackParamSchema = Joi.object({
  key: Joi.string().valid(...CMS_CONTENT_KEYS).required(),
  version: Joi.number().integer().min(1).required()
});

// Query del GET público: locale opcional (default 'es').
export const publicLocaleQuerySchema = Joi.object({
  locale: Joi.string().valid(...LOCALES).default('es')
});

// ─── FAQ ────────────────────────────────────────────────────────────────────

const localizedRequired = Joi.object({
  es: Joi.string().trim().min(1).max(5_000).required(),
  en: Joi.string().trim().min(1).max(5_000).required()
});

const localizedOptional = Joi.object({
  es: Joi.string().trim().max(5_000).allow(''),
  en: Joi.string().trim().max(5_000).allow('')
});

export const createFaqSchema = Joi.object({
  question: localizedRequired.required(),
  answerMarkdown: localizedRequired.required(),
  category: Joi.string().valid(...FAQ_CATEGORIES).default('general'),
  order: Joi.number().integer().min(0).max(100_000).optional(),
  active: Joi.boolean().default(true)
});

export const updateFaqSchema = Joi.object({
  question: localizedOptional,
  answerMarkdown: localizedOptional,
  category: Joi.string().valid(...FAQ_CATEGORIES),
  order: Joi.number().integer().min(0).max(100_000),
  active: Joi.boolean()
}).min(1);

export const reorderFaqSchema = Joi.object({
  order: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().length(24).hex().required(),
        order: Joi.number().integer().min(0).max(100_000).required()
      })
    )
    .min(1)
    .max(200)
    .required()
});

export const faqQuerySchema = Joi.object({
  locale: Joi.string().valid(...LOCALES).default('es'),
  category: Joi.string().valid(...FAQ_CATEGORIES, 'all').default('all')
});

// ─── Reset & Service Categories ─────────────────────────────────────────────

export const resetFromDefaultsBodySchema = Joi.object({
  locale: Joi.string().valid('es', 'en', 'both').default('both')
});

const localizedLabel = Joi.object({
  es: Joi.string().trim().max(200).allow(''),
  en: Joi.string().trim().max(200).allow('')
});

export const upsertServiceCategorySchema = Joi.object({
  label: localizedLabel.optional(),
  description: localizedLabel.optional()
}).min(1);

export const serviceCategoryKeyParamSchema = Joi.object({
  key: Joi.string().min(1).max(80).required()
});

export default {
  updateContentSchema,
  contentKeyParamSchema,
  rollbackParamSchema,
  publicLocaleQuerySchema,
  createFaqSchema,
  updateFaqSchema,
  reorderFaqSchema,
  faqQuerySchema,
  resetFromDefaultsBodySchema,
  upsertServiceCategorySchema,
  serviceCategoryKeyParamSchema
};
