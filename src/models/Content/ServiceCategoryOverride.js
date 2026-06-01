// models/Content/ServiceCategoryOverride.js
//
// Override editorial (label visible + descripción) por categoría de servicio.
// La CLAVE CANÓNICA (Reparaciones, Plomería, Electricidad…) sigue viviendo en
// `client/src/utils/categories.js` y `server/src/config/categories.js` y NO se
// modifica desde aquí: cualquier cambio de la clave requeriría migración masiva
// de datos (perfiles, solicitudes, matching, slugs SEO indexados, etc.).
//
// Este modelo solo guarda overrides DE PRESENTACIÓN:
//   - label.es / label.en      (lo que el visitante ve en cards, hero, breadcrumbs)
//   - description.es / description.en
//
// Si no existe doc para una categoría, el frontend cae a las claves i18n
// `home.categories.<canonical>` y `home.categoryDescriptions.<canonical>`.

import mongoose from 'mongoose';

const localizedTextSchema = new mongoose.Schema(
  {
    es: { type: String, trim: true, maxlength: 200, default: '' },
    en: { type: String, trim: true, maxlength: 200, default: '' }
  },
  { _id: false }
);

const serviceCategoryOverrideSchema = new mongoose.Schema(
  {
    // Clave canónica (sí, va en español por compatibilidad con BD existente).
    canonicalKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    label: { type: localizedTextSchema, default: () => ({}) },
    description: { type: localizedTextSchema, default: () => ({}) },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

const ServiceCategoryOverride = mongoose.model('ServiceCategoryOverride', serviceCategoryOverrideSchema);

export default ServiceCategoryOverride;
