// NOTA: Las variables de entorno se cargan en server.js
// No duplicar la carga aquí para evitar inconsistencias

import { Resend } from 'resend';
import nodemailer from 'nodemailer';

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
    this.emailMode = process.env.EMAIL_MODE || (this.isDevelopment ? 'console' : 'smtp');
    
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
    this.defaultFrom = process.env.EMAIL_FROM || 
                       process.env.RESEND_FROM_EMAIL ||
                       process.env.SENDGRID_FROM_EMAIL ||
                       process.env.GMAIL_USER || 
                       'noreply@novofix.com';
    
    this.appName = process.env.APP_NAME || 'NovoFix';
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
   * Envía email usando el modo configurado
   */
  async sendEmail({ to, subject, template, data }) {
    // Log detallado para diagnóstico en producción
    console.log('[📧 EMAIL] sendEmail llamado:', { 
      to, 
      subject, 
      template, 
      mode: this.emailMode,
      smtpConfigured: !!this.smtpTransporter,
      resendConfigured: !!this.resend
    });

    try {
      if (!to || !subject || !template) {
        throw new Error('Missing required email parameters: to, subject, template');
      }

      // Preparar datos seguros según la plantilla
      const safeData = this.sanitizeTemplateData(template, data);
      const html = this.getTemplateHtml(template, safeData);

      console.log(`[📧 EMAIL] Enviando con modo: ${this.emailMode}`);

      // Seleccionar proveedor según el modo
      let result;
      switch (this.emailMode) {
        case 'console':
          result = await this.sendViaConsole({ to, subject, template, data: safeData });
          break;
        
        case 'resend':
          result = await this.sendViaResend({ to, subject, html });
          break;
        
        case 'sendgrid':
          result = await this.sendViaSendGrid({ to, subject, html });
          break;
        
        case 'smtp':
          result = await this.sendViaSmtp({ to, subject, html });
          break;
        
        case 'hybrid':
          result = await this.sendViaHybrid({ to, subject, template, data: safeData, html });
          break;
        
        default:
          // Auto-detectar mejor opción (priorizar APIs sobre SMTP)
          console.log('[📧 EMAIL] Modo auto-detectar. Resend:', !!this.resend, 'SendGrid:', !!this.sendgridApiKey, 'SMTP:', !!this.smtpTransporter);
          if (this.resend) {
            result = await this.sendViaResend({ to, subject, html });
          } else if (this.sendgridApiKey) {
            result = await this.sendViaSendGrid({ to, subject, html });
          } else if (this.smtpTransporter) {
            result = await this.sendViaSmtp({ to, subject, html });
          } else {
            result = await this.sendViaConsole({ to, subject, template, data: safeData });
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
   * Sanitiza datos de plantilla para seguridad
   */
  sanitizeTemplateData(template, data) {
    if (template === 'verify_email') {
      return {
        name: data?.name || 'usuario',
        verifyUrl: data?.verifyUrl || ''
      };
    }
    return data || {};
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
  async sendViaSendGrid({ to, subject, html }) {
    if (!this.sendgridApiKey) {
      throw new Error('SendGrid no configurado. Define SENDGRID_API_KEY en .env');
    }

    const sgMail = (await import('@sendgrid/mail')).default;
    sgMail.setApiKey(this.sendgridApiKey);

    const msg = {
      to,
      from: this.defaultFrom,
      subject,
      html
    };

    const [response] = await sgMail.send(msg);
    
    console.log(`[📧 SENDGRID] Email enviado a ${to} - Status: ${response.statusCode}`);
    
    return { 
      success: true, 
      messageId: response.headers['x-message-id'], 
      via: 'sendgrid',
      statusCode: response.statusCode
    };
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
        return await this.sendViaSendGrid({ to, subject, html });
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
   * Obtiene el HTML de una plantilla
   */
  getTemplateHtml(templateName, data) {
    const templates = {
      verify_email: this.getVerifyEmailTemplate(data),
      password_reset: this.getPasswordResetTemplate(data),
      password_reset_confirmed: this.getPasswordResetConfirmedTemplate(data),
      new_request: this.getNewRequestTemplate(data),
      proposal_accepted: this.getProposalAcceptedTemplate(data),
      welcome: this.getWelcomeTemplate(data)
    };

    const template = templates[templateName];
    if (!template) {
      console.warn(`[📧] Plantilla '${templateName}' no encontrada, usando genérica`);
      return this.getGenericTemplate({ ...data, templateName });
    }

    return template;
  }

  // ==================== PLANTILLAS ====================

  getVerifyEmailTemplate(data) {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background: #ffffff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.15); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">📧 Verifica tu Email</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">${this.appName}</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333; font-size: 18px; margin: 0 0 20px;">Hola <strong>${data.name}</strong>,</p>
              <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
                ¡Gracias por registrarte! Solo falta un paso para activar tu cuenta y empezar a disfrutar de todos nuestros servicios.
              </p>
              <!-- Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${data.verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                      ✓ Verificar mi correo
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color: #999; font-size: 14px; line-height: 1.6; margin: 30px 0 0;">
                Si no creaste esta cuenta, puedes ignorar este mensaje.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background: #f8f9fa; padding: 25px 30px; border-top: 1px solid #eee;">
              <p style="color: #888; font-size: 13px; margin: 0; text-align: center;">
                ¿Problemas con el botón? Copia este enlace:<br>
                <a href="${data.verifyUrl}" style="color: #667eea; word-break: break-all;">${data.verifyUrl}</a>
              </p>
            </td>
          </tr>
        </table>
        <!-- Sub-footer -->
        <p style="color: rgba(255,255,255,0.7); font-size: 12px; margin-top: 30px;">
          © ${new Date().getFullYear()} ${this.appName}. Todos los derechos reservados.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  getPasswordResetTemplate(data) {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding: 40px 30px; text-align: center;">
              <div style="width: 60px; height: 60px; background: #fff3cd; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 30px;">🔐</span>
              </div>
              <h2 style="color: #333; margin: 0 0 20px;">Restablecer Contraseña</h2>
              <p style="color: #666; font-size: 16px; line-height: 1.6;">
                Hola ${data.name || 'usuario'},<br>
                Recibimos una solicitud para restablecer tu contraseña.
              </p>
              <a href="${data.resetUrl}" style="display: inline-block; background: #ffc107; color: #333; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-weight: 600; margin: 25px 0;">
                Cambiar Contraseña
              </a>
              <p style="color: #999; font-size: 14px;">
                Este enlace expira en ${data.expiresIn || '60 minutos'}.<br>
                Si no solicitaste esto, ignora este mensaje.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  getPasswordResetConfirmedTemplate(data) {
    return `
<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 40px;">
  <div style="max-width: 480px; margin: auto; background: #fff; border-radius: 12px; padding: 40px; text-align: center;">
    <div style="font-size: 50px; margin-bottom: 20px;">✅</div>
    <h2 style="color: #28a745;">¡Contraseña Actualizada!</h2>
    <p style="color: #666;">Hola ${data.name || 'usuario'},</p>
    <p style="color: #666;">Tu contraseña se actualizó correctamente.</p>
    <a href="${data.loginUrl || '/login'}" style="display: inline-block; background: #28a745; color: #fff; padding: 12px 30px; border-radius: 8px; text-decoration: none; margin-top: 20px;">
      Iniciar Sesión
    </a>
  </div>
</body>
</html>`;
  }

  getNewRequestTemplate(data) {
    const sr = data?.serviceRequest || {};
    return `
<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 40px;">
  <div style="max-width: 500px; margin: auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
    <div style="background: #17a2b8; color: #fff; padding: 25px; text-align: center;">
      <h2 style="margin: 0;">🔔 Nueva Solicitud</h2>
    </div>
    <div style="padding: 30px;">
      <p>Hola <strong>${data.providerName || 'Proveedor'}</strong>,</p>
      <p>Tienes una nueva solicitud de servicio:</p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>📋 Servicio:</strong> ${sr.title || 'Sin título'}</p>
        <p style="margin: 5px 0;"><strong>🏷️ Categoría:</strong> ${sr.category || 'Sin categoría'}</p>
        <p style="margin: 5px 0;"><strong>📍 Ubicación:</strong> ${sr.location || 'Sin ubicación'}</p>
      </div>
      <a href="${data.actionUrl || '#'}" style="display: block; background: #17a2b8; color: #fff; text-align: center; padding: 14px; border-radius: 8px; text-decoration: none;">
        Ver Solicitud
      </a>
    </div>
  </div>
</body>
</html>`;
  }

  getProposalAcceptedTemplate(data) {
    const sr = data?.serviceRequest || {};
    return `
<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 40px;">
  <div style="max-width: 500px; margin: auto; background: #fff; border-radius: 12px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #28a745, #20c997); color: #fff; padding: 30px; text-align: center;">
      <div style="font-size: 50px; margin-bottom: 10px;">🎉</div>
      <h2 style="margin: 0;">¡Propuesta Aceptada!</h2>
    </div>
    <div style="padding: 30px;">
      <p>Hola <strong>${data.providerName || 'Proveedor'}</strong>,</p>
      <p>¡Excelentes noticias! El cliente aceptó tu propuesta:</p>
      <div style="background: #d4edda; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>📋</strong> ${sr.title || 'Sin título'}</p>
        <p style="margin: 5px 0;"><strong>🏷️</strong> ${sr.category || 'Sin categoría'}</p>
      </div>
      <a href="${data.actionUrl || '#'}" style="display: block; background: #28a745; color: #fff; text-align: center; padding: 14px; border-radius: 8px; text-decoration: none;">
        Ver Detalles
      </a>
    </div>
  </div>
</body>
</html>`;
  }

  getWelcomeTemplate(data) {
    return `
<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 40px;">
  <div style="max-width: 500px; margin: auto; background: #fff; border-radius: 12px; text-align: center; padding: 40px;">
    <div style="font-size: 60px; margin-bottom: 20px;">👋</div>
    <h2 style="color: #333;">¡Bienvenido a ${this.appName}!</h2>
    <p style="color: #666; font-size: 16px;">
      Hola <strong>${data.name || 'usuario'}</strong>,<br>
      Estamos felices de tenerte con nosotros.
    </p>
    <a href="${data.dashboardUrl || '/'}" style="display: inline-block; background: #667eea; color: #fff; padding: 14px 30px; border-radius: 8px; text-decoration: none; margin-top: 20px;">
      Explorar
    </a>
  </div>
</body>
</html>`;
  }

  getGenericTemplate(data) {
    return `
<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; padding: 40px;">
  <div style="max-width: 500px; margin: auto; background: #fff; border-radius: 8px; padding: 30px; border: 1px solid #ddd;">
    <h2 style="color: #333;">${this.appName}</h2>
    <p style="color: #666;">${data.message || 'Tienes una notificación.'}</p>
    ${data.actionUrl ? `<a href="${data.actionUrl}" style="color: #667eea;">Ver más</a>` : ''}
  </div>
</body>
</html>`;
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
