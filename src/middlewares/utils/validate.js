// middlewares/utils/validate.js
import Joi from 'joi';

// Generic request body validator using Joi schemas
export function validateBody(schema) {
  return async (req, res, next) => {
    try {
      if (!schema || !Joi.isSchema(schema)) return next();
      const value = await schema.validateAsync(req.body, { abortEarly: false, stripUnknown: true });
      req.body = value;
      next();
    } catch (err) {
      const details = err?.details?.map(d => d.message.replace(/"/g, '')) || [];
      return res.status(400).json({ success: false, message: 'Invalid request payload', errors: details });
    }
  };
}

// Optional: params validator for ObjectId-like paths
export function validateParams(schema) {
  return async (req, res, next) => {
    try {
      if (!schema || !Joi.isSchema(schema)) return next();
      const value = await schema.validateAsync(req.params, { abortEarly: false, stripUnknown: true });
      req.params = value;
      next();
    } catch (err) {
      const details = err?.details?.map(d => d.message.replace(/"/g, '')) || [];
      return res.status(400).json({ success: false, message: 'Invalid route parameters', errors: details });
    }
  };
}

// Optional: query-string validator. Useful for paginated/filterable GET endpoints
// such as the public CMS routes (?locale=es, ?category=general). Mirrors the
// behaviour of validateBody/validateParams to keep the API consistent.
export function validateQuery(schema) {
  return async (req, res, next) => {
    try {
      if (!schema || !Joi.isSchema(schema)) return next();
      const value = await schema.validateAsync(req.query, { abortEarly: false, stripUnknown: true });
      // Express 5+ may use a getter on req.query; assign field-by-field to stay safe.
      Object.keys(value).forEach((k) => { req.query[k] = value[k]; });
      next();
    } catch (err) {
      const details = err?.details?.map(d => d.message.replace(/"/g, '')) || [];
      return res.status(400).json({ success: false, message: 'Invalid query parameters', errors: details });
    }
  };
}

export default { validateBody, validateParams, validateQuery };
