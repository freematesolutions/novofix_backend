// routes/auth/auth.routes.js
import express from 'express';
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

const router = express.Router();

// Rutas públicas de autenticación
router.get('/check-email', authController.checkEmailAvailability);
router.post('/register/client', attachGuest, authController.registerClient);
router.post('/register/provider', attachGuest, authController.registerProvider);
router.post('/login', authController.login);
// Refresh token -> entrega nuevo access token y renueva refresh (cookie)
router.post('/refresh', refreshToken, (req, res) => {
  // Setear nuevo refresh token en cookie httpOnly para seguridad
  res.cookie('refresh_token', req.tokenRefresh.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
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
  res.clearCookie('refresh_token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  return res.json({ success: true, message: 'Logged out' });
});
// Password reset
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
// Upgrade explícito a proveedor
router.post('/become-provider', authenticateJWT, requireAuth, authController.becomeProvider);

// Rutas protegidas de perfil
router.get('/profile', authenticateJWT, requireAuth, authController.getProfile);
router.put('/profile', authenticateJWT, requireAuth, authController.updateProfile);

// Rutas específicas por rol
router.get('/profile/client', authenticateJWT, clientOnly, authController.getProfile);
router.get('/profile/provider', authenticateJWT, providerOnly, authController.getProfile);
router.put('/profile/provider', authenticateJWT, providerOnly, authController.updateProfile);

// Rutas de portfolio para proveedores
router.post('/portfolio', authenticateJWT, providerOnly, authController.addPortfolioItems);
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

export default router;