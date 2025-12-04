import { getIO } from '../../config/socket.js';
import { EVENTS } from '../../websocket/constants/socketEvents.js';
import { ROOMS } from '../../websocket/constants/socketRooms.js';

class EmitterService {
  constructor() {
    this.io = null;
    // Debounce storage for counters updates
    this._countersTimers = new Map(); // userId -> timer
    this._countersPayloads = new Map(); // userId -> merged payload
  }

  initialize() {
    try {
      this.io = getIO();
    } catch (error) {
      console.error('EmitterService - Failed to get Socket.io instance:', error);
    }
  }

  emitToUser(userId, event, data) {
    if (!this.io) this.initialize();
    if (this.io) {
      this.io.to(ROOMS.USER(userId)).emit(event, data);
    }
  }

  emitToUsers(userIds, event, data) {
    if (!this.io) this.initialize();
    if (this.io) {
      userIds.forEach(userId => {
        this.emitToUser(userId, event, data);
      });
    }
  }

  emitToRoom(room, event, data) {
    if (!this.io) this.initialize();
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }

  emitToRole(role, event, data) {
    if (!this.io) this.initialize();
    if (this.io) {
      const roleRoom = ROOMS.ROLE[role.toUpperCase()];
      if (roleRoom) {
        this.io.to(roleRoom).emit(event, data);
      }
    }
  }

  emitNotification(userId, notification) {
    this.emitToUser(userId, EVENTS.NOTIFICATION.NEW, notification);
  }

  emitChatMessage(chatId, message) {
    this.emitToRoom(ROOMS.CHAT(chatId), EVENTS.CHAT.MESSAGE.RECEIVED, message);
  }

  emitBookingUpdate(bookingId, update) {
    this.emitToRoom(ROOMS.BOOKING(bookingId), EVENTS.BOOKING.STATUS.CHANGED, update);
  }

  // Counters helpers
  emitCountersUpdateToUser(userId, payload = {}) {
    this.emitToUser(userId, EVENTS.COUNTERS.UPDATE, { ts: Date.now(), ...payload });
  }

  emitCountersUpdateToUsers(userIds = [], payload = {}) {
    (userIds || []).forEach((u) => this.emitCountersUpdateToUser(u, payload));
  }

  // Debounced emit to coalesce bursts (e.g., rapid chat messages)
  emitCountersUpdateToUserDebounced(userId, payload = {}, delayMs = 300) {
    if (!userId) return;
    // Merge payloads (reasons) across the debounce window
    const prev = this._countersPayloads.get(String(userId)) || {};
    const merged = { ...prev, ...payload };
    const reasons = [
      ...(Array.isArray(prev.reasons) ? prev.reasons : (prev.reason ? [prev.reason] : [])),
      ...(Array.isArray(payload.reasons) ? payload.reasons : (payload.reason ? [payload.reason] : []))
    ];
    if (reasons.length) merged.reasons = Array.from(new Set(reasons));
    delete merged.reason;
    this._countersPayloads.set(String(userId), merged);

    // Reset timer
    if (this._countersTimers.has(String(userId))) {
      clearTimeout(this._countersTimers.get(String(userId)));
    }
    const timer = setTimeout(() => {
      try {
        const payloadToSend = this._countersPayloads.get(String(userId)) || {};
        this.emitCountersUpdateToUser(userId, payloadToSend);
      } finally {
        this._countersTimers.delete(String(userId));
        this._countersPayloads.delete(String(userId));
      }
    }, Math.max(50, delayMs|0));
    this._countersTimers.set(String(userId), timer);
  }

  emitLocationUpdate(bookingId, location) {
    this.emitToRoom(ROOMS.BOOKING(bookingId), EVENTS.BOOKING.LOCATION.CHANGED, location);
  }
}

export default new EmitterService();