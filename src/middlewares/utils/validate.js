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

export default { validateBody, validateParams };
