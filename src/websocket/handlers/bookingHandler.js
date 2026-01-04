import { EVENTS } from '../constants/socketEvents.js';
import { ROOMS } from '../constants/socketRooms.js';
import { locationUpdateSchema, bookingActionSchema, statusUpdateSchema } from '../schemas/bookingSchema.js';
import Booking from '../../models/Service/Booking.js';

export class BookingHandler {
  constructor(io) {
    this.io = io;
  }

  initialize(socket) {
    socket.on(EVENTS.BOOKING.TRACK, (data) => this.handleTrackBooking(socket, data));
    socket.on(EVENTS.BOOKING.UNTRACK, (data) => this.handleUntrackBooking(socket, data));
    socket.on(EVENTS.BOOKING.LOCATION.UPDATE, (data) => this.handleLocationUpdate(socket, data));
    socket.on(EVENTS.BOOKING.STATUS_UPDATE, (data) => this.handleStatusUpdate(socket, data));
  }

  async handleTrackBooking(socket, data) {
    try {
      // Validate data
      const { error, value } = bookingActionSchema.validate(data);
      if (error) {
        return socket.emit('error', {
          code: 'VALIDATION_ERROR',
          message: error.details.map(d => d.message).join(', ')
        });
      }

      const { bookingId } = value;

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

  handleUntrackBooking(socket, data) {
    try {
      // Validate data
      const { error, value } = bookingActionSchema.validate(data);
      if (error) {
        return;
      }

      const { bookingId } = value;
      socket.leave(ROOMS.BOOKING(bookingId));
      console.log(`User ${socket.userId} stopped tracking booking: ${bookingId}`);
    } catch (error) {
      // Silent fail
    }
  }

  handleLocationUpdate(socket, locationData) {
    try {
      // Validate data
      const { error, value } = locationUpdateSchema.validate(locationData);
      if (error) {
        return socket.emit('error', {
          code: 'VALIDATION_ERROR',
          message: error.details.map(d => d.message).join(', ')
        });
      }

      const { bookingId, location } = value;

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
    } catch (error) {
      socket.emit('error', {
        code: 'LOCATION_ERROR',
        message: error.message
      });
    }
  }

  handleStatusUpdate(socket, statusData) {
    try {
      // Validate data
      const { error, value } = statusUpdateSchema.validate(statusData);
      if (error) {
        return socket.emit('error', {
          code: 'VALIDATION_ERROR',
          message: error.details.map(d => d.message).join(', ')
        });
      }

      const { bookingId, status, previousStatus, notes } = value;
      
      this.io.to(ROOMS.BOOKING(bookingId)).emit(EVENTS.BOOKING.STATUS.CHANGED, {
        bookingId,
        status,
        previousStatus,
        notes,
        updatedBy: socket.userId,
        timestamp: new Date()
      });

      console.log(`Status update for booking ${bookingId}: ${status}`);
    } catch (error) {
      socket.emit('error', {
        code: 'STATUS_ERROR',
        message: error.message
      });
    }
  }
}