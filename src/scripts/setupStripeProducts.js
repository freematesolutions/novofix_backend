/**
 * setupStripeProducts.js
 * 
 * Creates the Expert and Elite subscription products & prices in Stripe,
 * then prints the Price IDs to paste into .env files.
 *
 * Usage:  node src/scripts/setupStripeProducts.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env file based on NODE_ENV: production uses .env.production, else .env.development
// When run with STRIPE_SECRET_KEY already set in the environment, dotenv will NOT overwrite it.
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.resolve(__dirname, `../../${envFile}`) });

import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY is not set. Run with: $env:STRIPE_SECRET_KEY="sk_live_..." before this script.');
  process.exit(1);
}

const isLive = process.env.STRIPE_SECRET_KEY.startsWith('sk_live_');
console.log(`🔑 Using ${isLive ? '✅ LIVE' : '⚠️  TEST'} key: ${process.env.STRIPE_SECRET_KEY.slice(0, 14)}...`);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = [
  {
    envKey: 'STRIPE_PRICE_EXPERT',
    productName: 'NovoFix Expert Plan',
    description: 'Expert subscription — urgent + scheduled leads, verified badge, unlimited portfolio',
    priceAmount: 499,   // $4.99 in cents
    currency: 'usd',
    interval: 'month',
  },
  {
    envKey: 'STRIPE_PRICE_ELITE',
    productName: 'NovoFix Elite Plan',
    description: 'Elite subscription — unlimited leads, VIP support, performance reports, unlimited portfolio',
    priceAmount: 999,   // $9.99 in cents
    currency: 'usd',
    interval: 'month',
  },
];

async function main() {
  console.log('🔧 Setting up Stripe products & prices...\n');

  for (const plan of PLANS) {
    // Check if a product with this name already exists
    const existing = await stripe.products.search({
      query: `name:"${plan.productName}"`,
    });

    let product;
    if (existing.data.length > 0) {
      product = existing.data[0];
      console.log(`✅ Product already exists: ${product.name} (${product.id})`);
    } else {
      product = await stripe.products.create({
        name: plan.productName,
        description: plan.description,
      });
      console.log(`✅ Created product: ${product.name} (${product.id})`);
    }

    // Check if a recurring price already exists for this product
    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      type: 'recurring',
    });

    const matchingPrice = prices.data.find(
      (p) =>
        p.unit_amount === plan.priceAmount &&
        p.currency === plan.currency &&
        p.recurring?.interval === plan.interval
    );

    let price;
    if (matchingPrice) {
      price = matchingPrice;
      console.log(`✅ Price already exists: $${(price.unit_amount / 100).toFixed(2)}/${price.recurring.interval} (${price.id})`);
    } else {
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.priceAmount,
        currency: plan.currency,
        recurring: { interval: plan.interval },
      });
      console.log(`✅ Created price: $${(price.unit_amount / 100).toFixed(2)}/${price.recurring.interval} (${price.id})`);
    }

    console.log(`\n   → ${plan.envKey}=${price.id}\n`);
  }

  console.log('──────────────────────────────────────────');
  console.log('Copy the Price IDs above into your .env.development and .env.production files.');
  console.log('Done! ✨');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
