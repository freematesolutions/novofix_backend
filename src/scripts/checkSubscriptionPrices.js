import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import SubscriptionPlan from '../models/Payment/SubscriptionPlan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.development') });

await mongoose.connect(process.env.MONGODB_URI);
const plans = await SubscriptionPlan.find({})
  .select('name stripePriceId isActive')
  .lean();

for (const plan of plans) {
  console.log(`${plan.name} | ${plan.stripePriceId || '(empty)'} | ${plan.isActive}`);
}

await mongoose.disconnect();
