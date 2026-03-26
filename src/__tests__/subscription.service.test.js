/**
 * Subscription Service — Unit Tests
 *
 * Tests the core subscription business logic:
 *  - Plan seeding & retrieval
 *  - canReceiveLead (lead limits & period management)
 *  - canReceiveLeadByUrgency (urgency-based filtering)
 *  - incrementLeadUsage
 *  - handleSubscriptionEvent (webhook event processing)
 *  - changePlanLocal
 *
 * Uses MongoMemoryServer to avoid touching real databases.
 * Stripe calls are fully mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// ─── Mock Stripe before any import that references it ───
vi.mock('../services/external/payment/stripeService.js', () => ({
  default: {
    stripe: {
      checkout: { sessions: { create: vi.fn() } },
      subscriptions: {
        retrieve: vi.fn(),
        update: vi.fn(),
        cancel: vi.fn()
      },
      customers: { create: vi.fn() },
      webhooks: { constructEvent: vi.fn() }
    },
    createCustomer: vi.fn(),
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

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  // Set env vars for plan seeds
  process.env.STRIPE_PRICE_EXPERT = 'price_test_expert';
  process.env.STRIPE_PRICE_ELITE = 'price_test_elite';
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ─── Import AFTER mocks are in place ───
let subscriptionService;
let Provider;
let SubscriptionPlan;
let stripeService;

beforeAll(async () => {
  subscriptionService = (await import('../services/internal/subscriptionService.js')).default;
  Provider = (await import('../models/User/Provider.js')).default;
  SubscriptionPlan = (await import('../models/Payment/SubscriptionPlan.js')).default;
  stripeService = (await import('../services/external/payment/stripeService.js')).default;
});

beforeEach(async () => {
  // Clean collections between tests
  await Provider.deleteMany({});
  await SubscriptionPlan.deleteMany({});
});

// ─── Helper: create a test provider ───
async function createProvider(overrides = {}) {
  const base = {
    email: `test-${Date.now()}@example.com`,
    password: 'hashedpassword123',
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
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    },
    ...overrides
  };
  return Provider.create(base);
}

// ═══════════════════════════════════════════
// 1. Plan Seeding & Retrieval
// ═══════════════════════════════════════════

describe('Plan Seeding & Retrieval', () => {
  it('should seed all 3 plans (free, expert, elite)', async () => {
    await subscriptionService.ensurePlansSeeded();
    const plans = await SubscriptionPlan.find({}).lean();
    expect(plans).toHaveLength(3);
    expect(plans.map(p => p.name).sort()).toEqual(['elite', 'expert', 'free']);
  });

  it('should not duplicate plans on repeated seeding', async () => {
    await subscriptionService.ensurePlansSeeded();
    await subscriptionService.ensurePlansSeeded();
    const plans = await SubscriptionPlan.find({}).lean();
    expect(plans).toHaveLength(3);
  });

  it('should return all active plans sorted by order', async () => {
    const plans = await subscriptionService.getAllActivePlans();
    expect(plans).toHaveLength(3);
    expect(plans[0].name).toBe('free');
    expect(plans[1].name).toBe('expert');
    expect(plans[2].name).toBe('elite');
  });

  it('should return correct plan by name', async () => {
    await subscriptionService.ensurePlansSeeded();
    const expert = await subscriptionService.getPlan('expert');
    expect(expert.name).toBe('expert');
    expect(expert.price.monthly).toBe(9.99);
    expect(expert.features.leadTypes).toContain('urgent');
    expect(expert.features.verifiedBadge).toBe(true);
  });

  it('should return free plan as fallback for unknown plan names', async () => {
    await subscriptionService.ensurePlansSeeded();
    const plan = await subscriptionService.getPlan('nonexistent');
    expect(plan.name).toBe('free');
  });

  it('should have correct pricing for each plan', async () => {
    const plans = await subscriptionService.getAllActivePlans();
    const priceMap = {};
    plans.forEach(p => { priceMap[p.name] = p.price.monthly; });
    expect(priceMap.free).toBe(0);
    expect(priceMap.expert).toBe(9.99);
    expect(priceMap.elite).toBe(19.99);
  });

  it('should have stripePriceId set for paid plans from env', async () => {
    const plans = await subscriptionService.getAllActivePlans();
    const expert = plans.find(p => p.name === 'expert');
    const elite = plans.find(p => p.name === 'elite');
    expect(expert.stripePriceId).toBe('price_test_expert');
    expect(elite.stripePriceId).toBe('price_test_elite');
  });
});

// ═══════════════════════════════════════════
// 2. canReceiveLead — Lead Limit Logic
// ═══════════════════════════════════════════

describe('canReceiveLead', () => {
  beforeEach(async () => {
    await subscriptionService.ensurePlansSeeded();
  });

  it('should allow free plan provider to receive leads (unlimited)', async () => {
    const provider = await createProvider({ subscription: { plan: 'free', status: 'active', leadsUsed: 0, currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLead(provider);
    expect(result).toBe(true);
  });

  it('should allow expert plan provider to receive leads', async () => {
    const provider = await createProvider({ subscription: { plan: 'expert', status: 'active', leadsUsed: 50, currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLead(provider);
    expect(result).toBe(true);
  });

  it('should deny leads to providers with inactive subscription', async () => {
    const provider = await createProvider({ subscription: { plan: 'expert', status: 'past_due', leadsUsed: 0, currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLead(provider);
    expect(result).toBe(false);
  });

  it('should deny leads to non-existent provider', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const result = await subscriptionService.canReceiveLead(fakeId);
    expect(result).toBe(false);
  });

  it('should auto-renew expired period and reset leadsUsed', async () => {
    const pastDate = new Date(Date.now() - 86400000); // yesterday
    const provider = await createProvider({
      subscription: { plan: 'free', status: 'active', leadsUsed: 99, currentPeriodEnd: pastDate }
    });
    const result = await subscriptionService.canReceiveLead(provider);
    expect(result).toBe(true);
    // Verify the period was renewed in DB
    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.leadsUsed).toBe(0);
    expect(new Date(updated.subscription.currentPeriodEnd) > new Date()).toBe(true);
  });
});

// ═══════════════════════════════════════════
// 3. canReceiveLeadByUrgency — Core Module 3 Logic
// ═══════════════════════════════════════════

describe('canReceiveLeadByUrgency', () => {
  beforeEach(async () => {
    await subscriptionService.ensurePlansSeeded();
  });

  // ─── Urgent leads ───

  it('FREE plan: should NOT receive urgent leads', async () => {
    const provider = await createProvider({ subscription: { plan: 'free', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLeadByUrgency(provider, 'immediate');
    expect(result.allowed).toBe(false);
    expect(result.delayHours).toBe(0);
  });

  it('EXPERT plan: should receive urgent leads immediately', async () => {
    const provider = await createProvider({ subscription: { plan: 'expert', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLeadByUrgency(provider, 'immediate');
    expect(result.allowed).toBe(true);
    expect(result.delayHours).toBe(0);
  });

  it('ELITE plan: should receive urgent leads immediately', async () => {
    const provider = await createProvider({ subscription: { plan: 'elite', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLeadByUrgency(provider, 'immediate');
    expect(result.allowed).toBe(true);
    expect(result.delayHours).toBe(0);
  });

  it('FREE plan: should also be denied with "urgent" alias', async () => {
    const provider = await createProvider({ subscription: { plan: 'free', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLeadByUrgency(provider, 'urgent');
    expect(result.allowed).toBe(false);
  });

  // ─── Scheduled leads ───

  it('FREE plan: should receive scheduled leads with 24h delay', async () => {
    const provider = await createProvider({ subscription: { plan: 'free', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLeadByUrgency(provider, 'scheduled');
    expect(result.allowed).toBe(true);
    expect(result.delayHours).toBe(24);
  });

  it('EXPERT plan: should receive scheduled leads immediately', async () => {
    const provider = await createProvider({ subscription: { plan: 'expert', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLeadByUrgency(provider, 'scheduled');
    expect(result.allowed).toBe(true);
    expect(result.delayHours).toBe(0);
  });

  it('ELITE plan: should receive scheduled leads immediately', async () => {
    const provider = await createProvider({ subscription: { plan: 'elite', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const result = await subscriptionService.canReceiveLeadByUrgency(provider, 'scheduled');
    expect(result.allowed).toBe(true);
    expect(result.delayHours).toBe(0);
  });

  it('should return not allowed for non-existent provider', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const result = await subscriptionService.canReceiveLeadByUrgency(fakeId, 'scheduled');
    expect(result.allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════
// 4. incrementLeadUsage
// ═══════════════════════════════════════════

describe('incrementLeadUsage', () => {
  beforeEach(async () => {
    await subscriptionService.ensurePlansSeeded();
  });

  it('should increment leadsUsed by 1', async () => {
    const provider = await createProvider({ subscription: { plan: 'expert', status: 'active', leadsUsed: 5, currentPeriodEnd: new Date(Date.now() + 86400000) } });
    await subscriptionService.incrementLeadUsage(provider._id);
    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.leadsUsed).toBe(6);
  });

  it('should set lastLeadAt timestamp', async () => {
    const provider = await createProvider({ subscription: { plan: 'free', status: 'active', leadsUsed: 0, currentPeriodEnd: new Date(Date.now() + 86400000) } });
    await subscriptionService.incrementLeadUsage(provider._id);
    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.lastLeadAt).toBeTruthy();
  });
});

// ═══════════════════════════════════════════
// 5. handleSubscriptionEvent — Webhook Processing
// ═══════════════════════════════════════════

describe('handleSubscriptionEvent', () => {
  beforeEach(async () => {
    await subscriptionService.ensurePlansSeeded();
  });

  it('checkout.session.completed → should activate expert plan', async () => {
    const provider = await createProvider();
    const now = Math.floor(Date.now() / 1000);

    // Mock Stripe subscription retrieve
    stripeService.stripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_test_123',
      current_period_start: now,
      current_period_end: now + 30 * 86400,
      metadata: { providerId: provider._id.toString(), planName: 'expert' }
    });

    await subscriptionService.handleSubscriptionEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          subscription: 'sub_test_123',
          customer: 'cus_test_456',
          metadata: {
            providerId: provider._id.toString(),
            planName: 'expert'
          }
        }
      }
    });

    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.plan).toBe('expert');
    expect(updated.subscription.status).toBe('active');
    expect(updated.subscription.stripeSubscriptionId).toBe('sub_test_123');
    expect(updated.subscription.stripeCustomerId).toBe('cus_test_456');
    expect(updated.subscription.leadsUsed).toBe(0);
    expect(updated.subscription.cancelAtPeriodEnd).toBe(false);
  });

  it('invoice.paid → should renew period and reset leads', async () => {
    const provider = await createProvider({
      subscription: {
        plan: 'expert', status: 'active',
        stripeSubscriptionId: 'sub_renew_1',
        leadsUsed: 42,
        currentPeriodEnd: new Date(Date.now() + 86400000)
      }
    });
    const now = Math.floor(Date.now() / 1000);

    stripeService.stripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_renew_1',
      current_period_start: now,
      current_period_end: now + 30 * 86400,
      cancel_at_period_end: false,
      metadata: { providerId: provider._id.toString() }
    });

    await subscriptionService.handleSubscriptionEvent({
      type: 'invoice.paid',
      data: { object: { subscription: 'sub_renew_1' } }
    });

    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.status).toBe('active');
    expect(updated.subscription.leadsUsed).toBe(0);
  });

  it('invoice.payment_failed → should set status to past_due', async () => {
    const provider = await createProvider({
      subscription: {
        plan: 'elite', status: 'active',
        stripeSubscriptionId: 'sub_fail_1',
        currentPeriodEnd: new Date(Date.now() + 86400000)
      }
    });

    stripeService.stripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_fail_1',
      metadata: { providerId: provider._id.toString() }
    });

    await subscriptionService.handleSubscriptionEvent({
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_fail_1' } }
    });

    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.status).toBe('past_due');
  });

  it('customer.subscription.deleted → should downgrade to free', async () => {
    const provider = await createProvider({
      subscription: {
        plan: 'expert', status: 'active',
        stripeSubscriptionId: 'sub_del_1',
        currentPeriodEnd: new Date(Date.now() + 86400000)
      }
    });

    await subscriptionService.handleSubscriptionEvent({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_del_1',
          metadata: { providerId: provider._id.toString() }
        }
      }
    });

    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.plan).toBe('free');
    expect(updated.subscription.status).toBe('active');
    expect(updated.subscription.stripeSubscriptionId).toBeNull();
  });

  it('customer.subscription.updated → should update plan and status', async () => {
    const provider = await createProvider({
      subscription: { plan: 'expert', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) }
    });
    const now = Math.floor(Date.now() / 1000);

    await subscriptionService.handleSubscriptionEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          status: 'active',
          current_period_start: now,
          current_period_end: now + 30 * 86400,
          cancel_at_period_end: true,
          metadata: {
            providerId: provider._id.toString(),
            planName: 'elite'
          }
        }
      }
    });

    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.plan).toBe('elite');
    expect(updated.subscription.cancelAtPeriodEnd).toBe(true);
  });

  it('should ignore events without providerId metadata', async () => {
    // Should not throw
    await subscriptionService.handleSubscriptionEvent({
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_unknown', metadata: {} } }
    });
  });
});

// ═══════════════════════════════════════════
// 6. changePlanLocal
// ═══════════════════════════════════════════

describe('changePlanLocal', () => {
  beforeEach(async () => {
    await subscriptionService.ensurePlansSeeded();
  });

  it('should downgrade expert to free and clear Stripe fields', async () => {
    const provider = await createProvider({
      subscription: {
        plan: 'expert', status: 'active',
        stripeSubscriptionId: 'sub_local_1',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() + 86400000)
      }
    });

    await subscriptionService.changePlanLocal(provider._id, 'free');
    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.plan).toBe('free');
    expect(updated.subscription.stripeSubscriptionId).toBeNull();
    expect(updated.subscription.cancelAtPeriodEnd).toBe(false);
  });

  it('should change to elite locally', async () => {
    const provider = await createProvider({
      subscription: { plan: 'free', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) }
    });

    await subscriptionService.changePlanLocal(provider._id, 'elite');
    const updated = await Provider.findById(provider._id).lean();
    expect(updated.subscription.plan).toBe('elite');
    expect(updated.subscription.status).toBe('active');
  });
});
