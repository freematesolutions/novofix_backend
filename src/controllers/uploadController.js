// controllers/uploadController.js
import cloudinary from '../config/cloudinary.js';

/**
 * Procesa un array de promesas con concurrencia limitada
 * @param {Array} items - Array de items a procesar
 * @param {Function} fn - Función async que procesa cada item
 * @param {number} limit - Límite de concurrencia (por defecto 3)
 */
async function processWithConcurrencyLimit(items, fn, limit = 3) {
  const results = [];
  const executing = [];
  
  for (const [index, item] of items.entries()) {
    const promise = fn(item, index).then(result => {
      executing.splice(executing.indexOf(promise), 1);
      return result;
    });
    
    results.push(promise);
    executing.push(promise);
    
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  
  return Promise.all(results);
}

/**
 * Función auxiliar para subir archivo individual a Cloudinary desde buffer
 * Usa upload_stream de Cloudinary para subir directamente desde memoria
 * Compatible con multer memoryStorage - sin archivos temporales en disco
 */
async function uploadToCloudinary(file, retries = 3) {
  // Validar que el buffer existe
  if (!file.buffer) {
    throw new Error(`File buffer not found. Ensure multer is configured with memoryStorage.`);
  }
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const isVideo = file.mimetype?.startsWith('video/');
      const isImage = file.mimetype?.startsWith('image/');
      const fileSizeMB = file.size / (1024 * 1024);
      const isLargeFile = file.size > 10 * 1024 * 1024; // > 10MB

      const uploadOptions = {
        folder: 'marketplace-services',
        resource_type: 'auto',
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'webm', 'mpeg', 'pdf', 'doc', 'docx'],
        timeout: 600000, // 10 minutos universal
        chunk_size: 20000000, // 20MB chunks para mejor rendimiento
        use_filename: true,
        unique_filename: true
      };

      // Optimizaciones para imágenes
      if (isImage) {
        uploadOptions.quality = 'auto:good'; // Compresión automática con buena calidad
        uploadOptions.fetch_format = 'auto'; // Formato automático (WebP cuando sea posible)
        uploadOptions.flags = 'lossy'; // Compresión con pérdida para reducir tamaño
      }

      // Para videos, agregar optimizaciones adicionales
      if (isVideo) {
        uploadOptions.resource_type = 'video';
        
        // Nota: `eager_async` requiere transformaciones `eager` definidas para ser válido.
        // Lo omitimos para evitar errores 400 de Cloudinary en uploads sin transformaciones eager.
        if (isLargeFile) {
          console.log(`📦 Large video detected (${fileSizeMB.toFixed(2)}MB) — using standard async upload`);
        }
        
        // Optimizaciones de formato para videos
        // Reducir calidad ligeramente para archivos muy grandes (> 50MB)
        if (fileSizeMB > 50) {
          uploadOptions.quality = 'auto:eco'; // Calidad económica para videos grandes
          console.log(`🎬 Applying quality optimization for large video (${fileSizeMB.toFixed(2)}MB)`);
        } else {
          uploadOptions.quality = 'auto:good';
        }
      }

      if (attempt > 1) {
        console.log(`🔄 Retry attempt ${attempt}/${retries} for ${file.originalname || file.filename}`);
      }

      console.log(`⬆️ Starting upload: ${file.originalname || 'unknown'} (${fileSizeMB.toFixed(2)}MB)`);
      const startTime = Date.now();
      
      // ✨ Usar upload_stream para subir desde buffer (memoria)
      // Esto elimina la necesidad de archivos temporales en disco
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          }
        );
        
        // Escribir el buffer al stream
        uploadStream.end(file.buffer);
      });
      
      const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Upload completed in ${uploadTime}s: ${result.secure_url}`);

      return {
        url: result.secure_url,
        cloudinaryId: result.public_id,
        format: result.format,
        size: result.bytes,
        resourceType: result.resource_type
      };
    } catch (error) {
      // Log completo del error para debugging
      console.error(`❌ uploadToCloudinary error (attempt ${attempt}/${retries}):`, {
        message: error.message,
        code: error.http_code,
        name: error.name,
        error: error.error,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      });
      
      // Si es el último intento o no es un error de timeout, lanzar el error
      if (attempt === retries || (error.http_code !== 499 && error.name !== 'TimeoutError')) {
        const errorMsg = error.message || error.error?.message || JSON.stringify(error.error) || 'Unknown error';
        throw new Error(`Failed to upload to Cloudinary: ${errorMsg}`);
      }
      
      // Esperar antes de reintentar (backoff exponencial)
      const delay = attempt * 2000; // 2s, 4s, 6s
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

class UploadController {
  /**
   * Subir archivos a Cloudinary con procesamiento en paralelo limitado
   */
  async uploadFiles(req, res) {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded'
        });
      }

      console.log(`📦 Processing ${req.files.length} file(s) with concurrent uploads`);

      // Usar procesamiento en paralelo limitado (máximo 3 archivos simultáneos)
      // Esto evita sobrecargar el servidor y optimiza el uso de recursos
      const uploadResults = await processWithConcurrencyLimit(
        req.files,
        (file) => uploadToCloudinary(file),
        3 // Máximo 3 uploads simultáneos
      );

      res.json({
        success: true,
        message: 'Files uploaded successfully',
        data: {
          files: uploadResults
        }
      });
    } catch (error) {
      console.error('UploadController - uploadFiles error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload files'
      });
    }
  }

  /**
   * Subir archivo individual a Cloudinary desde buffer
   * @deprecated Usa la función auxiliar uploadToCloudinary en su lugar
   */
  async uploadToCloudinary(file) {
    // Delegar a la función auxiliar que maneja buffers y reintentos
    return uploadToCloudinary(file);
  }

  /**
   * Eliminar archivo de Cloudinary
   */
  async deleteFile(req, res) {
    try {
      const { cloudinaryId } = req.params;

      const result = await cloudinary.uploader.destroy(cloudinaryId);

      if (result.result === 'ok') {
        res.json({
          success: true,
          message: 'File deleted successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to delete file'
        });
      }
    } catch (error) {
      console.error('UploadController - deleteFile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete file'
      });
    }
  }

  /**
   * Subir múltiples archivos para una solicitud de servicio
   */
  async uploadServiceRequestMedia(req, res) {
    try {
      const { type } = req.body; // 'photos' o 'videos'
      
      console.log('📤 Upload request received:', {
        type,
        filesCount: req.files?.length,
        files: req.files?.map(f => ({ name: f.originalname, size: f.size, mimetype: f.mimetype }))
      });

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded'
        });
      }

      // Validar tipo de archivos
      const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      const validVideoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/webm'];
      
      for (const file of req.files) {
        if (type === 'photos' && !validImageTypes.includes(file.mimetype)) {
          return res.status(400).json({
            success: false,
            message: `Invalid image type: ${file.mimetype}. Allowed: JPG, PNG, GIF, WebP`
          });
        }
        if (type === 'videos' && !validVideoTypes.includes(file.mimetype)) {
          return res.status(400).json({
            success: false,
            message: `Invalid video type: ${file.mimetype}. Allowed: MP4, MOV, AVI, MPEG, WebM`
          });
        }
      }

      // Subir archivos con concurrencia limitada
      console.log(`📦 Uploading ${req.files.length} ${type} with concurrent processing`);
      
      const uploadResults = await processWithConcurrencyLimit(
        req.files,
        async (file) => {
          try {
            console.log(`📤 Uploading ${file.originalname} to Cloudinary...`);
            const result = await uploadToCloudinary(file);
            console.log(`✅ Upload successful: ${result.url}`);
            
            return result;
          } catch (err) {
            console.error(`❌ Upload failed for ${file.originalname}:`, err.message);
            throw err;
          }
        },
        type === 'videos' ? 2 : 3 // Videos: máx 2 simultáneos, Fotos: máx 3 simultáneos
      );

      // Preparar respuesta según el tipo
      const mediaData = uploadResults.map(result => ({
        url: result.url,
        cloudinaryId: result.cloudinaryId,
        caption: ''
      }));

      console.log(`✅ All uploads completed successfully (${uploadResults.length} files)`);

      res.json({
        success: true,
        message: `${type} uploaded successfully`,
        data: {
          [type]: mediaData
        }
      });
    } catch (error) {
      console.error('❌ UploadController - uploadServiceRequestMedia error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        cloudinaryError: error.http_code
      });
      res.status(500).json({
        success: false,
        message: `Failed to upload media: ${error.message}`,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Subir avatar de usuario
   */
  async uploadAvatar(req, res) {
    try {
      console.log('📤 Avatar upload request received');

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      // Validar que sea imagen
      const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!validImageTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: `Invalid image type: ${req.file.mimetype}. Allowed: JPG, PNG, GIF, WebP`
        });
      }

      console.log(`📤 Uploading avatar: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)}KB)`);

      // Obtener el usuario para verificar si tiene un avatar anterior
      const User = (await import('../models/User/User.js')).default;
      const user = await User.findById(req.user._id);
      const oldAvatarCloudinaryId = user?.profile?.avatarCloudinaryId;

      // ✨ Subir a Cloudinary desde buffer con transformaciones para avatares
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'marketplace-services/avatars',
            resource_type: 'image',
            timeout: 120000, // 2 minutos para avatares
            chunk_size: 20000000, // 20MB chunks
            transformation: [
              { width: 400, height: 400, crop: 'fill', gravity: 'face' },
              { quality: 'auto:good', fetch_format: 'auto' }
            ]
          },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          }
        );
        
        // Escribir el buffer al stream
        uploadStream.end(req.file.buffer);
      });

      console.log(`✅ Avatar uploaded successfully: ${result.secure_url}`);

      // Eliminar el avatar anterior de Cloudinary si existe
      if (oldAvatarCloudinaryId) {
        try {
          await cloudinary.uploader.destroy(oldAvatarCloudinaryId, {
            resource_type: 'image'
          });
          console.log(`✅ Old avatar deleted from Cloudinary: ${oldAvatarCloudinaryId}`);
        } catch (deleteError) {
          console.error(`Failed to delete old avatar from Cloudinary:`, deleteError);
          // Continuar aunque falle la eliminación del anterior
        }
      }

      res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          avatar: {
            url: result.secure_url,
            cloudinaryId: result.public_id
          }
        }
      });
    } catch (error) {
      console.error('❌ UploadController - uploadAvatar error:', error);
      res.status(500).json({
        success: false,
        message: `Failed to upload avatar: ${error.message}`,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Subir múltiples archivos para portfolio de proveedor
   */
  async uploadPortfolio(req, res) {
    try {
      const { category, captions } = req.body; // category opcional, captions como JSON array
      
      console.log('📤 Portfolio upload request received:', {
        filesCount: req.files?.length,
        category,
        captions: captions ? JSON.parse(captions).length : 0
      });

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded'
        });
      }

      // Límite de 10 archivos por carga
      if (req.files.length > 10) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 10 files allowed per upload'
        });
      }

      // Validar tipos de archivos (imágenes y videos)
      const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      const validVideoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/webm'];
      
      for (const file of req.files) {
        if (![...validImageTypes, ...validVideoTypes].includes(file.mimetype)) {
          return res.status(400).json({
            success: false,
            message: `Invalid file type: ${file.mimetype}. Allowed: images (JPG, PNG, GIF, WebP) and videos (MP4, MOV, AVI, MPEG, WebM)`
          });
        }
      }

      // Parse captions si existen
      let captionsArray = [];
      if (captions) {
        try {
          captionsArray = JSON.parse(captions);
        } catch (e) {
          console.warn('Failed to parse captions, using empty array');
        }
      }

      // Subir archivos a Cloudinary con concurrencia limitada
      console.log(`📦 Uploading ${req.files.length} portfolio files with concurrent processing`);
      
      const uploadResults = await processWithConcurrencyLimit(
        req.files,
        async (file, index) => {
          try {
            const isVideo = file.mimetype.startsWith('video/');
            const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
            console.log(`📤 Uploading ${file.originalname} (${isVideo ? 'video' : 'image'}, ${fileSizeMB}MB) to Cloudinary...`);
            
            // Usar la función auxiliar mejorada
            const result = await uploadToCloudinary(file);
            
            console.log(`✅ Portfolio upload successful: ${result.url}`);
            
            return {
              url: result.url,
              cloudinaryId: result.cloudinaryId,
              type: isVideo ? 'video' : 'image',
              caption: captionsArray[index] || '',
              category: category || null
            };
          } catch (err) {
            console.error(`❌ Portfolio upload failed for ${file.originalname}:`, err.message);
            throw err;
          }
        },
        2 // Máximo 2 uploads simultáneos para portfolio (pueden ser archivos grandes)
      );

      console.log(`✅ All portfolio files uploaded successfully (${uploadResults.length} files)`);

      res.json({
        success: true,
        message: 'Portfolio files uploaded successfully',
        data: {
          portfolio: uploadResults
        }
      });
    } catch (error) {
      console.error('❌ UploadController - uploadPortfolio error:', error);
      res.status(500).json({
        success: false,
        message: `Failed to upload portfolio: ${error.message}`,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Subir archivo para chat (imágenes, videos y documentos)
   * Límites: imágenes 10MB, videos 100MB, documentos 5MB
   * Tipos permitidos: imágenes, videos, PDF, documentos de texto
   */
  async uploadChatFile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      const file = req.file;
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      const isImage = file.mimetype.startsWith('image/');
      const isVideo = file.mimetype.startsWith('video/');
      const isLargeFile = file.size > 10 * 1024 * 1024; // > 10MB
      
      // Determinar tipo de archivo para respuesta
      let fileType = 'document';
      if (isImage) fileType = 'image';
      if (isVideo) fileType = 'video';
      
      console.log(`📤 Uploading chat file: ${file.originalname} (${fileType}, ${fileSizeMB}MB)`);

      // Subir a Cloudinary con configuración optimizada
      const result = await new Promise((resolve, reject) => {
        const uploadOptions = {
          folder: 'marketplace-services/chat',
          use_filename: true,
          unique_filename: true
        };

        // Configuración específica por tipo de archivo
        if (isImage) {
          uploadOptions.resource_type = 'image';
          uploadOptions.quality = 'auto:good';
          uploadOptions.fetch_format = 'auto';
          uploadOptions.transformation = [
            { width: 1920, height: 1920, crop: 'limit' } // Limitar tamaño máximo
          ];
          uploadOptions.timeout = 120000; // 2 minutos
        } else if (isVideo) {
          uploadOptions.resource_type = 'video';
          uploadOptions.timeout = 600000; // 10 minutos para videos
          uploadOptions.chunk_size = 20000000; // 20MB chunks
          
          // Nota: `eager_async` requiere transformaciones `eager` para ser válido.
          // Lo omitimos para evitar errores 400 de Cloudinary en uploads sin transformaciones eager.
          if (isLargeFile) {
            console.log(`📦 Large chat video detected (${fileSizeMB}MB) — using standard upload`);
          }
          
          // Calidad adaptativa según tamaño
          if (file.size > 50 * 1024 * 1024) {
            uploadOptions.quality = 'auto:eco'; // Compresión económica para videos muy grandes
          } else {
            uploadOptions.quality = 'auto:good';
          }
        } else {
          uploadOptions.resource_type = 'raw';
          uploadOptions.timeout = 60000; // 1 minuto para documentos

          // Para resource_type: 'raw', Cloudinary NO agrega extensión a la URL.
          // Forzamos que el public_id incluya la extensión original (ej. .pdf)
          // para que la URL resultante sea descargable y reconocible por el navegador.
          const originalExt = (file.originalname || '').match(/\.[^.]+$/)?.[0] || '';
          const baseName = (file.originalname || 'document').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
          const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          uploadOptions.public_id = `${baseName}_${uniqueSuffix}${originalExt}`;
          // Con public_id explícito desactivamos use_filename para evitar conflicto
          uploadOptions.use_filename = false;
          uploadOptions.unique_filename = false;
        }

        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              console.error('❌ Cloudinary upload error:', error);
              reject(error);
            } else {
              resolve(result);
            }
          }
        );
        
        uploadStream.end(file.buffer);
      });

      console.log(`✅ Chat file uploaded: ${result.secure_url}`);

      res.json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          url: result.secure_url,
          cloudinaryId: result.public_id,
          type: fileType,
          name: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          format: result.format,
          duration: result.duration // Para videos
        }
      });
    } catch (error) {
      console.error('❌ UploadController - uploadChatFile error:', error);
      res.status(500).json({
        success: false,
        message: `Failed to upload chat file: ${error.message}`
      });
    }
  }

  /**
   * Proxy para servir archivos de Cloudinary a través del servidor.
   * Resuelve el 401 que Cloudinary devuelve en raw resources cuando el
   * navegador hace fetch directo (CORS / acceso restringido).
   * GET /uploads/proxy?url=<cloudinary_url>
   */
  async proxyFile(req, res) {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ success: false, message: 'Missing url parameter' });
      }

      // Security: only proxy Cloudinary URLs
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith('cloudinary.com') && !parsed.hostname.endsWith('cloudinary.net')) {
        return res.status(403).json({ success: false, message: 'Only Cloudinary URLs are allowed' });
      }

      // Generate an API-authenticated Cloudinary download URL
      let fetchUrl = url;
      try {
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        // pathParts: ['cloud_name', 'raw', 'upload', 'v123456', 'folder/file.pdf']
        const resourceType = pathParts[1] || 'raw';
        const type = pathParts[2] || 'upload';
        let publicIdStart = 3;
        if (pathParts[3] && /^v\d+$/.test(pathParts[3])) {
          publicIdStart = 4;
        }
        const publicId = pathParts.slice(publicIdStart).join('/');

        // private_download_url generates an API endpoint URL with full auth:
        // https://api.cloudinary.com/v1_1/{cloud}/{type}/download?api_key=...&signature=...
        fetchUrl = cloudinary.utils.private_download_url(publicId, '', {
          resource_type: resourceType,
          type: type,
          expires_at: Math.floor(Date.now() / 1000) + 3600
        });
        console.log('UploadController - proxyFile: Using private_download_url for', publicId);
      } catch (signErr) {
        console.warn('UploadController - proxyFile: Could not generate download URL, using original:', signErr.message);
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) {
        console.error(`UploadController - proxyFile: upstream returned ${response.status} for ${fetchUrl}`);
        return res.status(502).json({ success: false, message: `Upstream returned ${response.status}` });
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      // Extraer nombre de archivo de la URL
      const fileName = decodeURIComponent(parsed.pathname.split('/').pop() || 'file');

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      console.error('❌ UploadController - proxyFile error:', error);
      res.status(500).json({ success: false, message: 'Failed to proxy file' });
    }
  }
}

export default new UploadController();