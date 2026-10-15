/**
 * QuickDoc (Flujo 2 — "Vía Rápida en Vivo") — Integration Tests
 *
 * Cubre el ciclo completo del documento rápido, aislado del Flujo 1:
 *  - Rutas del profesional protegidas (auth + providerOnly)
 *  - Creación libre de estimado/factura (devuelve token + publicUrl una vez)
 *  - Acceso público por token: apertura (viewed), captura de correo (claim),
 *    aceptación de estimado, y bloqueo del PDF antes del claim (fix de negocio)
 *  - Conversión estimado→factura y cancelación (link inactivo → 410)
 *  - Validación de token inválido
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

// ─── Mocks de infra (mismo patrón que cms.routes.test) ───
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
    },
    utils: {
      private_download_url: () => 'https://example.com/fake.pdf'
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

// La notificación al profesional no debe tocar infra real en los tests.
vi.mock('../services/external/notificationService.js', () => ({
  default: {
    sendProviderNotification: vi.fn(async () => ({ ok: true })),
    sendClientNotification: vi.fn(async () => ({ ok: true }))
  }
}));

// El email de "define tu contraseña" no debe enviarse realmente.
vi.mock('../services/external/email/resendService.js', () => ({
  default: {
    sendEmail: vi.fn(async () => ({ id: 'fake-email' }))
  }
}));

let mongod;
let app;
let QuickDoc;
let Provider;
let Client;
let User;
let providerToken;
let clientToken;
let providerId;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  process.env.JWT_SECRET = 'test-jwt-secret-quickdoc';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-quickdoc';
  process.env.SKIP_SESSION_MIDDLEWARE = '1';
  process.env.SKIP_GUEST_QUERIES = '1';

  QuickDoc = (await import('../models/Service/QuickDoc.js')).default;
  Provider = (await import('../models/User/Provider.js')).default;
  Client = (await import('../models/User/Client.js')).default;
  User = (await import('../models/User/User.js')).default;

  const provider = await Provider.create({
    email: 'pro@test.local',
    password: 'Secret123!',
    isActive: true,
    emailVerified: true,
    profile: { firstName: 'Pro', lastName: 'Fesional', phone: '+1 555 0100' },
    providerProfile: { businessName: 'NovoFix Pro' }
  });
  providerId = provider._id;

  const client = await Client.create({
    email: 'cli@test.local',
    password: 'Secret123!',
    isActive: true,
    emailVerified: true,
    profile: { firstName: 'Cli', lastName: 'Ente' }
  });

  providerToken = jwt.sign({ id: provider._id, role: 'provider' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  clientToken = jwt.sign({ id: client._id, role: 'client' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const mod = await import('../../app.js');
  app = mod.default;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await QuickDoc.deleteMany({});
  // Limpiar clientes creados en segundo plano entre pruebas (dejar los base).
  await User.deleteMany({ email: { $nin: ['pro@test.local', 'cli@test.local'] } });
});

// Helper: crear un estimado vía API y devolver {id, token, publicUrl}
async function createEstimate(overrides = {}) {
  const res = await request(app)
    .post('/api/provider/quick-docs')
    .set('Authorization', `Bearer ${providerToken}`)
    .send({
      type: 'estimate',
      documentNumber: 'EST-TEST-1',
      clientInfo: { name: 'Juan Pérez' },
      financials: {
        items: [{ description: 'Reparación', qty: 1, unitPrice: 100, total: 100 }],
        subtotal: 100, total: 100, currency: 'USD'
      },
      expiresInDays: 30,
      ...overrides
    });
  return res;
}

// ════════════════════════════════════════════════════════════════════
// Protección de rutas del profesional
// ════════════════════════════════════════════════════════════════════
describe('Provider routes — auth & RBAC', () => {
  it('rechaza crear documento sin token (401)', async () => {
    const res = await request(app).post('/api/provider/quick-docs').send({ type: 'estimate' });
    expect(res.status).toBe(401);
  });

  it('rechaza crear documento con rol cliente (403)', async () => {
    const res = await request(app)
      .post('/api/provider/quick-docs')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ type: 'estimate', financials: { total: 10, currency: 'USD' } });
    expect(res.status).toBe(403);
  });

  it('rechaza payload inválido (type no permitido) con 400', async () => {
    const res = await request(app)
      .post('/api/provider/quick-docs')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ type: 'contract' });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// Creación del documento
// ════════════════════════════════════════════════════════════════════
describe('POST /api/provider/quick-docs', () => {
  it('crea un estimado y devuelve token + publicUrl una sola vez', async () => {
    const res = await createEstimate();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.doc.type).toBe('estimate');
    expect(res.body.data.doc.status).toBe('sent');
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token).toHaveLength(64);
    expect(res.body.data.publicUrl).toContain(`/d/${res.body.data.token}`);
    // La vista pública NO debe exponer hashes ni el token
    expect(res.body.data.doc.tokenHash).toBeUndefined();
    expect(res.body.data.doc.publicToken).toBeUndefined();
    // El snapshot del negocio toma el businessName del proveedor
    expect(res.body.data.doc.businessInfo.name).toBe('NovoFix Pro');
  });
});

// ════════════════════════════════════════════════════════════════════
// Acceso público por token
// ════════════════════════════════════════════════════════════════════
describe('Public access by token', () => {
  it('rechaza token con formato inválido (400)', async () => {
    const res = await request(app).get('/api/public/quick-docs/not-a-valid-token');
    expect(res.status).toBe(400);
  });

  it('abre el documento, incrementa viewCount y marca viewed', async () => {
    const created = await createEstimate();
    const { token } = created.body.data;

    const res = await request(app).get(`/api/public/quick-docs/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.doc.status).toBe('viewed');

    // Verificar en BD que se registró la apertura
    const doc = await QuickDoc.findOne({ tokenHash: QuickDoc.hashToken(token) });
    expect(doc.viewCount).toBe(1);
    expect(doc.firstViewedAt).toBeTruthy();
  });

  it('bloquea el PDF antes de confirmar el correo (403)', async () => {
    const created = await createEstimate({ pdfUrl: 'https://example.com/doc.pdf' });
    const { token } = created.body.data;

    const res = await request(app).get(`/api/public/quick-docs/${token}/pdf`);
    expect(res.status).toBe(403);
  });

  it('impide aceptar el estimado antes de confirmar el correo (400)', async () => {
    const created = await createEstimate();
    const { token } = created.body.data;

    const res = await request(app).post(`/api/public/quick-docs/${token}/accept`).send({});
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// Captura de correo (cuenta en segundo plano)
// ════════════════════════════════════════════════════════════════════
describe('POST /api/public/quick-docs/:token/claim', () => {
  it('exige aceptar términos (400 si acceptTerms no es true)', async () => {
    const created = await createEstimate();
    const { token } = created.body.data;

    const res = await request(app)
      .post(`/api/public/quick-docs/${token}/claim`)
      .send({ email: 'nuevo@cliente.com', acceptTerms: false });
    expect(res.status).toBe(400);
  });

  it('crea una cuenta de cliente en segundo plano y la vincula', async () => {
    const created = await createEstimate();
    const { token } = created.body.data;

    const res = await request(app)
      .post(`/api/public/quick-docs/${token}/claim`)
      .send({ email: 'nuevo@cliente.com', name: 'Nuevo Cliente', acceptTerms: true, locale: 'es' });
    expect(res.status).toBe(200);
    expect(res.body.data.doc.hasClaimed).toBe(true);

    // La cuenta debe existir, activa y verificada (acceso por token)
    const user = await User.findOne({ email: 'nuevo@cliente.com' });
    expect(user).toBeTruthy();
    expect(user.isActive).toBe(true);
    expect(user.emailVerified).toBe(true);

    // El documento quedó vinculado a la cuenta
    const doc = await QuickDoc.findOne({ tokenHash: QuickDoc.hashToken(token) });
    expect(String(doc.clientAccount)).toBe(String(user._id));
    expect(doc.clientEmail).toBe('nuevo@cliente.com');
    expect(doc.termsAcceptedAt).toBeTruthy();
  });

  it('con correo ya existente solo vincula (no crea ni bloquea)', async () => {
    const created = await createEstimate();
    const { token } = created.body.data;

    const res = await request(app)
      .post(`/api/public/quick-docs/${token}/claim`)
      .send({ email: 'cli@test.local', acceptTerms: true });
    expect(res.status).toBe(200);

    const doc = await QuickDoc.findOne({ tokenHash: QuickDoc.hashToken(token) });
    const client = await Client.findOne({ email: 'cli@test.local' });
    expect(String(doc.clientAccount)).toBe(String(client._id));
  });
});

// ════════════════════════════════════════════════════════════════════
// Aceptación → conversión
// ════════════════════════════════════════════════════════════════════
describe('Accept & convert flow', () => {
  async function createAndClaim() {
    const created = await createEstimate();
    const { token, doc } = created.body.data;
    await request(app)
      .post(`/api/public/quick-docs/${token}/claim`)
      .send({ email: 'acepta@cliente.com', acceptTerms: true });
    return { token, id: doc.id };
  }

  it('acepta el estimado tras confirmar el correo (status accepted)', async () => {
    const { token } = await createAndClaim();

    const res = await request(app).post(`/api/public/quick-docs/${token}/accept`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.doc.status).toBe('accepted');

    const doc = await QuickDoc.findOne({ tokenHash: QuickDoc.hashToken(token) });
    expect(doc.status).toBe('accepted');
    expect(doc.acceptedAt).toBeTruthy();
  });

  it('el profesional convierte el estimado aceptado en factura', async () => {
    const { token, id } = await createAndClaim();
    await request(app).post(`/api/public/quick-docs/${token}/accept`).send({});

    const res = await request(app)
      .post(`/api/provider/quick-docs/${id}/convert`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ financials: { total: 100, currency: 'USD' } });
    expect(res.status).toBe(201);
    expect(res.body.data.doc.type).toBe('invoice');

    // El estimado original queda marcado como convertido
    const estimate = await QuickDoc.findById(id);
    expect(estimate.status).toBe('converted');
  });

  it('no permite convertir un estimado no aceptado (400)', async () => {
    const created = await createEstimate();
    const id = created.body.data.doc.id;

    const res = await request(app)
      .post(`/api/provider/quick-docs/${id}/convert`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ financials: { total: 100, currency: 'USD' } });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// Cancelación → enlace inactivo
// ════════════════════════════════════════════════════════════════════
describe('Cancel flow', () => {
  it('cancela el documento y el enlace público deja de funcionar (410)', async () => {
    const created = await createEstimate();
    const { token, doc } = created.body.data;

    const cancelRes = await request(app)
      .post(`/api/provider/quick-docs/${doc.id}/cancel`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({});
    expect(cancelRes.status).toBe(200);

    const publicRes = await request(app).get(`/api/public/quick-docs/${token}`);
    expect(publicRes.status).toBe(410);
  });
});
