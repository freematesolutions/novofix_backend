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

  it('applies referral code awards 7 days of Expert plan', async () => {
    const p = await Provider.create({
      email: 'p@test.com',
      password: 'Password123!',
      providerProfile: { businessName: 'Biz', services: [], serviceArea: {} },
      referral: { code: 'REFTEST' },
      subscription: { plan: 'free', status: 'active' }
    });

    const result = await subscriptionService.applyReferralCode('REFTEST', {
      userId: new mongoose.Types.ObjectId(),
      role: 'client'
    });
    expect(result).not.toBeNull();
    expect(result.referrerId.toString()).toBe(p._id.toString());
    expect(result.daysAwarded).toBe(7);
    expect(result.totalDays).toBe(7);

    const updated = await Provider.findById(p._id).lean();
    expect(updated.referral.earnedDays).toBe(7);
    expect(updated.referral.bonusActive).toBe(true);
    expect(updated.referral.referralsCount).toBe(1);
    expect(updated.referral.referredUsers).toHaveLength(1);
    expect(updated.subscription.plan).toBe('expert');
  });

  it('caps referral bonus at 30 days maximum', async () => {
    const p = await Provider.create({
      email: 'p2@test.com',
      password: 'Password123!',
      providerProfile: { businessName: 'Biz2', services: [], serviceArea: {} },
      referral: { code: 'REFMAX', earnedDays: 28, bonusActive: true, bonusExpiresAt: new Date(Date.now() + 28 * 86400000) },
      subscription: { plan: 'expert', status: 'active' }
    });

    const result = await subscriptionService.applyReferralCode('REFMAX', {
      userId: new mongoose.Types.ObjectId(),
      role: 'provider'
    });
    expect(result.daysAwarded).toBe(2); // Only 2 more days to reach cap of 30
    expect(result.totalDays).toBe(30);
  });

  it('returns null for self-referral', async () => {
    const p = await Provider.create({
      email: 'p3@test.com',
      password: 'Password123!',
      providerProfile: { businessName: 'Biz3', services: [], serviceArea: {} },
      referral: { code: 'REFSELF' },
      subscription: { plan: 'free', status: 'active' }
    });

    const result = await subscriptionService.applyReferralCode('REFSELF', {
      userId: p._id,
      role: 'provider'
    });
    expect(result).toBeNull();
  });
});
