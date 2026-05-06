/**
 * Diccionario de traducciones para plantillas de email (ES/EN)
 * Mantener sincronizado con `client/src/locales/{es,en}/translation.json` (sección email.*)
 */

export const SUPPORTED_LOCALES = ['es', 'en'];
export const DEFAULT_LOCALE = 'es';

export const normalizeLocale = (locale) => {
  if (!locale) return DEFAULT_LOCALE;
  const lc = String(locale).toLowerCase().slice(0, 2);
  return SUPPORTED_LOCALES.includes(lc) ? lc : DEFAULT_LOCALE;
};

const dict = {
  es: {
    // Comunes
    common: {
      hello: 'Hola',
      buttonFallback: '¿Tienes problemas con el botón? Copia y pega este enlace en tu navegador:',
      automatedMessage: 'Este es un mensaje automático, por favor no respondas a este correo.',
      rights: 'Todos los derechos reservados.',
      preferencesText: '¿Quieres dejar de recibir estos correos?',
      preferencesLink: 'Gestiona tus preferencias',
      help: '¿Necesitas ayuda?',
      contactUs: 'Contáctanos',
      visit: 'Visitar',
    },
    // verify_email
    verifyEmail: {
      subject: 'Verifica tu correo electrónico · {{appName}}',
      preheader: 'Confirma tu email para activar tu cuenta en {{appName}}.',
      title: '¡Bienvenido a {{appName}}!',
      intro: 'Gracias por unirte. Solo falta un paso: confirma tu correo electrónico para activar tu cuenta y empezar a usar todas las funcionalidades.',
      cta: 'Verificar mi correo',
      expiresIn: 'Este enlace expira en {{hours}} horas.',
      ignoreText: 'Si no creaste esta cuenta, puedes ignorar este mensaje y nada cambiará.',
    },
    // password_reset
    passwordReset: {
      subject: 'Restablece tu contraseña · {{appName}}',
      preheader: 'Solicitud para restablecer tu contraseña.',
      title: 'Restablecer contraseña',
      intro: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón para crear una nueva.',
      cta: 'Cambiar contraseña',
      expiresIn: 'Este enlace expira en {{minutes}} minutos.',
      ignoreText: 'Si no solicitaste esto, ignora este mensaje. Tu contraseña permanecerá igual.',
    },
    // password_reset_confirmed
    passwordResetConfirmed: {
      subject: 'Contraseña actualizada · {{appName}}',
      preheader: 'Tu contraseña se actualizó correctamente.',
      title: '¡Contraseña actualizada!',
      intro: 'Tu contraseña fue cambiada con éxito. Si no realizaste este cambio, contacta inmediatamente con soporte.',
      cta: 'Iniciar sesión',
    },
    // welcome
    welcome: {
      subject: '¡Bienvenido a {{appName}}!',
      preheader: 'Estamos felices de tenerte con nosotros.',
      title: '¡Bienvenido, {{name}}!',
      intro: 'Tu cuenta está lista. Empieza a explorar profesionales verificados, recibe presupuestos y reserva servicios en minutos.',
      cta: 'Explorar servicios',
    },
    // notification (plantilla genérica para emails de notificación)
    notification: {
      preheader: '{{message}}',
      cta: 'Ver detalles',
    },
  },
  en: {
    common: {
      hello: 'Hi',
      buttonFallback: 'Trouble with the button? Copy and paste this link into your browser:',
      automatedMessage: 'This is an automated message, please do not reply to this email.',
      rights: 'All rights reserved.',
      preferencesText: 'Want to stop receiving these emails?',
      preferencesLink: 'Manage your preferences',
      help: 'Need help?',
      contactUs: 'Contact us',
      visit: 'Visit',
    },
    verifyEmail: {
      subject: 'Verify your email · {{appName}}',
      preheader: 'Confirm your email to activate your {{appName}} account.',
      title: 'Welcome to {{appName}}!',
      intro: 'Thanks for joining. Just one more step: confirm your email address to activate your account and start using all the features.',
      cta: 'Verify my email',
      expiresIn: 'This link expires in {{hours}} hours.',
      ignoreText: "If you didn't create this account, you can safely ignore this message.",
    },
    passwordReset: {
      subject: 'Reset your password · {{appName}}',
      preheader: 'Password reset request.',
      title: 'Reset your password',
      intro: 'We received a request to reset the password for your account. Click the button below to create a new one.',
      cta: 'Reset password',
      expiresIn: 'This link expires in {{minutes}} minutes.',
      ignoreText: "If you didn't request this, just ignore this message. Your password won't change.",
    },
    passwordResetConfirmed: {
      subject: 'Password updated · {{appName}}',
      preheader: 'Your password was updated successfully.',
      title: 'Password updated!',
      intro: "Your password was changed successfully. If you didn't make this change, please contact support immediately.",
      cta: 'Sign in',
    },
    welcome: {
      subject: 'Welcome to {{appName}}!',
      preheader: "We're happy to have you with us.",
      title: 'Welcome, {{name}}!',
      intro: 'Your account is ready. Start exploring verified professionals, receive quotes and book services in minutes.',
      cta: 'Explore services',
    },
    notification: {
      preheader: '{{message}}',
      cta: 'View details',
    },
  },
};

/**
 * Obtiene el diccionario para un locale (con fallback a 'es')
 */
export const getDict = (locale) => dict[normalizeLocale(locale)] || dict[DEFAULT_LOCALE];

/**
 * Interpola variables {{var}} en una cadena
 */
export const interpolate = (str = '', vars = {}) => {
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
};

/**
 * Atajo: traduce y aplica interpolación.
 *   t('verifyEmail.title', { appName: 'NovoFix' }, 'es')
 */
export const t = (path, vars = {}, locale = DEFAULT_LOCALE) => {
  const d = getDict(locale);
  const segments = String(path).split('.');
  let cur = d;
  for (const seg of segments) {
    if (cur && typeof cur === 'object' && seg in cur) cur = cur[seg];
    else { cur = undefined; break; }
  }
  if (cur === undefined) {
    // fallback al DEFAULT_LOCALE
    let fb = dict[DEFAULT_LOCALE];
    for (const seg of segments) {
      if (fb && typeof fb === 'object' && seg in fb) fb = fb[seg];
      else { fb = ''; break; }
    }
    cur = fb;
  }
  return interpolate(String(cur || ''), vars);
};

export default { t, getDict, interpolate, normalizeLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE };
