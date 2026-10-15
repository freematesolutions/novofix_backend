// schemas/quickDoc.schemas.js
//
// Validaciones Joi para el Flujo 2 — "Vía Rápida en Vivo" (QuickDoc).
// Consistente con el patrón de server/src/schemas/http.js (Joi + validateBody).
import Joi from 'joi';

const itemSchema = Joi.object({
  description: Joi.string().allow('', null),
  qty: Joi.number().min(0).allow(null),
  unitPrice: Joi.number().min(0).allow(null),
  total: Joi.number().min(0).allow(null)
});

const financialsSchema = Joi.object({
  items: Joi.array().items(itemSchema).default([]),
  subtotal: Joi.number().min(0).allow(null),
  discount: Joi.number().min(0).allow(null),
  taxRate: Joi.number().min(0).allow(null),
  tax: Joi.number().min(0).allow(null),
  shipping: Joi.number().min(0).allow(null),
  total: Joi.number().min(0).allow(null),
  currency: Joi.string().uppercase().length(3).default('USD'),
  isRange: Joi.boolean().default(false),
  amountMin: Joi.number().min(0).allow(null),
  amountMax: Joi.number().min(0).allow(null)
}).default({});

const contactInfoSchema = Joi.object({
  name: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  city: Joi.string().allow('', null),
  state: Joi.string().allow('', null),
  zip: Joi.string().allow('', null),
  phone: Joi.string().allow('', null)
});

const businessInfoSchema = Joi.object({
  name: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  phone: Joi.string().allow('', null),
  email: Joi.string().allow('', null)
});

// Creación libre de estimado/factura por el profesional
export const createQuickDocSchema = Joi.object({
  type: Joi.string().valid('estimate', 'invoice').required(),
  documentNumber: Joi.string().allow('', null),
  clientInfo: contactInfoSchema.allow(null),
  businessInfo: businessInfoSchema.allow(null),
  financials: financialsSchema,
  issueDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null, ''),
  dueDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null, ''),
  validUntil: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null, ''),
  notes: Joi.string().allow('', null),
  message: Joi.string().allow('', null),
  pdfUrl: Joi.string().uri().allow('', null),
  // Vigencia del link público en días (acotada por seguridad)
  expiresInDays: Joi.number().integer().min(1).max(90).default(30)
});

// Conversión estimado → factura (el profesional puede ajustar datos/pdf)
export const convertQuickDocSchema = Joi.object({
  documentNumber: Joi.string().allow('', null),
  financials: financialsSchema,
  dueDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).allow(null, ''),
  notes: Joi.string().allow('', null),
  message: Joi.string().allow('', null),
  pdfUrl: Joi.string().uri().allow('', null),
  expiresInDays: Joi.number().integer().min(1).max(90).default(30)
}).default({});

// Captura de correo + aceptación de términos por el cliente invitado
export const claimQuickDocSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  name: Joi.string().allow('', null),
  acceptTerms: Joi.boolean().valid(true).required(),
  locale: Joi.string().valid('es', 'en').allow(null, '')
});

// Parámetro de token público (SHA-256 hex = 64 chars del token en claro)
export const quickDocTokenParam = Joi.object({
  token: Joi.string().length(64).hex().required()
});

export default {
  createQuickDocSchema,
  convertQuickDocSchema,
  claimQuickDocSchema,
  quickDocTokenParam
};
