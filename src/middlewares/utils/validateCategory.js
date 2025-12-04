// Middleware para validar categorías de servicios
import { SERVICE_CATEGORIES } from '../../config/categories.js';

/**
 * Valida que la categoría proporcionada sea válida según SERVICE_CATEGORIES
 * Puede validar en req.body.category, req.query.category o req.params.category
 */
export const validateCategory = (options = {}) => {
  const { 
    source = 'body', // 'body', 'query', 'params'
    required = true,
    fieldName = 'category'
  } = options;

  return (req, res, next) => {
    const category = req[source]?.[fieldName];

    // Si no es requerido y no está presente, pasar
    if (!required && !category) {
      return next();
    }

    // Si es requerido y no está presente, error
    if (required && !category) {
      return res.status(400).json({
        success: false,
        message: `${fieldName} is required`,
        validCategories: SERVICE_CATEGORIES
      });
    }

    // Validar que la categoría sea válida
    if (category && !SERVICE_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category: "${category}". Must be one of the supported categories.`,
        providedCategory: category,
        validCategories: SERVICE_CATEGORIES
      });
    }

    // Categoría válida, continuar
    next();
  };
};

/**
 * Valida múltiples categorías en un array
 */
export const validateCategories = (options = {}) => {
  const { 
    source = 'body',
    required = true,
    fieldName = 'categories'
  } = options;

  return (req, res, next) => {
    const categories = req[source]?.[fieldName];

    // Si no es requerido y no está presente, pasar
    if (!required && !categories) {
      return next();
    }

    // Si es requerido y no está presente, error
    if (required && !categories) {
      return res.status(400).json({
        success: false,
        message: `${fieldName} is required`,
        validCategories: SERVICE_CATEGORIES
      });
    }

    // Validar que sea un array
    if (!Array.isArray(categories)) {
      return res.status(400).json({
        success: false,
        message: `${fieldName} must be an array`
      });
    }

    // Validar cada categoría
    const invalidCategories = categories.filter(cat => !SERVICE_CATEGORIES.includes(cat));
    
    if (invalidCategories.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'One or more invalid categories provided',
        invalidCategories,
        validCategories: SERVICE_CATEGORIES
      });
    }

    // Todas las categorías válidas, continuar
    next();
  };
};

/**
 * Valida categorías en servicios de proveedor (array de objetos con category)
 */
export const validateProviderServices = (req, res, next) => {
  const services = req.body?.services;

  if (!services || !Array.isArray(services)) {
    return res.status(400).json({
      success: false,
      message: 'services must be an array'
    });
  }

  // Validar que cada servicio tenga una categoría válida
  const invalidServices = services.filter(service => 
    !service.category || !SERVICE_CATEGORIES.includes(service.category)
  );

  if (invalidServices.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'One or more services have invalid or missing categories',
      invalidServices: invalidServices.map(s => s.category || 'missing'),
      validCategories: SERVICE_CATEGORIES
    });
  }

  next();
};

export default validateCategory;
