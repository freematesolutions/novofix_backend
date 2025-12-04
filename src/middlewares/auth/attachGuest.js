// middlewares/auth/attachGuest.js
import Session from '../../models/System/Session.js';
import Client from '../../models/User/Client.js';
import Provider from '../../models/User/Provider.js';
import ServiceRequest from '../../models/Service/ServiceRequest.js';

/**
 * Middleware para adjuntar datos de usuario guest y manejar merge automático
 */
const attachGuest = async (req, res, next) => {
  try {
    if (!req.session) {
      return res.status(400).json({
        success: false,
        message: 'Session required'
      });
    }

    // Si el usuario ya está autenticado, saltar este middleware
    if (req.user) {
      return next();
    }

    // Skip heavy DB lookups during tests or when explicitly requested
    const skipGuest = process.env.SKIP_GUEST_QUERIES === '1';
    if (skipGuest && req.session.userType === 'guest') {
      req.guest = {
        sessionId: req.session.sessionId,
        data: req.session.guestData || {},
        isGuest: true
      };
      return next();
    }

    // Para sesiones guest, adjuntar datos temporales
    if (req.session.userType === 'guest') {
      req.guest = {
        sessionId: req.session.sessionId,
        data: req.session.guestData || {},
        isGuest: true
      };

      // Buscar usuario por sessionId/email para merge automático (Cliente o Proveedor)
      let existingUser = await Client.findOne({
        $or: [
          { guestSessionId: req.session.sessionId },
          { 'mergeCandidate.sessionId': req.session.sessionId },
          { 'mergeCandidate.email': req.session.guestData?.email }
        ]
      });

      if (!existingUser) {
        existingUser = await Provider.findOne({
          $or: [
            { guestSessionId: req.session.sessionId },
            { 'mergeCandidate.sessionId': req.session.sessionId },
            { 'mergeCandidate.email': req.session.guestData?.email }
          ]
        });
      }

      if (existingUser) {
        // Auto-merge si se encuentra usuario coincidente
        req.user = existingUser;
        req.guest.mergeCandidate = true;

        // Actualizar sesión con usuario encontrado y su rol
        req.session.user = existingUser._id;
        req.session.userType = String(existingUser.role || 'client').toLowerCase();
        await req.session.save();
      }
    }

    next();
  } catch (error) {
    console.error('AttachGuest middleware error:', error);
    next(error); // Pasar al manejador de errores
  }
};

/**
 * Middleware para manejar merge explícito de sesión guest con usuario registrado
 */
const handleGuestMerge = async (req, res, next) => {
  try {
    const { sessionId, email } = req.body;
    const currentUser = req.user; // Usuario recién autenticado

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required for merge'
      });
    }

    // Buscar sesión guest por sessionId o email
    const guestSession = await Session.findOne({
      $or: [
        { sessionId: sessionId || req.session?.sessionId },
        { 'guestData.email': email }
      ]
    });

    if (!guestSession) {
      return next(); // No hay sesión para merge
    }

  // Transferir datos de la sesión guest al usuario (cliente o proveedor)
  await mergeGuestDataByRole(currentUser, guestSession);

    // Eliminar sesión guest
    await Session.deleteOne({ _id: guestSession._id });

    // Limpiar cookie de sesión guest
    res.clearCookie('sessionId');

    req.guestMerge = {
      success: true,
      transferredData: guestSession.guestData
    };

    next();
  } catch (error) {
    console.error('HandleGuestMerge middleware error:', error);
    next(error);
  }
};

/**
 * Función helper para merge de datos guest
 */
async function mergeGuestDataByRole(user, guestSession) {
  const role = String(user.role || '').toLowerCase();
  if (role === 'client') {
    await mergeGuestDataForClient(user, guestSession);
    return;
  }
  if (role === 'provider') {
    await mergeGuestDataForProvider(user, guestSession);
    return;
  }
  // Otros roles: no hay merge específico
}

async function mergeGuestDataForClient(user, guestSession) {
  const updateData = {
    $set: {
      guestSessionId: null,
      'mergeCandidate.merged': true,
      'mergeCandidate.mergedAt': new Date()
    }
  };

  // Transferir service requests del guest (solo tiene sentido para clientes)
  if (guestSession.guestData?.serviceRequests?.length > 0) {
    await ServiceRequest.updateMany(
      {
        _id: { $in: guestSession.guestData.serviceRequests },
        client: { $exists: false }
      },
      {
        $set: { 
          client: user._id,
          guestSessionId: null 
        }
      }
    );

    updateData.$addToSet = {
      'clientProfile.serviceHistory': {
        $each: guestSession.guestData.serviceRequests
      }
    };
  }

  // Actualizar datos de contacto si no existen
  if (guestSession.guestData?.email && !user.email) {
    updateData.$set.email = guestSession.guestData.email;
  }
  if (guestSession.guestData?.phone && !user.profile?.phone) {
    updateData.$set['profile.phone'] = guestSession.guestData.phone;
  }

  await Client.findByIdAndUpdate(user._id, updateData);
}

async function mergeGuestDataForProvider(user, guestSession) {
  // Para proveedores no se migran serviceRequests (son del lado cliente)
  const updateData = { $set: {} };

  if (guestSession.guestData?.email && !user.email) {
    updateData.$set.email = guestSession.guestData.email;
  }
  if (guestSession.guestData?.phone && !user.profile?.phone) {
    updateData.$set['profile.phone'] = guestSession.guestData.phone;
  }

  // Solo actualizar si hay algo que escribir
  if (Object.keys(updateData.$set).length > 0) {
    await Provider.findByIdAndUpdate(user._id, updateData);
  }
}

export {
  attachGuest,
  handleGuestMerge
};