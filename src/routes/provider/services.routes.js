// routes/provider/services.routes.js
import express from 'express';
const router = express.Router();
import agendaService from '../../services/internal/agendaService.js';
import holidaysService, { DEFAULT_HOLIDAYS_COUNTRY } from '../../services/internal/holidaysService.js';
import {
  authenticateJWT,
  requireAuth
} from '../../middlewares/auth/jwtAuth.js';
import { providerOnly } from '../../middlewares/auth/rbacMiddleware.js';
import Provider from '../../models/User/Provider.js';
import Proposal from '../../models/Service/Proposal.js';
import Booking from '../../models/Service/Booking.js';

// Middlewares para proveedores autenticados
router.use(authenticateJWT);
router.use(requireAuth);
router.use(providerOnly);

// ───────────────────────────────────────────────────────────────────
// Gestión de disponibilidad (agenda del profesional)
// ───────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidTime(s) {
  return typeof s === 'string' && TIME_REGEX.test(s);
}
function timeToMinutes(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
function defaultWorkingHours() {
  return DAYS_OF_WEEK.reduce((acc, d) => {
    acc[d] = { start: '09:00', end: '18:00', available: false };
    return acc;
  }, {});
}

/**
 * GET /provider/services/availability/schedule
 * Devuelve workingHours + exceptions actuales del profesional.
 */
router.get('/availability/schedule', async (req, res) => {
  try {
    const provider = await Provider.findById(req.user._id)
      .select('providerProfile.availability')
      .lean();
    const availability = provider?.providerProfile?.availability || {};
    const workingHours = { ...defaultWorkingHours(), ...(availability.workingHours || {}) };
    const exceptions = Array.isArray(availability.exceptions) ? availability.exceptions : [];
    res.json({
      success: true,
      data: { workingHours, exceptions }
    });
  } catch (error) {
    console.error('GET /provider/services/availability/schedule error:', error);
    res.status(500).json({ success: false, message: 'Failed to get schedule' });
  }
});

/**
 * GET /provider/services/availability/slots?date=YYYY-MM-DD
 */
router.get('/availability/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.json({ success: true, data: { slots: [] } });
    }
    const slots = await agendaService.getProviderAvailableSlots(req.user._id, date);
    res.json({ success: true, data: { slots } });
  } catch (error) {
    console.error('GET /provider/services/availability/slots error:', error);
    res.status(500).json({ success: false, message: 'Failed to get available slots' });
  }
});

/**
 * PUT /provider/services/availability/schedule
 * Actualiza workingHours (patch parcial) y/o exceptions (reemplazo completo).
 * Valida formato HH:mm y que start < end.
 */
router.put('/availability/schedule', async (req, res) => {
  try {
    const { workingHours, exceptions } = req.body || {};
    const update = {};

    if (workingHours && typeof workingHours === 'object') {
      const sanitized = {};
      for (const day of DAYS_OF_WEEK) {
        if (!workingHours[day]) continue;
        const { start, end, available } = workingHours[day] || {};
        if (start && !isValidTime(start)) {
          return res.status(400).json({ success: false, message: `Invalid start time for ${day}` });
        }
        if (end && !isValidTime(end)) {
          return res.status(400).json({ success: false, message: `Invalid end time for ${day}` });
        }
        if (start && end && timeToMinutes(start) >= timeToMinutes(end)) {
          return res.status(400).json({ success: false, message: `Start must be before end for ${day}` });
        }
        sanitized[day] = {
          start: start || '09:00',
          end: end || '18:00',
          available: Boolean(available)
        };
      }
      // Merge con defaults para garantizar los 7 días
      const current = await Provider.findById(req.user._id).select('providerProfile.availability.workingHours').lean();
      const merged = { ...defaultWorkingHours(), ...(current?.providerProfile?.availability?.workingHours || {}), ...sanitized };
      update['providerProfile.availability.workingHours'] = merged;
    }

    if (Array.isArray(exceptions)) {
      const sanitizedEx = [];
      for (const ex of exceptions) {
        if (!ex?.date) continue;
        const d = new Date(ex.date);
        if (isNaN(d.getTime())) continue;
        if (!ex.allDay) {
          if (ex.startTime && !isValidTime(ex.startTime)) {
            return res.status(400).json({ success: false, message: 'Invalid exception startTime' });
          }
          if (ex.endTime && !isValidTime(ex.endTime)) {
            return res.status(400).json({ success: false, message: 'Invalid exception endTime' });
          }
        }
        sanitizedEx.push({
          date: d,
          reason: String(ex.reason || '').slice(0, 200),
          allDay: Boolean(ex.allDay),
          startTime: ex.allDay ? undefined : ex.startTime,
          endTime: ex.allDay ? undefined : ex.endTime
        });
      }
      update['providerProfile.availability.exceptions'] = sanitizedEx;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const updated = await Provider.findByIdAndUpdate(
      req.user._id,
      { $set: update },
      { new: true }
    ).select('providerProfile.availability').lean();

    res.json({
      success: true,
      message: 'Availability schedule updated successfully',
      data: {
        workingHours: updated?.providerProfile?.availability?.workingHours || defaultWorkingHours(),
        exceptions: updated?.providerProfile?.availability?.exceptions || []
      }
    });
  } catch (error) {
    console.error('PUT /provider/services/availability/schedule error:', error);
    res.status(500).json({ success: false, message: 'Failed to update availability schedule' });
  }
});

/**
 * POST /provider/services/availability/exceptions
 * Añade una excepción puntual (bloqueo de día/horario).
 */
router.post('/availability/exceptions', async (req, res) => {
  try {
    const { date, reason, allDay, startTime, endTime } = req.body || {};
    if (!date) {
      return res.status(400).json({ success: false, message: 'date is required' });
    }
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date' });
    }
    const isAllDay = Boolean(allDay);
    if (!isAllDay) {
      if (!isValidTime(startTime) || !isValidTime(endTime)) {
        return res.status(400).json({ success: false, message: 'startTime/endTime required in HH:mm' });
      }
      if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
        return res.status(400).json({ success: false, message: 'startTime must be before endTime' });
      }
    }
    const exception = {
      date: d,
      reason: String(reason || '').slice(0, 200),
      allDay: isAllDay,
      ...(isAllDay ? {} : { startTime, endTime })
    };
    const updated = await Provider.findByIdAndUpdate(
      req.user._id,
      { $push: { 'providerProfile.availability.exceptions': exception } },
      { new: true }
    ).select('providerProfile.availability.exceptions').lean();

    res.status(201).json({
      success: true,
      message: 'Exception added',
      data: { exceptions: updated?.providerProfile?.availability?.exceptions || [] }
    });
  } catch (error) {
    console.error('POST /provider/services/availability/exceptions error:', error);
    res.status(500).json({ success: false, message: 'Failed to add exception' });
  }
});

/**
 * DELETE /provider/services/availability/exceptions/:id
 * Elimina una excepción por su _id.
 */
router.delete('/availability/exceptions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'id required' });
    const updated = await Provider.findByIdAndUpdate(
      req.user._id,
      { $pull: { 'providerProfile.availability.exceptions': { _id: id } } },
      { new: true }
    ).select('providerProfile.availability.exceptions').lean();
    res.json({
      success: true,
      message: 'Exception removed',
      data: { exceptions: updated?.providerProfile?.availability?.exceptions || [] }
    });
  } catch (error) {
    console.error('DELETE /provider/services/availability/exceptions/:id error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove exception' });
  }
});

/**
 * GET /provider/services/availability/month?year=YYYY&month=MM
 * Resumen por día del mes: workingDay, bookingsCount, exceptions, isToday.
 * month es 1-12.
 */
router.get('/availability/month', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10); // 1-12
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: 'year and month (1-12) are required' });
    }

    const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const [provider, bookings] = await Promise.all([
      Provider.findById(req.user._id).select('providerProfile.availability').lean(),
      Booking.find({
        provider: req.user._id,
        'schedule.scheduledDate': { $gte: monthStart, $lte: monthEnd },
        status: { $in: ['confirmed', 'provider_en_route', 'in_progress', 'completed'] }
      }).select('schedule.scheduledDate schedule.scheduledTime status').lean()
    ]);

    const workingHours = provider?.providerProfile?.availability?.workingHours || defaultWorkingHours();
    const exceptions = provider?.providerProfile?.availability?.exceptions || [];

    const country = (req.query.country || DEFAULT_HOLIDAYS_COUNTRY).toString().toUpperCase();
    const holidaysMap = holidaysService.getHolidaysMap(country, year);

    const bookingsByDay = new Map();
    for (const b of bookings) {
      const d = new Date(b.schedule.scheduledDate);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      bookingsByDay.set(key, (bookingsByDay.get(key) || 0) + 1);
    }

    const exceptionsByDay = new Map();
    for (const ex of exceptions) {
      if (!ex?.date) continue;
      const d = new Date(ex.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const arr = exceptionsByDay.get(key) || [];
      arr.push({ allDay: !!ex.allDay, reason: ex.reason, startTime: ex.startTime, endTime: ex.endTime });
      exceptionsByDay.set(key, arr);
    }

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(year, month - 1, d));
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const weekday = DAYS_OF_WEEK[(dt.getUTCDay() + 6) % 7]; // monday=0
      const wh = workingHours?.[weekday];
      const dayExceptions = exceptionsByDay.get(key) || [];
      const hasAllDayBlock = dayExceptions.some(e => e.allDay);
      const holiday = holidaysMap.get(key) || null;
      days.push({
        date: key,
        weekday,
        workingDay: !!wh?.available && !hasAllDayBlock,
        workingHours: wh ? { start: wh.start, end: wh.end, available: !!wh.available } : null,
        bookingsCount: bookingsByDay.get(key) || 0,
        exceptions: dayExceptions,
        hasException: dayExceptions.length > 0,
        isHoliday: !!holiday,
        holidayName: holiday?.name || null
      });
    }

    res.json({ success: true, data: { year, month, country, days } });
  } catch (error) {
    console.error('GET /provider/services/availability/month error:', error);
    res.status(500).json({ success: false, message: 'Failed to get month overview' });
  }
});

/**
 * GET /provider/services/availability/day?date=YYYY-MM-DD
 * Devuelve slots libres + bookings ocupados del día.
 */
router.get('/availability/day', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'date is required' });
    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date' });
    }

    const dayStart = new Date(targetDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate); dayEnd.setHours(23, 59, 59, 999);

    const [slots, bookings, provider] = await Promise.all([
      agendaService.getProviderAvailableSlots(req.user._id, date),
      Booking.find({
        provider: req.user._id,
        'schedule.scheduledDate': { $gte: dayStart, $lte: dayEnd },
        status: { $in: ['confirmed', 'provider_en_route', 'in_progress', 'completed'] }
      })
        .populate('client', 'profile contact')
        .populate('serviceRequest', 'basicInfo location')
        .sort({ 'schedule.scheduledTime': 1 })
        .lean(),
      Provider.findById(req.user._id).select('providerProfile.availability').lean()
    ]);

    const weekday = DAYS_OF_WEEK[(targetDate.getDay() + 6) % 7];
    const wh = provider?.providerProfile?.availability?.workingHours?.[weekday] || null;
    const exceptions = (provider?.providerProfile?.availability?.exceptions || []).filter(ex => {
      if (!ex?.date) return false;
      const d = new Date(ex.date);
      return d.toDateString() === targetDate.toDateString();
    });

    const country = (req.query.country || DEFAULT_HOLIDAYS_COUNTRY).toString().toUpperCase();
    const holidaysMap = holidaysService.getHolidaysMap(country, targetDate.getFullYear());
    const holiday = holidaysMap.get(date) || null;

    res.json({
      success: true,
      data: {
        date,
        weekday,
        workingHours: wh,
        slots,
        bookings: bookings.map(b => ({
          _id: b._id,
          scheduledTime: b.schedule?.scheduledTime,
          estimatedDuration: b.schedule?.estimatedDuration,
          status: b.status,
          clientName: b.client?.profile
            ? `${b.client.profile.firstName || ''} ${b.client.profile.lastName || ''}`.trim()
            : null,
          serviceTitle: b.serviceRequest?.basicInfo?.title || null,
          category: b.serviceRequest?.basicInfo?.category || null
        })),
        exceptions,
        isHoliday: !!holiday,
        holidayName: holiday?.name || null
      }
    });
  } catch (error) {
    console.error('GET /provider/services/availability/day error:', error);
    res.status(500).json({ success: false, message: 'Failed to get day overview' });
  }
});

/**
 * GET /provider/services/holidays?year=YYYY&country=AR
 * Devuelve la lista de feriados públicos/bancarios del país y año.
 */
router.get('/holidays', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const country = (req.query.country || DEFAULT_HOLIDAYS_COUNTRY).toString().toUpperCase();
    const holidays = holidaysService.getHolidays(country, year);
    res.json({ success: true, data: { year, country, holidays } });
  } catch (error) {
    console.error('GET /provider/services/holidays error:', error);
    res.status(500).json({ success: false, message: 'Failed to get holidays' });
  }
});

/**
 * GET /provider/services/upcoming-jobs?days=7
 * Próximos trabajos del profesional (bookings activos) en los próximos N días.
 */
router.get('/upcoming-jobs', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 60);
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const bookings = await Booking.find({
      provider: req.user._id,
      'schedule.scheduledDate': { $gte: now, $lte: end },
      status: { $in: ['confirmed', 'provider_en_route', 'in_progress'] }
    })
      .populate('client', 'profile contact')
      .populate('serviceRequest', 'basicInfo location')
      .sort({ 'schedule.scheduledDate': 1, 'schedule.scheduledTime': 1 })
      .limit(50)
      .lean();

    const items = bookings.map(b => ({
      _id: b._id,
      scheduledDate: b.schedule?.scheduledDate,
      scheduledTime: b.schedule?.scheduledTime,
      estimatedDuration: b.schedule?.estimatedDuration,
      status: b.status,
      clientName: b.client?.profile
        ? `${b.client.profile.firstName || ''} ${b.client.profile.lastName || ''}`.trim()
        : null,
      clientPhone: b.client?.contact?.phone || null,
      serviceTitle: b.serviceRequest?.basicInfo?.title || null,
      category: b.serviceRequest?.basicInfo?.category || null,
      address: b.serviceRequest?.location?.address || null
    }));

    res.json({ success: true, data: { days, count: items.length, items } });
  } catch (error) {
    console.error('GET /provider/services/upcoming-jobs error:', error);
    res.status(500).json({ success: false, message: 'Failed to get upcoming jobs' });
  }
});

// Verificar conflicto de disponibilidad
router.post('/availability/check-conflict', async (req, res) => {
  try {
    const { date, time } = req.body;
    const hasConflict = await agendaService.checkAvailabilityConflict(req.user._id, date, time);
    res.json({ success: true, data: { hasConflict } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to check availability conflict' });
  }
});

// Obtener estadísticas del proveedor
router.get('/stats', async (req, res) => {
  try {
    const provider = await Provider.findById(req.user._id);
    
    const [
      totalProposals,
      acceptedProposals,
      completedBookings,
      totalRevenue
    ] = await Promise.all([
      Proposal.countDocuments({ provider: req.user._id }),
      Proposal.countDocuments({ provider: req.user._id, status: 'accepted' }),
      Booking.countDocuments({ provider: req.user._id, status: 'completed' }),
      Booking.aggregate([
        {
          $match: {
            provider: req.user._id,
            'payment.status': 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$payment.providerEarnings' }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        profile: provider.providerProfile,
        stats: {
          totalProposals,
          acceptedProposals,
          acceptanceRate: totalProposals > 0 ? (acceptedProposals / totalProposals) * 100 : 0,
          completedBookings,
          totalRevenue: totalRevenue[0]?.total || 0,
          averageRating: provider.providerProfile.rating.average
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get provider stats'
    });
  }
});

export default router;