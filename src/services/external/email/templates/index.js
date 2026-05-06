/**
 * Plantillas concretas de email para NovoFix.
 * Todas usan el layout base responsive y se internacionalizan vía `locale` (es/en).
 *
 * Cada función:
 *  - Recibe `data` con los campos requeridos (verifyUrl, name, etc.)
 *  - Devuelve `{ subject, html }`
 */

import { renderLayout, renderButton, renderLinkFallback, escapeHtml } from './baseLayout.js';
import { t, normalizeLocale } from './i18n.js';

const APP_NAME_DEFAULT = 'NovoFix';

const greet = (locale, name) => {
  const safeName = escapeHtml(name || '');
  const hello = t('common.hello', {}, locale);
  return safeName
    ? `<p class="text-mobile auto-dark-text" style="margin:0 0 16px; color:#2D2D2D; font-size:16px; line-height:1.6;"><strong>${escapeHtml(hello)} ${safeName}</strong>,</p>`
    : '';
};

/**
 * verify_email
 * data: { name, verifyUrl, locale, expiresInHours }
 */
export const verifyEmailTemplate = (data = {}, ctx = {}) => {
  const locale = normalizeLocale(data.locale || ctx.locale);
  const appName = ctx.appName || APP_NAME_DEFAULT;
  const verifyUrl = data.verifyUrl || '#';
  const expiresInHours = data.expiresInHours || 24;

  const subject = t('verifyEmail.subject', { appName }, locale);
  const preheader = t('verifyEmail.preheader', { appName }, locale);
  const title = t('verifyEmail.title', { appName }, locale);
  const intro = t('verifyEmail.intro', { appName }, locale);
  const cta = t('verifyEmail.cta', {}, locale);
  const expires = t('verifyEmail.expiresIn', { hours: expiresInHours }, locale);
  const ignore = t('verifyEmail.ignoreText', {}, locale);

  const bodyHtml = `
    ${greet(locale, data.name)}
    <h1 class="h1-mobile auto-dark-text" style="margin: 0 0 16px; color:#2F353B; font-size:26px; line-height:1.3; font-weight:700;">
      ${escapeHtml(title)}
    </h1>
    <p class="text-mobile auto-dark-muted" style="margin:0 0 28px; color:#4a525c; font-size:16px; line-height:1.6;">
      ${escapeHtml(intro)}
    </p>
    ${renderButton({ url: verifyUrl, label: cta, variant: 'primary' })}
    <p class="text-mobile auto-dark-muted" style="margin: 24px 0 0; color:#7d8694; font-size:13px; line-height:1.6; text-align:center;">
      ${escapeHtml(expires)}
    </p>
    ${renderLinkFallback({ url: verifyUrl, locale })}
    <hr style="border:0; border-top:1px solid #e2e4e7; margin:28px 0 16px;">
    <p class="text-mobile auto-dark-muted" style="margin:0; color:#7d8694; font-size:13px; line-height:1.6;">
      ${escapeHtml(ignore)}
    </p>
  `;

  const html = renderLayout({
    title,
    preheader,
    bodyHtml,
    locale,
    appName,
    frontendUrl: ctx.frontendUrl,
  });

  return { subject, html };
};

/**
 * password_reset
 * data: { name, resetUrl, locale, expiresInMinutes }
 */
export const passwordResetTemplate = (data = {}, ctx = {}) => {
  const locale = normalizeLocale(data.locale || ctx.locale);
  const appName = ctx.appName || APP_NAME_DEFAULT;
  const resetUrl = data.resetUrl || '#';
  const expiresInMinutes = data.expiresInMinutes || 60;

  const subject = t('passwordReset.subject', { appName }, locale);
  const preheader = t('passwordReset.preheader', {}, locale);
  const title = t('passwordReset.title', {}, locale);
  const intro = t('passwordReset.intro', {}, locale);
  const cta = t('passwordReset.cta', {}, locale);
  const expires = t('passwordReset.expiresIn', { minutes: expiresInMinutes }, locale);
  const ignore = t('passwordReset.ignoreText', {}, locale);

  const bodyHtml = `
    ${greet(locale, data.name)}
    <h1 class="h1-mobile auto-dark-text" style="margin: 0 0 16px; color:#2F353B; font-size:26px; line-height:1.3; font-weight:700;">
      ${escapeHtml(title)}
    </h1>
    <p class="text-mobile auto-dark-muted" style="margin:0 0 28px; color:#4a525c; font-size:16px; line-height:1.6;">
      ${escapeHtml(intro)}
    </p>
    ${renderButton({ url: resetUrl, label: cta, variant: 'primary' })}
    <p class="text-mobile auto-dark-muted" style="margin: 24px 0 0; color:#7d8694; font-size:13px; line-height:1.6; text-align:center;">
      ${escapeHtml(expires)}
    </p>
    ${renderLinkFallback({ url: resetUrl, locale })}
    <hr style="border:0; border-top:1px solid #e2e4e7; margin:28px 0 16px;">
    <p class="text-mobile auto-dark-muted" style="margin:0; color:#7d8694; font-size:13px; line-height:1.6;">
      ${escapeHtml(ignore)}
    </p>
  `;

  const html = renderLayout({
    title,
    preheader,
    bodyHtml,
    locale,
    appName,
    frontendUrl: ctx.frontendUrl,
  });

  return { subject, html };
};

/**
 * password_reset_confirmed
 * data: { name, loginUrl, locale }
 */
export const passwordResetConfirmedTemplate = (data = {}, ctx = {}) => {
  const locale = normalizeLocale(data.locale || ctx.locale);
  const appName = ctx.appName || APP_NAME_DEFAULT;
  const loginUrl = data.loginUrl || (ctx.frontendUrl ? `${ctx.frontendUrl}/login` : '#');

  const subject = t('passwordResetConfirmed.subject', { appName }, locale);
  const preheader = t('passwordResetConfirmed.preheader', {}, locale);
  const title = t('passwordResetConfirmed.title', {}, locale);
  const intro = t('passwordResetConfirmed.intro', {}, locale);
  const cta = t('passwordResetConfirmed.cta', {}, locale);

  const bodyHtml = `
    ${greet(locale, data.name)}
    <h1 class="h1-mobile auto-dark-text" style="margin: 0 0 16px; color:#008080; font-size:26px; line-height:1.3; font-weight:700;">
      ${escapeHtml(title)}
    </h1>
    <p class="text-mobile auto-dark-muted" style="margin:0 0 28px; color:#4a525c; font-size:16px; line-height:1.6;">
      ${escapeHtml(intro)}
    </p>
    ${renderButton({ url: loginUrl, label: cta, variant: 'primary' })}
  `;

  const html = renderLayout({ title, preheader, bodyHtml, locale, appName, frontendUrl: ctx.frontendUrl });
  return { subject, html };
};

/**
 * welcome
 * data: { name, dashboardUrl, locale }
 */
export const welcomeTemplate = (data = {}, ctx = {}) => {
  const locale = normalizeLocale(data.locale || ctx.locale);
  const appName = ctx.appName || APP_NAME_DEFAULT;
  const dashboardUrl = data.dashboardUrl || ctx.frontendUrl || '#';

  const subject = t('welcome.subject', { appName }, locale);
  const preheader = t('welcome.preheader', {}, locale);
  const title = t('welcome.title', { name: data.name || '' }, locale);
  const intro = t('welcome.intro', {}, locale);
  const cta = t('welcome.cta', {}, locale);

  const bodyHtml = `
    <h1 class="h1-mobile auto-dark-text" style="margin: 0 0 16px; color:#2F353B; font-size:26px; line-height:1.3; font-weight:700;">
      ${escapeHtml(title)}
    </h1>
    <p class="text-mobile auto-dark-muted" style="margin:0 0 28px; color:#4a525c; font-size:16px; line-height:1.6;">
      ${escapeHtml(intro)}
    </p>
    ${renderButton({ url: dashboardUrl, label: cta, variant: 'primary' })}
  `;

  const html = renderLayout({ title, preheader, bodyHtml, locale, appName, frontendUrl: ctx.frontendUrl });
  return { subject, html };
};

/**
 * notification (plantilla genérica para Paso 2 — notificaciones por email)
 *
 * data: {
 *   name, locale,
 *   subject,        // ya traducido por el caller (notificationService)
 *   title,          // título visible en el email
 *   message,        // cuerpo principal
 *   actionUrl,      // CTA destino (opcional)
 *   actionLabel,    // texto del botón (opcional, fallback "Ver detalles")
 *   highlights      // array de pares { label, value } (opcional)
 * }
 */
export const notificationTemplate = (data = {}, ctx = {}) => {
  const locale = normalizeLocale(data.locale || ctx.locale);
  const appName = ctx.appName || APP_NAME_DEFAULT;
  const subject = data.subject || appName;
  const preheader = data.message || t('notification.preheader', { message: data.message || '' }, locale);
  const title = data.title || subject;
  const message = data.message || '';
  const actionUrl = data.actionUrl || '';
  const actionLabel = data.actionLabel || t('notification.cta', {}, locale);

  const highlightsRows = Array.isArray(data.highlights) && data.highlights.length
    ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f0fdfa; border-left:4px solid #008080; border-radius:8px; margin: 16px 0 24px;">
        <tr>
          <td style="padding: 16px 20px;">
            ${data.highlights
              .filter(h => h && h.value)
              .map(h => `<p style="margin:4px 0; color:#2F353B; font-size:14px; line-height:1.5;"><strong>${escapeHtml(h.label || '')}:</strong> ${escapeHtml(h.value)}</p>`)
              .join('')}
          </td>
        </tr>
      </table>
    `
    : '';

  const bodyHtml = `
    ${greet(locale, data.name)}
    <h1 class="h1-mobile auto-dark-text" style="margin: 0 0 12px; color:#2F353B; font-size:24px; line-height:1.3; font-weight:700;">
      ${escapeHtml(title)}
    </h1>
    <p class="text-mobile auto-dark-muted" style="margin:0 0 16px; color:#4a525c; font-size:16px; line-height:1.6;">
      ${escapeHtml(message)}
    </p>
    ${highlightsRows}
    ${actionUrl ? renderButton({ url: actionUrl, label: actionLabel, variant: 'primary' }) : ''}
  `;

  const preferencesUrl = ctx.frontendUrl ? `${ctx.frontendUrl}/perfil?section=preferences` : '';

  const html = renderLayout({
    title,
    preheader,
    bodyHtml,
    locale,
    appName,
    frontendUrl: ctx.frontendUrl,
    preferencesUrl,
    showPreferences: true,
  });

  return { subject, html };
};

/**
 * Plantilla genérica final (fallback).
 */
export const genericTemplate = (data = {}, ctx = {}) => {
  return notificationTemplate(
    {
      ...data,
      title: data.title || ctx.appName || APP_NAME_DEFAULT,
      message: data.message || '',
    },
    ctx
  );
};

export default {
  verifyEmailTemplate,
  passwordResetTemplate,
  passwordResetConfirmedTemplate,
  welcomeTemplate,
  notificationTemplate,
  genericTemplate,
};
