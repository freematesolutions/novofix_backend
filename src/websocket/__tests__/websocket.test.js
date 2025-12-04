import { describe, it, beforeEach, expect, vi } from 'vitest';
import { SocketService } from '../services/socketService';
import { ChatHandler } from '../handlers/chatHandler';
import { BookingHandler } from '../handlers/bookingHandler';
import { NotificationHandler } from '../handlers/notificationHandler';
import { EVENTS } from '../constants/socketEvents';
import { ROOMS } from '../constants/socketRooms';

describe('WebSocket Integration', () => {
  let socketService;
  let mockSocket;
  let mockIO;

  beforeEach(() => {
    // Mock Socket.IO server
    mockIO = {
      use: vi.fn(),
      on: vi.fn(),
      to: vi.fn().mockReturnThis(),
      emit: vi.fn()
    };

    // Mock socket
    mockSocket = {
      id: 'test-socket-id',
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
      on: vi.fn(),
      userData: {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'client'
      }
    };

    socketService = new SocketService();
    socketService.io = mockIO;
  });

  describe('Chat Handler', () => {
    it('should handle join chat event', async () => {
      const chatHandler = new ChatHandler(mockIO);
      const chatId = 'test-chat-id';

      await chatHandler.handleJoinChat(mockSocket, { chatId });

      expect(mockSocket.join).toHaveBeenCalledWith(ROOMS.CHAT(chatId));
    });

    it('should handle send message event', async () => {
      const chatHandler = new ChatHandler(mockIO);
      const messageData = {
        chatId: 'test-chat-id',
        content: 'Test message',
        type: 'text'
      };

      await chatHandler.handleMessage(mockSocket, messageData);

      expect(mockSocket.to).toHaveBeenCalledWith(ROOMS.CHAT(messageData.chatId));
      expect(mockSocket.emit).toHaveBeenCalledWith(EVENTS.CHAT.MESSAGE.SENT, expect.any(Object));
    });
  });

  describe('Booking Handler', () => {
    it('should handle track booking event', async () => {
      const bookingHandler = new BookingHandler(mockIO);
      const bookingId = 'test-booking-id';

      await bookingHandler.handleTrackBooking(mockSocket, { bookingId });

      expect(mockSocket.join).toHaveBeenCalledWith(ROOMS.BOOKING(bookingId));
    });

    it('should handle location update event', async () => {
      const bookingHandler = new BookingHandler(mockIO);
      const locationData = {
        bookingId: 'test-booking-id',
        location: {
          coordinates: {
            lat: 40.7128,
            lng: -74.0060
          }
        }
      };

      mockSocket.userRole = 'provider';
      await bookingHandler.handleLocationUpdate(mockSocket, locationData);

      expect(mockSocket.to).toHaveBeenCalledWith(ROOMS.BOOKING(locationData.bookingId));
    });
  });

  describe('Notification Handler', () => {
    it('should handle subscribe to notifications', () => {
      const notificationHandler = new NotificationHandler(mockIO);

      notificationHandler.handleSubscribe(mockSocket);

      expect(mockSocket.join).toHaveBeenCalledWith(ROOMS.NOTIFICATIONS(mockSocket.userId));
    });

    it('should send notification to specific user', () => {
      const notificationHandler = new NotificationHandler(mockIO);
      const userId = 'test-user-id';
      const notification = {
        type: 'test',
        message: 'Test notification'
      };

      notificationHandler.sendToUser(userId, notification);

      expect(mockIO.to).toHaveBeenCalledWith(ROOMS.USER(userId));
      expect(mockIO.emit).toHaveBeenCalledWith(EVENTS.NOTIFICATION.NEW, notification);
    });
  });
});