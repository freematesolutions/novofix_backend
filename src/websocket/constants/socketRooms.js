export const ROOMS = {
  USER: (userId) => `user_${userId}`,
  CHAT: (chatId) => `chat_${chatId}`,
  BOOKING: (bookingId) => `booking_${bookingId}`,
  NOTIFICATIONS: (userId) => `notifications_${userId}`,
  ROLE: {
    PROVIDERS: 'providers_room',
    CLIENTS: 'clients_room',
    ADMINS: 'admins_room'
  }
};