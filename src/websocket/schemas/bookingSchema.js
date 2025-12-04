import Joi from 'joi';

export const locationUpdateSchema = Joi.object({
  bookingId: Joi.string().required(),
  location: Joi.object({
    coordinates: Joi.object({
      lat: Joi.number().required().min(-90).max(90),
      lng: Joi.number().required().min(-180).max(180)
    }).required(),
    address: Joi.string().optional()
  }).required()
});

export const bookingActionSchema = Joi.object({
  bookingId: Joi.string().required()
});

export const statusUpdateSchema = Joi.object({
  bookingId: Joi.string().required(),
  status: Joi.string().required(),
  previousStatus: Joi.string().optional(),
  notes: Joi.string().optional()
});