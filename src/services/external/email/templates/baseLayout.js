/**
 * Layout base de email HTML responsive con paleta NovoFix.
 *
 * Paleta:
 *  - Brand (Teal):   #008080  · hover #006b6b
 *  - Accent (Gold):  #FFBF00  · hover #E1AD01
 *  - Dark:           #2F353B
 *  - Body text:      #2D2D2D
 *
 * Diseño mobile-first usando tablas (compatible Gmail/Outlook/Apple Mail)
 * y media queries para fine-tuning en clientes que las soportan.
 */

import { getDict } from './i18n.js';

const escapeHtml = (str = '') =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Construye el documento HTML completo a partir del bloque interior (`bodyHtml`).
 *
 * @param {Object} opts
 * @param {string} opts.title       - Título corto (usado en <title> y header).
 * @param {string} opts.preheader   - Texto invisible mostrado en preview de inbox.
 * @param {string} opts.bodyHtml    - HTML del cuerpo (insertado dentro del card).
 * @param {string} opts.locale      - 'es' | 'en'
 * @param {string} opts.appName     - Nombre de la marca.
 * @param {string} [opts.frontendUrl] - URL pública para footer.
 * @param {string} [opts.preferencesUrl] - URL para gestionar preferencias (opcional).
 * @param {boolean} [opts.showPreferences=false]
 */
export const renderLayout = ({
  title,
  preheader = '',
  bodyHtml = '',
  locale = 'es',
  appName = 'NovoFix',
  frontendUrl = '',
  preferencesUrl = '',
  showPreferences = false,
} = {}) => {
  const c = getDict(locale).common;
  const year = new Date().getFullYear();
  const safeTitle = escapeHtml(title || appName);
  const safePreheader = escapeHtml(preheader);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${safeTitle}</title>
  <style>
    /* Resets básicos */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f6f7f8; }

    /* Tipografía */
    body, table, td, p, a, li { font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }

    /* Botón principal (CTA) — paleta NovoFix Teal */
    .btn-primary { background-color: #008080 !important; }
    .btn-primary:hover { background-color: #006b6b !important; }

    /* Mobile responsive */
    @media screen and (max-width: 600px) {
      .container { width: 100% !important; max-width: 100% !important; }
      .px-mobile { padding-left: 24px !important; padding-right: 24px !important; }
      .py-mobile { padding-top: 28px !important; padding-bottom: 28px !important; }
      .h1-mobile { font-size: 22px !important; line-height: 1.3 !important; }
      .text-mobile { font-size: 15px !important; line-height: 1.6 !important; }
      .btn-mobile { width: 100% !important; display: block !important; padding: 14px 20px !important; }
      .hide-mobile { display: none !important; }
    }

    /* Dark mode opcional (clientes que lo respeten) */
    @media (prefers-color-scheme: dark) {
      .auto-dark-bg { background-color: #2F353B !important; }
      .auto-dark-card { background-color: #3d444d !important; }
      .auto-dark-text { color: #f6f7f8 !important; }
      .auto-dark-muted { color: #c5c9cf !important; }
    }
  </style>
</head>
<body class="auto-dark-bg" style="margin:0; padding:0; background-color:#f6f7f8;">
  <!-- Preheader (texto preview en inbox) -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#f6f7f8;">
    ${safePreheader}
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f6f7f8;" class="auto-dark-bg">
    <tr>
      <td align="center" style="padding: 32px 16px;">

        <!-- Container card -->
        <table role="presentation" class="container auto-dark-card" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:14px; overflow:hidden; box-shadow: 0 4px 16px rgba(47,53,59,0.08);">

          <!-- Header con logo/marca -->
          <tr>
            <td align="center" style="background-color:#008080; padding: 28px 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center">
                    <span style="display:inline-block; background-color:#FFBF00; color:#2F353B; font-weight:800; font-size:20px; padding:8px 16px; border-radius:8px; letter-spacing:0.5px;">
                      ${escapeHtml(appName)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Cuerpo del email -->
          <tr>
            <td class="px-mobile py-mobile auto-dark-text" style="padding: 40px 48px; color:#2D2D2D;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer institucional -->
          <tr>
            <td class="px-mobile auto-dark-card" style="padding: 24px 48px; background-color:#f6f7f8; border-top:1px solid #e2e4e7;">
              <p class="text-mobile auto-dark-muted" style="margin:0 0 8px; color:#5e6772; font-size:13px; line-height:1.6; text-align:center;">
                ${escapeHtml(c.automatedMessage)}
              </p>
              ${
                showPreferences && preferencesUrl
                  ? `<p class="text-mobile auto-dark-muted" style="margin:0 0 8px; color:#5e6772; font-size:13px; line-height:1.6; text-align:center;">
                       ${escapeHtml(c.preferencesText)} <a href="${escapeHtml(preferencesUrl)}" style="color:#008080; text-decoration:underline;">${escapeHtml(c.preferencesLink)}</a>
                     </p>`
                  : ''
              }
              <p class="auto-dark-muted" style="margin:8px 0 0; color:#7d8694; font-size:12px; text-align:center;">
                © ${year} ${escapeHtml(appName)}. ${escapeHtml(c.rights)}
                ${frontendUrl ? `&nbsp;·&nbsp;<a href="${escapeHtml(frontendUrl)}" style="color:#008080; text-decoration:none;">${escapeHtml(c.visit)} ${escapeHtml(appName)}</a>` : ''}
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Construye un botón CTA (compatible bulletproof-buttons / VML para Outlook).
 */
export const renderButton = ({ url, label, variant = 'primary' } = {}) => {
  const safeUrl = escapeHtml(url || '#');
  const safeLabel = escapeHtml(label || '');
  const isAccent = variant === 'accent';
  const bg = isAccent ? '#FFBF00' : '#008080';
  const color = isAccent ? '#2F353B' : '#ffffff';

  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 8px auto 4px;">
    <tr>
      <td align="center" bgcolor="${bg}" style="border-radius: 10px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="20%" stroke="f" fillcolor="${bg}">
          <w:anchorlock/>
          <center style="color:${color};font-family:'Montserrat',Arial,sans-serif;font-size:16px;font-weight:600;">${safeLabel}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${safeUrl}" target="_blank" rel="noopener"
           class="btn-primary btn-mobile"
           style="display:inline-block; background-color:${bg}; color:${color}; text-decoration:none; padding:14px 36px; border-radius:10px; font-size:16px; font-weight:600; letter-spacing:0.3px;">
          ${safeLabel}
        </a>
        <!--<![endif]-->
      </td>
    </tr>
  </table>`;
};

/**
 * Bloque de fallback "copia y pega el enlace".
 */
export const renderLinkFallback = ({ url, locale = 'es' } = {}) => {
  const c = getDict(locale).common;
  const safe = escapeHtml(url || '');
  return `
  <p class="text-mobile auto-dark-muted" style="margin: 24px 0 0; color:#5e6772; font-size:13px; line-height:1.6; text-align:center;">
    ${escapeHtml(c.buttonFallback)}<br>
    <a href="${safe}" style="color:#008080; word-break:break-all; text-decoration:underline;">${safe}</a>
  </p>`;
};

export { escapeHtml };
export default { renderLayout, renderButton, renderLinkFallback, escapeHtml };
