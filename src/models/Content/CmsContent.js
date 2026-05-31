// models/Content/CmsContent.js
//
// Modelo de contenidos editoriales gestionados por el admin desde el panel CMS.
// Cada documento representa una página/bloque editable identificado por una `key`
// estable (p.ej. 'terms', 'privacy', 'about', 'hero', 'contact').
//
// Diseño:
//   - Soporte bilingüe (es/en) integrado con el i18n del frontend.
//   - Cada `section` admite Markdown como fuente editable + HTML sanitizado cacheado.
//   - Historial de hasta MAX_HISTORY versiones por locale con rollback no destructivo.
//   - Auditoría completa de quién/cuándo edita.
//
// No reemplaza el i18n: el frontend cae a las claves i18n existentes si el doc
// no existe o la API falla, garantizando que nada se rompa.

import mongoose from 'mongoose';

const MAX_HISTORY_ENTRIES = 20;

// Claves permitidas para contenidos CMS. Añadir aquí nuevas páginas editables.
// El admin NO puede crear keys arbitrarias desde el panel para evitar contenido
// huérfano sin renderizador en el frontend.
export const CMS_CONTENT_KEYS = Object.freeze([
  'terms',
  'privacy',
  'about',
  'hero',
  'contact'
]);

const sectionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true, maxlength: 64 },
    label: { type: String, trim: true, maxlength: 200, default: '' },
    bodyMarkdown: { type: String, default: '', maxlength: 100_000 },
    bodyHtml: { type: String, default: '', maxlength: 200_000 }
  },
  { _id: false }
);

const localePayloadSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 280, default: '' },
    sections: { type: [sectionSchema], default: [] },
    lastEditedAt: { type: Date, default: null }
  },
  { _id: false }
);

const historyEntrySchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    locale: { type: String, enum: ['es', 'en'], required: true },
    titleSnapshot: { type: String, default: '' },
    sectionsSnapshot: { type: [sectionSchema], default: [] },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    editedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const cmsContentSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      enum: CMS_CONTENT_KEYS,
      index: true
    },
    translations: {
      es: { type: localePayloadSchema, default: () => ({}) },
      en: { type: localePayloadSchema, default: () => ({}) }
    },
    version: { type: Number, default: 1, min: 1 },
    publishedAt: { type: Date, default: Date.now },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    history: { type: [historyEntrySchema], default: [] }
  },
  { timestamps: true }
);

// Trunca el historial para que no crezca indefinidamente (controla tamaño del doc).
cmsContentSchema.methods.pushHistory = function pushHistory(entry) {
  this.history.push(entry);
  if (this.history.length > MAX_HISTORY_ENTRIES) {
    this.history = this.history.slice(-MAX_HISTORY_ENTRIES);
  }
};

// Devuelve el payload listo para servir al frontend en el locale solicitado.
// Hace fallback al otro idioma si el solicitado no tiene contenido aún
// (situación normal en migraciones parciales).
cmsContentSchema.methods.toPublicPayload = function toPublicPayload(locale = 'es') {
  const safeLocale = ['es', 'en'].includes(locale) ? locale : 'es';
  const primary = this.translations?.[safeLocale];
  const hasPrimary = primary && (primary.title || (primary.sections && primary.sections.length));

  if (hasPrimary) {
    return {
      key: this.key,
      locale: safeLocale,
      title: primary.title || '',
      sections: (primary.sections || []).map((s) => ({
        id: s.id,
        label: s.label,
        bodyHtml: s.bodyHtml
      })),
      lastEditedAt: primary.lastEditedAt || this.publishedAt,
      version: this.version
    };
  }

  // Fallback al otro idioma (mismo doc) si el solicitado está vacío.
  const fallbackLocale = safeLocale === 'es' ? 'en' : 'es';
  const fallback = this.translations?.[fallbackLocale];
  return {
    key: this.key,
    locale: safeLocale,
    title: fallback?.title || '',
    sections: (fallback?.sections || []).map((s) => ({
      id: s.id,
      label: s.label,
      bodyHtml: s.bodyHtml
    })),
    lastEditedAt: fallback?.lastEditedAt || this.publishedAt,
    version: this.version,
    fallbackUsed: fallbackLocale
  };
};

const CmsContent = mongoose.model('CmsContent', cmsContentSchema);

export default CmsContent;
