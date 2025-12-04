class ResendService {
  constructor() {
    // Al no tener la API key, solo registramos en consola
    this.defaultFrom = process.env.RESEND_FROM_EMAIL || 'noreply@yourapp.com';
  }

  async sendEmail({ to, subject, template, data }) {
    try {
      // Validar parámetros requeridos
      if (!to || !subject || !template) {
        throw new Error('Missing required email parameters');
      }

      // Aquí podrías tener un sistema de plantillas más robusto
      const html = await this.getTemplateHtml(template, data);

      // En lugar de enviar el email, solo lo registramos en consola
      console.log('Email would be sent:', {
        from: this.defaultFrom,
        to,
        subject,
        html
      });

      return {
        success: true,
        messageId: 'simulated-email-id'
      };
    } catch (error) {
      console.error('ResendService - sendEmail error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async getTemplateHtml(templateName, data) {
    // Aquí implementarías la lógica para cargar y renderizar plantillas
    // Por ejemplo, usando handlebars, ejs u otro motor de plantillas
    const templates = {
      new_request: this.getNewRequestTemplate(data),
      proposal_accepted: this.getProposalAcceptedTemplate(data),
      password_reset: this.getPasswordResetTemplate(data),
      password_reset_confirmed: this.getPasswordResetConfirmedTemplate(data),
      // ... más plantillas
    };

    const template = templates[templateName];
    if (!template) {
      throw new Error(`Email template '${templateName}' not found`);
    }

    return template;
  }

  getNewRequestTemplate(data) {
    return `
      <html>
        <body>
          <h1>Nueva Solicitud de Servicio</h1>
          <p>Hola ${data.providerName},</p>
          <p>Hay una nueva solicitud de servicio que podría interesarte:</p>
          <ul>
            <li>Servicio: ${data.serviceRequest.title}</li>
            <li>Categoría: ${data.serviceRequest.category}</li>
            <li>Ubicación: ${data.serviceRequest.location}</li>
          </ul>
          <p>
            <a href="${data.actionUrl}">Ver detalles de la solicitud</a>
          </p>
        </body>
      </html>
    `;
  }

  getProposalAcceptedTemplate(data) {
    return `
      <html>
        <body>
          <h1>¡Tu propuesta ha sido aceptada!</h1>
          <p>Hola ${data.providerName},</p>
          <p>El cliente ha aceptado tu propuesta para el servicio:</p>
          <ul>
            <li>Servicio: ${data.serviceRequest.title}</li>
            <li>Categoría: ${data.serviceRequest.category}</li>
          </ul>
          <p>
            <a href="${data.actionUrl}">Ver detalles de la reserva</a>
          </p>
        </body>
      </html>
    `;
  }

  getPasswordResetTemplate(data) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif;">
          <h2>Restablecer contraseña</h2>
          <p>Hola ${data.name || 'usuario'},</p>
          <p>Hemos recibido una solicitud para restablecer tu contraseña. Si fuiste tú, haz clic en el siguiente botón:</p>
          <p style="margin: 24px 0;">
            <a href="${data.resetUrl}"
               style="background: #2563eb; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 6px;">
              Restablecer contraseña
            </a>
          </p>
          <p>Si no solicitaste este cambio, puedes ignorar este mensaje. Este enlace expirará en ${data.expiresIn || '60 minutos'}.</p>
        </body>
      </html>
    `;
  }

  getPasswordResetConfirmedTemplate(data) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif;">
          <h2>Contraseña actualizada</h2>
          <p>Hola ${data.name || 'usuario'},</p>
          <p>Tu contraseña se actualizó correctamente. Si no fuiste tú, por favor cambia tu contraseña nuevamente y comunícate con soporte.</p>
          <p>
            <a href="${data.loginUrl || '/login'}">Ir a iniciar sesión</a>
          </p>
        </body>
      </html>
    `;
  }
}

const resendService = new ResendService();
export default resendService;