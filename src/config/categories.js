// Lista maestra de categorías de servicios (22 categorías)
// Sincronizada con frontend (client/src/utils/categories.js)

export const SERVICE_CATEGORIES = [
  'Reparaciones',
  'Plomería',
  'Electricidad',
  'Climatización',
  'Cerrajería',
  'Mantenimiento',
  'Control de Plagas',
  'Limpieza',
  'Pintura',
  'Gabinetes',
  'Pisos',
  'Cocina',
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
  'Carpintería': 'Gabinetes',
  'Piscina': 'Piscinas'
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
    'Cerrajería': 'Acceso y seguridad',
    'Mantenimiento': 'Siempre impecable',
    'Control de Plagas': '100% protegido',
    'Limpieza': 'Brillo total',
    'Pintura': 'Acabados de lujo',
    'Gabinetes': 'Diseños a medida',
    'Pisos': 'Pisadas con elegancia',
    'Cocina': 'Equipamiento y confort',
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

export default SERVICE_CATEGORIES;
