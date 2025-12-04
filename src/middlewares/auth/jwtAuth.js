// middlewares/auth/jwtAuth.js
import jwt from 'jsonwebtoken';
import User from '../../models/User/User.js';

/**
 * Middleware de autenticación JWT para usuarios registrados
 */
const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      // Si no hay token, continuar como guest (no error)
      return next();
    }

    // Verificar token JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Buscar usuario en la base de datos
    const user = await User.findById(decoded.id)
      .select('-password')
      .populate('profile');

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive'
      });
    }

    // Adjuntar usuario al request
    req.user = user;
    req.token = token;

    // Actualizar última actividad si es necesario
    await User.findByIdAndUpdate(user._id, {
      lastLogin: new Date()
    });

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    console.error('JWT Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

/**
 * Middleware que requiere autenticación estricta (no guest)
 */
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role === 'guest') {
    return res.status(401).json({
      success: false,
      message: 'Registered account required'
    });
  }

  next();
};

/**
 * Middleware para verificar email confirmado (opcional según requisitos)
 */
const requireVerifiedEmail = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // Si implementas verificación de email, agregar check aquí
  // if (!req.user.emailVerified) {
  //   return res.status(403).json({
  //     success: false,
  //     message: 'Email verification required'
  //   });
  // }

  next();
};

/**
 * Generador de tokens JWT
 */
const generateToken = (userId) => {
  return jwt.sign(
    { 
      id: userId,
      iat: Math.floor(Date.now() / 1000)
    },
    process.env.JWT_SECRET,
    { 
      expiresIn: process.env.JWT_EXPIRES_IN || '30d' 
    }
  );
};

/**
 * Middleware para refresh de token
 */
const refreshToken = async (req, res, next) => {
  try {
    // Permitir tomar el refresh token desde body o cookie httpOnly
    const { refreshToken: bodyRefreshToken } = req.body || {};
    const cookieRefreshToken = req.cookies?.refresh_token;
    const refreshToken = bodyRefreshToken || cookieRefreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required'
      });
    }

  const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Generar nuevos tokens
    const newAccessToken = generateToken(user._id);
    const newRefreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '90d' }
    );

    req.tokenRefresh = {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: user._id
    };

    next();
  } catch (error) {
    console.error('RefreshToken middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
};

/**
 * Middleware que verifica que el usuario es admin
 */
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

/**
 * Middleware que verifica que el usuario es cliente
 */
const clientOnly = (req, res, next) => {
  const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
  const isClient = userRoles.includes('client');
  
  if (!req.user || !isClient) {
    return res.status(403).json({
      success: false,
      message: 'Client access required'
    });
  }
  next();
};

/**
 * Middleware que verifica que el usuario es proveedor
 */
const providerOnly = (req, res, next) => {
  const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
  const isProvider = userRoles.includes('provider');
  
  if (!req.user || !isProvider) {
    return res.status(403).json({
      success: false,
      message: 'Provider access required'
    });
  }
  next();
};

/**
 * Middleware que verifica que el usuario es cliente o proveedor
 */
const clientOrProvider = (req, res, next) => {
  const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
  const isClientOrProvider = userRoles.includes('client') || userRoles.includes('provider');
  
  if (!req.user || !isClientOrProvider) {
    return res.status(403).json({
      success: false,
      message: 'Client or provider access required'
    });
  }
  next();
};

export {
  authenticateJWT,
  requireAuth,
  requireVerifiedEmail,
  generateToken,
  refreshToken,
  adminOnly,
  clientOnly,
  providerOnly,
  clientOrProvider
};