import dotenv from 'dotenv';

// Cargar el archivo .env.development
const result = dotenv.config({ path: './.env.development' });

if (result.error) {
  console.error('Error cargando el archivo .env.development:', result.error);
} else {
  console.log('Archivo .env.development cargado correctamente.');
  console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY || 'NO DEFINIDA');
  console.log('RESEND_FROM_EMAIL:', process.env.RESEND_FROM_EMAIL || 'NO DEFINIDA');
}