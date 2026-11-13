/**
 * Admin Users Routes — Integration Tests
 *
 * Cubre:
 *  - Dashboard: conteo exacto por tipo (Client/Provider/Admin) con discriminators
 *  - Listado: filtro por rol en minúscula (el role se guarda capitalizado)
 *  - Estado: activar marca emailVerified=true y audita en adminNotes; desactivar no toca emailVerified
 *  - Rol: normalización + protección del último admin
 *  - Cambio de contraseña: validaciones, re-autenticación del admin, hash bcrypt,
 *    invalidación de sesiones y control de acceso (no admin / sin token)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
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

// Evitar envíos reales de email
const sendEmailMock = vi.fn(async () => ({ success: true }));
vi.mock('../services/external/email/resendService.js', () => ({
  default: { sendEmail: (...args) => sendEmailMock(...args) }
}));

// Evitar efectos de notificaciones a providers
vi.mock('../services/external/notificationService.js', () => ({
  default: { sendProviderNotification: async () => null }
}));

const ADMIN_PASSWORD = 'AdminPass#2026';
const NEW_PASSWORD = 'NuevaClave#2026';

let mongod;
let app;
let User;
let Admin;
let Client;
let Provider;
let Session;
let adminDoc;
let adminToken;
let clientToken;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  process.env.JWT_SECRET = 'test-jwt-secret-admin-users';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-admin-users';
  process.env.SKIP_SESSION_MIDDLEWARE = '1';
  process.env.SKIP_GUEST_QUERIES = '1';

  User = (await import('../models/User/User.js')).default;
  Admin = (await import('../models/User/Admin.js')).default;
  Client = (await import('../models/User/Client.js')).default;
  Provider = (await import('../models/User/Provider.js')).default;
  Session = (await import('../models/System/Session.js')).default;

  const mod = await import('../../app.js');
  app = mod.default;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  sendEmailMock.mockClear();
  await Session.deleteMany({});
  await User.deleteMany({});

  // El hook pre('save') hashea la contraseña en claro
  adminDoc = await Admin.create({
    email: 'admin@test.local',
    password: ADMIN_PASSWORD,
    isActive: true,
    emailVerified: true,
    profile: { firstName: 'Admin', lastName: 'Test' }
  });
  const clientDoc = await Client.create({
    email: 'client-auth@test.local',
    password: 'ClientPass#2026',
    isActive: true,
    emailVerified: true,
    profile: { firstName: 'Cli', lastName: 'Auth' }
  });

  adminToken = jwt.sign({ id: adminDoc._id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  clientToken = jwt.sign({ id: clientDoc._id, role: 'client' }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

const makeClient = (over = {}) => Client.create({
  email: `u${Math.random().toString(36).slice(2, 8)}@test.local`,
  password: 'OldPassword#1',
  isActive: true,
  emailVerified: true,
  profile: { firstName: 'Test', lastName: 'User' },
  ...over
});

// ════════════════════════════════════════════════════════════════════
// Control de acceso
// ════════════════════════════════════════════════════════════════════
describe('Control de acceso /api/admin', () => {
  it('rechaza sin token', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect([401, 403]).toContain(res.status);
  });

  it('rechaza a un usuario con rol client', async () => {
    const res = await request(app).get('/api/admin/dashboard').set(auth(clientToken));
    expect(res.status).toBe(403);
  });

  it('rechaza cambio de contraseña a un no-admin', async () => {
    const target = await makeClient();
    const res = await request(app)
      .post(`/api/admin/users/${target._id}/password`)
      .set(auth(clientToken))
      .send({ newPassword: NEW_PASSWORD, adminPassword: 'x' });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════
// F1 — Métricas
// ════════════════════════════════════════════════════════════════════
describe('GET /api/admin/dashboard', () => {
  it('cuenta clientes, proveedores y admins por tipo (Clientes != 0)', async () => {
    await makeClient();
    await makeClient();
    await Provider.create({
      email: 'prov@test.local',
      password: 'ProvPass#2026',
      isActive: true,
      emailVerified: true,
      profile: { firstName: 'Pro', lastName: 'Vider' }
    });

    const res = await request(app).get('/api/admin/dashboard').set(auth(adminToken));
    expect(res.status).toBe(200);
    const o = res.body.data.overview;
    // 1 client de auth + 2 creados
    expect(o.totalClients).toBe(3);
    expect(o.totalProviders).toBe(1);
    expect(o.totalAdmins).toBe(1);
    expect(o.totalUsers).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════════
// F2 — Listado y estado
// ════════════════════════════════════════════════════════════════════
describe('GET /api/admin/users (filtro por rol)', () => {
  it('filtra con rol en minúscula aunque se almacene capitalizado', async () => {
    await makeClient();
    const res = await request(app).get('/api/admin/users?role=client').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.users.length).toBe(2);
    expect(res.body.data.users.every((u) => String(u.role).toLowerCase() === 'client')).toBe(true);

    const resAdmin = await request(app).get('/api/admin/users?role=admin').set(auth(adminToken));
    expect(resAdmin.body.data.users.length).toBe(1);
  });

  it('no expone el hash de contraseña', async () => {
    const res = await request(app).get('/api/admin/users').set(auth(adminToken));
    expect(res.status).toBe(200);
    for (const u of res.body.data.users) expect(u.password).toBeUndefined();
  });
});

describe('PUT /api/admin/users/:id/status', () => {
  it('activar marca emailVerified=true y deja traza en adminNotes', async () => {
    const target = await makeClient({ isActive: false, emailVerified: false, emailVerificationToken: 'tok' });
    const res = await request(app)
      .put(`/api/admin/users/${target._id}/status`)
      .set(auth(adminToken))
      .send({ isActive: true, reason: 'Validación manual' });
    expect(res.status).toBe(200);

    const fresh = await User.findById(target._id);
    expect(fresh.isActive).toBe(true);
    expect(fresh.emailVerified).toBe(true);
    expect(fresh.emailVerificationToken == null).toBe(true);
    expect(fresh.adminNotes.length).toBe(1);
    expect(fresh.adminNotes[0].action).toBe('activated');
    expect(String(fresh.adminNotes[0].admin)).toBe(String(adminDoc._id));
  });

  it('desactivar no revierte emailVerified', async () => {
    const target = await makeClient();
    const res = await request(app)
      .put(`/api/admin/users/${target._id}/status`)
      .set(auth(adminToken))
      .send({ isActive: false, reason: 'Política' });
    expect(res.status).toBe(200);

    const fresh = await User.findById(target._id);
    expect(fresh.isActive).toBe(false);
    expect(fresh.emailVerified).toBe(true);
    expect(fresh.adminNotes[0].action).toBe('deactivated');
  });

  it('404 si el usuario no existe', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${new mongoose.Types.ObjectId()}/status`)
      .set(auth(adminToken))
      .send({ isActive: true });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/admin/users/:id/role', () => {
  it('rechaza roles inválidos', async () => {
    const target = await makeClient();
    const res = await request(app)
      .put(`/api/admin/users/${target._id}/role`)
      .set(auth(adminToken))
      .send({ role: 'superuser' });
    expect(res.status).toBe(400);
  });

  it('cambia a provider guardando role capitalizado y roles[] en minúscula', async () => {
    const target = await makeClient();
    const res = await request(app)
      .put(`/api/admin/users/${target._id}/role`)
      .set(auth(adminToken))
      .send({ role: 'provider' });
    expect(res.status).toBe(200);

    const raw = await User.collection.findOne({ _id: target._id });
    expect(raw.role).toBe('Provider');
    expect(raw.roles).toContain('provider');
  });

  it('impide degradar al último admin activo', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${adminDoc._id}/role`)
      .set(auth(adminToken))
      .send({ role: 'client' });
    expect(res.status).toBe(400);
    const raw = await User.collection.findOne({ _id: adminDoc._id });
    expect(raw.role).toBe('Admin');
  });
});

// ════════════════════════════════════════════════════════════════════
// F3 — Cambio de contraseña por admin
// ════════════════════════════════════════════════════════════════════
describe('POST /api/admin/users/:id/password', () => {
  it('400 si la nueva contraseña es corta', async () => {
    const target = await makeClient();
    const res = await request(app)
      .post(`/api/admin/users/${target._id}/password`)
      .set(auth(adminToken))
      .send({ newPassword: '123', adminPassword: ADMIN_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('400 si falta la contraseña del admin', async () => {
    const target = await makeClient();
    const res = await request(app)
      .post(`/api/admin/users/${target._id}/password`)
      .set(auth(adminToken))
      .send({ newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('401 si la contraseña del admin es incorrecta y NO cambia nada', async () => {
    const target = await makeClient();
    const before = (await User.findById(target._id).select('+password')).password;

    const res = await request(app)
      .post(`/api/admin/users/${target._id}/password`)
      .set(auth(adminToken))
      .send({ newPassword: NEW_PASSWORD, adminPassword: 'incorrecta' });
    expect(res.status).toBe(401);

    const after = (await User.findById(target._id).select('+password')).password;
    expect(after).toBe(before);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('404 si el usuario destino no existe', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${new mongoose.Types.ObjectId()}/password`)
      .set(auth(adminToken))
      .send({ newPassword: NEW_PASSWORD, adminPassword: ADMIN_PASSWORD });
    expect(res.status).toBe(404);
  });

  it('cambia la contraseña (hash bcrypt), audita, invalida sesiones y notifica', async () => {
    const target = await makeClient();
    await Session.create({
      sessionId: 'sess-target-1',
      user: target._id,
      userType: 'client',
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });
    await Session.create({
      sessionId: 'sess-other-1',
      user: adminDoc._id,
      userType: 'admin',
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });

    const res = await request(app)
      .post(`/api/admin/users/${target._id}/password`)
      .set(auth(adminToken))
      .send({ newPassword: NEW_PASSWORD, adminPassword: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.revokedSessions).toBe(1);
    // Nunca se devuelve ni la contraseña nueva ni el hash
    expect(JSON.stringify(res.body)).not.toContain(NEW_PASSWORD);

    const fresh = await User.findById(target._id).select('+password');
    expect(fresh.password).not.toBe(NEW_PASSWORD);
    expect(await bcryptjs.compare(NEW_PASSWORD, fresh.password)).toBe(true);
    expect(await bcryptjs.compare('OldPassword#1', fresh.password)).toBe(false);

    const last = fresh.adminNotes[fresh.adminNotes.length - 1];
    expect(last.action).toBe('password_changed');
    expect(JSON.stringify(last)).not.toContain(NEW_PASSWORD);

    // Sesión del usuario revocada; la del admin se conserva
    expect(await Session.countDocuments({ user: target._id })).toBe(0);
    expect(await Session.countDocuments({ user: adminDoc._id })).toBe(1);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].template).toBe('password_reset_confirmed');
    expect(sendEmailMock.mock.calls[0][0].to).toBe(target.email);
  });

  it('si falla el email, el cambio igualmente se completa', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('smtp down'));
    const target = await makeClient();
    const res = await request(app)
      .post(`/api/admin/users/${target._id}/password`)
      .set(auth(adminToken))
      .send({ newPassword: NEW_PASSWORD, adminPassword: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    const fresh = await User.findById(target._id).select('+password');
    expect(await bcryptjs.compare(NEW_PASSWORD, fresh.password)).toBe(true);
  });
});
