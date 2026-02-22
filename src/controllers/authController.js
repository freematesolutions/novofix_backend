// IMPORTS AL INICIO
import User from '../models/User/User.js';
import Client from '../models/User/Client.js';
import Provider from '../models/User/Provider.js';
import Session from '../models/System/Session.js';
import PasswordResetToken from '../models/System/PasswordResetToken.js';
import { generateToken } from '../middlewares/auth/jwtAuth.js';
import jwt from 'jsonwebtoken';
import { handleGuestMerge } from '../middlewares/auth/attachGuest.js';
import notificationService from '../services/external/notificationService.js';
import resendService from '../services/external/email/resendService.js';
import subscriptionService from '../services/internal/subscriptionService.js';
import crypto from 'crypto';
import { SERVICE_CATEGORIES } from '../config/categories.js';

const normalizeProviderServices = (services = [], additionalServices = []) => {
  const safeServices = Array.isArray(services) ? services : [];
  const mainService = safeServices[0] || null;
  const extraCategories = safeServices.slice(1).map(s => s?.category).filter(Boolean);
  const safeAdditional = Array.isArray(additionalServices) ? additionalServices : [];
  const combinedAdditional = Array.from(new Set([...safeAdditional, ...extraCategories]))
    .filter(cat => cat && cat !== mainService?.category);
  return { mainService, additionalServices: combinedAdditional };
};

class AuthController {
  /**
   * Registro de cliente con verificación pendiente
   * NO envía token si el usuario no está verificado
   */
  async registerClient(req, res) {
    try {
      const { email, password, firstName, lastName, phone, guestSessionId } = req.body;

      // Verificar si el usuario ya existe
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email'
        });
      }

      // Generar token de verificación de email
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');

      // Verificar si está habilitado el modo demo (para presentaciones)
      // En modo demo: NO verificamos automáticamente, pero mostramos el enlace en la UI
      const demoMode = process.env.AUTO_VERIFY_EMAIL === 'true';
      
      // Debug log para desarrollo
      console.log('[AuthController] registerClient:', {
        demoMode,
        AUTO_VERIFY_EMAIL: process.env.AUTO_VERIFY_EMAIL,
        NODE_ENV: process.env.NODE_ENV,
        EMAIL_MODE: process.env.EMAIL_MODE
      });

      // Crear nuevo cliente SIEMPRE en estado pendiente de verificación
      // (tanto en modo real como en modo demo)
      const client = new Client({
        email,
        password,
        profile: {
          firstName,
          lastName,
          phone
        },
        guestSessionId: guestSessionId || req.session?.sessionId,
        roles: ['client'],
        isActive: false, // Siempre inactivo hasta verificar
        emailVerified: false, // Siempre pendiente hasta verificar
        emailVerificationToken
      });

      await client.save();

      // URL de verificación
      const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verificar-email?token=${emailVerificationToken}`;

      // En modo demo: NO enviamos email real, solo mostraremos el enlace en la UI
      // En modo real: intentamos enviar el email
      if (!demoMode) {
        try {
          await notificationService.sendClientNotification({
            clientId: client._id,
            type: 'VERIFY_EMAIL',
            data: { firstName: client.profile?.firstName, verifyUrl }
          });
        } catch (e) {
          console.warn('Verification email failed:', e?.message);
        }
      } else {
        console.log(`[DEMO MODE] Cliente ${email} - Enlace de verificación disponible en UI`);
      }

      // Manejar merge de datos guest si existe sesión
      if (req.session?.sessionId) {
        req.user = client;
        await handleGuestMerge(req, res, () => {});
      }

      // NO generar tokens para usuario no verificado
      // Solo devolver información básica del usuario

      // Notificación de bienvenida para cliente (solo in-app, no email)
      try {
        await notificationService.sendClientNotification({
          clientId: client._id,
          type: 'WELCOME_CLIENT',
          data: { firstName: client.profile?.firstName }
        });
      } catch (e) {
        console.warn('Client welcome notification failed:', e?.message);
      }

      // Respuesta unificada: siempre pendiente de verificación
      // La diferencia es que en modo demo incluimos la URL de verificación
      res.status(201).json({
        success: true,
        message: demoMode 
          ? 'Registro exitoso. Usa el enlace de verificación para activar tu cuenta (modo demo).'
          : 'Client registered successfully. Please verify your email.',
        data: {
          user: {
            id: client._id,
            email: client.email,
            role: client.role,
            roles: client.roles,
            profile: client.profile,
            isActive: client.isActive,
            emailVerified: client.emailVerified
          },
          pendingVerification: true,
          // En modo demo: incluir URL de verificación para mostrar en la UI
          // En desarrollo: también incluir para facilitar testing
          ...(demoMode && { verificationUrl: verifyUrl, demoMode: true }),
          ...(process.env.NODE_ENV !== 'production' && !demoMode && {
            _dev: {
              verifyUrl,
              hint: 'Usa esta URL para verificar el email en desarrollo'
            }
          })
        }
      });

      // Registrar el estado inicial del usuario registrado
      console.log('Usuario registrado pendiente de verificación:', {
        email: client.email,
        isActive: client.isActive,
        emailVerified: client.emailVerified,
        emailVerificationToken: client.emailVerificationToken
      });
    } catch (error) {
      console.error('AuthController - registerClient error:', error);
      res.status(500).json({
        success: false,
        message: 'Registration failed',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Registro de proveedor con verificación pendiente
   * NO envía token si el usuario no está verificado
   */
  async registerProvider(req, res) {
    try {
      const { 
        email, 
        password, 
        businessName, 
        description, 
        services, 
        additionalServices,
        mainServiceCategory,
        mainServiceName,
        serviceArea,
        phone,
        referredByCode 
      } = req.body;

      const fallbackServices = (!services || !Array.isArray(services) || services.length === 0) && mainServiceCategory
        ? [{ category: mainServiceCategory, name: mainServiceName || mainServiceCategory, description }]
        : services;
      const { mainService, additionalServices: normalizedAdditional } = normalizeProviderServices(fallbackServices, additionalServices);

      if (!mainService || !mainService.category) {
        return res.status(400).json({
          success: false,
          message: 'Main service is required'
        });
      }

      if (!SERVICE_CATEGORIES.includes(mainService.category)) {
        return res.status(400).json({
          success: false,
          message: 'Main service category is invalid',
          validCategories: SERVICE_CATEGORIES
        });
      }

      // Validar lat/lng dentro de rango si vienen
      if (serviceArea?.coordinates) {
        const { lat, lng } = serviceArea.coordinates;
        const latOk = Number.isFinite(lat) && lat <= 90 && lat >= -90;
        const lngOk = Number.isFinite(lng) && lng <= 180 && lng >= -180;
        if (!latOk || !lngOk) {
          return res.status(400).json({ success: false, message: 'Coordenadas fuera de rango' });
        }
      }

      // Validar datos requeridos
      if (!businessName || typeof businessName !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Business name is required and must be a string'
        });
      }

      const existingProviderSameService = await Provider.findOne({
        email,
        'providerProfile.services.0.category': mainService.category
      }).select('_id');
      if (existingProviderSameService) {
        return res.status(400).json({
          success: false,
          message: 'This email is already registered for the selected main service',
          code: 'PROVIDER_EMAIL_SERVICE_EXISTS'
        });
      }

      // Verificar usuario existente: si existe, sugerir endpoint dedicado
      const existingUser = await User.findOne({ email }).select('+password');
      if (existingUser) {
        const currentRole = String(existingUser.role || '').toLowerCase();
        if (currentRole === 'provider' || (Array.isArray(existingUser.roles) && existingUser.roles.includes('provider'))) {
          return res.status(409).json({
            success: false,
            message: 'Email already registered with a different main service. Use another email or update your provider profile.',
            code: 'PROVIDER_EMAIL_DIFFERENT_SERVICE'
          });
        }

        // Si ya es cliente, indicar uso de endpoint dedicado
        return res.status(409).json({
          success: false,
          message: 'User already exists with this email as client. Use /auth/become-provider to upgrade.'
        });
      }

      // Generar código de referido
      const referralCode = AuthController.generateReferralCode(businessName);

      // Ensure plans exist
      await subscriptionService.ensurePlansSeeded();
      const freePlan = await subscriptionService.getPlan('free');

      // Generar token de verificación de email
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');

      // Verificar si está habilitado el modo demo (para presentaciones)
      // En modo demo: NO verificamos automáticamente, pero mostramos el enlace en la UI
      const demoMode = process.env.AUTO_VERIFY_EMAIL === 'true';

      // Crear proveedor SIEMPRE en estado pendiente de verificación
      const provider = new Provider({
        email,
        password,
        profile: {
          firstName: businessName, // Usar businessName como nombre inicial
          phone
        },
        guestSessionId: req.session?.sessionId,
        providerProfile: {
          businessName,
          description,
          services: [mainService],
          additionalServices: normalizedAdditional,
          serviceArea: (() => {
            const area = { zones: serviceArea?.zones || [], radius: serviceArea?.radius };
            if (serviceArea?.coordinates && Number.isFinite(serviceArea.coordinates.lat) && Number.isFinite(serviceArea.coordinates.lng)) {
              area.coordinates = {
                lat: Number(serviceArea.coordinates.lat),
                lng: Number(serviceArea.coordinates.lng)
              };
              area.location = {
                type: 'Point',
                coordinates: [Number(serviceArea.coordinates.lng), Number(serviceArea.coordinates.lat)]
              };
            }
            return area;
          })()
        },
        referral: {
          code: referralCode,
          referredBy: null
        },
        subscription: {
          plan: 'free',
          status: 'active'
        },
        billing: {
          commissionRate: freePlan.features.commissionRate
        },
        roles: ['client', 'provider'],
        isActive: false, // Siempre inactivo hasta verificar
        emailVerified: false, // Siempre pendiente hasta verificar
        emailVerificationToken
      });

      await provider.save();

      // URL de verificación
      const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verificar-email?token=${emailVerificationToken}`;

      // En modo demo: NO enviamos email real, solo mostraremos el enlace en la UI
      // En modo real: intentamos enviar el email
      if (!demoMode) {
        try {
          await notificationService.sendProviderNotification({
            providerId: provider._id,
            type: 'VERIFY_EMAIL',
            data: { businessName, verifyUrl }
          });
        } catch (e) {
          console.warn('Verification email failed:', e?.message);
        }
      } else {
        console.log(`[DEMO MODE] Proveedor ${email} - Enlace de verificación disponible en UI`);
      }

      // Aplicar código de referido si aplica
      if (referredByCode && typeof referredByCode === 'string') {
        try {
          const referrerId = await subscriptionService.applyReferralCode(referredByCode);
          if (referrerId) {
            await Provider.findByIdAndUpdate(provider._id, { $set: { 'referral.referredBy': referrerId } });
          }
        } catch (e) {
          console.warn('Referral code apply failed:', e?.message);
        }
      }

      // Mergear datos de sesión guest si existe sesión activa
      if (req.session?.sessionId) {
        req.user = provider;
        await handleGuestMerge(req, res, () => {});
      }

      // NO generar tokens para usuario no verificado
      // Solo devolver información básica

      // Enviar email de bienvenida (solo in-app por ahora)
      await notificationService.sendProviderNotification({
        providerId: provider._id,
        type: 'WELCOME_PROVIDER',
        data: { businessName }
      });

      // Emitir actualización de contadores
      try {
        const emitter = (await import('../websocket/services/emitterService.js')).default;
        emitter.emitCountersUpdateToUser(provider._id, { reason: 'provider_registered' });
      } catch {/* ignore */}

      // Respuesta unificada: siempre pendiente de verificación
      // La diferencia es que en modo demo incluimos la URL de verificación
      res.status(201).json({
        success: true,
        message: demoMode 
          ? 'Registro exitoso. Usa el enlace de verificación para activar tu cuenta (modo demo).'
          : 'Provider registered successfully. Please verify your email.',
        data: {
          user: {
            id: provider._id,
            email: provider.email,
            role: provider.role,
            roles: provider.roles,
            businessName: provider.providerProfile.businessName,
            referralCode: provider.referral.code,
            isActive: provider.isActive,
            emailVerified: provider.emailVerified
          },
          pendingVerification: true,
          // En modo demo: incluir URL de verificación para mostrar en la UI
          // En desarrollo: también incluir para facilitar testing
          ...(demoMode && { verificationUrl: verifyUrl, demoMode: true }),
          ...(process.env.NODE_ENV !== 'production' && !demoMode && {
            _dev: {
              verifyUrl,
              hint: 'Usa esta URL para verificar el email en desarrollo'
            }
          })
        }
      });
    } catch (error) {
      console.error('AuthController - registerProvider error:', error);
      res.status(500).json({
        success: false,
        message: 'Provider registration failed',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Reenviar email de verificación (ENDPOINT PÚBLICO)
   * No requiere autenticación - considerar agregar rate limiting
   */
  async resendVerificationEmail(req, res) {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email is required' 
        });
      }

      // Buscar usuario por email
      const user = await User.findOne({ email });
      if (!user) {
        // Por seguridad, responder igual aunque el usuario no exista
        // Esto evita la enumeración de cuentas
        return res.json({ 
          success: true, 
          message: 'If an account exists, a verification email has been sent.' 
        });
      }

      if (user.emailVerified) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email already verified' 
        });
      }

      // Generar nuevo token si no existe
      if (!user.emailVerificationToken) {
        user.emailVerificationToken = crypto.randomBytes(32).toString('hex');
        await user.save();
      }

      // Generar URL de verificación
      const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verificar-email?token=${user.emailVerificationToken}`;
      
      // Enviar email usando notificationService
      try {
        const userRoles = Array.isArray(user.roles) ? user.roles : [user.role];
        const isProvider = userRoles.includes('provider');
        
        if (isProvider) {
          await notificationService.sendProviderNotification({
            providerId: user._id,
            type: 'VERIFY_EMAIL',
            data: { 
              businessName: user.providerProfile?.businessName || user.profile?.firstName,
              verifyUrl 
            }
          });
        } else {
          await notificationService.sendClientNotification({
            clientId: user._id,
            type: 'VERIFY_EMAIL',
            data: { 
              firstName: user.profile?.firstName || 'Usuario',
              verifyUrl 
            }
          });
        }
      } catch (emailError) {
        console.error('Error sending verification email:', emailError);
      }

      return res.json({ 
        success: true, 
        message: 'Verification email resent successfully' 
      });
    } catch (error) {
      console.error('AuthController - resendVerificationEmail error:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to resend verification email' 
      });
    }
  }

  /**
   * Verificar email y activar cuenta
   * Genera y devuelve token después de la verificación
   */
  async verifyEmail(req, res) {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ 
          success: false, 
          message: 'Verification token is required' 
        });
      }

      // Find user by email verification token
      const user = await User.findOne({ emailVerificationToken: token });

      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'Invalid or expired token' 
        });
      }

      // Verificar que el token coincida exactamente
      if (user.emailVerificationToken !== token) {
        return res.status(400).json({ 
          success: false, 
          message: 'Token does not match' 
        });
      }

      // Activar la cuenta del usuario
      user.isActive = true;
      user.emailVerified = true;
      user.emailVerificationToken = null; // Limpiar token usado
      await user.save();

      // Generar tokens de acceso
      const accessToken = generateToken(user._id);
      const refreshToken = jwt.sign(
        { id: user._id }, 
        process.env.JWT_REFRESH_SECRET, 
        { expiresIn: '90d' }
      );

      // Establecer cookie de refresh token
      res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 90 * 24 * 60 * 60 * 1000 // 90 días
      });

      // Preparar datos del usuario según su rol
      let userData;
      const userRoles = Array.isArray(user.roles) && user.roles.length > 0 
        ? user.roles 
        : [user.role];
      
      const isProvider = userRoles.includes('provider');
      const isClient = userRoles.includes('client');

      if (isProvider) {
        const provider = await Provider.findById(user._id)
          .populate('providerProfile.rating');
        userData = {
          id: provider._id,
          email: provider.email,
          role: provider.role,
          roles: provider.roles && provider.roles.length ? provider.roles : ['client','provider'],
          profile: provider.profile,
          providerProfile: provider.providerProfile,
          subscription: provider.subscription,
          billing: provider.billing,
          referral: provider.referral,
          isActive: provider.isActive,
          emailVerified: provider.emailVerified
        };
      } else if (isClient) {
        const client = await Client.findById(user._id);
        userData = {
          id: client._id,
          email: client.email,
          role: client.role,
          roles: client.roles && client.roles.length ? client.roles : ['client'],
          profile: client.profile,
          isActive: client.isActive,
          emailVerified: client.emailVerified
        };
      } else {
        userData = {
          id: user._id,
          email: user.email,
          role: user.role,
          roles: user.roles,
          profile: user.profile,
          isActive: user.isActive,
          emailVerified: user.emailVerified
        };
      }

      return res.json({
        success: true,
        message: 'Email verified and account activated successfully',
        user: userData,
        token: accessToken // Token de acceso para el frontend
      });
    } catch (error) {
      console.error('AuthController - verifyEmail error:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to verify email' 
      });
    }
  }

  /**
   * Verificar disponibilidad de email
   */
  async checkEmailAvailability(req, res) {
    try {
      const { email, serviceCategory, mainServiceCategory, role } = req.query;
      const mainCategory = mainServiceCategory || serviceCategory;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      // Validar formato básico
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format',
          available: false
        });
      }

      // Verificar si existe en la base de datos
      const existingUser = await User.findOne({ email }).select('_id role roles');
      const available = !existingUser;

      // Si se solicita validación como proveedor con categoría principal
      if (mainCategory && (role === 'provider' || role === 'professional' || role === 'prestador')) {
        const providerSameService = await Provider.findOne({
          email,
          'providerProfile.services.0.category': mainCategory
        }).select('_id');
        if (providerSameService) {
          return res.json({
            success: true,
            available: false,
            code: 'PROVIDER_EMAIL_SERVICE_EXISTS',
            message: 'This email is already registered for the selected main service'
          });
        }
        if (existingUser) {
          return res.json({
            success: true,
            available: false,
            code: 'PROVIDER_EMAIL_DIFFERENT_SERVICE',
            message: 'Email already registered with a different main service'
          });
        }
        return res.json({
          success: true,
          available: true,
          message: 'Email is available'
        });
      }

      return res.json({
        success: true,
        available,
        message: available ? 'Email is available' : 'Email is already registered'
      });
    } catch (error) {
      console.error('AuthController - checkEmailAvailability error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking email availability',
        available: false
      });
    }
  }

  /**
   * Login de usuario (solo usuarios verificados)
   */
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Buscar usuario
      const user = await User.findOne({ email }).select('+password');
      if (!user || !(await user.correctPassword(password, user.password))) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Bloquear si el usuario no ha verificado su email
      if (!user.emailVerified) {
        return res.status(401).json({
          success: false,
          message: 'Debes verificar tu correo electrónico para acceder.'
        });
      }

      // Verificar si el usuario está activo
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated'
        });
      }

      // Actualizar último login
      user.lastLogin = new Date();
      await user.save();

      // Generar token de acceso y refresh cookie
      const token = generateToken(user._id);
      const refresh = jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '90d' });

      res.cookie('refresh_token', refresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 90 * 24 * 60 * 60 * 1000
      });

      // Preparar respuesta según el rol
      let userData;
      const r = String(user.role || '').toLowerCase();
      switch (r) {
        case 'provider':
          const provider = await Provider.findById(user._id)
            .populate('providerProfile.rating');
          userData = {
            id: provider._id,
            email: provider.email,
            role: provider.role,
            roles: provider.roles && provider.roles.length ? provider.roles : ['client','provider'],
            profile: provider.profile,
            businessName: provider.providerProfile.businessName,
            subscription: provider.subscription,
            rating: provider.providerProfile.rating
          };
          break;
        case 'client':
          userData = {
            id: user._id,
            email: user.email,
            role: user.role,
            roles: user.roles && user.roles.length ? user.roles : ['client'],
            profile: user.profile
          };
          break;
        case 'admin':
          userData = {
            id: user._id,
            email: user.email,
            role: user.role,
            roles: user.roles && user.roles.length ? user.roles : ['admin'],
            profile: user.profile
          };
          break;
      }

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: userData,
          token
        }
      });
    } catch (error) {
      console.error('AuthController - login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Upgrade explícito de cliente a proveedor
   */
  async becomeProvider(req, res) {
    try {
      const userId = req.user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Validar que NO sea ya proveedor
      const currentUser = await User.findById(userId);
      const isProvider = String(currentUser?.role || '').toLowerCase() === 'provider' || 
                        (currentUser?.roles || []).includes('provider');
      if (isProvider) {
        return res.status(400).json({ success: false, message: 'User is already a provider' });
      }

      const {
        businessName,
        description,
        services,
        additionalServices,
        mainServiceCategory,
        mainServiceName,
        serviceArea,
        phone,
        referredBy
      } = req.body;

      const fallbackServices = (!services || !Array.isArray(services) || services.length === 0) && mainServiceCategory
        ? [{ category: mainServiceCategory, name: mainServiceName || mainServiceCategory, description }]
        : services;
      const { mainService, additionalServices: normalizedAdditional } = normalizeProviderServices(fallbackServices, additionalServices);

      if (!mainService || !mainService.category) {
        return res.status(400).json({ success: false, message: 'Main service is required' });
      }
      if (!SERVICE_CATEGORIES.includes(mainService.category)) {
        return res.status(400).json({ success: false, message: 'Main service category is invalid', validCategories: SERVICE_CATEGORIES });
      }

      if (!businessName || typeof businessName !== 'string') {
        return res.status(400).json({ success: false, message: 'Business name is required and must be a string' });
      }

      const referralCode = AuthController.generateReferralCode(businessName);

      const svcAreaSet = {};
      if (serviceArea) {
        if (serviceArea.coordinates) {
          const { lat, lng } = serviceArea.coordinates;
          const latOk = Number.isFinite(lat) && lat <= 90 && lat >= -90;
          const lngOk = Number.isFinite(lng) && lng <= 180 && lng >= -180;
          if (!latOk || !lngOk) {
            return res.status(400).json({ success: false, message: 'Coordenadas fuera de rango' });
          }
        }
        svcAreaSet['providerProfile.serviceArea.radius'] = serviceArea.radius;
        svcAreaSet['providerProfile.serviceArea.zones'] = serviceArea.zones;
        if (serviceArea.coordinates && Number.isFinite(serviceArea.coordinates.lat) && Number.isFinite(serviceArea.coordinates.lng)) {
          svcAreaSet['providerProfile.serviceArea.coordinates'] = {
            lat: Number(serviceArea.coordinates.lat),
            lng: Number(serviceArea.coordinates.lng)
          };
          svcAreaSet['providerProfile.serviceArea.location'] = {
            type: 'Point',
            coordinates: [Number(serviceArea.coordinates.lng), Number(serviceArea.coordinates.lat)]
          };
        }
      }

      await subscriptionService.ensurePlansSeeded();
      const freePlan = await subscriptionService.getPlan('free');

      await User.updateOne(
        { _id: userId },
        {
          $set: {
            role: 'Provider',
            'profile.firstName': businessName,
            'profile.phone': phone,
            'providerProfile.businessName': businessName,
            'providerProfile.description': description,
            'providerProfile.services': [mainService],
            'providerProfile.additionalServices': normalizedAdditional,
            ...svcAreaSet,
            'subscription.plan': 'free',
            'subscription.status': 'active',
            'billing.commissionRate': freePlan.features.commissionRate,
            'referral.code': referralCode,
            'referral.referredBy': referredBy || null,
            guestSessionId: req.session?.sessionId || null
          },
          $addToSet: { roles: { $each: ['provider', 'client'] } }
        },
        { overwriteDiscriminatorKey: true }
      );

      const updatedUser = await User.findById(userId);
      if (!updatedUser || String(updatedUser.role || '').toLowerCase() !== 'provider') {
        return res.status(500).json({ success: false, message: 'Upgrade failed: could not promote user to provider' });
      }

      const providerUser = await Provider.findById(userId);

      if (req.session?.sessionId && updatedUser) {
        req.user = updatedUser;
        await handleGuestMerge(req, res, () => {});
      }

      const token = generateToken(userId);
      const refresh = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '90d' });

      res.cookie('refresh_token', refresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 90 * 24 * 60 * 60 * 1000
      });

      try {
        await notificationService.sendProviderNotification({
          providerId: userId,
          type: 'WELCOME_PROVIDER',
          data: { businessName }
        });
      } catch (e) {
        console.warn('Provider welcome notification failed:', e?.message);
      }

      try {
        const emitter = (await import('../websocket/services/emitterService.js')).default;
        emitter.emitCountersUpdateToUser(userId, { reason: 'become_provider' });
      } catch {/* ignore */}

      res.status(200).json({
        success: true,
        message: 'Upgraded to provider successfully',
        data: {
          user: {
            id: updatedUser._id,
            email: updatedUser.email,
            role: updatedUser.role,
            roles: Array.isArray(updatedUser.roles) && updatedUser.roles.length ? updatedUser.roles : ['client', 'provider'],
            businessName: providerUser?.providerProfile?.businessName || businessName,
            referralCode: providerUser?.referral?.code || referralCode
          },
          token
        }
      });
    } catch (error) {
      console.error('AuthController - becomeProvider error:', error);
      res.status(500).json({ success: false, message: 'Upgrade to provider failed', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
  }

  /**
   * Solicitar restablecimiento de contraseña
   */
  async forgotPassword(req, res) {
    try {
      const { email } = req.body || {};
      const genericResponse = {
        success: true,
        message: 'If an account exists, an email has been sent with instructions.'
      };

      if (!email || typeof email !== 'string') {
        return res.status(200).json(genericResponse);
      }

      const user = await User.findOne({ email: String(email).toLowerCase().trim() });
      if (!user) {
        return res.status(200).json(genericResponse);
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await PasswordResetToken.deleteMany({ user: user._id });

      await PasswordResetToken.create({
        user: user._id,
        tokenHash,
        expiresAt,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetUrl = `${frontendUrl}/restablecer-contrasena?token=${rawToken}&uid=${user._id}`;

      await resendService.sendEmail({
        to: user.email,
        subject: 'Restablecer contraseña',
        template: 'password_reset',
        data: {
          name: user.profile?.firstName || user.email,
          resetUrl,
          expiresIn: '60 minutos'
        }
      });

      return res.status(200).json(genericResponse);
    } catch (error) {
      console.error('AuthController - forgotPassword error:', error);
      return res.status(200).json({
        success: true,
        message: 'If an account exists, an email has been sent with instructions.'
      });
    }
  }

  /**
   * Confirmar restablecimiento de contraseña
   */
  async resetPassword(req, res) {
    try {
      const { token, uid, password } = req.body || {};

      if (!token || !uid || !password) {
        return res.status(400).json({ success: false, message: 'Invalid request' });
      }

      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
      }

      const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');

      const record = await PasswordResetToken.findOne({
        user: uid,
        tokenHash,
        usedAt: null,
        expiresAt: { $gt: new Date() }
      });

      if (!record) {
        return res.status(400).json({ success: false, message: 'Invalid or expired token' });
      }

      const user = await User.findById(uid).select('+password');
      if (!user) {
        return res.status(400).json({ success: false, message: 'Invalid token' });
      }

      user.password = password;
      await user.save();

      record.usedAt = new Date();
      await record.save();
      await PasswordResetToken.deleteMany({ user: uid, _id: { $ne: record._id } });

      try {
        await resendService.sendEmail({
          to: user.email,
          subject: 'Tu contraseña fue actualizada',
          template: 'password_reset_confirmed',
          data: {
            name: user.profile?.firstName || user.email,
            loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`
          }
        });
      } catch (e) {
        console.warn('Password reset confirmation email failed:', e?.message);
      }

      return res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
      console.error('AuthController - resetPassword error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
  }

  /**
   * Obtener perfil de usuario actual
   */
  async getProfile(req, res) {
    try {
      let userData;
      const userRoles = Array.isArray(req.user.roles) && req.user.roles.length > 0 
        ? req.user.roles 
        : [req.user.role];
      const hasProvider = userRoles.includes('provider');
      const hasClient = userRoles.includes('client');
      const r = String(req.user.role || '').toLowerCase();

      if (hasProvider) {
        const provider = await Provider.findById(req.user._id)
          .populate('providerProfile.rating');
        userData = {
          id: provider._id,
          email: provider.email,
          role: provider.role,
          roles: provider.roles && provider.roles.length ? provider.roles : ['client','provider'],
          profile: provider.profile,
          providerProfile: provider.providerProfile,
          subscription: provider.subscription,
          billing: provider.billing,
          referral: provider.referral,
          score: provider.score,
          isActive: provider.isActive,
          emailVerified: provider.emailVerified
        };
        if (hasClient && provider.clientProfile) {
          userData.clientProfile = provider.clientProfile;
        }
      } else if (hasClient || r === 'client') {
        const client = await Client.findById(req.user._id)
          .populate('clientProfile.serviceHistory')
          .populate('clientProfile.favoriteProviders');
        userData = {
          id: client._id,
          email: client.email,
          role: client.role,
          roles: client.roles && client.roles.length ? client.roles : ['client'],
          profile: client.profile,
          contact: client.contact,
          clientProfile: client.clientProfile,
          isActive: client.isActive,
          emailVerified: client.emailVerified
        };
      } else {
        userData = {
          id: req.user._id,
          email: req.user.email,
          role: req.user.role,
          roles: req.user.roles,
          profile: req.user.profile,
          isActive: req.user.isActive,
          emailVerified: req.user.emailVerified
        };
      }

      res.json({
        success: true,
        data: { user: userData }
      });
    } catch (error) {
      console.error('AuthController - getProfile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get profile',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Actualizar perfil de usuario
   */
  async updateProfile(req, res) {
    try {
      const updateData = req.body;
      let user;
      const r = String(req.user.role || '').toLowerCase();
      // Obtener el usuario actual para mergear el profile
      const currentUser = await User.findById(req.user._id);
      const mergedProfile = { ...((currentUser && currentUser.profile) || {}), ...(updateData.profile || {}) };
      switch (r) {
        case 'provider': {
          const svcArea = updateData.serviceArea;
          const setOps = {
            'profile': mergedProfile
          };
          
          // Solo agregar campos si tienen valor definido
          if (updateData.businessName !== undefined) {
            setOps['providerProfile.businessName'] = updateData.businessName;
          }
          if (updateData.description !== undefined) {
            setOps['providerProfile.description'] = updateData.description;
          }
          if (updateData.services !== undefined) {
            const { mainService, additionalServices: normalizedAdditional } = normalizeProviderServices(
              updateData.services,
              updateData.additionalServices
            );
            if (!mainService || !mainService.category) {
              return res.status(400).json({ success: false, message: 'Main service is required' });
            }
            if (!SERVICE_CATEGORIES.includes(mainService.category)) {
              return res.status(400).json({ success: false, message: 'Main service category is invalid', validCategories: SERVICE_CATEGORIES });
            }
            setOps['providerProfile.services'] = [mainService];
            setOps['providerProfile.additionalServices'] = normalizedAdditional;
          } else if (updateData.additionalServices !== undefined) {
            setOps['providerProfile.additionalServices'] = Array.isArray(updateData.additionalServices)
              ? updateData.additionalServices
              : [];
          }
          if (updateData.availability !== undefined) {
            setOps['providerProfile.availability'] = updateData.availability;
          }
          
          if (svcArea) {
            if (svcArea.coordinates) {
              const { lat, lng } = svcArea.coordinates;
              const latOk = Number.isFinite(lat) && lat <= 90 && lat >= -90;
              const lngOk = Number.isFinite(lng) && lng <= 180 && lng >= -180;
              if (!latOk || !lngOk) {
                return res.status(400).json({ success: false, message: 'Coordenadas fuera de rango' });
              }
            }
            setOps['providerProfile.serviceArea.radius'] = svcArea.radius;
            setOps['providerProfile.serviceArea.zones'] = svcArea.zones;
            if (svcArea.coordinates && Number.isFinite(svcArea.coordinates.lat) && Number.isFinite(svcArea.coordinates.lng)) {
              setOps['providerProfile.serviceArea.coordinates'] = {
                lat: Number(svcArea.coordinates.lat),
                lng: Number(svcArea.coordinates.lng)
              };
              setOps['providerProfile.serviceArea.location'] = {
                type: 'Point',
                coordinates: [Number(svcArea.coordinates.lng), Number(svcArea.coordinates.lat)]
              };
            } else {
              setOps['providerProfile.serviceArea.location'] = undefined;
            }
          }
          user = await Provider.findByIdAndUpdate(
            req.user._id,
            { $set: setOps },
            { new: true, runValidators: true }
          );
          try {
            const changedKeys = Object.keys(setOps || {});
            if (changedKeys.some(k => k === 'providerProfile.services')) {
              const emitter = (await import('../websocket/services/emitterService.js')).default;
              emitter.emitCountersUpdateToUser(req.user._id, { reason: 'services_changed' });
            }
          } catch {/* ignore */}
          break;
        }
        case 'client':
          user = await Client.findByIdAndUpdate(
            req.user._id,
            { 
              $set: {
                'profile': mergedProfile,
                'contact': updateData.contact
              }
            },
            { new: true, runValidators: true }
          );
          break;
        default:
          user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: { 'profile': mergedProfile } },
            { new: true, runValidators: true }
          );
      }

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: { user }
      });
    } catch (error) {
      console.error('AuthController - updateProfile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update profile',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Generar código de referido
   */
  static generateReferralCode(businessName) {
    const base = businessName
      .replace(/\s+/g, '')
      .toUpperCase()
      .slice(0, 6);
    
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${base}${random}`;
  }

  /**
   * Agregar items al portfolio del proveedor
   */
  async addPortfolioItems(req, res) {
    try {
      const { portfolio } = req.body;

      if (!Array.isArray(portfolio) || portfolio.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Portfolio items array required'
        });
      }

      const provider = await Provider.findById(req.user._id);
      if (!provider) {
        return res.status(404).json({
          success: false,
          message: 'Provider not found'
        });
      }

      const portfolioItems = portfolio.map(item => ({
        url: item.url,
        cloudinaryId: item.cloudinaryId,
        type: item.type,
        caption: item.caption || '',
        category: item.category || null,
        uploadedAt: new Date()
      }));

      provider.providerProfile.portfolio = provider.providerProfile.portfolio || [];
      provider.providerProfile.portfolio.push(...portfolioItems);

      await provider.save();

      res.json({
        success: true,
        message: 'Portfolio items added successfully',
        data: {
          portfolio: provider.providerProfile.portfolio
        }
      });
    } catch (error) {
      console.error('AuthController - addPortfolioItems error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add portfolio items',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Eliminar item del portfolio del proveedor
   */
  async deletePortfolioItem(req, res) {
    try {
      const { itemId } = req.params;

      const provider = await Provider.findById(req.user._id);
      if (!provider) {
        return res.status(404).json({
          success: false,
          message: 'Provider not found'
        });
      }

      const itemIndex = provider.providerProfile.portfolio.findIndex(
        item => item._id.toString() === itemId
      );

      if (itemIndex === -1) {
        return res.status(404).json({
          success: false,
          message: 'Portfolio item not found'
        });
      }

      const item = provider.providerProfile.portfolio[itemIndex];
      
      if (item.cloudinaryId) {
        try {
          const cloudinary = (await import('../config/cloudinary.js')).default;
          await cloudinary.uploader.destroy(item.cloudinaryId, {
            resource_type: item.type === 'video' ? 'video' : 'image'
          });
        } catch (cloudinaryError) {
          console.error('Failed to delete from Cloudinary:', cloudinaryError);
        }
      }

      provider.providerProfile.portfolio.splice(itemIndex, 1);
      await provider.save();

      res.json({
        success: true,
        message: 'Portfolio item deleted successfully',
        data: {
          portfolio: provider.providerProfile.portfolio
        }
      });
    } catch (error) {
      console.error('AuthController - deletePortfolioItem error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete portfolio item',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

const authController = new AuthController();
export default authController;