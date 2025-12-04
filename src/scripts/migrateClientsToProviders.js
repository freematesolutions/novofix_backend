// scripts/migrateClientsToProviders.js
// Usage:
//   node src/scripts/migrateClientsToProviders.js --emails=email1@example.com,email2@example.com
//   node src/scripts/migrateClientsToProviders.js --all

import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/database.js';
import User from '../models/User/User.js';
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

function generateReferralCode(businessName) {
  const base = (businessName || '').replace(/\s+/g, '').toUpperCase().slice(0, 6);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${base}${random}`;
}

async function migrateOne(user) {
  const email = user.email;
  if (String(user.role || '').toLowerCase() === 'provider' || (user.roles || []).includes('provider')) {
    console.log(`Skip: ${email} already provider`);
    return { email, status: 'skipped-already-provider' };
  }

  const businessName = user.profile?.firstName || email.split('@')[0];
  const referralCode = generateReferralCode(businessName);

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        role: 'Provider',
        'providerProfile.businessName': businessName,
        'providerProfile.description': user.providerProfile?.description || '',
        'providerProfile.services': user.providerProfile?.services || [],
        'providerProfile.serviceArea': user.providerProfile?.serviceArea || {},
        'subscription.plan': 'free',
        'subscription.status': 'inactive',
        'referral.code': referralCode
      },
      $addToSet: { roles: { $each: ['provider', 'client'] } }
    }
  );

  // Hydrate as Provider for validation
  const prov = await Provider.findById(user._id);
  if (!prov) {
    console.warn(`Warning: could not hydrate as Provider for ${email}`);
  }
  return { email, status: 'migrated' };
}

async function main() {
  try {
    const opts = parseArgs();
    await connectDB();

    const filter = opts.all ? { role: 'Client' } : { email: { $in: opts.emails } };
    const clients = await User.find(filter);
    if (!clients.length) {
      console.log('No matching clients found.');
      await mongoose.connection.close();
      process.exit(0);
    }

    const results = [];
    for (const u of clients) {
      try {
        const r = await migrateOne(u);
        results.push(r);
      } catch (e) {
        console.error(`Error migrating ${u.email}:`, e.message);
        results.push({ email: u.email, status: 'error', error: e.message });
      }
    }

    console.table(results);
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

main();
