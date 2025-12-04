// services/internal/agendaService.js
import Provider from '../../models/User/Provider.js';
import Booking from '../../models/Service/Booking.js';

class AgendaService {
  async blockProviderAvailability(providerId, bookingId, schedule) {
    try {
      const { scheduledDate, scheduledTime, estimatedDuration } = schedule;

      // Verificar conflicto de disponibilidad
      const hasConflict = await this.checkAvailabilityConflict(providerId, scheduledDate, scheduledTime);
      if (hasConflict) {
        throw new Error('Provider has scheduling conflict');
      }

      // Bloquear agenda
      await Provider.findByIdAndUpdate(providerId, {
        $push: {
          'providerProfile.availability.exceptions': {
            date: scheduledDate,
            reason: `Booking: ${bookingId}`,
            allDay: false,
            startTime: scheduledTime,
            endTime: this.calculateEndTime(scheduledTime, estimatedDuration)
          }
        }
      });

      return {
        success: true,
        message: 'Availability blocked successfully'
      };
    } catch (error) {
      console.error('AgendaService - blockProviderAvailability error:', error);
      throw error;
    }
  }

  async checkAvailabilityConflict(providerId, date, time) {
    const provider = await Provider.findById(providerId).lean();
    if (!provider) throw new Error('Provider not found');

    const targetDate = new Date(date);
    const dayOfWeek = targetDate.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
    
    // Verificar horas laborales
    const workingHours = provider?.providerProfile?.availability?.workingHours?.[dayOfWeek];
    if (!workingHours?.available || !workingHours.start || !workingHours.end) {
      return true; // No trabaja ese día
    }

    if (time < workingHours.start || time > workingHours.end) {
      return true; // Fuera de horario laboral
    }

    // Verificar excepciones/bloqueos existentes
    const hasException = (provider?.providerProfile?.availability?.exceptions || []).some(exception => {
      const exceptionDate = new Date(exception.date).toDateString();
      const targetDateStr = targetDate.toDateString();
      
      return exceptionDate === targetDateStr && 
             !exception.allDay &&
             this.isTimeOverlap(time, exception.startTime, exception.endTime);
    });

    if (hasException) return true;

    // Verificar bookings existentes
    const existingBookings = await Booking.find({
      provider: providerId,
      'schedule.scheduledDate': {
        $gte: new Date(targetDate.setHours(0, 0, 0, 0)),
        $lt: new Date(targetDate.setHours(23, 59, 59, 999))
      },
      status: { $in: ['confirmed', 'provider_en_route', 'in_progress'] }
    }).lean();

    return existingBookings.some(booking => 
      this.isTimeOverlap(time, booking.schedule.scheduledTime, 
        this.calculateEndTime(booking.schedule.scheduledTime, booking.schedule.estimatedDuration))
    );
  }

  isTimeOverlap(time, startTime, endTime) {
    if (!time || !startTime || !endTime) return false;
    return time >= startTime && time <= endTime;
  }

  calculateEndTime(startTime, estimatedDuration) {
    try {
      if (!startTime || typeof startTime !== 'string') return startTime || '00:00';
      const parts = startTime.split(':');
      if (parts.length < 2) return startTime;
      const [hours, minutes] = parts.map(Number);
      const startDate = new Date();
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return startTime;
      startDate.setHours(hours, minutes, 0, 0);
      const dur = Number(estimatedDuration);
      const durMs = Number.isFinite(dur) ? dur * 60 * 60 * 1000 : 60 * 60 * 1000; // default 1h
      const endDate = new Date(startDate.getTime() + durMs);
      const hh = String(endDate.getHours()).padStart(2, '0');
      const mm = String(endDate.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    } catch {
      return startTime || '00:00';
    }
  }

  async releaseProviderAvailability(providerId, bookingId) {
    try {
      await Provider.findByIdAndUpdate(providerId, {
        $pull: {
          'providerProfile.availability.exceptions': {
            reason: { $regex: bookingId }
          }
        }
      });

      return {
        success: true,
        message: 'Availability released successfully'
      };
    } catch (error) {
      console.error('AgendaService - releaseProviderAvailability error:', error);
      throw error;
    }
  }

  async getProviderAvailableSlots(providerId, date) {
    try {
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
      
      const provider = await Provider.findById(providerId).lean();
      if (!provider) return [];
      const workingHours = provider?.providerProfile?.availability?.workingHours?.[dayOfWeek];

      if (!workingHours?.available || !workingHours.start || !workingHours.end) {
        return []; // No disponible ese día
      }

      // Generar slots disponibles basados en horario laboral y bookings existentes
      const availableSlots = this.generateTimeSlots(
        workingHours.start,
        workingHours.end,
        60 // slot de 60 minutos
      );

      // Filtrar slots conflictivos
      const filteredSlots = await this.filterConflictSlots(providerId, targetDate, availableSlots);

      return filteredSlots;
    } catch (error) {
      console.error('AgendaService - getProviderAvailableSlots error:', error);
      throw error;
    }
  }

  generateTimeSlots(startTime, endTime, slotDuration) {
    const slots = [];
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    let currentHour = startHour;
    let currentMinute = startMinute;

    while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
      const timeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
      slots.push(timeString);

      currentMinute += slotDuration;
      if (currentMinute >= 60) {
        currentHour += Math.floor(currentMinute / 60);
        currentMinute = currentMinute % 60;
      }
    }

    return slots;
  }

  async filterConflictSlots(providerId, date, slots) {
    const conflicts = await this.getProviderConflicts(providerId, date);
    return slots.filter(slot => !conflicts.some(conflict => 
      this.isTimeOverlap(slot, conflict.startTime, conflict.endTime)
    ));
  }

  async getProviderConflicts(providerId, date) {
    const provider = await Provider.findById(providerId).lean();
    if (!provider) return [];
    const exceptions = (provider?.providerProfile?.availability?.exceptions || []).filter(exception => {
      const exceptionDate = new Date(exception.date).toDateString();
      return exceptionDate === date.toDateString();
    });

    const bookings = await Booking.find({
      provider: providerId,
      'schedule.scheduledDate': {
        $gte: new Date(date.setHours(0, 0, 0, 0)),
        $lt: new Date(date.setHours(23, 59, 59, 999))
      },
      status: { $in: ['confirmed', 'provider_en_route', 'in_progress'] }
    }).lean();

    return [
      ...exceptions.map(e => ({ startTime: e.startTime, endTime: e.endTime })),
      ...bookings.map(b => ({ 
        startTime: b.schedule.scheduledTime, 
        endTime: this.calculateEndTime(b.schedule.scheduledTime, b.schedule.estimatedDuration)
      }))
    ];
  }
}

export default new AgendaService();