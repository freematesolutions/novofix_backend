import { Server } from 'socket.io';
import { EVENTS } from '../constants/socketEvents.js';
import { ROOMS } from '../constants/socketRooms.js';
import { socketAuth } from '../middleware/socketAuth.js';
import { ChatHandler } from '../handlers/chatHandler.js';
import { BookingHandler } from '../handlers/bookingHandler.js';
import { NotificationHandler } from '../handlers/notificationHandler.js';

export class SocketService {
  constructor(server) {
    // Configurar múltiples orígenes permitidos para desarrollo y producción
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:5173', // Vite dev server
      'http://localhost:3000', // React dev server alternativo
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000'
    ].filter(Boolean);

    this.io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ['websocket', 'polling']
    });

    // Inicializar handlers
    this.chatHandler = new ChatHandler(this.io);
    this.bookingHandler = new BookingHandler(this.io);
    this.notificationHandler = new NotificationHandler(this.io);

    // Almacenar conexiones activas
    this.activeConnections = new Map();
  }

  initialize() {
    // Configurar middleware de autenticación
    this.io.use(socketAuth);

    // Manejar conexiones
    this.io.on('connection', this.handleConnection.bind(this));

    console.log('✅ Socket.io service initialized');
    return this.io;
  }

  handleConnection(socket) {
    console.log(`✅ User ${socket.userData.email} connected with socket ${socket.id}`);

    // Almacenar conexión
    this.activeConnections.set(socket.userId, {
      socketId: socket.id,
      userData: socket.userData,
      connectedAt: new Date()
    });

    // Unir a sala de usuario para notificaciones privadas
    socket.join(ROOMS.USER(socket.userId));

    // Unir a salas según el rol
    if (socket.userRole === 'provider') {
      socket.join(ROOMS.ROLE.PROVIDERS);
    } else if (socket.userRole === 'client') {
      socket.join(ROOMS.ROLE.CLIENTS);
    } else if (socket.userRole === 'admin') {
      socket.join(ROOMS.ROLE.ADMINS);
    }

    // Inicializar handlers para este socket
    this.chatHandler.initialize(socket);
    this.bookingHandler.initialize(socket);
    this.notificationHandler.initialize(socket);

    // Manejar desconexión
    socket.on('disconnect', (reason) => {
      console.log(`❌ User ${socket.userData?.email} disconnected: ${reason}`);
      this.activeConnections.delete(socket.userId);
      
      // Notificar que el usuario está offline
      socket.broadcast.emit(EVENTS.USER.OFFLINE, {
        userId: socket.userId,
        lastSeen: new Date()
      });
    });

    // Manejar errores
    socket.on('error', (error) => {
      console.error(`Socket error for user ${socket.userId}:`, error);
    });
  }

  // Métodos helper para emitir eventos
  emitToUser(userId, event, data) {
    const connection = this.activeConnections.get(userId);
    if (connection) {
      this.io.to(connection.socketId).emit(event, data);
    }
  }

  emitToUsers(userIds, event, data) {
    userIds.forEach(userId => {
      this.emitToUser(userId, event, data);
    });
  }

  emitToRoom(room, event, data) {
    this.io.to(room).emit(event, data);
  }

  getActiveConnections() {
    return this.activeConnections;
  }

  getIO() {
    return this.io;
  }
}