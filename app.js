import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';
import hpp from 'hpp';
import path from 'path';
import { fileURLToPath } from 'url';

// Importar rutas
import routes from './src/routes/index.js';

// server/src/app.js (actualización)
import redisClient from './src/config/redis.js';

// Middlewares importados
import ensureSession from './src/middlewares/auth/ensureSession.js';
import { attachGuest } from './src/middlewares/auth/attachGuest.js';
import { authenticateJWT } from './src/middlewares/auth/jwtAuth.js';
import {
  clientOnly,
  providerOnly,
  adminOnly,
  clientOrProvider,
  requireActiveSubscription
} from './src/middlewares/auth/rbacMiddleware.js';

// Middlewares de error
import errorHandler from './src/middlewares/utils/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 1. GLOBAL MIDDLEWARES

// Security - Helmet
app.use(helmet());

// Cookie parser debe ir antes de cualquier middleware que lea cookies
app.use(cookieParser());

// CORS temprano para soportar preflight correctamente con credenciales
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'X-Client-Id']
}));

// Session and Auth middlewares (orden recomendado)
// Allow skipping heavy session DB operations during tests
const skipSession = process.env.SKIP_SESSION_MIDDLEWARE === '1';
if (skipSession) {
  app.use((req, _res, next) => {
    req.session = { sessionId: 'test-session', userType: 'guest' };
    req.sessionId = 'test-session';
    next();
  });
} else {
  app.use(ensureSession);      // 1) gestión de sesión (lee cookie ya parseada)
}
app.use(authenticateJWT);    // 2) autenticar JWT si existe (define req.user)
app.use(attachGuest);        // 3) adjuntar datos guest SOLO si no hay req.user

// Redis middleware
app.use((req, res, next) => {
  req.redis = redisClient;
  next();
});

// Rate limiting - configuración mejorada
const isDevelopment = process.env.NODE_ENV === 'development';

// Rutas que se excluyen del rate limiting (llamadas frecuentes o públicas)
const rateLimitSkipPaths = [
  '/auth/',          // autenticación
  '/uploads/',       // uploads de archivos
  '/guest/',         // rutas públicas/guest
  '/counters',       // contadores (polling frecuente)
  '/notifications',  // notificaciones (polling frecuente)
  '/health',         // health checks
  '/status'          // status checks
];

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutos
  max: isDevelopment 
    ? (parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_DEV) || 5000)  // 5000 en desarrollo
    : (parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 300),      // 300 en producción (más razonable)
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting para rutas específicas
  skip: (req) => {
    // req.path ya viene sin el prefijo /api porque el limiter se aplica sobre /api
    const path = req.path;
    
    // Siempre excluir rutas de polling frecuente y autenticación
    const shouldSkip = rateLimitSkipPaths.some(skipPath => path.startsWith(skipPath));
    
    // En desarrollo, log para debug si está bloqueando
    if (isDevelopment && !shouldSkip) {
      // Solo log cada 100 requests para no saturar
      if (Math.random() < 0.01) {
        console.log(`[RateLimit] Counting request to: ${path}`);
      }
    }
    
    return shouldSkip;
  },
  // Handler personalizado para cuando se alcanza el límite
  handler: (req, res) => {
    console.warn(`[RateLimit] IP ${req.ip} exceeded limit for path: ${req.path}`);
    res.status(429).json({
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil((req.rateLimit?.resetTime - Date.now()) / 1000) || 900
    });
  }
});

app.use('/api', limiter);

// Body parser, reading data from body into req.body
// Límite aumentado para soportar uploads de videos grandes
app.use(express.json({
  limit: '100mb'
}));
app.use(express.urlencoded({
  extended: true,
  limit: '100mb'
}));

// Cookie parser
app.use(cookieParser());

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Prevent parameter pollution
app.use(hpp({
  whitelist: [
    'duration',
    'ratingsQuantity',
    'ratingsAverage',
    'maxGroupSize',
    'difficulty',
    'price'
  ]
}));

// Serving static files
app.use(express.static(path.join(__dirname, 'public')));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Test middleware
app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  next();
});

// 2. ROUTES
app.use('/api', routes);


// Mantener la raíz '/' para Render
app.get('/', (req, res) => {
  res.json({ message: 'API funcionando correctamente' });
});

// 4. HANDLE UNDEFINED ROUTES
app.all('*', (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.status = 'fail';
  err.statusCode = 404;
  next(err);
});

// 5. GLOBAL ERROR HANDLING MIDDLEWARE
app.use(errorHandler);

export default app;