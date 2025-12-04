export const EVENTS = {
  CHAT: {
    JOIN: 'join_chat',
    LEAVE: 'leave_chat',
    MESSAGE: {
      SEND: 'send_message',
      RECEIVED: 'new_message',
      SENT: 'message_sent',
      ERROR: 'message_error'
    },
    TYPING: {
      START: 'typing_start',
      STOP: 'typing_stop',
      USER_TYPING: 'user_typing',
      USER_STOPPED_TYPING: 'user_stopped_typing'
    }
  },
  BOOKING: {
    TRACK: 'track_booking',
    UNTRACK: 'untrack_booking',
    STATUS_UPDATE: 'service_status_update',
    LOCATION: {
      UPDATE: 'provider_location_update',
      CHANGED: 'provider_location'
    },
    STATUS: {
      CHANGED: 'booking_status_update'
    }
  },
  NOTIFICATION: {
    SUBSCRIBE: 'subscribe_notifications',
    UNSUBSCRIBE: 'unsubscribe_notifications',
    NEW: 'notification',
    READ: 'notification_read'
  },
  USER: {
    OFFLINE: 'user_offline',
    ONLINE: 'user_online'
  },
  CONNECTION: {
    ERROR: 'connection_error',
    AUTHENTICATED: 'authenticated'
  },
  COUNTERS: {
    UPDATE: 'counters_update'
  }
};