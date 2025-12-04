// Lista maestra de categorías de servicios
// Sincronizada con frontend (client/src/utils/categories.js)

export const SERVICE_CATEGORIES = [
  'Plomería',
  'Electricidad',
  'Carpintería',
  'Pintura',
  'Limpieza',
  'Jardinería',
  'Cerrajería',
  'Albañilería',
  'Reparación de electrodomésticos',
  'Instalación de aire acondicionado',
  'Mudanzas',
  'Fumigación',
  'Tecnología e informática',
  'Clases particulares',
  'Belleza y estética',
  'Mecánica automotriz',
  'Fotografía',
  'Catering',
  'Construcción',
  'Decoración',
  'Diseño gráfico',
  'Asesoría legal',
  'Contabilidad',
  'Marketing digital',
  'Traducción',
  'Otro'
];

// Categorías con descripción (para UI y API)
function getCategoryDescription(category) {
  const descriptions = {
    'Plomería': 'Instalación y reparación de sistemas de agua y drenaje',
    'Electricidad': 'Instalaciones eléctricas, reparaciones y mantenimiento',
    'Carpintería': 'Muebles, estructuras de madera y reparaciones',
    'Pintura': 'Pintura interior y exterior, revestimientos',
    'Limpieza': 'Limpieza profunda, mantenimiento regular',
    'Jardinería': 'Diseño, mantenimiento de jardines y áreas verdes',
    'Cerrajería': 'Apertura de puertas, instalación de cerraduras',
    'Albañilería': 'Construcción, remodelación, reparaciones estructurales',
    'Reparación de electrodomésticos': 'Reparación de lavadoras, refrigeradores, etc.',
    'Instalación de aire acondicionado': 'Instalación, mantenimiento y reparación',
    'Mudanzas': 'Transporte y logística de mudanzas',
    'Fumigación': 'Control de plagas y desinfección',
    'Tecnología e informática': 'Soporte técnico, reparación de computadoras',
    'Clases particulares': 'Educación personalizada en diversas materias',
    'Belleza y estética': 'Servicios de belleza, peluquería, estética',
    'Mecánica automotriz': 'Reparación y mantenimiento de vehículos',
    'Fotografía': 'Fotografía profesional para eventos y productos',
    'Catering': 'Servicio de comidas para eventos',
    'Construcción': 'Proyectos de construcción y remodelación',
    'Decoración': 'Diseño de interiores y decoración',
    'Diseño gráfico': 'Diseño de logotipos, branding, publicidad',
    'Asesoría legal': 'Consultoría legal y representación',
    'Contabilidad': 'Servicios contables y fiscales',
    'Marketing digital': 'Estrategias de marketing online',
    'Traducción': 'Servicios de traducción e interpretación',
    'Otro': 'Otros servicios profesionales'
  };
  return descriptions[category] || '';
}

export const SERVICE_CATEGORIES_WITH_DESCRIPTION = SERVICE_CATEGORIES.map(cat => ({
  value: cat,
  label: cat,
  description: getCategoryDescription(cat)
}));

export default SERVICE_CATEGORIES;
