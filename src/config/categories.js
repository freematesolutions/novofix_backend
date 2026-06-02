// Lista maestra de categorías de servicios (22 categorías)
// Sincronizada con frontend (client/src/utils/categories.js)

export const SERVICE_CATEGORIES = [
  'Reparaciones',
  'Plomería',
  'Electricidad',
  'Climatización',
  'Refrigeración',
  'Cerrajería',
  'Garaje',
  'Control de Plagas',
  'Limpieza',
  'Pintura',
  'Pisos',
  'Remodelación',
  'Jardinería',
  'Piscinas',
  'Techado',
  'Cercas',
  'Pérgolas',
  'Ventanas',
  'Construcción',
  'Mudanzas',
  'Seguridad'
];

// Mapa de migración: claves antiguas → claves nuevas
// Usado para compatibilidad con datos existentes en la BD
export const CATEGORY_MIGRATION_MAP = {
  'Handiman': 'Reparaciones',
  'Plumb': 'Plomería',
  'Electricista': 'Electricidad',
  'HVAC': 'Climatización',
  'Cerrajeria': 'Cerrajería',
  'Control de plagas': 'Control de Plagas',
  // 2026-06 — 'Carpintería' y 'Gabinetes' se retiran del catálogo. Se remapean a 'Remodelación'.
  'Carpintería': 'Remodelación',
  'Gabinetes': 'Remodelación',
  // 2026-06 — 'Cocina' también se retira; remap a 'Remodelación' por afinidad funcional.
  'Cocina': 'Remodelación',
  'Piscina': 'Piscinas',
  // 2026-06 — Rebranding: la categoría 'Mantenimiento' pasó a llamarse 'Garaje'.
  // Mantener el mapeo para que documentos antiguos en MongoDB se normalicen automáticamente.
  'Mantenimiento': 'Garaje'
};

/**
 * Normaliza una categoría antigua al nuevo nombre
 * @param {string} category - Nombre de categoría (puede ser antiguo o nuevo)
 * @returns {string} Nombre normalizado de la categoría
 */
export function normalizeCategory(category) {
  return CATEGORY_MIGRATION_MAP[category] || category;
}

// Categorías con descripción (para UI y API)
function getCategoryDescription(category) {
  const descriptions = {
    'Reparaciones': 'Soluciones hoy mismo',
    'Plomería': 'Cero fugas, cero estrés',
    'Electricidad': 'Energía segura',
    'Climatización': 'Tu clima perfecto',
    'Refrigeración': 'Frío confiable, sin pausas',
    'Cerrajería': 'Acceso y seguridad',
    'Garaje': 'Tu garaje, listo y ordenado',
    'Control de Plagas': '100% protegido',
    'Limpieza': 'Brillo total',
    'Pintura': 'Acabados de lujo',
    'Pisos': 'Pisadas con elegancia',
    'Remodelación': 'Estrena tu casa',
    'Jardinería': 'Jardines de revista',
    'Piscinas': 'Oasis cristalino',
    'Techado': 'Cobertura de nivel',
    'Cercas': 'Privacidad con estilo',
    'Pérgolas': 'Sombra y estilo',
    'Ventanas': 'Vistas de impacto',
    'Construcción': 'Estructuras garantizadas',
    'Mudanzas': 'Traslados seguros',
    'Seguridad': 'Protección garantizada'
  };
  return descriptions[category] || '';
}

export const SERVICE_CATEGORIES_WITH_DESCRIPTION = SERVICE_CATEGORIES.map(cat => ({
  value: cat,
  label: cat,
  description: getCategoryDescription(cat)
}));

/**
 * Slug URL-safe a partir del nombre canónico de la categoría.
 * Implementación gemela del helper que vive en
 * `client/src/utils/categories.js` — debe permanecer 100% sincronizada
 * para que las URLs del sitemap coincidan con las que el SPA resuelve.
 */
export function slugifyCategory(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default SERVICE_CATEGORIES;
