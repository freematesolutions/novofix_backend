// scripts/seedSubscriptionPlans.js
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import SubscriptionPlan from '../models/Payment/SubscriptionPlan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../../.env.production')
  : path.resolve(__dirname, '../../.env.development');
dotenv.config({ path: envFile });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/marketplace';

const seed = [
  {
    name: 'free',
    displayName: 'Básico',
    price: { monthly: 0, currency: 'USD' },
    features: {
      leadLimit: -1,
      leadTypes: ['scheduled'],
      scheduledLeadBatchHour: 18,
      visibilityMultiplier: 1.0,
      maxPortfolioVideos: 1,
      verifiedBadge: false,
      performanceReports: false,
      profileViewsVisible: false,
      vipSupport: false,
      urgentLeadPriority: 0,
      benefits: ['multiple_categories']
    },
    stripePriceId: '',
    isActive: true,
    metadata: {
      description: 'Ranking básico, portafolio (máx. 1 video), leads programados (diariamente a las 6 PM)',
      descriptionEn: 'Basic ranking, portfolio (max 1 video), scheduled leads (daily at 6 PM)',
      order: 1
    }
  },
  {
    name: 'expert',
    displayName: 'Experto',
    price: { monthly: 4.99, currency: 'USD' },
    features: {
      leadLimit: -1,
      leadTypes: ['scheduled', 'urgent'],
      scheduledLeadBatchHour: -1,
      visibilityMultiplier: 1.5,
      maxPortfolioVideos: -1,
      verifiedBadge: true,
      performanceReports: false,
      profileViewsVisible: true,
      vipSupport: false,
      urgentLeadPriority: 1,
      benefits: ['verified_badge', 'profile_views', 'multiple_categories']
    },
    stripePriceId: process.env.STRIPE_PRICE_EXPERT || '',
    isActive: true,
    metadata: {
      description: 'Notificación inmediata, badge verificado, leads ilimitados, visitas al perfil',
      descriptionEn: 'Instant notifications, verified badge, unlimited leads, profile views',
      order: 2,
      mostPopular: true
    }
  },
  {
    name: 'elite',
    displayName: 'Élite',
    price: { monthly: 9.99, currency: 'USD' },
    features: {
      leadLimit: -1,
      leadTypes: ['scheduled', 'urgent'],
      scheduledLeadBatchHour: -1,
      visibilityMultiplier: 2.0,
      maxPortfolioVideos: -1,
      verifiedBadge: true,
      performanceReports: true,
      profileViewsVisible: true,
      vipSupport: true,
      urgentLeadPriority: 2,
      benefits: ['verified_badge', 'profile_views', 'performance_reports', 'vip_support', 'urgent_leads_first', 'featured_listing', 'multiple_categories']
    },
    stripePriceId: process.env.STRIPE_PRICE_ELITE || '',
    isActive: true,
    metadata: {
      description: 'Top resultados, urgentes primero, reportes mensuales, soporte VIP',
      descriptionEn: 'Top results, urgent leads first, monthly reports, VIP support',
      order: 3
    }
  }
];

async function run() {
  await mongoose.connect(MONGODB_URI);

  // Remove old plans that no longer exist (basic, pro)
  await SubscriptionPlan.deleteMany({ name: { $in: ['basic', 'pro'] } });
  console.log('Cleaned up legacy plans (basic, pro).');

  for (const plan of seed) {
    await SubscriptionPlan.findOneAndUpdate(
      { name: plan.name },
      { $set: plan },
      { upsert: true, new: true }
    );
    console.log(`Upserted plan: ${plan.name}`);
  }

  console.log('All plans seeded successfully.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
