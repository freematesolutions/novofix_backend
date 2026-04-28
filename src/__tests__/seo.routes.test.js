/**
 * SEO Routes — Smoke Tests
 *
 * Verifies that public SEO endpoints (sitemap.xml, robots.txt) are exposed
 * at the root path (NOT under /api), are accessible without authentication,
 * return well-formed content with the correct Content-Type, and include the
 * expected URLs / hreflang alternates.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set canonical site URL BEFORE importing the app so the SEO controller
// uses a stable, predictable origin in assertions.
process.env.PUBLIC_SITE_URL = 'https://novofix.test';
process.env.SKIP_SESSION_MIDDLEWARE = '1';

let app;

beforeAll(async () => {
  ({ default: app } = await import('../../app.js'));
});

afterAll(async () => {
  delete process.env.PUBLIC_SITE_URL;
});

describe('GET /seo/sitemap.xml', () => {
  it('returns 200 with application/xml content-type', async () => {
    const res = await request(app).get('/seo/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
  });

  it('contains an XML declaration and urlset root element', async () => {
    const res = await request(app).get('/seo/sitemap.xml');
    expect(res.text).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(res.text).toContain('<urlset');
    expect(res.text).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(res.text).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(res.text).toContain('</urlset>');
  });

  it('uses the configured PUBLIC_SITE_URL as canonical origin', async () => {
    const res = await request(app).get('/seo/sitemap.xml');
    expect(res.text).toContain('<loc>https://novofix.test</loc>');
    expect(res.text).toContain('<loc>https://novofix.test/sobre-nosotros</loc>');
    expect(res.text).toContain('<loc>https://novofix.test/unete</loc>');
    expect(res.text).toContain('<loc>https://novofix.test/terminos</loc>');
    expect(res.text).toContain('<loc>https://novofix.test/privacidad</loc>');
  });

  it('includes hreflang alternates for ES, EN and x-default', async () => {
    const res = await request(app).get('/seo/sitemap.xml');
    expect(res.text).toMatch(/hreflang="es"/);
    expect(res.text).toMatch(/hreflang="en"/);
    expect(res.text).toMatch(/hreflang="x-default"/);
  });

  it('includes per-category SEO landings under /categorias/:slug', async () => {
    const res = await request(app).get('/seo/sitemap.xml');
    // Slugs are deterministic (slugifyCategory): no accents, lowercase, dashes
    expect(res.text).toContain('<loc>https://novofix.test/categorias/plomeria</loc>');
    expect(res.text).toContain('<loc>https://novofix.test/categorias/electricidad</loc>');
    expect(res.text).toContain('<loc>https://novofix.test/categorias/control-de-plagas</loc>');
    expect(res.text).toContain('<loc>https://novofix.test/categorias/pergolas</loc>');
  });

  it('serves cached responses on subsequent calls (X-SEO-Cache: HIT)', async () => {
    await request(app).get('/seo/sitemap.xml'); // warm
    const res = await request(app).get('/seo/sitemap.xml');
    expect(res.headers['x-seo-cache']).toBe('HIT');
  });
});

describe('GET /seo/robots.txt', () => {
  it('returns 200 with text/plain content-type', async () => {
    const res = await request(app).get('/seo/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('declares User-agent: * and Allow: /', async () => {
    const res = await request(app).get('/seo/robots.txt');
    expect(res.text).toMatch(/User-agent:\s*\*/);
    expect(res.text).toMatch(/Allow:\s*\//);
  });

  it('disallows private/authenticated routes', async () => {
    const res = await request(app).get('/seo/robots.txt');
    expect(res.text).toMatch(/Disallow:\s*\/login/);
    expect(res.text).toMatch(/Disallow:\s*\/admin/);
    expect(res.text).toMatch(/Disallow:\s*\/perfil/);
    expect(res.text).toMatch(/Disallow:\s*\/mis-solicitudes/);
  });

  it('points to an absolute Sitemap URL using PUBLIC_SITE_URL', async () => {
    const res = await request(app).get('/seo/robots.txt');
    expect(res.text).toContain('Sitemap: https://novofix.test/sitemap.xml');
  });
});
