// routes/shared/uploads.routes.js
import express from 'express';
import uploadController from '../../controllers/uploadController.js';
import {
  authenticateJWT,
  requireAuth
} from '../../middlewares/auth/jwtAuth.js';
import { anyUser } from '../../middlewares/auth/rbacMiddleware.js';
import multer from 'multer';

const router = express.Router();

// ✨ Configuración de multer con memoryStorage
// Usa memoria RAM en lugar de disco, eliminando problemas con sistemas de archivos efímeros
// Ideal para Render, Vercel, Railway y otros servicios serverless/containerizados
const storage = multer.memoryStorage();

// Configuración de multer con límites aumentados para videos
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB máximo por archivo
    files: 10, // Máximo 10 archivos
    fieldSize: 10 * 1024 * 1024 // 10MB para campos no-file
  },
  fileFilter: function (req, file, cb) {
    // Validación básica de tipos
    const allowedMimes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/webm'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: images and videos only.`));
    }
  },
  preservePath: false
});

// Configuración de multer para múltiples archivos
const handleUpload = upload.array('files', 10);

// Rutas públicas para uploads (pueden requerir autenticación según el caso)
router.post('/files', authenticateJWT, requireAuth, handleUpload, uploadController.uploadFiles);
router.delete('/files/:cloudinaryId', authenticateJWT, requireAuth, uploadController.deleteFile);

// Upload específico para solicitudes de servicio
router.post('/service-request/media', 
  authenticateJWT, 
  requireAuth, 
  handleUpload, 
  uploadController.uploadServiceRequestMedia
);

// Upload para evidencias de servicio
router.post('/booking-evidence', 
  authenticateJWT, 
  requireAuth, 
  handleUpload, 
  uploadController.uploadFiles // Usar el método correcto del controller
);

// Upload para avatar de usuario
const handleAvatarUpload = upload.single('avatar'); // Solo 1 archivo
router.post('/avatar',
  authenticateJWT,
  requireAuth,
  handleAvatarUpload,
  uploadController.uploadAvatar
);

// Upload para portfolio de proveedor (múltiples archivos)
const handlePortfolioUpload = upload.array('portfolio', 10); // Hasta 10 archivos
router.post('/portfolio',
  authenticateJWT,
  requireAuth,
  handlePortfolioUpload,
  uploadController.uploadPortfolio
);

// Upload para chat (imágenes y documentos)
const chatUpload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB máximo por archivo para chat
    files: 5 // Máximo 5 archivos
  },
  fileFilter: function (req, file, cb) {
    const allowedMimes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type for chat: ${file.mimetype}.`));
    }
  }
});
const handleChatUpload = chatUpload.single('file');
router.post('/chat',
  authenticateJWT,
  requireAuth,
  handleChatUpload,
  uploadController.uploadChatFile
);

export default router;