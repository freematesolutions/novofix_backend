import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import subscriptionService from '../subscriptionService.js';
import Provider from '../../../models/User/Provider.js';

// In-memory Mongo could be set; for now assume test DB URL provided

describe('subscriptionService', () => {
  let mongod;
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    await subscriptionService.ensurePlansSeeded();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  it('seeds plans', async () => {
    const freePlan = await subscriptionService.getPlan('free');
    expect(freePlan.features.leadLimit).toBe(1);
  });

  it('applies referral code increments discount months', async () => {
    const p = await Provider.create({
      email: 'p@test.com',
      password: 'Password123!',
      providerProfile: { businessName: 'Biz', services: [], serviceArea: {} },
      referral: { code: 'REFTEST' },
      subscription: { plan: 'free', status: 'active' }
    });

    const refId = await subscriptionService.applyReferralCode('REFTEST');
    expect(refId.toString()).toBe(p._id.toString());
    const updated = await Provider.findById(p._id).lean();
    expect(updated.referral.discountMonths).toBe(1);
  });
});
