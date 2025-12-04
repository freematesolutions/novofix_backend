import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import connectDB from '../config/database.js';
import User from '../models/User/User.js';
import Admin from '../models/User/Admin.js';
import notificationService from '../services/external/notificationService.js';

// Prefer .env in server root; fallback to .env.development if present
const root = process.cwd();
const envPath = existsSync(resolve(root, '.env'))
	? resolve(root, '.env')
	: (existsSync(resolve(root, '.env.development')) ? resolve(root, '.env.development') : undefined);
if (envPath) loadEnv({ path: envPath }); else loadEnv();

async function run() {
	const args = parseArgs(process.argv.slice(2));
	const email = (args.email || process.env.ADMIN_EMAIL || process.env.DEFAULT_ADMIN_EMAIL || 'admin@marketplace.com');
		const password = (process.env.ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || generateTempPassword());
		const firstName = process.env.ADMIN_FIRST_NAME || process.env.DEFAULT_ADMIN_NAME || 'Admin';
		const lastName = process.env.ADMIN_LAST_NAME || 'User';
	const reset = (process.env.SEED_ADMIN_OVERWRITE || '').toLowerCase() === 'true' || args.reset === true;

	try {
		await connectDB();

		// Optional delete by email
		if (args.delete) {
			const delEmail = String(args.delete).toLowerCase().trim();
			const delRes = await User.deleteOne({ email: delEmail });
			console.log(`🗑️  Delete by email (${delEmail}): ${delRes.deletedCount} document(s) removed`);
		}

		let user = await User.findOne({ email: email.toLowerCase().trim() });

			if (!user) {
				// Create as Admin discriminator to persist role
				user = new Admin({
					email: email.toLowerCase().trim(),
					password,
					isActive: true,
					profile: { firstName, lastName }
				});
			await user.save();
					printResult('created', { email, password });
					try {
						await notificationService.sendAdminNotification({ adminId: user._id, type: 'WELCOME_ADMIN' });
					} catch (e) {
						console.warn('Admin welcome notification failed:', e?.message);
					}
		} else {
			// Ensure role admin and active
				let changed = false;
				// If not Admin discriminator, replace document by deleting and recreating
				const currentRole = String(user.role || '');
				if (currentRole !== 'Admin') {
					await User.deleteOne({ _id: user._id });
					const adminDoc = new Admin({
						_id: user._id, // preserve id
						email: user.email,
						password: reset ? password : user.password, // if resetting, set new password
						isActive: true,
						profile: user.profile || { firstName, lastName }
					});
					await adminDoc.save();
					user = adminDoc;
					changed = false; // already saved
				}
			if (user.isActive !== true) { user.isActive = true; changed = true; }
			if (reset) {
				user.password = password; // will be hashed by pre-save hook
				changed = true;
			}
			if (changed) {
				await user.save();
			}
					printResult(reset ? 'reset' : 'exists', { email, password: reset ? password : undefined });
					if (reset) {
						try {
							await notificationService.sendAdminNotification({ adminId: user._id, type: 'WELCOME_ADMIN' });
						} catch (e) {
							console.warn('Admin welcome notification failed:', e?.message);
						}
					}
		}

		process.exit(0);
	} catch (err) {
		console.error('❌ Seed admin failed:', err?.message || err);
		console.error('Ensure MONGODB_URI is set in your environment (.env)');
		process.exit(1);
	}
}

function printResult(status, { email, password }) {
	const lines = [];
	if (status === 'created') {
		lines.push('✅ Admin user created');
	} else if (status === 'reset') {
		lines.push('✅ Admin user password reset');
	} else {
		lines.push('ℹ️  Admin user already exists');
	}
	lines.push(`   Email: ${email}`);
	if (password) {
		lines.push(`   Password: ${password}`);
	}
	lines.push('   Role: admin');
	lines.push('\nTip: Set ADMIN_EMAIL and ADMIN_PASSWORD in .env to control credentials. Use --reset to force password reset.');
	console.log(lines.join('\n'));
}

function generateTempPassword() {
	// 16-char mixed temporary password
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()_+';
	let out = '';
	for (let i = 0; i < 16; i++) {
		out += chars[Math.floor(Math.random() * chars.length)];
	}
	return out;
}

function parseArgs(argv) {
	const out = {};
	for (const a of argv) {
		if (a === '--reset') { out.reset = true; continue; }
		const m = a.match(/^--([^=]+)=(.*)$/);
		if (m) {
			out[m[1]] = m[2];
		}
	}
	return out;
}

run();

