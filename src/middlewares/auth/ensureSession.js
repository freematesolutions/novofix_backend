// middlewares/auth/ensureSession.js
import Session from '../../models/System/Session.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Middleware para garantizar que cada request tenga una sesión válida
 * Crea sesiones guest automáticamente para usuarios no autenticados
 */
const ensureSession = async (req, res, next) => {
  try {
    let sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
    const clientId = req.headers['x-client-id'];
    
    // Verificar si ya hay una sesión activa en la request
    if (req.session) {
      return next();
    }

    let session;

    if (sessionId) {
      // Buscar sesión existente
      session = await Session.findOne({ 
        sessionId, 
        expiresAt: { $gt: new Date() } 
      }).populate('user');
    }

    // Si no hay sesión por sessionId, intentar por clientId estable (si viene)
    if (!session && clientId) {
      session = await Session.findOne({
        clientId,
        expiresAt: { $gt: new Date() }
      }).populate('user');
    }

    if (!session) {
      // Crear nueva sesión guest
      sessionId = uuidv4();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 días de expiración

      try {
        session = await Session.create({
          sessionId,
          clientId: clientId || undefined,
          userType: 'guest',
          guestData: {},
          deviceInfo: {
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip || req.connection?.remoteAddress,
            deviceType: getDeviceType(req.headers['user-agent'])
          },
          expiresAt,
          lastActivity: new Date(),
          metadata: { createdAt: new Date() }
        });
      } catch (e) {
        // Si otro request concurrente creó la sesión con el mismo clientId, recuperar esa
        const isDupClient = clientId && String(e?.code) === '11000' && e?.keyPattern?.clientId;
        if (isDupClient) {
          session = await Session.findOne({ clientId, expiresAt: { $gt: new Date() } });
          if (session) {
            sessionId = session.sessionId;
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }

      // Setear cookie de sesión
      res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
      });
    } else {
      // Actualizar última actividad de sesión existente de forma tolerante a carreras
      const updated = await Session.findOneAndUpdate(
        { _id: session._id, expiresAt: { $gt: new Date() } },
        { $set: { lastActivity: new Date() } },
        { new: true }
      );
      if (!updated) {
        // La sesión pudo ser eliminada (p.ej., tras merge). Crear una nueva.
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        sessionId = uuidv4();
        session = await Session.create({
          sessionId,
          clientId: clientId || undefined,
          userType: 'guest',
          guestData: {},
          deviceInfo: {
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip || req.connection?.remoteAddress,
            deviceType: getDeviceType(req.headers['user-agent'])
          },
          expiresAt,
          lastActivity: new Date(),
          metadata: { createdAt: new Date() }
        });
        res.cookie('sessionId', sessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000
        });
      } else {
        session = updated;
      }
    }

    // Adjuntar sesión al request
    req.session = session;
    req.sessionId = sessionId;

    next();
  } catch (error) {
    console.error('EnsureSession middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Session initialization failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper para detectar tipo de dispositivo
function getDeviceType(userAgent) {
  if (!userAgent) return 'unknown';
  
  const ua = userAgent.toLowerCase();
  if (ua.match(/mobile/)) return 'mobile';
  if (ua.match(/tablet/)) return 'tablet';
  return 'desktop';
}

export default ensureSession;