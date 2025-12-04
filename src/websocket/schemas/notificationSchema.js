import Joi from 'joi';

export const notificationSchema = Joi.object({
  type: Joi.string().required(),
  title: Joi.string().required(),
  message: Joi.string().required(),
  priority: Joi.string().valid('low', 'medium', 'high').default('medium'),
  data: Joi.object().optional()
});

export const notificationBatchSchema = Joi.object({
  recipients: Joi.array().items(Joi.string()).min(1).required(),
  notification: Joi.object({
    type: Joi.string().required(),
    title: Joi.string().required(),
    message: Joi.string().required(),
    priority: Joi.string().valid('low', 'medium', 'high').default('medium'),
    data: Joi.object().optional()
  }).required()
});