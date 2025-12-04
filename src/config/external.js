export const emailConfig = {
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL || 'noreply@yourapp.com',
    defaultTemplates: {
      new_request: 'new_request',
      proposal_accepted: 'proposal_accepted',
      booking_confirmed: 'booking_confirmed',
      service_completed: 'service_completed'
    }
  }
};

export const whatsappConfig = {
  apiVersion: '2023-10-24',
  templates: {
    new_service_request: {
      name: 'new_service_request',
      language: 'es'
    },
    proposal_accepted: {
      name: 'proposal_accepted',
      language: 'es'
    },
    booking_reminder: {
      name: 'booking_reminder',
      language: 'es'
    }
  }
};