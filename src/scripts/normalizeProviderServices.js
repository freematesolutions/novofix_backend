// scripts/normalizeProviderServices.js
// Usage:
//   node src/scripts/normalizeProviderServices.js --all
//   node src/scripts/normalizeProviderServices.js --emails=email1@example.com,email2@example.com

import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/database.js';
import Provider from '../models/User/Provider.js';

dotenvConfig();

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { emails: [], all: false };
  for (const arg of args) {
    if (arg.startsWith('--emails=')) {
      const list = arg.split('=')[1];
      if (list) opts.emails = list.split(',').map((e) => e.trim().toLowerCase());
    } else if (arg === '--all') {
      opts.all = true;
    }
  }
  if (!opts.all && (!opts.emails || opts.emails.length === 0)) {
    console.error('Provide --all or --emails=email1,email2');
    process.exit(1);
  }
  return opts;
}

async function normalizeProvider(provider) {
  const services = Array.isArray(provider?.providerProfile?.services) ? provider.providerProfile.services : [];
  const mainService = services[0];
  const extras = services.slice(1).map(s => s?.category).filter(Boolean);
  const additional = Array.isArray(provider?.providerProfile?.additionalServices)
    ? provider.providerProfile.additionalServices
    : [];

  const combinedAdditional = Array.from(new Set([...additional, ...extras]))
    .filter(cat => cat && cat !== mainService?.category);

  if (!mainService) {
    return { updated: false, reason: 'no-main-service' };
  }

  provider.providerProfile.services = [mainService];
  provider.providerProfile.additionalServices = combinedAdditional;
  await provider.save();
  return { updated: true, mainCategory: mainService.category, additionalCount: combinedAdditional.length };
}

async function main() {
  try {
    const opts = parseArgs();
    await connectDB();

    const filter = opts.all ? { role: 'Provider' } : { email: { $in: opts.emails } };
    const providers = await Provider.find(filter);
    if (!providers.length) {
      console.log('No matching providers found.');
      await mongoose.connection.close();
      process.exit(0);
    }

    const results = [];
    for (const p of providers) {
      try {
        const r = await normalizeProvider(p);
        results.push({ email: p.email, status: r.updated ? 'updated' : 'skipped', ...r });
      } catch (e) {
        console.error(`Error normalizing ${p.email}:`, e.message);
        results.push({ email: p.email, status: 'error', error: e.message });
      }
    }

    console.table(results);
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Normalization failed:', err);
    process.exit(1);
  }
}

main();
