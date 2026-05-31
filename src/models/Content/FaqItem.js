// models/Content/FaqItem.js
//
// Modelo de preguntas frecuentes editables desde el panel admin.
// Cada documento es una pregunta individual con respuesta bilingüe (es/en).
// Las preguntas se agrupan por `category` y se ordenan con `order` numérico
// (siempre múltiplo de 10 al crear para permitir intercalar sin reescribir todo).

import mongoose from 'mongoose';

export const FAQ_CATEGORIES = Object.freeze([
  'general',
  'client',
  'provider',
  'payment',
  'account'
]);

const localizedTextSchema = new mongoose.Schema(
  {
    es: { type: String, default: '', maxlength: 5_000 },
    en: { type: String, default: '', maxlength: 5_000 }
  },
  { _id: false }
);

const localizedHtmlSchema = new mongoose.Schema(
  {
    es: { type: String, default: '', maxlength: 20_000 },
    en: { type: String, default: '', maxlength: 20_000 }
  },
  { _id: false }
);

const faqItemSchema = new mongoose.Schema(
  {
    question: { type: localizedTextSchema, default: () => ({}) },
    answerMarkdown: { type: localizedTextSchema, default: () => ({}) },
    // HTML pre-sanitizado servido al público (evita procesar Markdown en cada GET).
    answerHtml: { type: localizedHtmlSchema, default: () => ({}) },
    order: { type: Number, default: 100, index: true },
    category: { type: String, enum: FAQ_CATEGORIES, default: 'general', index: true },
    active: { type: Boolean, default: true, index: true },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

// Devuelve el payload listo para el frontend en el locale solicitado.
faqItemSchema.methods.toPublicPayload = function toPublicPayload(locale = 'es') {
  const safeLocale = ['es', 'en'].includes(locale) ? locale : 'es';
  const fallbackLocale = safeLocale === 'es' ? 'en' : 'es';

  const pick = (field) =>
    (this[field]?.[safeLocale] && this[field][safeLocale].trim()) ||
    this[field]?.[fallbackLocale] ||
    '';

  return {
    id: this._id,
    question: pick('question'),
    answerHtml: pick('answerHtml'),
    category: this.category,
    order: this.order
  };
};

const FaqItem = mongoose.model('FaqItem', faqItemSchema);

export default FaqItem;
