import Joi from 'joi';

export const messageSchema = Joi.object({
  chatId: Joi.string().required(),
  content: Joi.alternatives().try(
    Joi.string(),
    Joi.object({
      text: Joi.string(),
      attachments: Joi.array().items(Joi.object({
        type: Joi.string().valid('image', 'file', 'audio').required(),
        url: Joi.string().required(),
        metadata: Joi.object().optional()
      }))
    })
  ).required(),
  type: Joi.string().valid('text', 'image', 'file', 'system').default('text')
});

export const typingSchema = Joi.object({
  chatId: Joi.string().required()
});

export const chatActionSchema = Joi.object({
  chatId: Joi.string().required()
});