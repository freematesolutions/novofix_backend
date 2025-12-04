// controllers/authController.js
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

class AuthController {
  /**
   * Verificar disponibilidad de email
   */
  async checkEmailAvailability(req, res) {
    try {
      const { email } = req.query;

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
      const existingUser = await User.findOne({ email }).select('_id');
      const available = !existingUser;

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
   * Registro de cliente con merge de sesión guest
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

      // Crear nuevo cliente - no necesitamos especificar role porque es manejado por el discriminator
      const client = new Client({
        email,
        password,
        profile: {
          firstName,
          lastName,
          phone
        },
        guestSessionId: guestSessionId || req.session?.sessionId,
        roles: ['client']
      });

      await client.save();

      // Manejar merge de datos guest si existe sesión
      if (req.session?.sessionId) {
        req.user = client;
        await handleGuestMerge(req, res, () => {});
      }

      // Generar tokens (access + refresh)
      const token = generateToken(client._id);
      const refresh = jwt.sign({ id: client._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '90d' });

      // Setear cookie httpOnly con refresh token
      res.cookie('refresh_token', refresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 90 * 24 * 60 * 60 * 1000
      });

      // Notificación de bienvenida para cliente (in-app + real-time)
      try {
        await notificationService.sendClientNotification({
          clientId: client._id,
          type: 'WELCOME_CLIENT',
          data: { firstName: client.profile?.firstName }
        });
      } catch (e) {
        console.warn('Client welcome notification failed:', e?.message);
      }

      res.status(201).json({
        success: true,
        message: 'Client registered successfully',
        data: {
          user: {
            id: client._id,
            email: client.email,
            role: client.role,
            roles: client.roles,
            profile: client.profile
          },
          token
        }
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
   * Registro de proveedor
   */
  async registerProvider(req, res) {
    try {
      const { 
        email, 
        password, 
        businessName, 
        description, 
        services, 
        serviceArea,
        phone,
        referredByCode 
      } = req.body;

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

      // Verificar usuario existente: si existe, sugerir endpoint dedicado
      const existingUser = await User.findOne({ email }).select('+password');
      if (existingUser) {
        const currentRole = String(existingUser.role || '').toLowerCase();
        if (currentRole === 'provider') {
          return res.status(400).json({
            success: false,
            message: 'User already exists as provider'
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

      // Crear proveedor (no establecer 'role'; lo maneja el discriminator)
      // Ensure plans exist
      await subscriptionService.ensurePlansSeeded();

      const freePlan = await subscriptionService.getPlan('free');

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
          services,
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
        roles: ['client', 'provider']
      });

      await provider.save();

      // Aplicar código de referido si aplica (50% off siguiente mes, máx 3)
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

      // Mergear datos de sesión guest si existe sesión activa (paridad con cliente)
      if (req.session?.sessionId) {
        req.user = provider;
        await handleGuestMerge(req, res, () => {});
      }

      // Generar tokens (access + refresh)
      const token = generateToken(provider._id);
      const refresh = jwt.sign({ id: provider._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '90d' });

      res.cookie('refresh_token', refresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 90 * 24 * 60 * 60 * 1000
      });

      // Enviar email de bienvenida
      await notificationService.sendProviderNotification({
        providerId: provider._id,
        type: 'WELCOME_PROVIDER',
        data: { businessName }
      });

      // Emitir actualización de contadores (servicios del proveedor, etc.)
      try {
        const emitter = (await import('../websocket/services/emitterService.js')).default;
        emitter.emitCountersUpdateToUser(provider._id, { reason: 'provider_registered' });
      } catch {/* ignore */}

      res.status(201).json({
        success: true,
        message: 'Provider registered successfully',
        data: {
          user: {
            id: provider._id,
            email: provider.email,
            role: provider.role,
            roles: provider.roles,
            businessName: provider.providerProfile.businessName,
            referralCode: provider.referral.code
          },
          token
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
   * Upgrade explícito de cliente a proveedor (endpoint dedicado)
   */
  async becomeProvider(req, res) {
    try {
      const userId = req.user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Validar que NO sea ya proveedor (por role o roles[])
      const currentUser = await User.findById(userId);
      const isProvider = String(currentUser?.role || '').toLowerCase() === 'provider' || (currentUser?.roles || []).includes('provider');
      if (isProvider) {
        return res.status(400).json({ success: false, message: 'User is already a provider' });
      }

      const {
        businessName,
        description,
        services,
        serviceArea,
        phone,
        referredBy
      } = req.body;

      if (!businessName || typeof businessName !== 'string') {
        return res.status(400).json({ success: false, message: 'Business name is required and must be a string' });
      }

      const referralCode = AuthController.generateReferralCode(businessName);

      // Promover al usuario a Provider conservando datos existentes
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
            'providerProfile.services': services,
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

      // Cargar el documento ya actualizado de forma segura
      const updatedUser = await User.findById(userId);
      if (!updatedUser || String(updatedUser.role || '').toLowerCase() !== 'provider') {
        return res.status(500).json({ success: false, message: 'Upgrade failed: could not promote user to provider' });
      }

      // Obtener vista como Provider (puede devolver null si el discriminador no aplica aún)
      const providerUser = await Provider.findById(userId);

      // Merge de datos guest solo si tenemos currentUser válido
      if (req.session?.sessionId && updatedUser) {
        req.user = updatedUser; // asegurar usuario para handleGuestMerge
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

      // Enviar notificación de bienvenida (usar businessName de input como fallback)
      try {
        await notificationService.sendProviderNotification({
          providerId: userId,
          type: 'WELCOME_PROVIDER',
          data: { businessName }
        });
      } catch (e) {
        console.warn('Provider welcome notification failed:', e?.message);
      }

      // Emit counters update for newly upgraded provider
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
   * Login de usuario
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

      // Preparar respuesta según el rol (normalizado a minúsculas)
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
   * Solicitar restablecimiento de contraseña
   * Responde genéricamente para evitar enumeración de cuentas
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

      // Generar token aleatorio y hash para almacenar
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 minutos

      // Limpiar tokens anteriores del usuario
      await PasswordResetToken.deleteMany({ user: user._id });

      // Guardar token
      await PasswordResetToken.create({
        user: user._id,
        tokenHash,
        expiresAt,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetUrl = `${frontendUrl}/restablecer-contrasena?token=${rawToken}&uid=${user._id}`;

      // Enviar email (simulado por consola en este entorno)
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
      // Respuesta genérica para evitar filtrado
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

      // Actualizar contraseña (se hashea en pre-save)
      user.password = password;
      await user.save();

      // Marcar token como usado e invalidar el resto
      record.usedAt = new Date();
      await record.save();
      await PasswordResetToken.deleteMany({ user: uid, _id: { $ne: record._id } });

      // Email de confirmación (opcional)
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
        // No bloquear por fallo de notificación
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

      // Para usuarios multi-rol, buscar en Provider (que tiene toda la info)
      // ya que Provider extiende de User y puede tener tanto clientProfile como providerProfile
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
          score: provider.score
        };
        // Si también es cliente, agregar clientProfile si existe
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
          clientProfile: client.clientProfile
        };
      } else {
        userData = {
          id: req.user._id,
          email: req.user.email,
          role: req.user.role,
          roles: req.user.roles,
          profile: req.user.profile
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
      switch (r) {
        case 'provider': {
          const svcArea = updateData.serviceArea;
          // Construir actualización garantizando GeoJSON si hay lat/lng
          const setOps = {
            'profile': updateData.profile,
            'providerProfile.businessName': updateData.businessName,
            'providerProfile.description': updateData.description,
            'providerProfile.services': updateData.services,
            'providerProfile.availability': updateData.availability
          };
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
              // Si se quitó la ubicación, eliminamos el punto geo para evitar índice inválido
              setOps['providerProfile.serviceArea.location'] = undefined;
            }
          }
          user = await Provider.findByIdAndUpdate(
            req.user._id,
            { $set: setOps },
            { new: true, runValidators: true }
          );
          // Emit counters update if services changed (affects 'Servicios' count) or availability changes might impact jobs list
          try {
            const changedKeys = Object.keys(setOps || {});
            if (changedKeys.some(k => k === 'providerProfile.services')) {
              const emitter = (await import('../websocket/services/emitterService.js')).default;
              emitter.emitCountersUpdateToUser(req.user._id, { reason: 'services_changed' });
            }
          } catch {/* ignore */}
          break;
        }
          break;
        case 'client':
          user = await Client.findByIdAndUpdate(
            req.user._id,
            { 
              $set: {
                'profile': updateData.profile,
                'contact': updateData.contact
              }
            },
            { new: true, runValidators: true }
          );
          break;
        default:
          user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: { 'profile': updateData.profile } },
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
   * Aplicar descuento por referido
   */
  static async applyReferralDiscount(referralCode, newProviderId) {
    try {
      // Deprecated in favor of subscriptionService.applyReferralCode
      await subscriptionService.applyReferralCode(referralCode);
    } catch (error) {
      console.error('AuthController - applyReferralDiscount error:', error);
    }
  }

  /**
   * Agregar items al portfolio del proveedor
   */
  async addPortfolioItems(req, res) {
    try {
      const { portfolio } = req.body; // Array de items: [{ url, cloudinaryId, type, caption, category }]

      if (!Array.isArray(portfolio) || portfolio.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Portfolio items array required'
        });
      }

      // Verificar que el usuario sea proveedor
      const provider = await Provider.findById(req.user._id);
      if (!provider) {
        return res.status(404).json({
          success: false,
          message: 'Provider not found'
        });
      }

      // Agregar items al portfolio
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

      // Encontrar y eliminar el item
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
      
      // Eliminar de Cloudinary si tiene cloudinaryId
      if (item.cloudinaryId) {
        try {
          const cloudinary = (await import('../config/cloudinary.js')).default;
          await cloudinary.uploader.destroy(item.cloudinaryId, {
            resource_type: item.type === 'video' ? 'video' : 'image'
          });
        } catch (cloudinaryError) {
          console.error('Failed to delete from Cloudinary:', cloudinaryError);
          // Continuar con la eliminación del registro aunque falle Cloudinary
        }
      }

      // Eliminar del array
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