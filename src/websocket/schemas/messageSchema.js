import Joi from 'joi';

export const messageSchema = Joi.object({
  chatId: Joi.string().required(),
  content: Joi.alternatives().try(
    Joi.string(),
    Joi.object({
      text: Joi.string(),
      attachments: Joi.array().items(Joi.object({
        type: Joi.string().valid('image', 'file', 'audio', 'video').required(),
        url: Joi.string().required(),
        metadata: Joi.object().optional()
      }))
    })
  ).required(),
  type: Joi.string().valid('text', 'image', 'file', 'video', 'system').default('text'),
  localId: Joi.string().optional(), // Client-side tracking ID for optimistic updates
  replyTo: Joi.string().allow(null).optional() // ID del mensaje al que se responde (puede ser null)
});

export const typingSchema = Joi.object({
  chatId: Joi.string().required()
});

export const chatActionSchema = Joi.object({
  chatId: Joi.string().required()
});