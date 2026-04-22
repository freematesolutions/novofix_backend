// services/internal/reminderJob.js
// Job recurrente en proceso que dispara los recordatorios de bookings.
// Busca Bookings con reminders pendientes (sent=false, scheduledFor<=now)
// y envía notificaciones in-app al profesional (+ socket) y marca como enviados.

import Booking from '../../models/Service/Booking.js';
import Client from '../../models/User/Client.js';
import notificationService from '../external/notificationService.js';

const TICK_MS = parseInt(process.env.REMINDER_TICK_MS, 10) || 5 * 60 * 1000; // 5 min
let intervalId = null;
let running = false;

async function runOnce() {
  if (running) return;
  running = true;
  const now = new Date();
  try {
    const bookings = await Booking.find({
      status: { $in: ['confirmed', 'provider_en_route', 'in_progress'] },
      reminders: {
        $elemMatch: { sent: false, scheduledFor: { $lte: now } }
      }
    })
      .populate('serviceRequest', 'basicInfo')
      .populate('client', 'profile')
      .limit(100);

    for (const booking of bookings) {
      let changed = false;
      for (const rem of booking.reminders) {
        if (rem.sent || !rem.scheduledFor || rem.scheduledFor > now) continue;
        try {
          const clientDoc = booking.client?.profile
            ? booking.client
            : await Client.findById(booking.client).select('profile').lean();
          const clientName = clientDoc?.profile
            ? `${clientDoc.profile.firstName || ''} ${clientDoc.profile.lastName || ''}`.trim()
            : '';

          await notificationService.sendProviderNotification({
            providerId: booking.provider,
            type: 'BOOKING_REMINDER',
            priority: 'high',
            data: {
              bookingId: booking._id,
              clientName,
              serviceTitle: booking.serviceRequest?.basicInfo?.title || '',
              scheduledDate: booking.schedule?.scheduledDate,
              scheduledTime: booking.schedule?.scheduledTime,
              window: rem.window || ''
            }
          });
          rem.sent = true;
          rem.sentAt = new Date();
          changed = true;
        } catch (err) {
          console.warn(`[reminderJob] failed to send reminder for booking ${booking._id}`, err?.message);
        }
      }
      if (changed) {
        try { await booking.save(); }
        catch (err) { console.warn(`[reminderJob] could not persist booking ${booking._id}`, err?.message); }
      }
    }
  } catch (err) {
    console.error('[reminderJob] runOnce error:', err?.message || err);
  } finally {
    running = false;
  }
}

export function startReminderJob() {
  if (intervalId) return;
  console.log(`[reminderJob] starting — tick every ${TICK_MS / 1000}s`);
  // Ejecutar una vez al arranque (tras un pequeño delay para permitir que la app termine de inicializar)
  setTimeout(() => { runOnce().catch(() => {}); }, 10_000);
  intervalId = setInterval(() => { runOnce().catch(() => {}); }, TICK_MS);
  // No mantener el proceso vivo solo por este timer
  if (typeof intervalId?.unref === 'function') intervalId.unref();
}

export function stopReminderJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export default { startReminderJob, stopReminderJob, runOnce };
