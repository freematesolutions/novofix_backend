// controllers/guestController.js
import mongoose from 'mongoose';
import Session from '../models/System/Session.js';
import ServiceRequest from '../models/Service/ServiceRequest.js';
import Client from '../models/User/Client.js';

class GuestController {
  /**
   * Buscar proveedores (público, sin autenticación)
   */
  async searchProvidersPublic(req, res) {
    try {
      const { q, category, lat, lng, limit = 20 } = req.query;
      const Provider = (await import('../models/User/Provider.js')).default;
      const scoringService = (await import('../services/internal/scoringService.js')).default;
      const { SERVICE_CATEGORIES } = await import('../config/categories.js');

      // Consulta base más flexible - no requerir suscripción activa obligatoriamente
      const base = {
        isActive: true
      };
      if (category) {
        base['providerProfile.services.category'] = category;
      }

      const select = {
        email: 1,
        'profile.firstName': 1,
        'profile.avatar': 1,
        'providerProfile.businessName': 1,
        'providerProfile.description': 1,
        'providerProfile.businessDescription': 1,
        'providerProfile.rating.average': 1,
        'providerProfile.rating.count': 1,
        'providerProfile.rating.breakdown': 1,
        'providerProfile.services': 1,
        'providerProfile.portfolio': 1,
        'providerProfile.stats': 1,
        'subscription.plan': 1,
        'subscription.status': 1,
        'providerProfile.serviceArea.location': 1,
        'providerProfile.serviceArea.address': 1,
        'providerProfile.serviceArea.zones': 1,
        'providerProfile.serviceArea.radius': 1
      };

      const lim = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
      const hasCoords = lat != null && lng != null && !isNaN(Number(lat)) && !isNaN(Number(lng));

      // Búsqueda inteligente por texto con NLP profundo
      let orText = [];
      if (q && String(q).trim().length > 0) {
        const searchText = String(q).trim().toLowerCase();
        console.log(`🔍 Intelligent text search for: "${searchText}"`);
        
        // Análisis de lenguaje natural - Extraer palabras clave
        const words = searchText.split(/\s+/).filter(w => w.length > 2);
        console.log(`📝 Extracted words: ${words.join(', ')}`);
        
        // Crear múltiples regex para cada palabra
        const wordRegexes = words.map(word => ({ $regex: word, $options: 'i' }));
        
        // Buscar en múltiples campos con cada palabra
        orText = [];
        
        // Para cada palabra, buscar en todos los campos
        words.forEach(word => {
          const wordRegex = { $regex: word, $options: 'i' };
          orText.push(
            { 'providerProfile.businessName': wordRegex },
            { 'profile.firstName': wordRegex },
            { 'providerProfile.description': wordRegex },
            { 'providerProfile.businessDescription': wordRegex },
            { 'providerProfile.services.category': wordRegex },
            { 'providerProfile.services.description': wordRegex },
            { 'providerProfile.serviceArea.address': wordRegex }
          );
        });
        
        // También buscar la frase completa
        const searchRegex = { $regex: searchText, $options: 'i' };
        orText.push(
          { 'providerProfile.businessName': searchRegex },
          { 'providerProfile.description': searchRegex },
          { 'providerProfile.businessDescription': searchRegex },
          { 'providerProfile.services.description': searchRegex }
        );
        
        // Búsqueda inteligente por categorías - buscar coincidencias parciales
        const matchingCategories = SERVICE_CATEGORIES.filter(cat => 
          cat.toLowerCase().includes(searchText.toLowerCase()) ||
          searchText.toLowerCase().includes(cat.toLowerCase())
        );
        
        if (matchingCategories.length > 0) {
          console.log(`📋 Found matching categories: ${matchingCategories.join(', ')}`);
          orText.push({ 'providerProfile.services.category': { $in: matchingCategories } });
        }
        
        // Búsqueda por palabras clave comunes con análisis NLP profundo
        // Incluye verbos de acción, necesidades, problemas y contextos
        const keywords = {
          // Plomería - acciones, problemas, elementos
          'plomero|plomería|fontanero|agua|tubería|caño|fuga|filtración|goteo|gotear|tapar|destapa|desatora|inodoro|baño|lavabo|grifo|ducha|regadera|cañería|drenaje|desagüe|instalación agua|reparar tubería|arreglar fuga|necesito plomero|tengo fuga|problema agua|cambiar tubería|instalar lavabo': 'Plomería',
          
          // Electricidad - instalación, reparación, problemas
          'electricista|electricidad|luz|cables|cable|interruptor|enchufe|toma|corriente|instalación eléctrica|apagón|cortocircuito|no hay luz|sin luz|cambiar enchufe|instalar lámpara|arreglar luz|reparar instalación|problema eléctrico|revisar instalación|breaker|fusible|voltaje|conexión|alumbrado': 'Electricidad',
          
          // Carpintería - elementos, trabajos, materiales
          'carpintero|carpintería|madera|muebles|puerta|ventana|closet|armario|estante|librero|mesa|silla|reparar mueble|hacer mueble|instalar puerta|arreglar ventana|trabajos madera|diseño muebles|mueble medida|restaurar muebles': 'Carpintería',
          
          // Pintura - trabajos, áreas, acabados
          'pintor|pintura|pared|barniz|decoración pintura|pintar casa|pintar habitación|pintar cuarto|pintar fachada|pintar exterior|pintar interior|acabados|empaste|resane|color|esmalte|látex|brocha|rodillo|necesito pintor': 'Pintura',
          
          // Limpieza - tipos, áreas, servicios
          'limpieza|limpiar|aseo|desinfección|limpiador|sanitizar|sanitización|limpiar casa|limpiar oficina|limpieza profunda|limpieza hogar|servicio limpieza|personal limpieza|hacer limpieza|necesito limpieza|aspirar|trapear|lavar|pulir|brillar': 'Limpieza',
          
          // Jardinería - servicios, plantas, mantenimiento
          'jardinero|jardinería|jardín|poda|podar|césped|pasto|cortar pasto|plantas|regar|riego|mantenimiento jardín|diseño jardín|plantar|sembrar|fertilizar|abono|árboles|flores|macetas|tierra': 'Jardinería',
          
          // Cerrajería - servicios, problemas
          'cerrajero|cerradura|llave|candado|puerta|cerrar|abrir|cambiar cerradura|hacer llave|duplicar llave|me quedé afuera|perdí llave|puerta trabada|no abre puerta|chapas|instalación cerradura': 'Cerrajería',
          
          // Albañilería - construcción, reparación
          'albañil|albañilería|construcción|pared|muro|cemento|ladrillo|block|mampostería|levantar pared|hacer cuarto|ampliar casa|reparar pared|grieta|resane|construir|obra gris|cimientos|columna': 'Albañilería',
          
          // Electrodomésticos - tipos, problemas
          'electrodomésticos|reparación electrodomésticos|lavadora|refrigerador|nevera|heladera|estufa|cocina|horno|microondas|licuadora|cafetera|no funciona|no prende|no enfría|hace ruido|reparar lavadora|arreglar nevera|técnico electrodomésticos': 'Reparación de electrodomésticos',
          
          // Aire acondicionado - instalación, mantenimiento
          'aire acondicionado|clima|climatización|refrigeración|instalar aire|mantenimiento aire|reparar aire|recarga gas|limpieza aire|no enfría|hace ruido|minisplit|central|ventilación': 'Instalación de aire acondicionado',
          
          // Mudanzas - servicio, transporte
          'mudanza|mudanzas|mudarme|transporte|trasladar|embalaje|empaque|embalar|cargar|descargar|flete|camión mudanza|servicio mudanza|transportar muebles|cambio casa|cambio oficina': 'Mudanzas',
          
          // Fumigación - plagas, control
          'fumigación|fumigar|plagas|insectos|cucarachas|hormigas|ratones|ratas|chinches|termitas|control plagas|eliminar plagas|desinfección|desinsectación|exterminador|veneno|químicos': 'Fumigación',
          
          // Tecnología - dispositivos, problemas, servicios
          'tecnología|informática|computadora|computador|ordenador|pc|laptop|portátil|computador|reparar computadora|arreglar pc|lento|virus|no prende|pantalla rota|formatear|instalar windows|respaldo|datos|software|hardware|internet|wifi|red|impresora|scanner': 'Tecnología e informática',
          
          // Clases - materias, niveles
          'clases|clase|profesor|profesora|maestro|maestra|tutor|tutora|enseñanza|educación|enseñar|aprender|matemáticas|inglés|física|química|primaria|secundaria|preparatoria|universidad|tarea|examen|regularización|apoyo escolar': 'Clases particulares',
          
          // Belleza - servicios, tratamientos
          'belleza|estética|peluquería|salón|cabello|pelo|corte|tinte|color|mechas|alaciado|peinado|maquillaje|uñas|manicure|pedicure|depilación|facial|masaje|spa|estilista': 'Belleza y estética',
          
          // Mecánica - vehículos, servicios
          'mecánica|mecánico|auto|automóvil|carro|coche|vehículo|motor|reparar auto|arreglar carro|afinación|cambio aceite|frenos|suspensión|transmisión|no arranca|hace ruido|humo|revisión|servicio|taller': 'Mecánica automotriz',
          
          // Fotografía - eventos, tipos
          'fotografía|fotógrafo|foto|fotografías|sesión fotográfica|sesión fotos|imagen|fotografiar|boda|quinceañera|evento|fiesta|cumpleaños|producto|retrato|estudio fotográfico|book|portafolio': 'Fotografía',
          
          // Catering - eventos, comida
          'catering|comida|banquete|evento|fiesta|boda|cumpleaños|cocina|cocinero|chef|servicio comida|buffet|bocadillos|menú|alimentos|bebidas|meseros': 'Catering',
          
          // Construcción - proyectos, obras
          'construcción|construir|construcciones|constructor|edificar|obra|proyecto|casa|edificio|remodelación|remodelar|ampliar|ampliación|renovar|renovación|hacer casa|construir casa|proyecto construcción': 'Construcción',
          
          // Decoración - diseño, ambientes
          'decoración|decorador|decoradora|decorar|interior|diseño interior|interiorismo|ambientar|amueblar|diseño espacios|renovar casa|cambiar decoración|diseñador interiores|cortinas|muebles|colores': 'Decoración',
          
          // Diseño gráfico - servicios, productos
          'diseño gráfico|diseñador gráfico|diseñadora|logo|logotipo|crear logo|diseño logo|branding|marca|identidad|publicidad|flyer|cartel|banner|tarjetas|diseño web|imagen corporativa|ilustración': 'Diseño gráfico',
          
          // Legal - servicios, trámites
          'legal|abogado|abogada|licenciado|derecho|asesoría legal|asesor legal|jurídico|demanda|juicio|contrato|trámite|documento|notario|divorcios|herencias|laboral|penal|civil|consulta legal': 'Asesoría legal',
          
          // Contabilidad - servicios, declaraciones
          'contabilidad|contador|contadora|contable|impuestos|declaración|fiscal|financiero|finanzas|empresa|negocio|sat|facturación|nómina|auditoría|estados financieros|cálculo impuestos': 'Contabilidad',
          
          // Marketing - estrategias, medios
          'marketing|marketing digital|mercadotecnia|publicidad|anuncios|redes sociales|facebook|instagram|social media|community manager|seo|posicionamiento|google|ads|campaña|estrategia|contenido|viral': 'Marketing digital',
          
          // Traducción - idiomas, documentos
          'traducción|traductor|traductora|traducir|idiomas|idioma|inglés|francés|alemán|chino|japonés|interpretación|intérprete|documento|traducir documento|certificada|jurada|simultánea': 'Traducción'
        };
        
        // Búsqueda por palabras clave y contexto
        const matchedCategories = new Set();
        for (const [keywordPattern, categoryName] of Object.entries(keywords)) {
          const keywordRegex = new RegExp(keywordPattern, 'i');
          if (keywordRegex.test(searchText)) {
            console.log(`🔑 Keyword match: "${searchText}" -> ${categoryName}`);
            matchedCategories.add(categoryName);
            orText.push({ 'providerProfile.services.category': categoryName });
          }
        }
        
        // Análisis de frases comunes en lenguaje natural
        const commonPhrases = {
          'necesito|requiero|busco|quiero': 'acción_búsqueda',
          'tengo un problema|tengo problema|problema con|está roto|no funciona|se rompió|se dañó': 'problema',
          'instalar|instalación|colocar|poner': 'instalación',
          'reparar|arreglar|componer|reparación|arreglo': 'reparación',
          'cambiar|reemplazar|sustituir|cambio': 'cambio',
          'hacer|construir|crear': 'construcción',
          'limpiar|limpieza de': 'limpieza',
          'pintar|pintado de': 'pintura',
          'revisar|revisión|checar|verificar': 'diagnóstico'
        };
        
        let detectedAction = null;
        for (const [phrasePattern, actionType] of Object.entries(commonPhrases)) {
          const phraseRegex = new RegExp(phrasePattern, 'i');
          if (phraseRegex.test(searchText)) {
            detectedAction = actionType;
            console.log(`💡 Detected action: ${actionType}`);
            break;
          }
        }
        
        // Si se detectó una acción pero no categorías, expandir búsqueda
        if (detectedAction && matchedCategories.size === 0) {
          console.log(`🔍 Expanding search based on action: ${detectedAction}`);
          // Buscar con más énfasis en descripciones
          words.forEach(word => {
            if (word.length > 3) {
              const wordRegex = { $regex: word, $options: 'i' };
              orText.push(
                { 'providerProfile.services.description': wordRegex },
                { 'providerProfile.businessDescription': wordRegex }
              );
            }
          });
        }
        
        if (matchedCategories.size > 0) {
          console.log(`✅ Total matched categories: ${matchedCategories.size} - ${Array.from(matchedCategories).join(', ')}`);
        }
      }

      let docs = [];
      
      if (hasCoords) {
        docs = await Provider.find({
          ...base,
          ...(orText.length ? { $or: orText } : {}),
          'providerProfile.serviceArea.location': {
            $near: {
              $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
              $maxDistance: 50000
            }
          }
        }).select(select).limit(lim).lean();
      } else {
        docs = await Provider.find({
          ...base,
          ...(orText.length ? { $or: orText } : {})
        }).select(select).limit(lim).lean();
      }

      console.log(`🔍 Found ${docs.length} providers for query: "${q || 'all'}" (category: ${category || 'all'})`);
      if (docs.length > 0 && q) {
        console.log(`✅ Sample match: ${docs[0].providerProfile?.businessName || 'N/A'}`);
      }

      // Calcular score para cada proveedor
      const providersWithScore = await Promise.all(
        docs.map(async (p) => {
          const scoreData = await scoringService.calculateProviderScore(p);
          return {
            ...p,
            score: scoreData.total,
            scoreBreakdown: scoreData.breakdown
          };
        })
      );

      // Ordenar por suscripción y score
      const planOrder = { pro: 3, basic: 2, free: 1 };
      providersWithScore.sort((a, b) => {
        const planA = planOrder[a.subscription?.plan] || 0;
        const planB = planOrder[b.subscription?.plan] || 0;
        if (planA !== planB) return planB - planA;
        
        // Luego por score
        return b.score - a.score;
      });

      res.json({
        success: true,
        data: { providers: providersWithScore }
      });
    } catch (error) {
      console.error('GuestController - searchProvidersPublic error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search providers'
      });
    }
  }

  /**
   * Obtener profesionales destacados del sistema (público)
   * Retorna los mejores proveedores ordenados por score general
   */
  async getFeaturedProviders(req, res) {
    try {
      const { limit = 10 } = req.query;
      const Provider = (await import('../models/User/Provider.js')).default;
      const Review = (await import('../models/Service/Review.js')).default;
      const scoringService = (await import('../services/internal/scoringService.js')).default;

      const lim = Math.min(Math.max(parseInt(limit) || 10, 1), 20);

      // Buscar proveedores activos con rating y trabajos completados
      const providers = await Provider.find({
        isActive: true,
        'providerProfile.services': { $exists: true, $ne: [] },
        // Preferir proveedores con al menos algún trabajo o rating
        $or: [
          { 'providerProfile.rating.count': { $gt: 0 } },
          { 'providerProfile.stats.completedJobs': { $gt: 0 } },
          { 'providerProfile.portfolio': { $exists: true, $ne: [] } }
        ]
      }).select({
        email: 1,
        'profile.firstName': 1,
        'profile.avatar': 1,
        'providerProfile.businessName': 1,
        'providerProfile.description': 1,
        'providerProfile.businessDescription': 1,
        'providerProfile.rating.average': 1,
        'providerProfile.rating.count': 1,
        'providerProfile.rating.breakdown': 1,
        'providerProfile.services': 1,
        'providerProfile.portfolio': 1,
        'providerProfile.stats': 1,
        'subscription.plan': 1,
        'subscription.status': 1,
        'providerProfile.serviceArea.address': 1
      }).lean();

      console.log(`📊 Found ${providers.length} providers for featured section`);

      // Calcular score para cada proveedor
      const providersWithScore = await Promise.all(
        providers.map(async (p) => {
          const scoreData = await scoringService.calculateProviderScore(p);
          return {
            ...p,
            score: scoreData.total,
            scoreBreakdown: scoreData.breakdown
          };
        })
      );

      // Ordenar primero por plan (pro > basic > free), luego por score
      const planOrder = { pro: 3, basic: 2, free: 1 };
      providersWithScore.sort((a, b) => {
        const planA = planOrder[a.subscription?.plan] || 0;
        const planB = planOrder[b.subscription?.plan] || 0;
        if (planA !== planB) return planB - planA;
        return b.score - a.score;
      });

      // Limitar resultados
      const featuredProviders = providersWithScore.slice(0, lim);

      // Obtener reseñas destacadas para cada proveedor (1 reseña más reciente con rating >= 4)
      const providersWithReviews = await Promise.all(
        featuredProviders.map(async (provider) => {
          const featuredReview = await Review.findOne({
            provider: provider._id,
            status: 'active',
            'rating.overall': { $gte: 4 }
          })
          .sort({ createdAt: -1 })
          .select({
            'rating.overall': 1,
            'review.comment': 1,
            'review.title': 1,
            'translations': 1,
            'originalLanguage': 1,
            createdAt: 1
          })
          .populate('client', 'profile.firstName profile.avatar')
          .lean();

          return {
            ...provider,
            featuredReview: featuredReview || null
          };
        })
      );

      console.log(`✅ Returning ${providersWithReviews.length} featured providers`);

      res.json({
        success: true,
        data: { 
          providers: providersWithReviews,
          total: providersWithReviews.length
        }
      });
    } catch (error) {
      console.error('GuestController - getFeaturedProviders error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get featured providers'
      });
    }
  }

  /**
   * Obtener testimonios destacados (reseñas con fotos de trabajos y feedback de plataforma)
   * Para la sección de testimonios en Home - Incluye tanto clientes como profesionales
   */
  async getFeaturedTestimonials(req, res) {
    try {
      const { limit = 12 } = req.query;
      const Review = (await import('../models/Service/Review.js')).default;
      const ClientReview = (await import('../models/Service/ClientReview.js')).default;
      const Booking = (await import('../models/Service/Booking.js')).default;

      const lim = Math.min(Math.max(parseInt(limit) || 12, 1), 30);

      // 1. Obtener reseñas de CLIENTES con fotos en la reseña
      const reviewsWithPhotos = await Review.find({
        status: 'active',
        'rating.overall': { $gte: 4 },
        'review.photos': { $exists: true, $ne: [] }
      })
      .sort({ 'rating.overall': -1, createdAt: -1 })
      .limit(lim)
      .select({
        'rating.overall': 1,
        'review.title': 1,
        'review.comment': 1,
        'review.photos': 1,
        'translations': 1,
        'originalLanguage': 1,
        'platformFeedback': 1,
        'booking': 1,
        createdAt: 1
      })
      .populate('client', 'profile.firstName profile.avatar')
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .lean();

      // 2. Obtener reseñas de CLIENTES con feedback de plataforma
      const clientPlatformTestimonials = await Review.find({
        status: 'active',
        'platformFeedback.rating': { $gte: 4 },
        'platformFeedback.comment': { $exists: true, $ne: '' }
      })
      .sort({ 'platformFeedback.rating': -1, createdAt: -1 })
      .limit(Math.floor(lim / 2))
      .select({
        'rating.overall': 1,
        'review.title': 1,
        'review.comment': 1,
        'review.photos': 1,
        'translations': 1,
        'originalLanguage': 1,
        'platformFeedback': 1,
        'booking': 1,
        createdAt: 1
      })
      .populate('client', 'profile.firstName profile.avatar')
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .lean();

      // 3. Obtener reseñas de PROFESIONALES (ClientReview) con feedback de plataforma
      const providerPlatformTestimonials = await ClientReview.find({
        'platformFeedback.rating': { $gte: 4 },
        'platformFeedback.comment': { $exists: true, $ne: '' }
      })
      .sort({ 'platformFeedback.rating': -1, createdAt: -1 })
      .limit(Math.floor(lim / 2))
      .select({
        'rating.overall': 1,
        'rating.categories': 1,
        'comment': 1,
        'platformFeedback': 1,
        'translations': 1,
        'originalLanguage': 1,
        createdAt: 1
      })
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .populate('client', 'profile.firstName profile.avatar')
      .lean();

      // 3.5. Obtener reseñas normales de clientes (sin fotos ni platformFeedback) con alta calificación
      const regularClientReviews = await Review.find({
        status: 'active',
        'rating.overall': { $gte: 4 },
        'review.comment': { $exists: true, $ne: '' }
      })
      .sort({ 'rating.overall': -1, createdAt: -1 })
      .limit(lim)
      .select({
        'rating.overall': 1,
        'rating.categories': 1,
        'review.title': 1,
        'review.comment': 1,
        'review.photos': 1,
        'translations': 1,
        'originalLanguage': 1,
        'platformFeedback': 1,
        'booking': 1,
        createdAt: 1
      })
      .populate('client', 'profile.firstName profile.avatar')
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .lean();

      // 4. Obtener bookings con evidencias (fotos del trabajo) que tengan reviews
      const bookingIds = [...reviewsWithPhotos, ...clientPlatformTestimonials]
        .map(r => r.booking)
        .filter(Boolean);
      
      const bookingsWithEvidence = await Booking.find({
        _id: { $in: bookingIds },
        $or: [
          { 'serviceEvidence.before.0': { $exists: true } },
          { 'serviceEvidence.during.0': { $exists: true } },
          { 'serviceEvidence.after.0': { $exists: true } }
        ]
      })
      .select('_id serviceEvidence')
      .lean();

      // Crear mapa de evidencias por booking
      const evidenceMap = new Map();
      bookingsWithEvidence.forEach(b => {
        const allPhotos = [
          ...(b.serviceEvidence?.before || []),
          ...(b.serviceEvidence?.during || []),
          ...(b.serviceEvidence?.after || [])
        ].filter(p => p.url);
        if (allPhotos.length > 0) {
          evidenceMap.set(b._id.toString(), allPhotos);
        }
      });

      // 5. También buscar reviews sin fotos pero cuyos bookings SÍ tienen evidencias
      const reviewsWithBookingEvidence = await Review.find({
        status: 'active',
        'rating.overall': { $gte: 4 },
        booking: { $in: Array.from(evidenceMap.keys()).map(id => new mongoose.Types.ObjectId(id)) },
        $or: [
          { 'review.photos': { $exists: false } },
          { 'review.photos': { $size: 0 } }
        ]
      })
      .sort({ 'rating.overall': -1, createdAt: -1 })
      .limit(Math.floor(lim / 2))
      .select({
        'rating.overall': 1,
        'review.title': 1,
        'review.comment': 1,
        'translations': 1,
        'originalLanguage': 1,
        'platformFeedback': 1,
        'booking': 1,
        createdAt: 1
      })
      .populate('client', 'profile.firstName profile.avatar')
      .populate('provider', 'providerProfile.businessName providerProfile.services profile.firstName profile.avatar')
      .lean();

      // Combinar y deduplicar todos los testimonios
      const allTestimonialsMap = new Map();
      
      // Agregar reseñas de clientes con fotos en review
      reviewsWithPhotos.forEach(r => {
        const bookingEvidence = r.booking ? evidenceMap.get(r.booking.toString()) : null;
        allTestimonialsMap.set(r._id.toString(), {
          ...r,
          userRole: 'client',
          type: 'work_photo',
          providerName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
          providerAvatar: r.provider?.profile?.avatar || null,
          providerServices: r.provider?.providerProfile?.services || [],
          userName: r.client?.profile?.firstName || 'Cliente',
          userAvatar: r.client?.profile?.avatar || null,
          // Combinar fotos de review + evidencias del booking
          allPhotos: [
            ...(r.review?.photos || []),
            ...(bookingEvidence || [])
          ],
          hasPlatformFeedback: !!(r.platformFeedback?.rating || r.platformFeedback?.comment)
        });
      });

      // Agregar reseñas con evidencias del booking (sin fotos en review)
      reviewsWithBookingEvidence.forEach(r => {
        if (allTestimonialsMap.has(r._id.toString())) return;
        const bookingEvidence = r.booking ? evidenceMap.get(r.booking.toString()) : null;
        if (!bookingEvidence || bookingEvidence.length === 0) return;
        
        allTestimonialsMap.set(r._id.toString(), {
          ...r,
          userRole: 'client',
          type: 'work_photo',
          providerName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
          providerAvatar: r.provider?.profile?.avatar || null,
          providerServices: r.provider?.providerProfile?.services || [],
          userName: r.client?.profile?.firstName || 'Cliente',
          userAvatar: r.client?.profile?.avatar || null,
          allPhotos: bookingEvidence,
          hasPlatformFeedback: !!(r.platformFeedback?.rating || r.platformFeedback?.comment)
        });
      });

      // Agregar testimonios de plataforma de clientes
      clientPlatformTestimonials.forEach(r => {
        const existing = allTestimonialsMap.get(r._id.toString());
        if (existing) {
          existing.hasPlatformFeedback = true;
        } else {
          const bookingEvidence = r.booking ? evidenceMap.get(r.booking.toString()) : null;
          allTestimonialsMap.set(r._id.toString(), {
            ...r,
            userRole: 'client',
            type: 'platform_feedback',
            providerName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
            providerAvatar: r.provider?.profile?.avatar || null,
            providerServices: r.provider?.providerProfile?.services || [],
            userName: r.client?.profile?.firstName || 'Cliente',
            userAvatar: r.client?.profile?.avatar || null,
            allPhotos: [
              ...(r.review?.photos || []),
              ...(bookingEvidence || [])
            ],
            hasPlatformFeedback: true
          });
        }
      });

      // Agregar testimonios de plataforma de PROFESIONALES
      providerPlatformTestimonials.forEach(r => {
        // Usar ID diferente para evitar colisiones con reviews normales
        const uniqueId = `provider_${r._id.toString()}`;
        allTestimonialsMap.set(uniqueId, {
          _id: r._id,
          userRole: 'provider',
          type: 'platform_feedback',
          rating: r.rating,
          review: { comment: r.comment },
          translations: r.translations,
          originalLanguage: r.originalLanguage,
          platformFeedback: r.platformFeedback,
          createdAt: r.createdAt,
          // Para profesionales, el "userName" es el profesional
          userName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
          userAvatar: r.provider?.profile?.avatar || null,
          providerServices: r.provider?.providerProfile?.services || [],
          // Info del cliente que atendió
          clientName: r.client?.profile?.firstName || 'Cliente',
          clientAvatar: r.client?.profile?.avatar || null,
          allPhotos: [],
          hasPlatformFeedback: true
        });
      });

      // Agregar reseñas regulares de clientes (sin fotos ni platformFeedback pero con buen rating)
      regularClientReviews.forEach(r => {
        if (allTestimonialsMap.has(r._id.toString())) return; // Evitar duplicados
        const bookingEvidence = r.booking ? evidenceMap.get(r.booking.toString()) : null;
        allTestimonialsMap.set(r._id.toString(), {
          ...r,
          userRole: 'client',
          type: 'service_review',
          providerName: r.provider?.providerProfile?.businessName || r.provider?.profile?.firstName || 'Profesional',
          providerAvatar: r.provider?.profile?.avatar || null,
          providerServices: r.provider?.providerProfile?.services || [],
          userName: r.client?.profile?.firstName || 'Cliente',
          userAvatar: r.client?.profile?.avatar || null,
          allPhotos: [
            ...(r.review?.photos || []),
            ...(bookingEvidence || [])
          ],
          hasPlatformFeedback: !!(r.platformFeedback?.rating || r.platformFeedback?.comment)
        });
      });

      const testimonials = Array.from(allTestimonialsMap.values())
        .sort((a, b) => {
          // Priorizar los que tienen fotos
          if (a.allPhotos?.length && !b.allPhotos?.length) return -1;
          if (!a.allPhotos?.length && b.allPhotos?.length) return 1;
          // Priorizar los que tienen platformFeedback
          if (a.hasPlatformFeedback && !b.hasPlatformFeedback) return -1;
          if (!a.hasPlatformFeedback && b.hasPlatformFeedback) return 1;
          // Luego por rating
          return (b.rating?.overall || b.platformFeedback?.rating || 0) - (a.rating?.overall || a.platformFeedback?.rating || 0);
        })
        .slice(0, lim);

      // Extraer fotos para la galería
      const workPhotos = [];
      testimonials.forEach(t => {
        if (t.allPhotos?.length) {
          t.allPhotos.slice(0, 4).forEach(photo => {
            workPhotos.push({
              url: photo.url,
              cloudinaryId: photo.cloudinaryId,
              reviewId: t._id,
              rating: t.rating?.overall || t.platformFeedback?.rating,
              providerName: t.userRole === 'client' ? t.providerName : t.userName,
              userName: t.userName,
              userRole: t.userRole,
              category: t.providerServices?.[0]?.category || 'Otro'
            });
          });
        }
      });

      console.log(`✅ Returning ${testimonials.length} testimonials (clients + providers) with ${workPhotos.length} work photos`);

      res.json({
        success: true,
        data: { 
          testimonials,
          workPhotos: workPhotos.slice(0, 20),
          total: testimonials.length
        }
      });
    } catch (error) {
      console.error('GuestController - getFeaturedTestimonials error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get testimonials'
      });
    }
  }

  /**
   * Obtener servicios activos (categorías con proveedores)
   */
  async getActiveServices(req, res) {
    try {
      const Provider = (await import('../models/User/Provider.js')).default;
      const { SERVICE_CATEGORIES_WITH_DESCRIPTION } = await import('../config/categories.js');

      // Obtener categorías con proveedores activos - consulta más flexible
      const providers = await Provider.find({
        isActive: true,
        'providerProfile.services': { $exists: true, $ne: [] }
      }).select('providerProfile.services subscription.status').lean();

      console.log(`📊 Found ${providers.length} providers in database`);

      // Total de proveedores únicos
      const totalUniqueProviders = providers.length;

      // Contar proveedores por categoría (incluir todos, incluso sin suscripción activa por ahora)
      const categoryCounts = {};
      providers.forEach(p => {
        if (p.providerProfile?.services && Array.isArray(p.providerProfile.services)) {
          p.providerProfile.services.forEach(s => {
            if (s.category) {
              categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
            }
          });
        }
      });

      console.log('📋 Category counts:', categoryCounts);

      // Filtrar categorías con descripción y agregar conteo
      const services = SERVICE_CATEGORIES_WITH_DESCRIPTION
        .filter(cat => categoryCounts[cat.value] > 0)
        .map(cat => ({
          category: cat.value,
          description: cat.description,
          providerCount: categoryCounts[cat.value]
        }))
        .sort((a, b) => b.providerCount - a.providerCount); // Ordenar por cantidad de proveedores

      console.log(`✅ Returning ${services.length} active service categories with ${totalUniqueProviders} unique providers`);

      res.json({
        success: true,
        data: { 
          services,
          totalUniqueProviders 
        }
      });
    } catch (error) {
      console.error('GuestController - getActiveServices error:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({
        success: false,
        message: 'Failed to get active services'
      });
    }
  }

  /**
   * Obtener datos de sesión guest
   */
  async getGuestSession(req, res) {
    try {
      if (!req.session) {
        return res.status(400).json({
          success: false,
          message: 'No active session'
        });
      }

      const session = await Session.findById(req.session._id)
        .populate('guestData.serviceRequests');

      res.json({
        success: true,
        data: {
          session: {
            sessionId: session.sessionId,
            userType: session.userType,
            guestData: session.guestData,
            lastActivity: session.lastActivity
          }
        }
      });
    } catch (error) {
      console.error('GuestController - getGuestSession error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get session data'
      });
    }
  }

  /**
   * Actualizar datos de contacto temporal para guest
   */
  async updateGuestContact(req, res) {
    try {
      const { email, phone, firstName, lastName } = req.body;

      if (!req.session) {
        return res.status(400).json({
          success: false,
          message: 'No active session'
        });
      }

      const session = await Session.findByIdAndUpdate(
        req.session._id,
        {
          $set: {
            'guestData.email': email,
            'guestData.phone': phone,
            'guestData.temporaryContact': {
              firstName,
              lastName,
              phone
            }
          }
        },
        { new: true }
      );

      res.json({
        success: true,
        message: 'Guest contact updated successfully',
        data: {
          guestData: session.guestData
        }
      });
    } catch (error) {
      console.error('GuestController - updateGuestContact error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update guest contact'
      });
    }
  }

  /**
   * Vincular service request a sesión guest
   */
  async linkServiceRequestToGuest(req, res) {
    try {
      const { serviceRequestId } = req.body;

      if (!req.session) {
        return res.status(400).json({
          success: false,
          message: 'No active session'
        });
      }

      const session = await Session.findByIdAndUpdate(
        req.session._id,
        {
          $addToSet: {
            'guestData.serviceRequests': serviceRequestId
          }
        },
        { new: true }
      );

      // También actualizar el service request con el sessionId
      await ServiceRequest.findByIdAndUpdate(serviceRequestId, {
        $set: { guestSessionId: req.session.sessionId }
      });

      res.json({
        success: true,
        message: 'Service request linked to guest session',
        data: {
          linkedRequests: session.guestData.serviceRequests
        }
      });
    } catch (error) {
      console.error('GuestController - linkServiceRequestToGuest error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to link service request'
      });
    }
  }

  /**
   * Migrar datos de guest a usuario registrado
   */
  async migrateGuestToUser(req, res) {
    try {
      const { sessionId, targetUserId } = req.body;

      const session = await Session.findOne({ sessionId });
      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Guest session not found'
        });
      }

      // Transferir service requests
      if (session.guestData.serviceRequests?.length > 0) {
        await ServiceRequest.updateMany(
          {
            _id: { $in: session.guestData.serviceRequests },
            client: { $exists: false }
          },
          {
            $set: { 
              client: targetUserId,
              guestSessionId: null 
            }
          }
        );

        // Actualizar historial del cliente
        await Client.findByIdAndUpdate(targetUserId, {
          $addToSet: {
            'clientProfile.serviceHistory': {
              $each: session.guestData.serviceRequests
            }
          }
        });
      }

      // Eliminar sesión guest
      await Session.deleteOne({ _id: session._id });

      res.json({
        success: true,
        message: 'Guest data migrated successfully',
        data: {
          migratedRequests: session.guestData.serviceRequests?.length || 0
        }
      });
    } catch (error) {
      console.error('GuestController - migrateGuestToUser error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to migrate guest data'
      });
    }
  }
}

const guestController = new GuestController();
export default guestController;