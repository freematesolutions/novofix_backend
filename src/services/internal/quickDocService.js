// services/internal/quickDocService.js
//
// Flujo 2 — "Vía Rápida en Vivo".
// Lógica interna del documento rápido: creación de cuenta de cliente en segundo
// plano al capturar el correo (decisión B: contraseña autogenerada + email para
// establecerla, reutilizando PasswordResetToken + el flujo de reset existente).
import crypto from 'crypto';
import User from '../../models/User/User.js';
import Client from '../../models/User/Client.js';
import PasswordResetToken from '../../models/System/PasswordResetToken.js';
import resendService from '../external/email/resendService.js';

const getFrontendBaseUrl = () =>
  (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

/**
 * Crea (o vincula) una cuenta de cliente en segundo plano a partir de un correo.
 *
 * - Si ya existe un usuario con ese correo: NO crea ni modifica nada; solo lo
 *   vincula (devuelve el usuario existente). No se envía email de contraseña.
 * - Si no existe: crea un Client con contraseña aleatoria, cuenta activa y
 *   verificada (el acceso al documento es vía token público; el email de
 *   "define tu contraseña" permite el login tradicional posterior — Flujo 1).
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} [params.name]   Nombre para el perfil (opcional)
 * @param {string} [params.locale] 'es' | 'en'
 * @param {Object} [params.req]    Request (para ip/userAgent)
 * @returns {Promise<{ user: Object, created: boolean }>}
 */
export async function createOrLinkBackgroundClient({ email, name = '', locale = 'es', req = null }) {
  const normalizedEmail = String(email).toLowerCase().trim();

  // 1) ¿Existe ya una cuenta con ese correo? → solo vincular.
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return { user: existing, created: false };
  }

  // 2) Crear cuenta de cliente con contraseña aleatoria (el usuario la define luego).
  const randomPassword = crypto.randomBytes(24).toString('hex');
  const [firstName, ...rest] = String(name || '').trim().split(/\s+/).filter(Boolean);
  const lastName = rest.join(' ');

  const client = new Client({
    email: normalizedEmail,
    password: randomPassword, // se hashea en el pre-save del modelo User
    profile: {
      firstName: firstName || normalizedEmail.split('@')[0],
      lastName: lastName || ''
    },
    roles: ['client'],
    isActive: true,
    emailVerified: true,
    preferences: {
      language: locale === 'en' ? 'en' : 'es'
    }
  });
  await client.save();

  // 3) Enviar email "define tu contraseña" reutilizando PasswordResetToken.
  try {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h para primer set

    await PasswordResetToken.deleteMany({ user: client._id });
    await PasswordResetToken.create({
      user: client._id,
      tokenHash,
      expiresAt,
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent']
    });

    const setPasswordUrl = `${getFrontendBaseUrl()}/restablecer-contrasena?token=${rawToken}&uid=${client._id}`;
    await resendService.sendEmail({
      to: client.email,
      subject: locale === 'en' ? 'Set your NovoFix password' : 'Define tu contraseña en NovoFix',
      template: 'password_reset',
      data: {
        name: client.profile?.firstName || client.email,
        resetUrl: setPasswordUrl,
        expiresIn: '24h',
        locale
      },
      locale
    });
  } catch (e) {
    // El email de contraseña no es crítico para el flujo del documento.
    console.warn('[quickDocService] set-password email failed:', e?.message);
  }

  return { user: client, created: true };
}

export default { createOrLinkBackgroundClient };
