// middlewares/auth/rbacMiddleware.js
import User from '../../models/User/User.js';
import Provider from '../../models/User/Provider.js';
import ServiceRequest from '../../models/Service/ServiceRequest.js';
import Proposal from '../../models/Service/Proposal.js';
import Booking from '../../models/Service/Booking.js';

/**
 * Middleware de Control de Acceso Basado en Roles (RBAC)
 */

// Roles hierarchy
const ROLES_HIERARCHY = {
  guest: ['guest'],
  client: ['guest', 'client'],
  provider: ['guest', 'client', 'provider'],
  admin: ['guest', 'client', 'provider', 'admin']
};

/**
 * Middleware principal RBAC
 */
const rbacMiddleware = (allowedRoles = [], options = {}) => {
  return async (req, res, next) => {
    try {
      const { requireAuth = true, checkOwnership = false } = options;
      const userRole = (req.user?.role || 'guest').toLowerCase();
      const userRolesList = Array.isArray(req.user?.roles) ? req.user.roles.map(r => String(r).toLowerCase()) : [];

      // Verificar autenticación si es requerida
      if (requireAuth && !req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Verificar si el rol tiene permisos
      if (!hasPermission(userRole, allowedRoles, userRolesList)) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          requiredRoles: allowedRoles,
          userRole: userRole
        });
      }

      // Verificar ownership si es necesario
      if (checkOwnership && req.user) {
        const isOwner = await checkResourceOwnership(req);
        if (!isOwner) {
          return res.status(403).json({
            success: false,
            message: 'Access denied to resource'
          });
        }
      }

      next();
    } catch (error) {
      console.error('RBAC middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Authorization check failed'
      });
    }
  };
};

/**
 * Verificar permisos basado en jerarquía de roles
 */
function hasPermission(userRole, allowedRoles, userRolesList = []) {
  if (!allowedRoles || allowedRoles.length === 0) {
    return true; // Sin restricciones
  }

  // Si hay lista de roles explícitos del usuario, verificar por inclusión directa
  if (Array.isArray(userRolesList) && userRolesList.length > 0) {
    return allowedRoles.some(role => userRolesList.includes(String(role).toLowerCase()));
  }

  // Fallback a jerarquía por rol primario
  const userHierarchy = ROLES_HIERARCHY[(userRole || 'guest').toLowerCase()] || ['guest'];
  return allowedRoles.some(role => userHierarchy.includes(role));
}

/**
 * Verificar ownership del recurso
 */
async function checkResourceOwnership(req) {
  const resourceId = req.params.id || req.body.id;
  const userId = req.user._id;
  const userRole = req.user.role;

  if (!resourceId) return false;

  try {
    switch (req.baseUrl) {
      case '/api/client':
      case '/api/requests':
        // Clientes solo pueden acceder a sus propias requests
        if (userRole === 'client') {
          const request = await ServiceRequest.findOne({
            _id: resourceId,
            client: userId
          });
          return !!request;
        }
        break;

      case '/api/provider':
      case '/api/proposals':
        // Proveedores solo pueden acceder a sus propias propuestas
        if (userRole === 'provider') {
          const proposal = await Proposal.findOne({
            _id: resourceId,
            provider: userId
          });
          return !!proposal;
        }
        break;

      case '/api/bookings':
        // Verificar si el usuario es cliente o proveedor del booking
        const booking = await Booking.findOne({
          _id: resourceId,
          $or: [
            { client: userId },
            { provider: userId }
          ]
        });
        return !!booking;

      case '/api/admin':
        // Solo admins pueden acceder a recursos admin
        return userRole === 'admin';

      default:
        return true; // Por defecto permitir si pasa RBAC básico
    }
  } catch (error) {
    console.error('Ownership check error:', error);
    return false;
  }

  return false;
}

/**
 * Middlewares específicos por rol para mejor legibilidad
 */

// Solo guests (usuarios no autenticados)
const guestOnly = rbacMiddleware(['guest'], { requireAuth: false });

// Solo clientes
const clientOnly = rbacMiddleware(['client']);

// Solo proveedores
const providerOnly = rbacMiddleware(['provider']);

// Solo administradores
const adminOnly = rbacMiddleware(['admin']);

// Clientes y proveedores
const clientOrProvider = rbacMiddleware(['client', 'provider']);

// Clientes, proveedores y admins
const authenticatedUsers = rbacMiddleware(['client', 'provider', 'admin']);

// Cualquier usuario (incluido guest)
const anyUser = rbacMiddleware(['guest', 'client', 'provider', 'admin'], { 
  requireAuth: false 
});

/**
 * Middleware para verificar suscripción activa de proveedor
 */
const requireActiveSubscription = async (req, res, next) => {
  try {
    // Verificar que el usuario tenga rol de proveedor (único o múltiple)
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
    const isProvider = userRoles.includes('provider');
    
    if (!isProvider) {
      return next(); // No es proveedor, continuar sin verificar suscripción
    }

    const provider = await Provider.findById(req.user._id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    if (provider.subscription.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Active subscription required',
        currentPlan: provider.subscription.plan,
        subscriptionStatus: provider.subscription.status
      });
    }

    // Adjuntar info de suscripción al request
    req.providerSubscription = {
      plan: provider.subscription.plan,
      limits: getPlanLimits(provider.subscription.plan),
      commissionRate: provider.billing.commissionRate
    };

    next();
  } catch (error) {
    console.error('RequireActiveSubscription middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Subscription check failed'
    });
  }
};

/**
 * Helper para obtener límites del plan
 */
function getPlanLimits(plan) {
  const limits = {
    free: { leadLimit: 1, visibilityMultiplier: 1.0 },
    basic: { leadLimit: 5, visibilityMultiplier: 1.2 },
    pro: { leadLimit: -1, visibilityMultiplier: 1.5 } // -1 = ilimitado
  };

  return limits[plan] || limits.free;
}

/**
 * Middleware para verificar límites de leads del plan
 */
const checkLeadLimit = async (req, res, next) => {
  try {
    // Verificar que el usuario tenga rol de proveedor (único o múltiple)
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role];
    const isProvider = userRoles.includes('provider');
    
    if (!isProvider) {
      return next(); // No es proveedor, continuar sin verificar límites
    }

    const provider = await Provider.findById(req.user._id);
    const plan = provider.subscription.plan;

    if (plan === 'pro') {
      return next(); // Plan pro no tiene límites
    }

    const leadLimit = getPlanLimits(plan).leadLimit;
    
    // Contar propuestas enviadas en el mes actual
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const proposalsThisMonth = await Proposal.countDocuments({
      provider: req.user._id,
      createdAt: { $gte: startOfMonth },
      status: { $in: ['sent', 'viewed', 'accepted'] }
    });

    if (proposalsThisMonth >= leadLimit) {
      return res.status(429).json({
        success: false,
        message: 'Monthly lead limit reached',
        limit: leadLimit,
        used: proposalsThisMonth,
        upgradeRequired: true
      });
    }

    req.leadUsage = {
      used: proposalsThisMonth,
      limit: leadLimit,
      remaining: leadLimit - proposalsThisMonth
    };

    next();
  } catch (error) {
    console.error('CheckLeadLimit middleware error:', error);
    next(error);
  }
};

export {
  rbacMiddleware,
  guestOnly,
  clientOnly,
  providerOnly,
  adminOnly,
  clientOrProvider,
  authenticatedUsers,
  anyUser,
  requireActiveSubscription,
  checkLeadLimit
};