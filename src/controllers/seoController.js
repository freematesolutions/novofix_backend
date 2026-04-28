// server/src/controllers/seoController.js
//
// Controllers that produce SEO artifacts consumed by search engine crawlers:
//   - GET /seo/sitemap.xml  → XML sitemap (https://www.sitemaps.org/protocol.html)
//                             with hreflang alternates for ES/EN.
//   - GET /seo/robots.txt   → robots.txt with Disallow for private routes and
//                             an absolute Sitemap: pointer.
//
// Why generate dynamically (instead of shipping static files in /public)?
//  · We can include data-driven URLs (active provider public profiles,
//    category landings, blog posts) in future phases without a redeploy.
//  · We can serve the EXACT canonical origin (PUBLIC_SITE_URL) regardless of
//    where the SPA is hosted (Vercel/Render/local), keeping URLs consistent.
//
// Performance: in-memory cache (TTL) avoids hammering the database on every
// crawler request. Vercel/Render edge caching adds another layer (see vercel.json
// and the s-maxage Cache-Control header set below).

import Provider from '../models/User/Provider.js';
import { SERVICE_CATEGORIES, slugifyCategory } from '../config/categories.js';

// Maximum number of public provider profiles included in the sitemap.
// Search engines accept up to 50,000 URLs per file, but we cap to keep the
// payload light and the response cache cheap. Increase / split into a
// sitemap index when this becomes the limiting factor.
const MAX_PROVIDER_ENTRIES = 1000;

// ─── Configuration ───────────────────────────────────────────────────────────

/** Absolute public origin of the SPA. Falls back to FRONTEND_URL or localhost. */
const SITE_URL = (
  process.env.PUBLIC_SITE_URL ||
  process.env.FRONTEND_URL ||
  'http://localhost:5173'
).replace(/\/$/, '');

const SUPPORTED_LANGS = ['es', 'en'];

/** Static, indexable public pages of the SPA (Phase 3). */
const STATIC_ROUTES = [
  { path: '/',                priority: 1.0, changefreq: 'daily' },
  { path: '/sobre-nosotros',  priority: 0.7, changefreq: 'monthly' },
  { path: '/unete',           priority: 0.8, changefreq: 'weekly' },
  { path: '/terminos',        priority: 0.3, changefreq: 'yearly' },
  { path: '/privacidad',      priority: 0.3, changefreq: 'yearly' },
];

/**
 * Routes that MUST never be indexed (private/authenticated areas).
 * Mirrors client/public/robots.txt + the noindex meta tags emitted by RouteSeo.
 */
const DISALLOWED_ROUTES = [
  '/login',
  '/registrarse',
  '/registro-proveedor',
  '/verificar-email',
  '/olvide-contrasena',
  '/restablecer-contrasena',
  '/perfil',
  '/mensajes',
  '/mis-mensajes',
  '/calendario',
  '/referidos',
  '/plan',
  '/portafolio',
  '/resenas',
  '/servicios',
  '/empleos',
  '/mis-solicitudes',
  '/mis-resenas',
  '/reservas',
  '/notificaciones',
  '/payment',
  '/admin',
  '/provider/onboarding',
];

// ─── Tiny in-memory cache ────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key → { value, expiresAt }

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escape XML special characters in a URL/text. */
function xmlEscape(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build an absolute URL from a path. The root path "/" is normalized to the
 *  bare origin (no trailing slash) to match the canonical URL emitted by the
 *  client <Seo /> via buildCanonical(). This keeps sitemap, og:url, canonical
 *  and analytics aligned. */
function abs(path) {
  if (!path || path === '/') return SITE_URL;
  return `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Render a single <url> entry with hreflang alternates for ES/EN.
 * Each alternate uses the `?lng=` query param convention (matches the one
 * emitted by the client <Seo /> component).
 */
function urlEntry({ path, lastmod, priority, changefreq }) {
  const loc = abs(path);
  const alternates = SUPPORTED_LANGS.map(
    (l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(`${loc}?lng=${l}`)}"/>`,
  ).join('\n');
  const lm = lastmod ? `    <lastmod>${xmlEscape(lastmod)}</lastmod>\n` : '';
  const cf = changefreq ? `    <changefreq>${changefreq}</changefreq>\n` : '';
  const pr = typeof priority === 'number' ? `    <priority>${priority.toFixed(1)}</priority>\n` : '';
  return (
    `  <url>\n` +
    `    <loc>${xmlEscape(loc)}</loc>\n` +
    `${lm}${cf}${pr}` +
    `${alternates}\n` +
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(loc)}"/>\n` +
    `  </url>`
  );
}

/**
 * Fetch active, indexable providers and emit one sitemap entry per public
 * profile (`/profesional/:id`). Only providers that meet ALL of the following
 * criteria are exposed to crawlers:
 *   - `emailVerified: true`              → real, validated identity
 *   - `isActive: true`                   → not suspended/banned
 *   - At least one entry in `providerProfile.services` with a category
 *
 * Defensive: any DB / serialization failure degrades gracefully to an empty
 * list (sitemap still serves static + category routes; never returns 500).
 */
async function fetchPublicProviderEntries() {
  try {
    const docs = await Provider.find({
      emailVerified: true,
      isActive: true,
      'providerProfile.services.0.category': { $exists: true, $ne: '' },
    })
      .select('_id updatedAt')
      .sort({ updatedAt: -1 })
      .limit(MAX_PROVIDER_ENTRIES)
      .lean();

    return docs.map((d) => ({
      path: `/profesional/${d._id}`,
      lastmod: (d.updatedAt || new Date()).toISOString(),
      priority: 0.6,
      changefreq: 'weekly',
    }));
  } catch (err) {
    console.warn('[seo] Could not load public providers for sitemap:', err.message);
    return [];
  }
}

/**
 * Static, SEO-friendly category landings: one URL per service category.
 * Each landing renders the category description, top providers and JSON-LD
 * (CollectionPage + ItemList) on the SPA side. The slug is deterministic
 * (`slugifyCategory`) and shared with the frontend so URLs round-trip cleanly.
 */
function buildCategoryEntries(now) {
  return SERVICE_CATEGORIES.map((cat) => ({
    path: `/categorias/${slugifyCategory(cat)}`,
    lastmod: now,
    priority: 0.8,
    changefreq: 'weekly',
  }));
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/** GET /seo/sitemap.xml */
export async function getSitemap(req, res, next) {
  try {
    const cached = getCached('sitemap');
    if (cached) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600');
      res.setHeader('X-SEO-Cache', 'HIT');
      return res.send(cached);
    }

    const now = new Date().toISOString();
    const dynamicEntries = await fetchPublicProviderEntries();
    const categoryEntries = buildCategoryEntries(now);
    const allEntries = [
      ...STATIC_ROUTES.map((r) => ({ ...r, lastmod: now })),
      ...categoryEntries,
      ...dynamicEntries,
    ];

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
      `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
      allEntries.map(urlEntry).join('\n') +
      `\n</urlset>\n`;

    setCached('sitemap', xml);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600');
    res.setHeader('X-SEO-Cache', 'MISS');
    res.send(xml);
  } catch (err) {
    next(err);
  }
}

/** GET /seo/robots.txt */
export function getRobots(req, res) {
  const lines = [
    '# robots.txt for NovoFix (dynamically generated)',
    `# Origin: ${SITE_URL}`,
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# Private / authenticated areas',
    ...DISALLOWED_ROUTES.map((r) => `Disallow: ${r}`),
    '',
    '# Tracking query params',
    'Disallow: /*?*utm_',
    'Disallow: /*?*ref=',
    '',
    `Sitemap: ${abs('/sitemap.xml')}`,
    '',
  ];
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.send(lines.join('\n'));
}

/** Test/admin helper: invalidate the in-memory cache. */
export function invalidateSeoCache() {
  cache.clear();
}
