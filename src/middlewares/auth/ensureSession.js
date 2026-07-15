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

    const buildGuestSessionPayload = ({ sessionId: nextSessionId, expiresAt }) => ({
      sessionId: nextSessionId,
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

    const createOrRecycleGuestSession = async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 dias de expiracion
      const nextSessionId = uuidv4();
      const payload = buildGuestSessionPayload({ sessionId: nextSessionId, expiresAt });

      if (clientId) {
        // Reusar/renovar por clientId evita colisiones cuando hay docs expirados
        // aun presentes (TTL no es instantaneo) y tambien evita carreras.
        const recycled = await Session.findOneAndUpdate(
          { clientId },
          { $set: payload },
          {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true
          }
        );
        return { session: recycled, sessionId: nextSessionId };
      }

      const created = await Session.create(payload);
      return { session: created, sessionId: nextSessionId };
    };
    
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
      // Crear o reciclar sesion guest de manera tolerante a carreras y TTL lag.
      const created = await createOrRecycleGuestSession();
      session = created.session;
      sessionId = created.sessionId;

      // Setear cookie de sesión
      // En producción: SameSite=None + Secure (cross-site frontend Vercel ↔ backend Render).
      // En desarrollo: Lax (mismo origin localhost, sin HTTPS).
      res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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
        // La sesion pudo eliminarse o expirar entre lecturas. Reciclarla/crearla.
        const created = await createOrRecycleGuestSession();
        sessionId = created.sessionId;
        session = created.session;
        res.cookie('sessionId', sessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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