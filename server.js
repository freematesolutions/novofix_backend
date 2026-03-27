// Cargar variables de entorno:
// - En producción (Render): las variables vienen del dashboard, dotenv es opcional
// - En desarrollo: cargar desde archivo .env.development
import dotenv from 'dotenv';

// Determinar el archivo de entorno según NODE_ENV
// En Render, NODE_ENV=production se configura en el dashboard ANTES de que el código se ejecute
const envFile = process.env.NODE_ENV === 'production' 
  ? './.env.production'  // En Render, este archivo NO existe (está en .gitignore)
  : './.env.development';

// Intentar cargar archivo .env (fallback silencioso si no existe - normal en Render)
const result = dotenv.config({ path: envFile });
if (result.error && process.env.NODE_ENV !== 'production') {
  console.warn(`[dotenv] No se pudo cargar ${envFile}:`, result.error.message);
}

// Importaciones restantes
import app from './app.js';
import http from 'http';
import { configureSocket } from './src/config/socket.js';
import connectDB from './src/config/database.js';
import redisClient from './src/config/redis.js';

// Log de configuración de entorno
console.log('='.repeat(50));
console.log('🔧 CONFIGURACIÓN DE ENTORNO');
console.log('='.repeat(50));
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('EMAIL_MODE:', process.env.EMAIL_MODE || 'no configurado');
console.log('GMAIL_USER:', process.env.GMAIL_USER ? `${process.env.GMAIL_USER.slice(0, 5)}...` : 'NO DEFINIDO');
console.log('GMAIL_APP_PASSWORD:', process.env.GMAIL_APP_PASSWORD ? '****configurado****' : 'NO DEFINIDO');
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || 'NO DEFINIDO');
console.log('='.repeat(50));


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
process.on('SIGTERM', async () => {
  console.log('👋 SIGTERM RECEIVED. Shutting down gracefully');
  try {
    const { stopNudgeProcessor } = await import('./src/services/internal/nudgeProcessor.js');
    stopNudgeProcessor();
  } catch { /* ignore */ }
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
    // 0. Re-inicializar servicio de email AHORA que las variables de entorno están disponibles
    // Esto es necesario porque el módulo puede haberse importado antes de cargar dotenv
    try {
      const { getEmailService } = await import('./src/services/external/email/emailService.js');
      const emailService = getEmailService();
      emailService.reinitialize();
      
      // Verificar conexión SMTP
      const status = await emailService.getServiceStatus();
      console.log('[📧 EMAIL] Estado del servicio:', {
        mode: status.mode,
        smtpConfigured: status.smtp.configured,
        smtpVerified: status.smtpVerified,
        smtpError: status.smtpError || 'ninguno'
      });
    } catch (emailErr) {
      console.warn('[📧 EMAIL] Error al inicializar servicio de email:', emailErr.message);
    }

    // 1. Conectar a MongoDB
    await connectDB();

    // 1.5 Seed subscription plans so they exist before first API call
    try {
      const subscriptionService = (await import('./src/services/internal/subscriptionService.js')).default;
      await subscriptionService.ensurePlansSeeded();
      console.log('[💳 PLANS] Subscription plans seeded/verified ✅');
    } catch (planErr) {
      console.warn('[💳 PLANS] Could not seed plans:', planErr.message);
    }

    // 1.6 Start persistent nudge processor (replaces volatile setTimeout nudges)
    try {
      const { startNudgeProcessor } = await import('./src/services/internal/nudgeProcessor.js');
      startNudgeProcessor();
      console.log('[🔔 NUDGES] Persistent nudge processor started ✅');
    } catch (nudgeErr) {
      console.warn('[🔔 NUDGES] Could not start nudge processor:', nudgeErr.message);
    }

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
      console.log(`📧 Email: ${process.env.EMAIL_MODE || 'auto'} (GMAIL: ${process.env.GMAIL_USER ? '✅' : '❌'})`);
      console.log(`☁️ Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? 'Ready' : 'Not configured'}`);
      console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Key ✅' : 'Key ❌'} | Webhook: ${process.env.STRIPE_WEBHOOK_SECRET && !process.env.STRIPE_WEBHOOK_SECRET.includes('REPLACE') ? 'Secret ✅' : '⚠️  Placeholder'} | Expert Price: ${process.env.STRIPE_PRICE_EXPERT ? '✅' : '❌'} | Elite Price: ${process.env.STRIPE_PRICE_ELITE ? '✅' : '❌'}`);
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