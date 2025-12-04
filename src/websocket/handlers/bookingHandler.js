import { EVENTS } from '../constants/socketEvents.js';
import { ROOMS } from '../constants/socketRooms.js';
import { locationUpdateSchema, bookingActionSchema, statusUpdateSchema } from '../schemas/bookingSchema.js';
import { validatePayload } from '../middleware/schemaValidator.js';
import Booking from '../../models/Service/Booking.js';

export class BookingHandler {
  constructor(io) {
    this.io = io;
  }

  initialize(socket) {
    socket.on(EVENTS.BOOKING.TRACK, validatePayload(bookingActionSchema), this.handleTrackBooking.bind(this, socket));
    socket.on(EVENTS.BOOKING.UNTRACK, validatePayload(bookingActionSchema), this.handleUntrackBooking.bind(this, socket));
    socket.on(EVENTS.BOOKING.LOCATION.UPDATE, validatePayload(locationUpdateSchema), this.handleLocationUpdate.bind(this, socket));
    socket.on(EVENTS.BOOKING.STATUS_UPDATE, validatePayload(statusUpdateSchema), this.handleStatusUpdate.bind(this, socket));
  }

  async handleTrackBooking(socket, { bookingId }) {
    try {
      const booking = await Booking.findOne({
        _id: bookingId,
        $or: [
          { client: socket.userId },
          { provider: socket.userId }
        ]
      });

      if (!booking) {
        throw new Error('Booking not found or access denied');
      }

      socket.join(ROOMS.BOOKING(bookingId));
      console.log(`User ${socket.userId} tracking booking: ${bookingId}`);
    } catch (error) {
      socket.emit('error', {
        code: 'BOOKING_ERROR',
        message: error.message
      });
    }
  }

  handleUntrackBooking(socket, { bookingId }) {
    socket.leave(ROOMS.BOOKING(bookingId));
    console.log(`User ${socket.userId} stopped tracking booking: ${bookingId}`);
  }

  handleLocationUpdate(socket, locationData) {
    const { bookingId, location } = locationData;

    // Verificar que solo los providers pueden actualizar ubicación
    if (socket.userRole !== 'provider') {
      return socket.emit('error', {
        code: 'PERMISSION_ERROR',
        message: 'Only providers can update location'
      });
    }
    
    // Emitir a cliente y admin que están trackeando este booking
    socket.to(ROOMS.BOOKING(bookingId)).emit(EVENTS.BOOKING.LOCATION.CHANGED, {
      bookingId,
      providerId: socket.userId,
      providerName: socket.userData.name,
      location: {
        ...location,
        timestamp: new Date()
      }
    });

    console.log(`Location update for booking ${bookingId} by provider ${socket.userId}`);
  }

  handleStatusUpdate(socket, statusData) {
    const { bookingId, status, previousStatus, notes } = statusData;
    
    this.io.to(ROOMS.BOOKING(bookingId)).emit(EVENTS.BOOKING.STATUS.CHANGED, {
      bookingId,
      status,
      previousStatus,
      notes,
      updatedBy: socket.userId,
      timestamp: new Date()
    });

    console.log(`Status update for booking ${bookingId}: ${status}`);
  }
}