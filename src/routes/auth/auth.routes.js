// routes/auth/auth.routes.js
import express from 'express';
import rateLimit from 'express-rate-limit';
import authController from '../../controllers/authController.js';
import {
  authenticateJWT,
  requireAuth,
  refreshToken
} from '../../middlewares/auth/jwtAuth.js';
import {
  clientOnly,
  providerOnly,
  adminOnly
} from '../../middlewares/auth/rbacMiddleware.js';
import {
  attachGuest,
  handleGuestMerge
} from '../../middlewares/auth/attachGuest.js';
import {
  requireActiveSubscription,
  checkLeadLimit
} from '../../middlewares/auth/rbacMiddleware.js';
import { getEmailService } from '../../services/external/email/emailService.js';

const router = express.Router();

// Rate limit espec\u00edfico para reenv\u00edo de email de verificaci\u00f3n
// Previene abuso: m\u00e1ximo 5 reintentos cada 15 min por IP+email
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    return `${req.ip}:${email}`;
  },
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many verification email requests. Please wait a few minutes and try again.'
  }
});

// Rutas p\u00fablicas de autenticaci\u00f3n
router.get('/check-email', authController.checkEmailAvailability);
router.post('/register/client', attachGuest, authController.registerClient);
router.post('/register/provider', attachGuest, authController.registerProvider);
router.post('/login', authController.login);
// Reenviar email de verificaci\u00f3n: p\u00fablico + rate limited (mejor UX para usuarios reci\u00e9n registrados sin token)
router.post('/resend-verification', resendVerificationLimiter, authController.resendVerificationEmail);
// Refresh token -> entrega nuevo access token y renueva refresh (cookie)
router.post('/refresh', refreshToken, (req, res) => {
  // Setear nuevo refresh token en cookie httpOnly para seguridad
  res.cookie('refresh_token', req.tokenRefresh.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 90 * 24 * 60 * 60 * 1000 // 90 días
  });
  return res.json({
    success: true,
    message: 'Token refreshed',
    data: { accessToken: req.tokenRefresh.accessToken }
  });
});

// Logout -> limpiar cookie de refresh
router.post('/logout', (req, res) => {
  res.clearCookie('refresh_token', { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production' });
  return res.json({ success: true, message: 'Logged out' });
});
// Password reset
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
// Upgrade explícito a proveedor
router.post('/become-provider', authenticateJWT, requireAuth, authController.becomeProvider);

// Rutas protegidas de perfil
// Endpoint para obtener el usuario autenticado (usado por el frontend para refrescar datos)
router.get('/me', authenticateJWT, requireAuth, (req, res) => {
  // Devuelve el usuario autenticado y sus perfiles
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  res.json({
    success: true,
    data: { user: req.user }
  });
});

router.get('/profile', authenticateJWT, requireAuth, authController.getProfile);
router.put('/profile', authenticateJWT, requireAuth, authController.updateProfile);

// Rutas específicas por rol
router.get('/profile/client', authenticateJWT, clientOnly, authController.getProfile);
router.get('/profile/provider', authenticateJWT, providerOnly, authController.getProfile);
router.put('/profile/provider', authenticateJWT, providerOnly, authController.updateProfile);

// Rutas de portfolio para proveedores
router.post('/portfolio', authenticateJWT, providerOnly, authController.addPortfolioItems);
router.patch('/portfolio/:itemId/reel', authenticateJWT, providerOnly, authController.togglePortfolioReel);
router.delete('/portfolio/:itemId', authenticateJWT, providerOnly, authController.deletePortfolioItem);

// Rutas de administración de usuarios (solo admin)
router.get('/admin/users', authenticateJWT, adminOnly, (req, res) => {
  // Esta ruta será manejada por el AdminController
  res.json({ message: 'Admin users endpoint' });
});

// Ruta para merge de sesión guest después de registro/login
router.post('/merge-guest', authenticateJWT, handleGuestMerge, (req, res) => {
  res.json({
    success: true,
    message: 'Guest data merged successfully',
    data: req.guestMerge
  });
});

// Verify email endpoint
router.post('/verify-email', authController.verifyEmail);

// Endpoint de diagnóstico para verificar estado del servicio de email (solo admin o en desarrollo)
router.get('/email-status', async (req, res) => {
  try {
    const emailService = getEmailService();
    const status = await emailService.getServiceStatus();
    
    // Ocultar información sensible en producción
    const safeStatus = {
      mode: status.mode,
      isDevelopment: status.isDevelopment,
      smtp: {
        configured: status.smtp?.configured || false,
        verified: status.smtpVerified || false,
        error: status.smtpError || null,
        user: status.smtp?.user ? `${status.smtp.user.slice(0, 5)}...` : 'no configurado'
      },
      resend: {
        configured: status.resend?.configured || false
      },
      defaultFrom: status.defaultFrom ? `${status.defaultFrom.slice(0, 10)}...` : 'no configurado',
      envVars: {
        EMAIL_MODE: process.env.EMAIL_MODE || 'no definido',
        GMAIL_USER_EXISTS: !!process.env.GMAIL_USER,
        GMAIL_APP_PASSWORD_EXISTS: !!process.env.GMAIL_APP_PASSWORD,
        FRONTEND_URL: process.env.FRONTEND_URL || 'no definido'
      }
    };

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      emailService: safeStatus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;