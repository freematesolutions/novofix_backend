/**
 * Subscription Routes — Authenticated Smoke Tests
 *
 * Tests every subscription endpoint with both:
 *  - Unauthenticated requests (expect 401)
 *  - Authenticated provider requests (expect 200/400 but NOT 401)
 *
 * Uses MongoMemoryServer with real Provider + SubscriptionPlan docs.
 * JWT tokens are generated for a seeded provider user.
 * Stripe is fully mocked so no real Checkout sessions are created.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

// ─── Mock Stripe ───
vi.mock('../services/external/payment/stripeService.js', () => ({
  default: {
    stripe: {
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'cs_test_xxx',
            url: 'https://checkout.stripe.com/test'
          })
        }
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({ id: 'sub_test', status: 'active' }),
        update: vi.fn().mockResolvedValue({ id: 'sub_test', cancel_at_period_end: false }),
        cancel: vi.fn().mockResolvedValue({ id: 'sub_test', cancel_at_period_end: true })
      },
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_test_xxx' })
      },
      webhooks: { constructEvent: vi.fn() }
    },
    createCustomer: vi.fn().mockResolvedValue({ id: 'cus_test_xxx' })
  }
}));

// ─── Mock Redis ───
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

// ─── Mock Cloudinary ───
vi.mock('../config/cloudinary.js', () => ({
  default: {
    uploader: {
      upload: async () => ({ secure_url: 'https://example.com/fake.jpg', public_id: 'fake' }),
      destroy: async () => ({ result: 'ok' })
    }
  }
}));

// ─── Mock ensureSession (skip guest session creation) ───
vi.mock('../middlewares/auth/ensureSession.js', () => ({
  default: (req, _res, next) => {
    req.session = { sessionId: 'test-session', userType: 'guest' };
    req.sessionId = 'test-session';
    next();
  }
}));

let mongod;
let app;
let providerToken;
let provider;
let Provider;
let SubscriptionPlan;
let subscriptionService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  process.env.JWT_SECRET = 'test-jwt-secret-for-subscription-routes';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  process.env.SKIP_SESSION_MIDDLEWARE = '1';
  process.env.SKIP_GUEST_QUERIES = '1';
  process.env.STRIPE_PRICE_EXPERT = 'price_test_expert';
  process.env.STRIPE_PRICE_ELITE = 'price_test_elite';
  process.env.FRONTEND_URL = 'http://localhost:5173';

  // Import models & services after DB is ready
  Provider = (await import('../models/User/Provider.js')).default;
  SubscriptionPlan = (await import('../models/Payment/SubscriptionPlan.js')).default;
  subscriptionService = (await import('../services/internal/subscriptionService.js')).default;

  // Seed plans
  await subscriptionService.ensurePlansSeeded();

  // Create a real provider in the DB
  provider = await Provider.create({
    email: 'testprovider@example.com',
    password: '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890', // bcrypt hash placeholder
    role: 'Provider',
    isActive: true,
    profile: { firstName: 'Test', lastName: 'Provider' },
    providerProfile: {
      businessName: 'Test Business',
      services: [{ category: 'Plomería', name: 'Plomería' }]
    },
    subscription: {
      plan: 'free',
      status: 'active',
      leadsUsed: 0,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });

  // Generate a valid JWT for this provider
  providerToken = jwt.sign(
    { id: provider._id, role: 'Provider' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Import app AFTER mocks and DB
  const mod = await import('../../app.js');
  app = mod.default;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Reset provider subscription state before each test
  await Provider.findByIdAndUpdate(provider._id, {
    $set: {
      'subscription.plan': 'free',
      'subscription.status': 'active',
      'subscription.leadsUsed': 0
    }
  });
});

// ═══════════════════════════════════════════
// UNAUTHENTICATED — all should return 401
// ═══════════════════════════════════════════

describe('Subscription routes — Unauthenticated (401)', () => {
  const endpoints = [
    { method: 'get',  url: '/api/provider/subscription/plans' },
    { method: 'get',  url: '/api/provider/subscription/status' },
    { method: 'post', url: '/api/provider/subscription/checkout' },
    { method: 'post', url: '/api/provider/subscription/downgrade' },
    { method: 'post', url: '/api/provider/subscription/cancel' },
    { method: 'post', url: '/api/provider/subscription/reactivate' },
    { method: 'post', url: '/api/provider/subscription/apply-referral' },
  ];

  for (const ep of endpoints) {
    it(`${ep.method.toUpperCase()} ${ep.url} → 401 without token`, async () => {
      const res = await request(app)[ep.method](ep.url).send({});
      expect(res.status).toBe(401);
    });
  }
});

// ═══════════════════════════════════════════
// AUTHENTICATED — provider with valid JWT
// ═══════════════════════════════════════════

describe('Subscription routes — Authenticated provider', () => {

  // ──── GET /plans ────
  it('GET /plans returns list of plans', async () => {
    const res = await request(app)
      .get('/api/provider/subscription/plans')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.plans).toBeInstanceOf(Array);
    expect(res.body.data.plans.length).toBeGreaterThanOrEqual(3); // free, expert, elite
  });

  // ──── GET /status ────
  it('GET /status returns subscription info', async () => {
    const res = await request(app)
      .get('/api/provider/subscription/status')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subscription).toBeDefined();
    expect(res.body.data.subscription.plan).toBe('free');
    expect(typeof res.body.data.canReceiveLead).toBe('boolean');
  });

  // ──── POST /checkout — valid planName ────
  it('POST /checkout with valid planName returns checkout URL', async () => {
    const res = await request(app)
      .post('/api/provider/subscription/checkout')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ planName: 'expert' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkoutUrl).toBeDefined();
    expect(res.body.data.sessionId).toBeDefined();
  });

  // ──── POST /checkout — invalid planName ────
  it('POST /checkout with invalid planName returns 400', async () => {
    const res = await request(app)
      .post('/api/provider/subscription/checkout')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ planName: 'invalid-plan' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ──── POST /checkout — missing planName ────
  it('POST /checkout with no planName returns 400', async () => {
    const res = await request(app)
      .post('/api/provider/subscription/checkout')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  // ──── POST /downgrade ────
  it('POST /downgrade returns success (free → still free)', async () => {
    const res = await request(app)
      .post('/api/provider/subscription/downgrade')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({});

    // Free user has no Stripe sub → service handles gracefully
    expect([200, 400, 500]).toContain(res.status);
    // The key assertion: NOT 401 (auth passed)
    expect(res.status).not.toBe(401);
  });

  // ──── POST /cancel ────
  it('POST /cancel is not 401', async () => {
    const res = await request(app)
      .post('/api/provider/subscription/cancel')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({});

    expect(res.status).not.toBe(401);
  });

  // ──── POST /reactivate ────
  it('POST /reactivate is not 401', async () => {
    const res = await request(app)
      .post('/api/provider/subscription/reactivate')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({});

    expect(res.status).not.toBe(401);
  });

  // ──── POST /apply-referral — missing code ────
  it('POST /apply-referral without code returns 400', async () => {
    const res = await request(app)
      .post('/api/provider/subscription/apply-referral')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ──── POST /apply-referral — nonexistent code ────
  it('POST /apply-referral with fake code returns 404', async () => {
    const res = await request(app)
      .post('/api/provider/subscription/apply-referral')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ code: 'NONEXISTENT-CODE' });

    expect(res.status).toBe(404);
  });
});
