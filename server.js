import { config } from 'dotenv';

// Configurar variables de entorno PRIMERO
const envFile = process.env.NODE_ENV === 'production' ? './.env.production' : './.env.development';
config({ path: envFile });


import app from './app.js';
import http from 'http';
import { configureSocket } from './src/config/socket.js';
import connectDB from './src/config/database.js';
import redisClient from './src/config/redis.js';

// Manejar excepciones no capturadas
process.on('uncaughtException', (err) => {
  console.log('💥 UNCAUGHT EXCEPTION! Shutting down...');
  console.log(err.name, err.message);
  console.log(err.stack);
  process.exit(1);
});

// Manejar promesas rechazadas no capturadas
let server; // Declarar aquí para acceso en catch
process.on('unhandledRejection', (err) => {
  console.log('💥 UNHANDLED REJECTION! Shutting down...');
  console.log(err.name, err.message);
  console.log(err.stack);
  if (server) {
    server.close(() => {
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

// Manejar señal de terminación (para producción)
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM RECEIVED. Shutting down gracefully');
  if (server) {
    server.close(() => {
      console.log('💥 Process terminated!');
    });
  }
});

const PORT = process.env.PORT || 5000;

async function waitForRedisReady(redisClient, timeoutMs = 20000) {
  // Espera a que redisClient.isConnected sea true o timeout
  const start = Date.now();
  while (!redisClient.isConnected) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timeout waiting for Redis to be ready');
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function startServer() {
  try {
    // 1. Conectar a MongoDB
    await connectDB();

    // 2. Esperar a que Redis esté listo
    await waitForRedisReady(redisClient);

    // 3. Crear servidor HTTP y configurar Socket.IO
    server = http.createServer(app);
    const io = configureSocket(server);

    // 4. Iniciar servidor solo si todo está listo
    server.listen(PORT, () => {
      console.log('='.repeat(50));
      console.log('🚀 MARKETPLACE SERVICES BACKEND');
      console.log('='.repeat(50));
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL}`);
      console.log(`🗄️ Database: Connected`);
      console.log(`📧 Email Service: ${process.env.RESEND_API_KEY ? 'Ready' : 'Not configured'}`);
      console.log(`☁️ Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? 'Ready' : 'Not configured'}`);
      console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Ready' : 'Not configured'}`);
      console.log(`🧠 Redis: Connected`);
      console.log('='.repeat(50));
      console.log(`📡 API running on: http://localhost:${PORT}/api`);
      console.log(`❤️ Health check: http://localhost:${PORT}/health`);
      console.log('='.repeat(50));
    });

    // Exportar para testing
    return { app, io, server };
  } catch (err) {
    console.error('❌ Error starting server:', err);
    process.exit(1);
  }
}

// Ejecutar arranque
startServer();

// Exportar para testing (en caso de importación en tests)
export { app };