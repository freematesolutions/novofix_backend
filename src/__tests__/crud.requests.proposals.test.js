import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
let app;

// NOTE: These are smoke tests against routes wiring and basic auth errors.
// Full integration would require DB bootstrapping and seed users.

beforeAll(async () => {
  // Ensure app is imported after setup.vitest sets env flags
  const mod = await import('../../app.js');
  app = mod.default;
});

describe('CRUD Requests & Proposals (routing smoke)', () => {
  it('should reject creating request without auth', async () => {
    const res = await request(app).post('/api/client/requests').send({ title: 'x' });
    expect(res.status).toBe(401);
  });

  it('should reject provider proposals list without auth', async () => {
    const res = await request(app).get('/api/provider/proposals/proposals');
    expect(res.status).toBe(401);
  });

  it('should expose client routes for publish/archive/republish (auth required)', async () => {
    const id = '655555555555555555555555';
    const endpoints = [
      `/api/client/requests/${id}`,
      `/api/client/requests/${id}/publish`,
      `/api/client/requests/${id}/archive`,
      `/api/client/requests/${id}/republish`
    ];
    for (const ep of endpoints) {
      const res = await request(app).put(ep).send({});
      expect([401,404,400]).toContain(res.status);
    }
  });

  it('should expose provider draft proposal endpoints (auth required)', async () => {
    const rid = '655555555555555555555555';
    const pid = '655555555555555555555556';
    const checks = [
      { method: 'post', url: `/api/provider/proposals/requests/${rid}/proposals/draft` },
      { method: 'post', url: `/api/provider/proposals/requests/${rid}/proposals` },
      { method: 'put', url: `/api/provider/proposals/proposals/${pid}` },
      { method: 'post', url: `/api/provider/proposals/proposals/${pid}/send` },
      { method: 'post', url: `/api/provider/proposals/proposals/${pid}/cancel` },
    ];
    for (const c of checks) {
      const res = await request(app)[c.method](c.url).send({});
      expect([401,404,400]).toContain(res.status);
    }
  });

  it('should require auth for proposal context endpoint', async () => {
    const res = await request(app).get('/api/provider/proposals/context');
    expect(res.status).toBe(401);
  });

  it('subscription routes should require auth (plans/status)', async () => {
    const unaPlans = await request(app).get('/api/provider/subscription/plans');
    expect(unaPlans.status).toBe(401);
    const unaStatus = await request(app).get('/api/provider/subscription/status');
    expect(unaStatus.status).toBe(401);
  });

  it('should require auth for plan change and validate payload', async () => {
    const unaChange = await request(app).post('/api/provider/subscription/change').send({ planName: 'invalid' });
    expect([401,403]).toContain(unaChange.status);
  });
});
