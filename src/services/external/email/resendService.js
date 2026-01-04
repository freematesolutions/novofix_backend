/**
 * @deprecated Este archivo mantiene compatibilidad hacia atrás.
 * Usa directamente emailService.js para nuevas implementaciones.
 */
import emailService from './emailService.js';

// Re-exportar emailService como resendService para compatibilidad
const resendService = emailService;
export default resendService;
