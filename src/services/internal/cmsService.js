// services/internal/cmsService.js
//
// Servicio interno del CMS:
//   - Renderiza Markdown a HTML con `marked`.
//   - Sanitiza con `sanitize-html` usando un allowlist estricto.
//     Se permiten solo etiquetas necesarias para textos legales/editoriales
//     (encabezados, párrafos, listas, énfasis, enlaces y citas).
//     Se bloquean: <script>, <style>, <iframe>, on*= handlers, javascript: URIs.
//   - Cachea el payload público en Redis (TTL configurable) y proporciona
//     invalidación por clave tras una publicación admin.

import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
import redisClient from '../../config/redis.js';

const DEFAULT_TTL_SECONDS = Number(process.env.REDIS_CACHE_TTL_CMS) || 60;

// Allowlist estricto: textos editoriales y FAQ no necesitan más que esto.
const SANITIZE_OPTIONS = Object.freeze({
  allowedTags: [
    'p', 'br', 'hr',
    'h2', 'h3', 'h4',
    'ul', 'ol', 'li',
    'strong', 'em', 'u', 's',
    'a', 'blockquote',
    'code', 'pre',
    'span'
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    span: ['class']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { a: ['http', 'https', 'mailto', 'tel'] },
  allowProtocolRelative: false,
  // Forzar rel="noopener noreferrer nofollow" + target="_blank" en enlaces externos
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href || '';
      const isExternal = /^https?:\/\//i.test(href);
      const out = { ...attribs };
      if (isExternal) {
        out.target = '_blank';
        out.rel = 'noopener noreferrer nofollow';
      }
      return { tagName: 'a', attribs: out };
    }
  },
  disallowedTagsMode: 'discard',
  enforceHtmlBoundary: true
});

// Configuración de marked: GFM con headers seguros (los h1 originales se degradan
// a h2 vía allowlist) y sin HTML embebido (lo que se cuele se purga después).
marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false
});

/**
 * Convierte Markdown crudo a HTML seguro.
 * Idempotente: si recibe ya HTML simple lo limpia igualmente.
 */
export function renderMarkdownSafe(markdown = '') {
  if (!markdown || typeof markdown !== 'string') return '';
  const rawHtml = marked.parse(markdown);
  return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}

/**
 * Sanitiza HTML ya existente (sin pasar por marked). Útil cuando el admin pega
 * HTML directamente o cuando se quiere normalizar contenido importado.
 */
export function sanitizeHtmlStrict(html = '') {
  if (!html || typeof html !== 'string') return '';
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

const cacheKey = (key, locale) => `cms:content:${key}:${locale}`;
const faqCacheKey = (locale, category = 'all') => `cms:faq:${category}:${locale}`;

export async function getCachedContent(key, locale) {
  try {
    return await redisClient.get(cacheKey(key, locale));
  } catch {
    return null;
  }
}

export async function setCachedContent(key, locale, payload, ttl = DEFAULT_TTL_SECONDS) {
  try {
    await redisClient.set(cacheKey(key, locale), payload, { EX: ttl });
  } catch {
    /* noop — cache es best-effort */
  }
}

export async function invalidateContentCache(key) {
  try {
    await Promise.all([
      redisClient.del(cacheKey(key, 'es')),
      redisClient.del(cacheKey(key, 'en'))
    ]);
  } catch {
    /* noop */
  }
}

export async function getCachedFaq(locale, category = 'all') {
  try {
    return await redisClient.get(faqCacheKey(locale, category));
  } catch {
    return null;
  }
}

export async function setCachedFaq(locale, category, payload, ttl = DEFAULT_TTL_SECONDS) {
  try {
    await redisClient.set(faqCacheKey(locale, category), payload, { EX: ttl });
  } catch {
    /* noop */
  }
}

export async function invalidateFaqCache() {
  // Invalidamos todas las combinaciones conocidas. Como el set de categorías
  // es pequeño y fijo (4-5), enumerar es más rápido que un SCAN.
  const categories = ['all', 'general', 'client', 'provider', 'payment', 'account'];
  const ops = [];
  for (const loc of ['es', 'en']) {
    for (const cat of categories) {
      ops.push(redisClient.del(faqCacheKey(loc, cat)));
    }
  }
  try {
    await Promise.all(ops);
  } catch {
    /* noop */
  }
}

export default {
  renderMarkdownSafe,
  sanitizeHtmlStrict,
  getCachedContent,
  setCachedContent,
  invalidateContentCache,
  getCachedFaq,
  setCachedFaq,
  invalidateFaqCache
};
