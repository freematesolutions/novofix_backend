import { vi } from 'vitest';

// NOTE: Simplified setup for routing smoke tests.
// We mock infra-heavy middlewares & services to avoid real DB/Redis/Cloudinary usage.
// No Mongo connection required because we short-circuit session creation.

export let testTokens = {}; // placeholder if future tests need tokens

// Mock Redis client to avoid real connection during tests
vi.mock('../../config/redis.js', () => {
  const fake = {
    isConnected: true,
    getStatus: () => ({ connected: true }),
    ping: async () => 'PONG',
    set: async () => null,
    get: async () => null,
    del: async () => 0,
    publish: async () => 0
  };
  return { default: fake };
});

// Mock Cloudinary
vi.mock('../../config/cloudinary.js', () => {
  return {
    default: {
      uploader: {
        upload: async () => ({ secure_url: 'https://example.com/fake.jpg', public_id: 'fake' }),
        destroy: async () => ({ result: 'ok' })
      }
    }
  };
});

// Mock ensureSession to avoid Mongoose Session operations (guest session creation)
vi.mock('../../middlewares/auth/ensureSession.js', () => ({
  default: (req, _res, next) => {
    // Attach a lightweight fake session object (guest)
    req.session = { sessionId: 'test-session', userType: 'guest' };
    req.sessionId = 'test-session';
    next();
  }
}));

// Provide JWT secrets for potential auth tests (no DB-backed users needed here)
beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh';
  process.env.SKIP_SESSION_MIDDLEWARE = '1';
  process.env.SKIP_GUEST_QUERIES = '1';
});

afterAll(() => {
  // Nothing to clean up; kept for symmetry if extended later.
});

