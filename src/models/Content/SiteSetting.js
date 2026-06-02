// models/Content/SiteSetting.js
//
// Modelo genérico clave/valor para "ajustes del sitio" administrables por el
// admin desde el panel y consumibles públicamente por el frontend.
//
// A diferencia de `CmsContent` (texto editorial multi-sección con historial y
// markdown), `SiteSetting` está pensado para datos puntuales no-texto:
// flags, URLs, pequeños objetos de configuración (p.ej. video del Home).
//
// Diseño:
//   - `key` enumerada para evitar contenido huérfano sin renderizador.
//   - `value` Mixed: cada controlador valida la forma exacta antes de guardar.
//   - Auditoría mínima (updatedBy + timestamps).
//
// No reemplaza el i18n ni el CMS: si el doc no existe o el endpoint falla,
// el frontend hace fallback graceful (oculta el bloque correspondiente).

import mongoose from 'mongoose';

// Claves permitidas. Añadir aquí nuevos settings administrables.
export const SITE_SETTING_KEYS = Object.freeze([
  'home_hero_video'
]);

const siteSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      enum: SITE_SETTING_KEYS,
      index: true
    },
    // Forma libre validada por cada controlador. Para 'home_hero_video':
    //   { enabled: bool, videoUrl: string|null, posterUrl: string|null,
    //     cloudinaryId: string|null, provider: 'cloudinary'|'youtube'|'vimeo'|'external',
    //     titleEs: string, titleEn: string }
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

const SiteSetting = mongoose.model('SiteSetting', siteSettingSchema);

export default SiteSetting;
