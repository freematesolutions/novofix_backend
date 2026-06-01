// services/internal/cmsDefaults.js
//
// Contenido por defecto para los documentos CMS (terms / privacy / about /
// hero / contact). Refleja exactamente el texto que vive en
// `client/src/locales/{es,en}/translation.json` bajo `termsPage.*`,
// `privacyPage.*` y `aboutPage.*`.
//
// Sirve a dos consumidores:
//   1) `scripts/seedCmsContent.js` (one-shot inicial en Mongo).
//   2) Endpoint admin `POST /admin/cms/contents/:key/reset-from-defaults`
//      (botón "Reimportar plantilla" en el editor del panel).
//
// Mantener este archivo sincronizado con `translation.json` cuando los textos
// originales cambien EN FRÍO. Una vez que el admin edita desde el panel, el
// CMS gana y este archivo deja de ser leído para esa key.

import { renderMarkdownSafe } from './cmsService.js';

// IDs estables (deben coincidir con las claves en translation.json para que
// el "ID semántico" tenga sentido y permita migraciones futuras).
const TERMS_SECTIONS_ES = [
  { id: 'acceptance', label: 'Aceptación de los Términos', body: 'Al registrarte o utilizar NovoFix, aceptas estos términos de servicio en su totalidad. Si no estás de acuerdo con alguna parte de estos términos, no debes utilizar la plataforma. El uso continuado de NovoFix después de cualquier modificación constituye la aceptación de los nuevos términos.' },
  { id: 'services', label: 'Descripción del Servicio', body: 'NovoFix es una plataforma tecnológica que conecta a clientes con profesionales de servicios del hogar y comercio. NovoFix actúa exclusivamente como intermediario facilitando la conexión entre usuarios, sin ser parte directa de los acuerdos de servicio entre clientes y proveedores.' },
  { id: 'accounts', label: 'Cuentas de Usuario', body: 'Para utilizar ciertas funciones de NovoFix, debes crear una cuenta proporcionando información veraz, completa y actualizada. Eres responsable de mantener la confidencialidad de tu contraseña y de todas las actividades que ocurran bajo tu cuenta. Debes notificarnos inmediatamente sobre cualquier uso no autorizado.' },
  { id: 'providers', label: 'Obligaciones de los Proveedores', body: 'Los proveedores de servicios se comprometen a:\n\n- Proporcionar información precisa sobre sus habilidades y experiencia\n- Mantener sus perfiles actualizados con fotos y descripciones reales\n- Cumplir con los acuerdos de servicio pactados con los clientes\n- Respetar los horarios y presupuestos acordados\n- Mantener los estándares de calidad de la plataforma' },
  { id: 'clients', label: 'Obligaciones de los Clientes', body: 'Los clientes se comprometen a:\n\n- Proporcionar descripciones claras y precisas de los servicios requeridos\n- Tratar a los proveedores con respeto y profesionalismo\n- Realizar los pagos acordados de manera oportuna\n- Proporcionar reseñas honestas y constructivas\n- No solicitar servicios con fines ilegales o inapropiados' },
  { id: 'payments', label: 'Pagos y Facturación', body: 'Los pagos se procesan de forma segura a través de nuestros proveedores de pago autorizados. NovoFix puede cobrar comisiones por sus servicios de intermediación. Los precios de los servicios son acordados directamente entre clientes y proveedores. NovoFix no se responsabiliza por disputas de pago entre usuarios.' },
  { id: 'intellectual', label: 'Propiedad Intelectual', body: 'Todo el contenido de la plataforma NovoFix, incluyendo pero no limitado a logos, diseños, textos, gráficos e interfaces, es propiedad de NovoFix o de sus licenciantes. El contenido subido por los usuarios (fotos, reseñas, descripciones) permanece como propiedad de sus respectivos autores, otorgando a NovoFix una licencia no exclusiva para su uso dentro de la plataforma.' },
  { id: 'liability', label: 'Limitación de Responsabilidad', body: 'NovoFix no garantiza la calidad, seguridad o legalidad de los servicios ofrecidos por los proveedores. La plataforma se proporciona "tal cual" y "según disponibilidad". NovoFix no será responsable por daños indirectos, incidentales o consecuentes que surjan del uso de la plataforma.' },
  { id: 'termination', label: 'Terminación', body: 'NovoFix se reserva el derecho de suspender o cancelar cuentas que violen estos términos, sin previo aviso. Los usuarios pueden eliminar sus cuentas en cualquier momento desde su perfil. La terminación no afecta las obligaciones pendientes entre usuarios.' },
  { id: 'modifications', label: 'Modificaciones', body: 'NovoFix se reserva el derecho de modificar estos términos en cualquier momento. Los cambios significativos serán notificados a los usuarios por correo electrónico o mediante un aviso en la plataforma. El uso continuado después de las modificaciones implica la aceptación de los nuevos términos.' },
  { id: 'contact', label: 'Contacto', body: 'Para preguntas sobre estos términos, puedes contactarnos a través de la plataforma o enviando un correo a soporte@novofixpro.com.' }
];

const TERMS_SECTIONS_EN = [
  { id: 'acceptance', label: 'Acceptance of Terms', body: 'By registering or using NovoFix, you accept these terms of service in their entirety. If you disagree with any part of these terms, you should not use the platform. Continued use of NovoFix after any modifications constitutes acceptance of the new terms.' },
  { id: 'services', label: 'Service Description', body: 'NovoFix is a technology platform that connects clients with home and commercial service professionals. NovoFix acts exclusively as an intermediary facilitating the connection between users, without being a direct party to service agreements between clients and providers.' },
  { id: 'accounts', label: 'User Accounts', body: 'To use certain features of NovoFix, you must create an account providing truthful, complete, and up-to-date information. You are responsible for maintaining the confidentiality of your password and all activities that occur under your account. You must notify us immediately of any unauthorized use.' },
  { id: 'providers', label: 'Provider Obligations', body: 'Service providers commit to:\n\n- Providing accurate information about their skills and experience\n- Keeping their profiles updated with real photos and descriptions\n- Fulfilling service agreements made with clients\n- Respecting agreed schedules and budgets\n- Maintaining the platform\'s quality standards' },
  { id: 'clients', label: 'Client Obligations', body: 'Clients commit to:\n\n- Providing clear and accurate descriptions of required services\n- Treating providers with respect and professionalism\n- Making agreed payments in a timely manner\n- Providing honest and constructive reviews\n- Not requesting services for illegal or inappropriate purposes' },
  { id: 'payments', label: 'Payments and Billing', body: 'Payments are securely processed through our authorized payment providers. NovoFix may charge commissions for its intermediation services. Service prices are agreed directly between clients and providers. NovoFix is not responsible for payment disputes between users.' },
  { id: 'intellectual', label: 'Intellectual Property', body: 'All content on the NovoFix platform, including but not limited to logos, designs, texts, graphics, and interfaces, is the property of NovoFix or its licensors. Content uploaded by users (photos, reviews, descriptions) remains the property of their respective authors, granting NovoFix a non-exclusive license for use within the platform.' },
  { id: 'liability', label: 'Limitation of Liability', body: 'NovoFix does not guarantee the quality, safety, or legality of services offered by providers. The platform is provided "as is" and "as available". NovoFix shall not be liable for indirect, incidental, or consequential damages arising from the use of the platform.' },
  { id: 'termination', label: 'Termination', body: 'NovoFix reserves the right to suspend or cancel accounts that violate these terms, without prior notice. Users may delete their accounts at any time from their profile. Termination does not affect pending obligations between users.' },
  { id: 'modifications', label: 'Modifications', body: 'NovoFix reserves the right to modify these terms at any time. Significant changes will be notified to users by email or through a notice on the platform. Continued use after modifications implies acceptance of the new terms.' },
  { id: 'contact', label: 'Contact', body: 'For questions about these terms, you can contact us through the platform or by sending an email to soporte@novofixpro.com.' }
];

const PRIVACY_SECTIONS_ES = [
  { id: 'collection', label: 'Información que Recopilamos', body: 'Recopilamos la siguiente información:\n\n- Datos de registro: nombre, correo electrónico, teléfono y contraseña\n- Información de perfil: foto, descripción, habilidades y ubicación\n- Datos de uso: interacciones con la plataforma, búsquedas y preferencias\n- Contenido generado: fotos de trabajos, reseñas y mensajes\n- Información técnica: dirección IP, tipo de dispositivo y navegador' },
  { id: 'usage', label: 'Uso de la Información', body: 'Utilizamos tu información para:\n\n- Proporcionar y mejorar nuestros servicios\n- Conectar clientes con proveedores relevantes\n- Procesar pagos y transacciones\n- Enviar notificaciones importantes sobre tu cuenta\n- Personalizar tu experiencia en la plataforma\n- Prevenir fraudes y actividades no autorizadas\n- Cumplir con obligaciones legales' },
  { id: 'sharing', label: 'Compartición de Datos', body: 'No vendemos tu información personal a terceros. Compartimos datos limitados únicamente con:\n\n- Proveedores de servicios de pago para procesar transacciones\n- Servicios de almacenamiento en la nube para guardar archivos\n- Autoridades legales cuando sea requerido por ley\n- Otros usuarios de la plataforma según sea necesario para la prestación de servicios (por ejemplo, nombre y foto de perfil)' },
  { id: 'cookies', label: 'Cookies y Tecnologías Similares', body: 'Utilizamos cookies y tecnologías similares para mantener tu sesión activa, recordar tus preferencias, analizar el uso de la plataforma y mejorar la experiencia del usuario. Puedes configurar tu navegador para rechazar cookies, aunque esto puede afectar la funcionalidad de algunos servicios.' },
  { id: 'security', label: 'Seguridad de los Datos', body: 'Implementamos medidas de seguridad estándar de la industria para proteger tu información, incluyendo cifrado SSL/TLS, almacenamiento seguro de contraseñas con hash, acceso restringido a datos personales y monitoreo continuo de seguridad. Sin embargo, ningún método de transmisión por Internet es 100% seguro.' },
  { id: 'rights', label: 'Tus Derechos', body: 'Tienes derecho a:\n\n- Acceder a tu información personal almacenada\n- Corregir datos inexactos o desactualizados\n- Solicitar la eliminación de tu cuenta y datos\n- Exportar tus datos en un formato portátil\n- Retirar tu consentimiento en cualquier momento\n- Presentar una queja ante la autoridad de protección de datos' },
  { id: 'retention', label: 'Retención de Datos', body: 'Conservamos tu información personal mientras tu cuenta esté activa o sea necesaria para proporcionarte servicios. Si eliminas tu cuenta, eliminaremos o anonimizaremos tu información dentro de un plazo de 30 días, salvo que la ley requiera su conservación por un período más largo.' },
  { id: 'minors', label: 'Menores de Edad', body: 'NovoFix no está dirigido a menores de 18 años. No recopilamos conscientemente información de menores de edad. Si descubrimos que un menor nos ha proporcionado información personal, la eliminaremos de inmediato.' },
  { id: 'changes', label: 'Cambios en esta Política', body: 'Podemos actualizar esta política de privacidad periódicamente. Te notificaremos sobre cambios significativos por correo electrónico o mediante un aviso en la plataforma. Te recomendamos revisar esta política regularmente.' },
  { id: 'contact', label: 'Contacto', body: 'Para preguntas sobre privacidad o para ejercer tus derechos, contáctanos en privacidad@novofixpro.com o a través de la sección de soporte de la plataforma.' }
];

const PRIVACY_SECTIONS_EN = [
  { id: 'collection', label: 'Information We Collect', body: 'We collect the following information:\n\n- Registration data: name, email, phone number, and password\n- Profile information: photo, description, skills, and location\n- Usage data: platform interactions, searches, and preferences\n- User-generated content: work photos, reviews, and messages\n- Technical information: IP address, device type, and browser' },
  { id: 'usage', label: 'Use of Information', body: 'We use your information to:\n\n- Provide and improve our services\n- Connect clients with relevant providers\n- Process payments and transactions\n- Send important notifications about your account\n- Personalize your platform experience\n- Prevent fraud and unauthorized activities\n- Comply with legal obligations' },
  { id: 'sharing', label: 'Data Sharing', body: 'We do not sell your personal information to third parties. We share limited data only with:\n\n- Payment service providers to process transactions\n- Cloud storage services to store files\n- Legal authorities when required by law\n- Other platform users as necessary for service delivery (e.g., name and profile photo)' },
  { id: 'cookies', label: 'Cookies and Similar Technologies', body: 'We use cookies and similar technologies to keep your session active, remember your preferences, analyze platform usage, and improve user experience. You can configure your browser to reject cookies, although this may affect the functionality of some services.' },
  { id: 'security', label: 'Data Security', body: 'We implement industry-standard security measures to protect your information, including SSL/TLS encryption, secure password storage with hashing, restricted access to personal data, and continuous security monitoring. However, no method of Internet transmission is 100% secure.' },
  { id: 'rights', label: 'Your Rights', body: 'You have the right to:\n\n- Access your stored personal information\n- Correct inaccurate or outdated data\n- Request deletion of your account and data\n- Export your data in a portable format\n- Withdraw your consent at any time\n- File a complaint with the data protection authority' },
  { id: 'retention', label: 'Data Retention', body: 'We retain your personal information while your account is active or as needed to provide services. If you delete your account, we will delete or anonymize your information within 30 days, unless the law requires retention for a longer period.' },
  { id: 'minors', label: 'Minors', body: 'NovoFix is not intended for users under 18 years of age. We do not knowingly collect information from minors. If we discover that a minor has provided us with personal information, we will delete it immediately.' },
  { id: 'changes', label: 'Changes to this Policy', body: 'We may update this privacy policy periodically. We will notify you of significant changes by email or through a notice on the platform. We recommend reviewing this policy regularly.' },
  { id: 'contact', label: 'Contact', body: 'For privacy questions or to exercise your rights, contact us at privacidad@novofixpro.com or through the platform\'s support section.' }
];

const ABOUT_SECTIONS_ES = [
  { id: 'mission', label: 'Nuestra Misión', body: 'El acceso a servicios profesionales de calidad, creando un ecosistema donde clientes encuentren soluciones rápidas y confiables, y donde los profesionales puedan crecer y prosperar mostrando su mejor trabajo.' },
  { id: 'vision', label: 'Nuestra Visión', body: 'Ser la plataforma de referencia en servicios del hogar y comercio, reconocida por la confianza, transparencia y calidad que ofrecemos tanto a clientes como a profesionales en toda Latinoamérica.' },
  { id: 'values-trust', label: 'Valor: Confianza', body: 'Verificamos perfiles y fomentamos reseñas reales para que cada conexión sea segura y transparente.' },
  { id: 'values-innovation', label: 'Valor: Innovación', body: 'Usamos tecnología inteligente como búsqueda por lenguaje natural y matching automático para facilitar cada interacción.' },
  { id: 'values-community', label: 'Valor: Comunidad', body: 'Creemos en el poder de conectar personas. Cada profesional y cada cliente forman parte de una comunidad que crece junta.' },
  { id: 'values-quality', label: 'Valor: Calidad', body: 'Promovemos la excelencia a través de portafolios visuales, calificaciones y un sistema de reputación que premia el buen trabajo.' },
  { id: 'story', label: 'Nuestra Historia', body: 'NovoFix surgió de la frustración de buscar un buen plomero, electricista o pintor y no saber a quién recurrir. Sabíamos que había miles de profesionales talentosos, pero no existía una forma fácil y confiable de encontrarlos.\n\nAsí nació NovoFix: una plataforma que combina tecnología moderna con la cercanía humana. Desde nuestro lanzamiento, hemos conectado a cientos de clientes con profesionales verificados, facilitando miles de servicios completados exitosamente.\n\nHoy, seguimos creciendo con la misma pasión del primer día, mejorando constantemente nuestra plataforma para ofrecer la mejor experiencia posible a nuestra comunidad.' }
];

const ABOUT_SECTIONS_EN = [
  { id: 'mission', label: 'Our Mission', body: 'Access to quality professional services, creating an ecosystem where clients find fast and reliable solutions, and where professionals can grow and thrive by showcasing their best work.' },
  { id: 'vision', label: 'Our Vision', body: 'To be the leading platform for home and commercial services, recognized for the trust, transparency, and quality we offer to both clients and professionals across Latin America.' },
  { id: 'values-trust', label: 'Value: Trust', body: 'We verify profiles and encourage real reviews so that every connection is safe and transparent.' },
  { id: 'values-innovation', label: 'Value: Innovation', body: 'We use smart technology like natural language search and automatic matching to facilitate every interaction.' },
  { id: 'values-community', label: 'Value: Community', body: 'We believe in the power of connecting people. Every professional and every client is part of a community that grows together.' },
  { id: 'values-quality', label: 'Value: Quality', body: 'We promote excellence through visual portfolios, ratings, and a reputation system that rewards good work.' },
  { id: 'story', label: 'Our Story', body: 'NovoFix emerged from the frustration of looking for a good plumber, electrician, or painter and not knowing who to turn to. We knew there were thousands of talented professionals, but there was no easy and reliable way to find them.\n\nThat\'s how NovoFix was born: a platform that combines modern technology with human warmth. Since our launch, we\'ve connected hundreds of clients with verified professionals, facilitating thousands of successfully completed services.\n\nToday, we continue to grow with the same passion as day one, constantly improving our platform to offer the best possible experience to our community.' }
];

const HERO_SECTIONS_ES = [
  { id: 'subtitle', label: 'Subtítulo', body: 'Conectamos clientes con técnicos verificados.' }
];
const HERO_SECTIONS_EN = [
  { id: 'subtitle', label: 'Subtitle', body: 'We connect clients with verified technicians.' }
];

const CONTACT_SECTIONS_ES = [
  { id: 'email', label: 'Email', body: 'soporte@novofixpro.com' }
];
const CONTACT_SECTIONS_EN = [
  { id: 'email', label: 'Email', body: 'soporte@novofixpro.com' }
];

const TITLES = {
  terms: { es: 'Términos y Condiciones', en: 'Terms and Conditions' },
  privacy: { es: 'Política de Privacidad', en: 'Privacy Policy' },
  about: { es: 'Sobre Nosotros', en: 'About Us' },
  hero: { es: 'Encontrá el profesional ideal para tu hogar', en: 'Find the perfect professional for your home' },
  contact: { es: 'Contacto', en: 'Contact' }
};

const SECTIONS = {
  terms: { es: TERMS_SECTIONS_ES, en: TERMS_SECTIONS_EN },
  privacy: { es: PRIVACY_SECTIONS_ES, en: PRIVACY_SECTIONS_EN },
  about: { es: ABOUT_SECTIONS_ES, en: ABOUT_SECTIONS_EN },
  hero: { es: HERO_SECTIONS_ES, en: HERO_SECTIONS_EN },
  contact: { es: CONTACT_SECTIONS_ES, en: CONTACT_SECTIONS_EN }
};

/**
 * Devuelve la estructura por defecto lista para persistir en Mongo:
 *   { title, sections: [{ id, label, bodyMarkdown, bodyHtml }] }
 *
 * @param {string} key
 * @param {'es'|'en'} locale
 * @returns {{ title: string, sections: Array }}
 */
export function buildDefaultLocale(key, locale) {
  const title = TITLES[key]?.[locale] || '';
  const raw = SECTIONS[key]?.[locale] || [];
  return {
    title,
    sections: raw.map((s) => ({
      id: s.id,
      label: s.label,
      bodyMarkdown: s.body,
      bodyHtml: renderMarkdownSafe(s.body)
    }))
  };
}

/**
 * Devuelve el objeto translations completo con ambos idiomas listos para guardar.
 * @param {string} key
 */
export function buildDefaultTranslations(key) {
  return {
    es: buildDefaultLocale(key, 'es'),
    en: buildDefaultLocale(key, 'en')
  };
}

export default { buildDefaultLocale, buildDefaultTranslations };
