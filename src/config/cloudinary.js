import { v2 as cloudinary } from 'cloudinary';

let isConfigured = false;

function ensureConfigured() {
  if (isConfigured) return;

  // Verificar que las variables de entorno estén disponibles
  const requiredVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = requiredVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    console.error('❌ Missing Cloudinary environment variables:', missing);
    console.error('Current env:', {
      NODE_ENV: process.env.NODE_ENV,
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || 'NOT SET',
      CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ? 'SET' : 'NOT SET',
      CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ? 'SET' : 'NOT SET'
    });
    throw new Error(`Missing required Cloudinary configuration: ${missing.join(', ')}`);
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
    api_proxy: process.env.CLOUDINARY_API_PROXY || undefined,
    // Optimizaciones de rendimiento
    upload_prefix: process.env.CLOUDINARY_UPLOAD_PREFIX || undefined,
    api_connection_timeout: 600000, // 10 minutos
    upload_timeout: 600000 // 10 minutos
  });

  isConfigured = true;
  console.log('✅ Cloudinary configured:', {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: `${process.env.CLOUDINARY_API_KEY.substring(0, 6)}...`,
    secure: true
  });
  
  // Verificar conectividad
  cloudinary.api.ping()
    .then(() => console.log('✅ Cloudinary connection verified'))
    .catch((err) => console.warn('⚠️ Cloudinary ping failed:', err.message));
}

// Proxy para cloudinary que asegura configuración antes de cada llamada
const cloudinaryProxy = new Proxy(cloudinary, {
  get(target, prop) {
    ensureConfigured();
    return target[prop];
  }
});

export default cloudinaryProxy;