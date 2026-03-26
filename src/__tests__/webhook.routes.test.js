/**
 * Stripe Webhook Route — Integration Tests
 *
 * Tests the POST /webhooks/stripe endpoint:
 *  - Rejects missing signature in production mode
 *  - Accepts valid webhook events
 *  - GET returns informational message
 *  - Handles dev mode fallback (no signature verification)
 *
 * Uses supertest against the real Express app with mocked Stripe/Redis.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

// ─── Mock Stripe ───
const mockConstructEvent = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();

vi.mock('../services/external/payment/stripeService.js', () => ({
  default: {
    _stripe: null,
    get stripe() {
      return {
        webhooks: { constructEvent: mockConstructEvent },
        subscriptions: { retrieve: mockSubscriptionsRetrieve },
        checkout: { sessions: { create: vi.fn() } },
        customers: { create: vi.fn() }
      };
    },
    createCustomer: vi.fn()
  }
}));

// ─── Mock Redis ───
vi.mock('../config/redis.js', () => ({
  default: {
    isConnected: true,
    get: async () => null,
    set: async () => null,
    del: async () => 0,
    publish: async () => 0,
    getStatus: () => ({ connected: true }),
    ping: async () => 'PONG'
  }
}));

// ─── Mock session middleware ───
vi.mock('../middlewares/auth/ensureSession.js', () => ({
  default: (req, _res, next) => {
    req.session = { sessionId: 'test-session', userType: 'guest' };
    req.sessionId = 'test-session';
    next();
  }
}));

let mongod;
let app;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh';
  process.env.SKIP_SESSION_MIDDLEWARE = '1';
  process.env.STRIPE_PRICE_EXPERT = 'price_test_expert';
  process.env.STRIPE_PRICE_ELITE = 'price_test_elite';

  const mod = await import('../../app.js');
  app = mod.default;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /webhooks/stripe', () => {
  it('should return informational JSON message', async () => {
    const res = await request(app).get('/webhooks/stripe');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.message).toContain('webhook');
  });
});

describe('POST /webhooks/stripe', () => {
  it('should reject without signature when STRIPE_WEBHOOK_SECRET is set', async () => {
    const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const originalEnv = process.env.NODE_ENV;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_real_secret_123';
    process.env.NODE_ENV = 'production';

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'test' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing signature');

    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    process.env.NODE_ENV = originalEnv;
  });

  it('should accept valid event when constructEvent succeeds', async () => {
    const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_valid';

    const fakeEvent = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_x', customer: 'cus_x', metadata: {} } }
    };
    mockConstructEvent.mockReturnValue(fakeEvent);

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=123,v1=abc')
      .send(JSON.stringify(fakeEvent));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  it('should process event in dev mode without signature (placeholder secret)', async () => {
    const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const originalEnv = process.env.NODE_ENV;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_REPLACE_WITH_REAL_WEBHOOK_SECRET';
    process.env.NODE_ENV = 'development';

    const fakeEvent = {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_dev', metadata: {} } }
    };

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(fakeEvent));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    process.env.NODE_ENV = originalEnv;
  });

  it('should reject in production mode when secret is placeholder', async () => {
    const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const originalEnv = process.env.NODE_ENV;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_REPLACE_WITH_REAL_WEBHOOK_SECRET';
    process.env.NODE_ENV = 'production';

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'test' }));

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('not configured');

    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    process.env.NODE_ENV = originalEnv;
  });
});
