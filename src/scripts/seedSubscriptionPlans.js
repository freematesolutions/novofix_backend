// scripts/seedSubscriptionPlans.js
import mongoose from 'mongoose';
import SubscriptionPlan from '../models/Payment/SubscriptionPlan.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/marketplace';

const seed = [
  {
    name: 'free',
    displayName: 'Gratis',
    price: { monthly: 0, currency: 'USD' },
    features: { leadLimit: 1, visibilityMultiplier: 1.0, commissionRate: 15, benefits: ['multiple_categories'] },
    stripePriceId: 'price_free',
    isActive: true,
    metadata: { description: 'Plan gratuito para comenzar', order: 1 }
  },
  {
    name: 'basic',
    displayName: 'Básico',
    price: { monthly: 10, currency: 'USD' },
    features: { leadLimit: 5, visibilityMultiplier: 1.2, commissionRate: 12, benefits: ['priority_support','advanced_analytics'] },
    stripePriceId: 'price_basic',
    isActive: true,
    metadata: { description: 'Más visibilidad y 5 leads/mes', order: 2, mostPopular: true }
  },
  {
    name: 'pro',
    displayName: 'Pro',
    price: { monthly: 19, currency: 'USD' },
    features: { leadLimit: -1, visibilityMultiplier: 1.5, commissionRate: 8, benefits: ['priority_support','advanced_analytics','featured_listing','custom_profile'] },
    stripePriceId: 'price_pro',
    isActive: true,
    metadata: { description: 'Visibilidad máxima y leads ilimitados', order: 3 }
  }
];

async function run() {
  await mongoose.connect(MONGODB_URI);
  const existing = await SubscriptionPlan.find({}).lean();
  const have = new Set(existing.map(p => p.name));
  const toCreate = seed.filter(p => !have.has(p.name));
  if (toCreate.length) {
    await SubscriptionPlan.insertMany(toCreate);
    console.log(`Inserted ${toCreate.length} plans.`);
  } else {
    console.log('Plans already seeded.');
  }
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
