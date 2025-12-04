// src/services/external/messaging/whatsappService.js
class WhatsAppService {
  async sendTemplateMessage({ to, template, parameters }) {
    try {
      // Simulación: solo registra el mensaje en la consola
      console.log('WhatsApp message would be sent:', {
        to,
        template,
        parameters,
        message: this.buildTemplateMessage(template, parameters)
      });
      
      return {
        success: true,
        messageId: 'simulated-message-id'
      };
    } catch (error) {
      console.error('WhatsAppService - sendTemplateMessage error:', error);
      throw error;
    }
  }

  buildTemplateMessage(template, parameters) {
    const templates = {
      new_service_request: this.buildNewRequestTemplate(parameters),
      proposal_accepted: this.buildProposalAcceptedTemplate(parameters),
      service_completed: this.buildServiceCompletedTemplate(parameters)
    };

    return templates[template] || '';
  }

  // Templates específicos
  buildNewRequestTemplate(parameters) {
    return `¡Nuevo servicio disponible!
Tipo: ${parameters.service_type}
Ubicación: ${parameters.location}
Para más detalles, ingresa a tu panel de servicios.`;
  }

  buildProposalAcceptedTemplate(parameters) {
    return `¡Felicitaciones! Tu propuesta ha sido aceptada
Servicio: ${parameters.service_type}
Cliente: ${parameters.client_name}
Por favor, ingresa a tu panel para coordinar los detalles.`;
  }

  buildServiceCompletedTemplate(parameters) {
    return `Servicio completado exitosamente
Gracias por usar nuestra plataforma
Servicio: ${parameters.service_type}
Cliente: ${parameters.client_name}`;
  }
}

const whatsAppService = new WhatsAppService();
export default whatsAppService;