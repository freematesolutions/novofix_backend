/**
 * CMS Routes — Integration Tests
 *
 * Cubre:
 *  - Lectura pública sin auth (terms, faq) y caché HTTP
 *  - 404 cuando un contenido no fue sembrado
 *  - Bloqueo de endpoints admin sin token / sin rol admin
 *  - Update real por admin → versionado + sanitización de markdown
 *  - Rollback restaura una versión anterior conservando historial
 *  - Sanitización elimina scripts / on-handlers
 *  - FAQ CRUD básico (crear, listar, eliminar)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

// ─── Mocks de infra (mismo patrón que subscription.routes.test) ───
vi.mock('../config/redis.js', () => ({
  default: {
    isConnected: true,
    getStatus: () => ({ connected: true }),
    ping: async () => 'PONG',
    set: async () => null,
    get: async () => null,
    del: async () => 0,
    publish: async () => 0
  }
}));

vi.mock('../config/cloudinary.js', () => ({
  default: {
    uploader: {
      upload: async () => ({ secure_url: 'https://example.com/fake.jpg', public_id: 'fake' }),
      destroy: async () => ({ result: 'ok' })
    }
  }
}));

vi.mock('../middlewares/auth/ensureSession.js', () => ({
  default: (req, _res, next) => {
    req.session = { sessionId: 'test-session', userType: 'guest' };
    req.sessionId = 'test-session';
    next();
  }
}));

let mongod;
let app;
let CmsContent;
let FaqItem;
let ServiceCategoryOverride;
let adminToken;
let clientToken;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  process.env.JWT_SECRET = 'test-jwt-secret-cms';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-cms';
  process.env.SKIP_SESSION_MIDDLEWARE = '1';
  process.env.SKIP_GUEST_QUERIES = '1';

  CmsContent = (await import('../models/Content/CmsContent.js')).default;
  FaqItem = (await import('../models/Content/FaqItem.js')).default;
  ServiceCategoryOverride = (await import('../models/Content/ServiceCategoryOverride.js')).default;

  // Crear un admin real usando el discriminator Admin para que el role 'admin'
  // se persista correctamente (User base no acepta role='admin' directo porque
  // se maneja via discriminatorKey).
  const Admin = (await import('../models/User/Admin.js')).default;
  const User = (await import('../models/User/User.js')).default;
  const admin = await Admin.create({
    email: 'admin@test.local',
    password: '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890',
    isActive: true,
    emailVerified: true,
    profile: { firstName: 'Admin', lastName: 'Test' }
  });

  const Client = (await import('../models/User/Client.js')).default;
  const client = await Client.create({
    email: 'client@test.local',
    password: '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890',
    isActive: true,
    emailVerified: true,
    profile: { firstName: 'Cli', lastName: 'Ent' }
  });

  adminToken = jwt.sign({ id: admin._id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  clientToken = jwt.sign({ id: client._id, role: 'client' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const mod = await import('../../app.js');
  app = mod.default;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await CmsContent.deleteMany({});
  await FaqItem.deleteMany({});
  if (ServiceCategoryOverride) await ServiceCategoryOverride.deleteMany({});
});

// ════════════════════════════════════════════════════════════════════
// Lectura pública
// ════════════════════════════════════════════════════════════════════
describe('GET /api/content/:key (público)', () => {
  it('devuelve empty:true cuando no hay documento sembrado (deja al frontend caer a i18n)', async () => {
    const res = await request(app).get('/api/content/terms?locale=es');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.empty).toBe(true);
    expect(res.body.data.key).toBe('terms');
  });

  it('devuelve el contenido con HTML renderizado y headers de caché', async () => {
    await CmsContent.create({
      key: 'terms',
      translations: {
        es: {
          title: 'Términos',
          sections: [{ id: 'intro', label: 'Intro', bodyMarkdown: '**Hola** mundo', bodyHtml: '<p><strong>Hola</strong> mundo</p>' }],
          lastEditedAt: new Date()
        }
      },
      version: 1,
      publishedAt: new Date()
    });

    const res = await request(app).get('/api/content/terms?locale=es');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.key).toBe('terms');
    expect(res.body.data.title).toBe('Términos');
    expect(res.body.data.sections[0].bodyHtml).toContain('<strong>Hola</strong>');
    expect(res.headers['cache-control']).toMatch(/stale-while-revalidate/);
  });

  it('rechaza key inválido con 400', async () => {
    const res = await request(app).get('/api/content/no-existe?locale=es');
    expect(res.status).toBe(400);
  });

  it('cae en fallback al otro idioma si el solicitado está vacío', async () => {
    await CmsContent.create({
      key: 'about',
      translations: {
        es: { title: 'Sobre Nosotros', sections: [{ id: 'a', label: 'a', bodyMarkdown: 'x', bodyHtml: '<p>x</p>' }] }
      },
      version: 1
    });
    const res = await request(app).get('/api/content/about?locale=en');
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Sobre Nosotros'); // fallback
  });
});

// ════════════════════════════════════════════════════════════════════
// Auth/RBAC admin
// ════════════════════════════════════════════════════════════════════
describe('Admin CMS — Auth & RBAC', () => {
  it('rechaza sin token con 401', async () => {
    const res = await request(app).get('/api/admin/cms/contents');
    expect(res.status).toBe(401);
  });

  it('rechaza con token de cliente (no admin) con 403', async () => {
    const res = await request(app)
      .get('/api/admin/cms/contents')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
  });

  it('permite acceso con token admin', async () => {
    const res = await request(app)
      .get('/api/admin/cms/contents')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    // Devuelve los 5 keys aunque no haya documentos
    expect(res.body.data.items.length).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════════
// Update + sanitización + versionado
// ════════════════════════════════════════════════════════════════════
describe('PUT /api/admin/cms/contents/:key', () => {
  it('crea v1 al primer PUT, incrementa a v2 al segundo y guarda historial', async () => {
    const payload1 = {
      locale: 'es',
      title: 'Términos v1',
      sections: [{ id: 'intro', label: 'Intro', bodyMarkdown: 'Texto v1' }]
    };
    const r1 = await request(app)
      .put('/api/admin/cms/contents/terms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload1);
    expect(r1.status).toBe(200);
    expect(r1.body.data.version).toBe(1);

    const payload2 = {
      locale: 'es',
      title: 'Términos v2',
      sections: [{ id: 'intro', label: 'Intro', bodyMarkdown: 'Texto v2' }]
    };
    const r2 = await request(app)
      .put('/api/admin/cms/contents/terms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload2);
    expect(r2.status).toBe(200);
    expect(r2.body.data.version).toBe(2);

    const doc = await CmsContent.findOne({ key: 'terms' }).lean();
    expect(doc.history.length).toBe(1);
    expect(doc.history[0].version).toBe(1);
    expect(doc.history[0].locale).toBe('es');
    expect(doc.history[0].titleSnapshot).toBe('Términos v1');
  });

  it('sanitiza scripts y on-handlers en el HTML guardado', async () => {
    const payload = {
      locale: 'es',
      title: 'Test XSS',
      sections: [{
        id: 'xss',
        label: 'xss',
        bodyMarkdown: 'Hola <script>alert(1)</script> <a href="javascript:alert(2)">link</a> <img src=x onerror=alert(3)>'
      }]
    };
    const res = await request(app)
      .put('/api/admin/cms/contents/about')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);
    expect(res.status).toBe(200);
    const html = res.body.data.sections[0].bodyHtml;
    // Las strings peligrosas quedan escapadas como texto (entidades HTML),
    // por eso buscamos PATRONES DE TAG REAL, no la mera presencia de la palabra.
    expect(html).not.toMatch(/<script[\s>]/i);          // no <script> real
    expect(html).not.toMatch(/<img[^>]*onerror/i);      // no img con onerror
    expect(html).not.toMatch(/<a[^>]*href="javascript:/i); // no <a href=javascript:>
  });

  it('rechaza payload sin locale válido con 400', async () => {
    const res = await request(app)
      .put('/api/admin/cms/contents/terms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ locale: 'fr', title: 'x', sections: [{ id: 'a', label: 'a', bodyMarkdown: 'x' }] });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// Rollback
// ════════════════════════════════════════════════════════════════════
describe('POST /api/admin/cms/contents/:key/rollback/:version', () => {
  it('restaura una versión anterior conservando el historial', async () => {
    // Crear v1
    await request(app).put('/api/admin/cms/contents/terms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ locale: 'es', title: 'T1', sections: [{ id: 'a', label: 'a', bodyMarkdown: 'uno' }] });
    // Crear v2
    await request(app).put('/api/admin/cms/contents/terms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ locale: 'es', title: 'T2', sections: [{ id: 'a', label: 'a', bodyMarkdown: 'dos' }] });

    const r = await request(app)
      .post('/api/admin/cms/contents/terms/rollback/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    // Tras rollback se crea v3 con el contenido de v1
    expect(r.body.data.version).toBe(3);
    expect(r.body.data.restoredFromVersion).toBe(1);
    // Verificar que el contenido del doc realmente cambió en BBDD
    const restored = await CmsContent.findOne({ key: 'terms' }).lean();
    expect(restored.translations.es.title).toBe('T1');
  });
});

// ════════════════════════════════════════════════════════════════════
// FAQ
// ════════════════════════════════════════════════════════════════════
describe('FAQ admin + público', () => {
  it('crea, lista y elimina una FAQ', async () => {
    const create = await request(app)
      .post('/api/admin/cms/faq')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'general',
        question: { es: '¿Qué es?', en: 'What is it?' },
        answerMarkdown: { es: '**Es** algo', en: '**It is** something' }
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    expect(create.body.data.answerHtml.es).toContain('<strong>Es</strong>');

    const list = await request(app).get('/api/content/faq?locale=es');
    expect(list.status).toBe(200);
    expect(list.body.data.items.length).toBe(1);

    const del = await request(app)
      .delete(`/api/admin/cms/faq/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const list2 = await request(app).get('/api/content/faq?locale=es');
    expect(list2.body.data.items.length).toBe(0);
  });

  it('lista solo FAQs activas en endpoint público', async () => {
    await FaqItem.create({
      category: 'general',
      question: { es: 'q1' }, answerMarkdown: { es: 'a1' }, answerHtml: { es: '<p>a1</p>' },
      active: true, order: 10
    });
    await FaqItem.create({
      category: 'general',
      question: { es: 'q2' }, answerMarkdown: { es: 'a2' }, answerHtml: { es: '<p>a2</p>' },
      active: false, order: 20
    });
    const res = await request(app).get('/api/content/faq?locale=es');
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].question).toBe('q1');
  });
});

// ════════════════════════════════════════════════════════════════════
// Reset desde defaults
// ════════════════════════════════════════════════════════════════════
describe('Reset content from defaults', () => {
  it('reimporta plantilla con todas las secciones reales (terms ES tiene 11)', async () => {
    // Doc actual con sólo 1 sección (simula el seed mínimo viejo)
    await CmsContent.create({
      key: 'terms',
      translations: {
        es: { title: 'old', sections: [{ id: 'intro', label: 'I', bodyMarkdown: 'x', bodyHtml: '<p>x</p>' }] },
        en: { title: 'old', sections: [{ id: 'intro', label: 'I', bodyMarkdown: 'x', bodyHtml: '<p>x</p>' }] }
      },
      version: 1
    });

    const reset = await request(app)
      .post('/api/admin/cms/contents/terms/reset-from-defaults')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ locale: 'both' });

    expect(reset.status).toBe(200);
    expect(reset.body.data.sectionsCount.es).toBeGreaterThanOrEqual(10);
    expect(reset.body.data.sectionsCount.en).toBeGreaterThanOrEqual(10);

    // El doc debe traer ahora las secciones canónicas (acceptance, services, …)
    const doc = await CmsContent.findOne({ key: 'terms' }).lean();
    const ids = doc.translations.es.sections.map((s) => s.id);
    expect(ids).toContain('acceptance');
    expect(ids).toContain('services');
    expect(ids).toContain('contact');
    // El contenido viejo debe estar en historial (no destructivo)
    expect(doc.history.length).toBeGreaterThan(0);
  });

  it('rechaza reset sin token admin', async () => {
    const res = await request(app)
      .post('/api/admin/cms/contents/privacy/reset-from-defaults')
      .send({ locale: 'both' });
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════
// Service Categories overrides
// ════════════════════════════════════════════════════════════════════
describe('Service Category overrides', () => {
  it('list devuelve las 21 categorías canónicas', async () => {
    const res = await request(app)
      .get('/api/admin/cms/service-categories')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(21);
    // todas inician sin override
    expect(res.body.data.items.every((it) => it.hasOverride === false)).toBe(true);
  });

  it('upsert + endpoint público reflejan label/description', async () => {
    const put = await request(app)
      .put('/api/admin/cms/service-categories/Plomer%C3%ADa')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: { es: 'Fontanería', en: 'Plumbing Pro' },
        description: { es: 'Sin fugas', en: 'No leaks' }
      });
    expect(put.status).toBe(200);
    expect(put.body.data.label.es).toBe('Fontanería');

    const pubEs = await request(app).get('/api/content/service-categories?locale=es');
    expect(pubEs.status).toBe(200);
    expect(pubEs.body.data.overrides['Plomería']).toEqual({ label: 'Fontanería', description: 'Sin fugas' });

    const pubEn = await request(app).get('/api/content/service-categories?locale=en');
    expect(pubEn.body.data.overrides['Plomería']).toEqual({ label: 'Plumbing Pro', description: 'No leaks' });
  });

  it('delete restablece (la categoría desaparece de overrides públicos)', async () => {
    await request(app)
      .put('/api/admin/cms/service-categories/Electricidad')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: { es: 'Luz', en: 'Light' } });

    const del = await request(app)
      .delete('/api/admin/cms/service-categories/Electricidad')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const pub = await request(app).get('/api/content/service-categories?locale=es');
    expect(pub.body.data.overrides['Electricidad']).toBeUndefined();
  });

  it('rechaza categoría inexistente', async () => {
    const res = await request(app)
      .put('/api/admin/cms/service-categories/NoExisteTal')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: { es: 'x' } });
    expect(res.status).toBe(404);
  });

  it('rechaza acceso sin token admin', async () => {
    const res = await request(app)
      .get('/api/admin/cms/service-categories');
    expect(res.status).toBe(401);
  });
});
