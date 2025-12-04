import { ValidationError } from '../utils/errors.js';

export const validatePayload = (schema) => (packet, next) => {
  const [event, data] = packet;
  
  try {
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      return next(new ValidationError(error.details.map(d => d.message).join(', ')));
    }

    // Reemplazar datos con los validados
    packet[1] = value;
    next();
  } catch (err) {
    next(new ValidationError('Invalid payload format'));
  }
};

export const validateEvent = (eventName) => (packet, next) => {
  const [event] = packet;
  if (event !== eventName) {
    return next(new ValidationError(`Invalid event: ${event}`));
  }
  next();
};