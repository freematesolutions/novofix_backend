import { EVENTS } from '../constants/socketEvents.js';
import { ROOMS } from '../constants/socketRooms.js';

export class NotificationHandler {
  constructor(io) {
    this.io = io;
  }

  initialize(socket) {
    socket.on(EVENTS.NOTIFICATION.SUBSCRIBE, () => this.handleSubscribe(socket));
    socket.on(EVENTS.NOTIFICATION.UNSUBSCRIBE, () => this.handleUnsubscribe(socket));
  }

  handleSubscribe(socket) {
    socket.join(ROOMS.NOTIFICATIONS(socket.userId));
    console.log(`User ${socket.userId} subscribed to notifications`);
  }

  handleUnsubscribe(socket) {
    socket.leave(ROOMS.NOTIFICATIONS(socket.userId));
    console.log(`User ${socket.userId} unsubscribed from notifications`);
  }

  // Método para enviar notificación a un usuario específico
  sendToUser(userId, notification) {
    this.io.to(ROOMS.NOTIFICATIONS(userId)).emit(EVENTS.NOTIFICATION.NEW, notification);
  }

  // Método para enviar notificación a múltiples usuarios
  sendToUsers(userIds, notification) {
    userIds.forEach(userId => {
      this.sendToUser(userId, notification);
    });
  }

  // Método para enviar notificación a un rol específico
  sendToRole(role, notification) {
    const roleRoom = ROOMS.ROLE[role.toUpperCase()];
    if (roleRoom) {
      this.io.to(roleRoom).emit(EVENTS.NOTIFICATION.NEW, notification);
    }
  }
}