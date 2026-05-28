// NOTA: Las variables de entorno se cargan en server.js
// No duplicar la carga aquí para evitar inconsistencias

import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import {
  verifyEmailTemplate,
  passwordResetTemplate,
  passwordResetConfirmedTemplate,
  welcomeTemplate,
  notificationTemplate,
  genericTemplate,
} from './templates/index.js';
import { normalizeLocale } from './templates/i18n.js';

/**
 * Servicio de Email Unificado
 * Soporta múltiples proveedores: Resend, SendGrid, Gmail SMTP, Console
 * 
 * Modos disponibles (EMAIL_MODE):
 * - 'resend': Usa Resend API (requiere dominio verificado) ⭐ RECOMENDADO PARA PRODUCCIÓN
 * - 'sendgrid': Usa SendGrid API (plan gratuito 100 emails/día)
 * - 'smtp': Usa Gmail/SMTP (⚠️ bloqueado en Render/Heroku/Railway)
 * - 'console': Solo imprime en consola (desarrollo)
 * - 'hybrid': Intenta Resend→SendGrid→SMTP, fallback a consola
 */
class EmailService {
  constructor() {
    this.isDevelopment = process.env.NODE_ENV !== 'production';
    this.emailMode = (process.env.EMAIL_MODE || (this.isDevelopment ? 'console' : 'smtp')).toLowerCase().trim();
    
    // Configurar proveedores según el modo
    this.initializeProviders();
    
    console.log(`[📧 EMAIL SERVICE] Modo: ${this.emailMode.toUpperCase()} ${this.isDevelopment ? '(desarrollo)' : '(producción)'}`);
  }

  initializeProviders() {
    // Configurar Resend si está disponible (prioridad 1 para producción)
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }

    // Configurar SendGrid si está disponible (prioridad 2)
    if (process.env.SENDGRID_API_KEY) {
      this.sendgridApiKey = process.env.SENDGRID_API_KEY;
    }

    // Configurar Nodemailer/SMTP si está disponible (prioridad 3, puede estar bloqueado)
    if (process.env.SMTP_HOST || process.env.GMAIL_USER) {
      this.smtpTransporter = this.createSmtpTransporter();
    }

    // Configurar email por defecto
    // NOTA: el dominio canónico autenticado en SendGrid es novofixpro.com.
    // Si EMAIL_FROM/SENDGRID_FROM_EMAIL no están definidos, se usa noreply@novofixpro.com
    // para alinear con DKIM y evitar fallos DMARC en Gmail/Outlook.
    this.defaultFrom = process.env.EMAIL_FROM || 
                       process.env.RESEND_FROM_EMAIL ||
                       process.env.SENDGRID_FROM_EMAIL ||
                       process.env.GMAIL_USER || 
                       'noreply@novofixpro.com';

    // Reply-To: buzón atendido al que responden los usuarios (si no se define,
    // se omite la cabecera y los clientes responderán al FROM por defecto).
    this.replyTo = process.env.EMAIL_REPLY_TO || null;

    // URL pública del frontend (para enlace de baja en List-Unsubscribe)
    this.frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

    this.appName = process.env.APP_NAME || 'NovoFix';
  }

  /**
   * Convierte el HTML del email en una versión texto plano legible.
   * Importante para deliverability: Gmail/Outlook penalizan mensajes
   * que solo viajan en HTML sin alternativa de texto.
   */
  htmlToPlainText(html = '') {
    if (!html) return '';
    return String(html)
      // Reemplazar saltos lógicos por \n antes de stripear tags
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
      // Preservar el texto del enlace seguido de la URL entre paréntesis
      .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
        const clean = text.replace(/<[^>]+>/g, '').trim();
        return clean && clean !== href ? `${clean} (${href})` : href;
      })
      // Eliminar el resto de etiquetas HTML
      .replace(/<[^>]+>/g, '')
      // Decodificar entidades comunes
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Colapsar espacios y líneas en blanco excesivas
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Determina si una plantilla es de tipo "notificación" (marketing-like)
   * y por tanto debe llevar cabecera List-Unsubscribe.
   * Los emails transaccionales críticos (verify_email, password_reset)
   * NO deben llevar unsubscribe porque son requeridos para usar el servicio.
   */
  isUnsubscribable(template) {
    return ['notification', 'new_request', 'proposal_accepted', 'welcome'].includes(template);
  }

  /**
   * Construye cabeceras List-Unsubscribe (RFC 2369 + RFC 8058).
   * Requeridas por Gmail/Yahoo desde 2024 para senders con buen volumen.
   */
  buildUnsubscribeHeaders(to) {
    if (!this.frontendUrl) return null;
    const encoded = encodeURIComponent(to || '');
    const url = `${this.frontendUrl}/unsubscribe?email=${encoded}`;
    return {
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };
  }

  /**
   * Crea el transporter de Nodemailer
   * Soporta Gmail y SMTP genérico
   */
  createSmtpTransporter() {
    // Si tiene credenciales de Gmail, usar configuración de Gmail
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      console.log('[📧 SMTP] Configurando Gmail SMTP...');
      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD
        }
      });
    }

    // SMTP genérico
    if (process.env.SMTP_HOST) {
      console.log('[📧 SMTP] Configurando SMTP genérico...');
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }

    return null;
  }

  /**
   * Envía email usando el modo configurado.
   *
   * @param {Object} params
   * @param {string} params.to        - Destinatario.
   * @param {string} [params.subject] - Asunto (si se omite, lo determina la plantilla a partir del locale).
   * @param {string} params.template  - Nombre de la plantilla.
   * @param {Object} [params.data]    - Datos para la plantilla. Puede incluir `locale` ('es' | 'en').
   * @param {string} [params.locale]  - Locale alternativo (si no viene en data).
   */
  async sendEmail({ to, subject, template, data, locale }) {
    // Log detallado para diagnóstico en producción
    console.log('[📧 EMAIL] sendEmail llamado:', { 
      to, 
      subject, 
      template, 
      mode: this.emailMode,
      smtpConfigured: !!this.smtpTransporter,
      resendConfigured: !!this.resend,
      sendgridConfigured: !!this.sendgridApiKey
    });

    try {
      if (!to || !template) {
        throw new Error('Missing required email parameters: to, template');
      }

      const effectiveLocale = normalizeLocale(data?.locale || locale);

      // Renderizar plantilla — ahora devuelve { subject, html }
      const rendered = this.renderTemplate(template, { ...(data || {}), locale: effectiveLocale });
      const html = rendered.html;
      const finalSubject = subject || rendered.subject;

      console.log(`[📧 EMAIL] Enviando con modo: ${this.emailMode} · locale: ${effectiveLocale}`);

      // Seleccionar proveedor según el modo
      let result;
      switch (this.emailMode) {
        case 'console':
          result = await this.sendViaConsole({ to, subject: finalSubject, template, data });
          break;
        
        case 'resend':
          result = await this.sendViaResend({ to, subject: finalSubject, html });
          break;
        
        case 'sendgrid':
          result = await this.sendViaSendGrid({ to, subject: finalSubject, html, template });
          break;
        
        case 'smtp':
          result = await this.sendViaSmtp({ to, subject: finalSubject, html });
          break;
        
        case 'hybrid':
          result = await this.sendViaHybrid({ to, subject: finalSubject, template, data, html });
          break;
        
        default:
          // Auto-detectar mejor opción (priorizar APIs sobre SMTP)
          console.log('[📧 EMAIL] Modo auto-detectar. Resend:', !!this.resend, 'SendGrid:', !!this.sendgridApiKey, 'SMTP:', !!this.smtpTransporter);
          if (this.sendgridApiKey) {
            result = await this.sendViaSendGrid({ to, subject: finalSubject, html, template });
          } else if (this.resend) {
            result = await this.sendViaResend({ to, subject: finalSubject, html });
          } else if (this.smtpTransporter) {
            result = await this.sendViaSmtp({ to, subject: finalSubject, html });
          } else {
            result = await this.sendViaConsole({ to, subject: finalSubject, template, data });
          }
      }
      
      console.log('[📧 EMAIL] Resultado:', result);
      return result;
    } catch (error) {
      console.error('[📧 EMAIL ERROR]', error.message);
      console.error('[📧 EMAIL ERROR STACK]', error.stack);
      
      // En desarrollo o modo híbrido, no fallar, solo advertir
      if (this.isDevelopment || this.emailMode === 'hybrid') {
        console.warn('📧 [FALLBACK] Email no enviado, la aplicación continúa.');
        return { success: false, fallback: true, error: error.message };
      }
      
      throw error;
    }
  }

  /**
   * Renderiza una plantilla y devuelve { subject, html }.
   * Mantiene compatibilidad: el caller puede sobreescribir subject.
   */
  renderTemplate(templateName, data = {}) {
    const ctx = {
      appName: this.appName,
      frontendUrl: process.env.FRONTEND_URL || '',
      locale: data.locale,
    };

    switch (templateName) {
      case 'verify_email':
        return verifyEmailTemplate(data, ctx);
      case 'password_reset':
        return passwordResetTemplate(data, ctx);
      case 'password_reset_confirmed':
        return passwordResetConfirmedTemplate(data, ctx);
      case 'welcome':
        return welcomeTemplate(data, ctx);
      case 'notification':
      case 'new_request':
      case 'proposal_accepted':
        return notificationTemplate(data, ctx);
      default:
        console.warn(`[📧] Plantilla '${templateName}' no encontrada, usando genérica`);
        return genericTemplate({ ...data, templateName }, ctx);
    }
  }

  /**
   * @deprecated Mantener para compatibilidad. Usar `renderTemplate` (devuelve subject+html).
   */
  getTemplateHtml(templateName, data = {}) {
    return this.renderTemplate(templateName, data).html;
  }

  /**
   * Envío via Gmail/SMTP (Nodemailer)
   * ✅ Funciona en producción sin dominio verificado
   */
  async sendViaSmtp({ to, subject, html }) {
    if (!this.smtpTransporter) {
      throw new Error('SMTP no configurado. Define GMAIL_USER y GMAIL_APP_PASSWORD en .env');
    }

    const mailOptions = {
      from: `"${this.appName}" <${this.defaultFrom}>`,
      to,
      subject,
      html
    };

    const info = await this.smtpTransporter.sendMail(mailOptions);
    
    console.log(`[📧 SMTP] Email enviado a ${to} - ID: ${info.messageId}`);
    
    return { 
      success: true, 
      messageId: info.messageId, 
      via: 'smtp',
      accepted: info.accepted 
    };
  }

  /**
   * Envío via Resend API
   * ⚠️ Requiere dominio verificado para cualquier destinatario
   */
  async sendViaResend({ to, subject, html }) {
    if (!this.resend) {
      throw new Error('Resend no configurado. Define RESEND_API_KEY en .env');
    }

    const response = await this.resend.emails.send({
      from: this.defaultFrom,
      to,
      subject,
      html
    });

    if (response.error) {
      throw new Error(response.error.message || 'Resend API error');
    }

    console.log(`[📧 RESEND] Email enviado a ${to} - ID: ${response.data?.id}`);
    
    return { 
      success: true, 
      messageId: response.data?.id, 
      via: 'resend' 
    };
  }

  /**
   * Envío via SendGrid API
   * ✅ Plan gratuito 100 emails/día, funciona en Render
   */
  async sendViaSendGrid({ to, subject, html, template }) {
    if (!this.sendgridApiKey) {
      throw new Error('SendGrid no configurado. Define SENDGRID_API_KEY en .env');
    }

    const sgMail = (await import('@sendgrid/mail')).default;
    sgMail.setApiKey(this.sendgridApiKey);

    // SendGrid requiere que el `from` esté verificado en Sender Authentication.
    // Priorizamos SENDGRID_FROM_EMAIL sobre EMAIL_FROM (este último puede ser un alias
    // genérico no verificado en SendGrid).
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || this.defaultFrom;
    const fromName = process.env.SENDGRID_FROM_NAME || this.appName;

    // ─── Mejoras antispam (deliverability) ───
    // 1) Versión texto plano: Gmail/Outlook penalizan mensajes solo-HTML.
    const text = this.htmlToPlainText(html);

    // 2) Reply-To opcional (buzón atendido). Si no está definido, se omite.
    const replyTo = this.replyTo || process.env.SENDGRID_REPLY_TO || null;

    // 3) List-Unsubscribe solo en emails no-transaccionales (notificaciones).
    //    Verificación de cuenta y reset de password NO llevan unsubscribe.
    const unsubHeaders = this.isUnsubscribable(template)
      ? this.buildUnsubscribeHeaders(to)
      : null;

    // 4) Tracking: SendGrid reescribe los enlaces para track clicks → los
    //    filtros antispam suelen marcar esos dominios como sospechosos.
    //    Se desactiva el click-tracking en emails transaccionales. Open-tracking
    //    se mantiene (no afecta a la entregabilidad pero da analítica básica).
    const trackingSettings = {
      clickTracking: { enable: false, enableText: false },
      openTracking: { enable: true },
      subscriptionTracking: { enable: false }
    };

    const msg = {
      to,
      from: { email: fromEmail, name: fromName },
      subject,
      text,
      html,
      trackingSettings,
      mailSettings: {
        // Bypass de listas de supresión solo para emails críticos
        // (verificación / reset). En notificaciones se respeta la lista.
        bypassListManagement: { enable: !this.isUnsubscribable(template) }
      }
    };

    if (replyTo) {
      msg.replyTo = replyTo;
    }
    if (unsubHeaders) {
      msg.headers = { ...(msg.headers || {}), ...unsubHeaders };
      // ASM/grupos de unsubscribe en SendGrid se podrían añadir aquí si se
      // configuran en el dashboard (asm: { groupId, groupsToDisplay }).
    }

    try {
      const [response] = await sgMail.send(msg);
      console.log(`[📧 SENDGRID] Email enviado a ${to} desde ${fromEmail} - Status: ${response.statusCode}`);
      return {
        success: true,
        messageId: response.headers['x-message-id'],
        via: 'sendgrid',
        statusCode: response.statusCode
      };
    } catch (err) {
      // SendGrid devuelve detalle del fallo en err.response.body
      const detail = err?.response?.body || err?.response?.data;
      if (detail) {
        console.error('[📧 SENDGRID ERROR DETAIL]', JSON.stringify(detail, null, 2));
      }
      console.error(`[📧 SENDGRID] Intentando enviar desde: ${fromEmail} hacia: ${to}`);
      throw err;
    }
  }

  /**
   * Modo consola: Imprime email en terminal (desarrollo)
   */
  sendViaConsole({ to, subject, template, data }) {
    const separator = '═'.repeat(60);
    console.log(`\n${separator}`);
    console.log('📧 [EMAIL SIMULADO - MODO DESARROLLO]');
    console.log(separator);
    console.log(`📬 Para: ${to}`);
    console.log(`📋 Asunto: ${subject}`);
    console.log(`📝 Plantilla: ${template}`);
    
    if (template === 'verify_email' && data?.verifyUrl) {
      console.log('\n🔗 URL DE VERIFICACIÓN:');
      console.log(`   ${data.verifyUrl}`);
      console.log('\n💡 Copia este enlace en tu navegador para verificar el email.');
    }
    
    if (template === 'password_reset' && data?.resetUrl) {
      console.log('\n🔗 URL DE RESET:');
      console.log(`   ${data.resetUrl}`);
    }
    
    console.log(`${separator}\n`);
    
    return { 
      success: true, 
      messageId: `console-${Date.now()}`, 
      via: 'console' 
    };
  }

  /**
   * Modo híbrido: Intenta Resend → SendGrid → SMTP → Console
   * Prioriza APIs sobre SMTP (que suele estar bloqueado en PaaS)
   */
  async sendViaHybrid({ to, subject, template, data, html }) {
    // 1. Intentar Resend primero (mejor opción si dominio verificado)
    if (this.resend) {
      try {
        return await this.sendViaResend({ to, subject, html });
      } catch (error) {
        console.warn(`⚠️ Resend falló: ${error.message}`);
      }
    }

    // 2. Intentar SendGrid
    if (this.sendgridApiKey) {
      try {
        return await this.sendViaSendGrid({ to, subject, html, template });
      } catch (error) {
        console.warn(`⚠️ SendGrid falló: ${error.message}`);
      }
    }

    // 3. Intentar SMTP (probablemente bloqueado en producción)
    if (this.smtpTransporter) {
      try {
        return await this.sendViaSmtp({ to, subject, html });
      } catch (error) {
        console.warn(`⚠️ SMTP falló: ${error.message}`);
      }
    }

    // 4. Fallback a consola
    console.warn('⚠️ Todos los proveedores fallaron, usando consola...');
    return this.sendViaConsole({ to, subject, template, data });
  }

  /**
   * Verifica el estado del servicio de email
   */
  async getServiceStatus() {
    const status = {
      mode: this.emailMode,
      isDevelopment: this.isDevelopment,
      smtp: {
        configured: !!this.smtpTransporter,
        user: process.env.GMAIL_USER || process.env.SMTP_USER || null,
        warning: this.smtpTransporter ? '⚠️ SMTP bloqueado en Render/Heroku' : null
      },
      resend: {
        configured: !!this.resend,
        recommended: true
      },
      sendgrid: {
        configured: !!this.sendgridApiKey,
        freeTier: '100 emails/día'
      },
      defaultFrom: this.defaultFrom,
      providers: {
        smtp: !!this.smtpTransporter,
        resend: !!this.resend,
        sendgrid: !!this.sendgridApiKey,
        console: true
      },
      ready: !!(this.resend || this.sendgridApiKey || this.smtpTransporter)
    };

    // Verificar SMTP si está configurado (probablemente fallará en producción)
    if (this.smtpTransporter) {
      try {
        await this.smtpTransporter.verify();
        status.smtpVerified = true;
        status.smtp.warning = null;
      } catch (error) {
        status.smtpVerified = false;
        status.smtpError = error.message;
      }
    }

    return status;
  }

  // Alias para compatibilidad
  async healthCheck() {
    return this.getServiceStatus();
  }

  /**
   * Re-inicializa los proveedores (útil si las variables de entorno cambian)
   * Llamar esto después de que dotenv haya cargado las variables
   */
  reinitialize() {
    console.log('[📧 EMAIL SERVICE] Re-inicializando proveedores...');
    this.emailMode = process.env.EMAIL_MODE || (this.isDevelopment ? 'console' : 'smtp');
    this.initializeProviders();
    console.log(`[📧 EMAIL SERVICE] Modo actualizado: ${this.emailMode.toUpperCase()}`);
    console.log(`[📧 EMAIL SERVICE] SMTP Transporter: ${this.smtpTransporter ? '✅ Configurado' : '❌ No disponible'}`);
    console.log(`[📧 EMAIL SERVICE] Resend: ${this.resend ? '✅ Configurado' : '❌ No disponible'}`);
  }
}

// Singleton con inicialización lazy
let emailServiceInstance = null;

function getEmailService() {
  if (!emailServiceInstance) {
    emailServiceInstance = new EmailService();
  }
  return emailServiceInstance;
}

// Para compatibilidad hacia atrás, exportar una instancia
// Pero también exportar la función para obtener instancia actualizada
const emailService = getEmailService();
export default emailService;
export { getEmailService };
