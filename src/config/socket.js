import { SocketService } from '../websocket/services/socketService.js';

let io;

export const configureSocket = (server) => {
  if (!io) {
    const socketService = new SocketService(server);
    io = socketService.initialize();
  }
  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

export default { configureSocket, getIO };