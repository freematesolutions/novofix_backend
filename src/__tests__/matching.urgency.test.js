/**
 * Matching Service — Urgency Filtering Tests
 *
 * Tests the urgency-based provider filtering in findEligibleProviders:
 *  - Urgent leads only go to expert/elite providers
 *  - Scheduled leads go to all; free-plan gets delayed
 *  - Delayed providers are separated with correct delayHours
 *
 * Uses MongoMemoryServer with real Provider/SubscriptionPlan documents.
 * Stripe, Redis, notification, emitter, and scoring services are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// ─── Mock Stripe ───
vi.mock('../services/external/payment/stripeService.js', () => ({
  default: {
    stripe: {
      checkout: { sessions: { create: vi.fn() } },
      subscriptions: { retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
      customers: { create: vi.fn() },
      webhooks: { constructEvent: vi.fn() }
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
    del: async () => 0
  }
}));

// ─── Mock notification service ───
vi.mock('../services/external/notificationService.js', () => ({
  default: {
    sendProviderNotification: vi.fn().mockResolvedValue(true)
  }
}));

// ─── Mock emitter service ───
vi.mock('../websocket/services/emitterService.js', () => ({
  default: {
    emitCountersUpdateToUser: vi.fn()
  }
}));

// ─── Mock scoring service — returns a simple deterministic score ───
vi.mock('../services/internal/scoringService.js', () => ({
  default: {
    calculateProviderScore: vi.fn().mockImplementation((provider) => {
      // Score based on plan: elite=90, expert=70, free=50
      const planScores = { elite: 90, expert: 70, free: 50 };
      const score = planScores[provider?.subscription?.plan] || 50;
      return Promise.resolve({ total: score });
    })
  }
}));

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  process.env.STRIPE_PRICE_EXPERT = 'price_test_expert';
  process.env.STRIPE_PRICE_ELITE = 'price_test_elite';
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ─── Import after mocks ───
let matchingService;
let subscriptionService;
let Provider;
let SubscriptionPlan;
let ServiceRequest;
let Client;

beforeAll(async () => {
  matchingService = (await import('../services/internal/matchingService.js')).default;
  subscriptionService = (await import('../services/internal/subscriptionService.js')).default;
  Provider = (await import('../models/User/Provider.js')).default;
  SubscriptionPlan = (await import('../models/Payment/SubscriptionPlan.js')).default;
  ServiceRequest = (await import('../models/Service/ServiceRequest.js')).default;
  // Client model for creating client users
  Client = (await import('../models/User/Client.js')).default;
});

beforeEach(async () => {
  await Provider.deleteMany({});
  await SubscriptionPlan.deleteMany({});
  await ServiceRequest.deleteMany({});
  await subscriptionService.ensurePlansSeeded();
});

// ─── Helpers ───

async function createClient() {
  return Client.create({
    email: `client-${Date.now()}@example.com`,
    password: 'hash123',
    role: 'Client',
    isActive: true,
    profile: { firstName: 'Test', lastName: 'Client' }
  });
}

async function createProviderWithPlan(plan = 'free', category = 'Plomería') {
  return Provider.create({
    email: `provider-${plan}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'hash123',
    role: 'Provider',
    isActive: true,
    profile: { firstName: 'Test', lastName: plan },
    providerProfile: {
      businessName: `${plan} Business`,
      services: [{ category, name: category }],
      rating: { average: 4.0, count: 10 }
    },
    subscription: {
      plan,
      status: 'active',
      leadsUsed: 0,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });
}

async function createServiceRequest(client, urgency = 'scheduled', category = 'Plomería') {
  return ServiceRequest.create({
    client: client._id,
    basicInfo: {
      title: 'Test Request',
      description: 'Test description for service request',
      category,
      urgency
    },
    location: {
      address: '123 Test St'
    },
    status: 'published'
  });
}

// ═══════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════

describe('findEligibleProviders — Urgency Filtering', () => {

  it('URGENT lead: should exclude free-plan providers', async () => {
    const client = await createClient();
    const freeProvider = await createProviderWithPlan('free');
    const expertProvider = await createProviderWithPlan('expert');
    const eliteProvider = await createProviderWithPlan('elite');

    const sr = await createServiceRequest(client, 'immediate');

    const result = await matchingService.findEligibleProviders(sr._id, { forceRefresh: true });

    // Free provider should NOT be in eligibleProviders (urgent excludes free)
    const eligibleIds = result.eligibleProviders.map(p => p.provider.toString());
    expect(eligibleIds).toContain(expertProvider._id.toString());
    expect(eligibleIds).toContain(eliteProvider._id.toString());
    expect(eligibleIds).not.toContain(freeProvider._id.toString());

    // Free provider should NOT be in delayedProviders either (urgent = excluded entirely)
    const delayedIds = result.delayedProviders.map(p => p.provider.toString());
    expect(delayedIds).not.toContain(freeProvider._id.toString());
  });

  it('SCHEDULED lead: expert/elite get immediate, free gets delayed', async () => {
    const client = await createClient();
    const freeProvider = await createProviderWithPlan('free');
    const expertProvider = await createProviderWithPlan('expert');

    const sr = await createServiceRequest(client, 'scheduled');

    const result = await matchingService.findEligibleProviders(sr._id, { forceRefresh: true });

    // Expert should be in eligibleProviders (immediate)
    const eligibleIds = result.eligibleProviders.map(p => p.provider.toString());
    expect(eligibleIds).toContain(expertProvider._id.toString());

    // Free should be in delayedProviders with 24h delay
    const delayed = result.delayedProviders.find(
      p => p.provider.toString() === freeProvider._id.toString()
    );
    expect(delayed).toBeTruthy();
    expect(delayed.delayHours).toBe(24);
  });

  it('should sort eligible providers by score (highest first)', async () => {
    const client = await createClient();
    await createProviderWithPlan('expert');
    await createProviderWithPlan('elite');

    const sr = await createServiceRequest(client, 'immediate');
    const result = await matchingService.findEligibleProviders(sr._id, { forceRefresh: true });

    // Elite (score 90) should be before expert (score 70)
    expect(result.eligibleProviders.length).toBeGreaterThanOrEqual(2);
    expect(result.eligibleProviders[0].score).toBeGreaterThanOrEqual(result.eligibleProviders[1].score);
  });

  it('totalCount should include both immediate and delayed providers', async () => {
    const client = await createClient();
    await createProviderWithPlan('free');
    await createProviderWithPlan('expert');
    await createProviderWithPlan('elite');

    const sr = await createServiceRequest(client, 'scheduled');
    const result = await matchingService.findEligibleProviders(sr._id, { forceRefresh: true });

    expect(result.totalCount).toBe(
      result.eligibleProviders.length + result.delayedProviders.length
    );
    expect(result.totalCount).toBe(3);
  });
});

describe('notifyProviders — Delayed Notifications', () => {

  it('should return totalDelayed count for scheduled leads with free providers', async () => {
    const client = await createClient();
    await createProviderWithPlan('free');
    await createProviderWithPlan('expert');

    const sr = await createServiceRequest(client, 'scheduled');

    const result = await matchingService.notifyProviders(sr._id, 'auto');

    // 1 immediate (expert) + 1 delayed (free)
    expect(result.totalNotified).toBeGreaterThanOrEqual(1);
    expect(result.totalDelayed).toBeGreaterThanOrEqual(1);
  });

  it('urgent lead: should have 0 delayed providers', async () => {
    const client = await createClient();
    await createProviderWithPlan('expert');
    await createProviderWithPlan('elite');

    const sr = await createServiceRequest(client, 'immediate');

    const result = await matchingService.notifyProviders(sr._id, 'auto');

    expect(result.totalDelayed).toBe(0);
    expect(result.totalNotified).toBeGreaterThanOrEqual(1);
  });
});
