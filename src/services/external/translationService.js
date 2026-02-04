// services/external/translationService.js
// Servicio de traducción usando MyMemory API (gratis, sin API key, 1000 palabras/día)

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const SUPPORTED_LANGUAGES = ['es', 'en'];
const DEFAULT_TIMEOUT = 10000; // 10 segundos
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas en ms
const MAX_CACHE_SIZE = 1000; // Máximo de entradas en cache

// Cache en memoria para evitar llamadas repetidas a la API
const translationCache = new Map();

/**
 * Genera una clave única para el cache
 */
function getCacheKey(text, sourceLang, targetLang) {
  return `${sourceLang}|${targetLang}|${text.substring(0, 100)}`;
}

/**
 * Limpia entradas antiguas del cache
 */
function cleanupCache() {
  const now = Date.now();
  for (const [key, entry] of translationCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      translationCache.delete(key);
    }
  }
  // Si aún excede el límite, eliminar las más antiguas
  if (translationCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(translationCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    for (const [key] of toDelete) {
      translationCache.delete(key);
    }
  }
}

/**
 * Traduce un texto de un idioma a otro usando MyMemory API
 * @param {string} text - Texto a traducir
 * @param {string} sourceLang - Idioma origen ('es', 'en')
 * @param {string} targetLang - Idioma destino ('es', 'en')
 * @returns {Promise<string|null>} - Texto traducido o null si falla
 */
async function translateText(text, sourceLang, targetLang) {
  // Si no hay texto o el idioma es el mismo, retornar original
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return text;
  }
  
  if (sourceLang === targetLang) {
    return text;
  }

  // Validar idiomas soportados
  if (!SUPPORTED_LANGUAGES.includes(targetLang)) {
    console.warn(`[TranslationService] Unsupported target language: ${targetLang}`);
    return null;
  }

  // Verificar cache primero
  const cacheKey = getCacheKey(text, sourceLang, targetLang);
  const cachedEntry = translationCache.get(cacheKey);
  if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL)) {
    return cachedEntry.translated;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    // MyMemory usa formato de langpair: "es|en"
    const langPair = `${sourceLang}|${targetLang}`;
    const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${langPair}`;

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[TranslationService] API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    
    // MyMemory retorna { responseStatus: 200, responseData: { translatedText: "..." } }
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      let translated = data.responseData.translatedText;
      // MyMemory a veces retorna en mayúsculas, normalizamos
      if (translated === translated.toUpperCase() && text !== text.toUpperCase()) {
        translated = translated.charAt(0).toUpperCase() + translated.slice(1).toLowerCase();
      }
      
      // Guardar en cache
      translationCache.set(cacheKey, {
        translated,
        timestamp: Date.now()
      });
      
      // Limpiar cache periódicamente
      if (translationCache.size > MAX_CACHE_SIZE * 0.9) {
        cleanupCache();
      }
      
      return translated;
    }

    console.warn('[TranslationService] No translatedText in response:', data);
    return null;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('[TranslationService] Request timeout');
    } else {
      console.warn('[TranslationService] Translation failed:', error.message);
    }
    return null;
  }
}

/**
 * Genera traducciones para un objeto con campos de texto
 * @param {Object} fields - Objeto con campos a traducir { fieldName: textValue }
 * @param {string} originalLang - Idioma original del contenido ('es' o 'en')
 * @returns {Promise<Object>} - Objeto con traducciones { es: {...}, en: {...} }
 */
async function generateTranslations(fields, originalLang = 'es') {
  const translations = {
    es: {},
    en: {}
  };

  // El idioma original ya lo tenemos
  for (const [fieldName, text] of Object.entries(fields)) {
    if (text && typeof text === 'string') {
      translations[originalLang][fieldName] = text;
    }
  }

  // Determinar idioma destino
  const targetLang = originalLang === 'es' ? 'en' : 'es';

  // Traducir cada campo al idioma destino
  const translationPromises = Object.entries(fields).map(async ([fieldName, text]) => {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return { fieldName, translated: text };
    }

    const translated = await translateText(text, originalLang, targetLang);
    return { fieldName, translated: translated || text }; // Fallback al original si falla
  });

  const results = await Promise.all(translationPromises);

  for (const { fieldName, translated } of results) {
    translations[targetLang][fieldName] = translated;
  }

  return translations;
}

/**
 * Detecta el idioma de un texto (heurística simple basada en palabras comunes)
 * @param {string} text - Texto a analizar
 * @returns {string} - 'es' o 'en'
 */
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'es';

  const spanishIndicators = [
    'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'en', 'es', 'por', 'para',
    'con', 'se', 'su', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le', 'ya', 'o', 'este',
    'sí', 'porque', 'esta', 'son', 'entre', 'cuando', 'muy', 'sin', 'sobre', 'ser', 'tiene',
    'también', 'fue', 'había', 'todo', 'nos', 'ni', 'parte', 'tiene', 'tiempo', 'mucho',
    'gracias', 'hola', 'necesito', 'quiero', 'tengo', 'puedo', 'favor', 'urgente', 'problema'
  ];

  const englishIndicators = [
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
    'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'must', 'shall', 'can', 'need', 'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by',
    'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above',
    'hello', 'please', 'thank', 'thanks', 'help', 'want', 'need', 'urgent', 'problem'
  ];

  const words = text.toLowerCase().split(/\s+/);
  let spanishScore = 0;
  let englishScore = 0;

  for (const word of words) {
    const cleanWord = word.replace(/[^a-záéíóúüñ]/gi, '');
    if (spanishIndicators.includes(cleanWord)) spanishScore++;
    if (englishIndicators.includes(cleanWord)) englishScore++;
  }

  // Si hay acentos españoles, probablemente es español
  if (/[áéíóúüñ]/i.test(text)) spanishScore += 2;

  return englishScore > spanishScore ? 'en' : 'es';
}

/**
 * Obtiene el texto traducido según el idioma solicitado
 * @param {Object} translations - Objeto con traducciones { es: {...}, en: {...} }
 * @param {string} fieldName - Nombre del campo
 * @param {string} lang - Idioma deseado ('es' o 'en')
 * @param {string} fallback - Valor fallback si no existe traducción
 * @returns {string} - Texto en el idioma solicitado o fallback
 */
function getTranslatedField(translations, fieldName, lang, fallback = '') {
  if (!translations || typeof translations !== 'object') {
    return fallback;
  }

  // Intentar obtener en el idioma solicitado
  if (translations[lang] && translations[lang][fieldName]) {
    return translations[lang][fieldName];
  }

  // Fallback al otro idioma
  const otherLang = lang === 'es' ? 'en' : 'es';
  if (translations[otherLang] && translations[otherLang][fieldName]) {
    return translations[otherLang][fieldName];
  }

  return fallback;
}

/**
 * Limpia el cache de traducciones (útil para testing)
 */
function clearCache() {
  translationCache.clear();
}

/**
 * Obtiene estadísticas del cache
 */
function getCacheStats() {
  return {
    size: translationCache.size,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL
  };
}

export default {
  translateText,
  generateTranslations,
  detectLanguage,
  getTranslatedField,
  clearCache,
  getCacheStats,
  SUPPORTED_LANGUAGES
};
