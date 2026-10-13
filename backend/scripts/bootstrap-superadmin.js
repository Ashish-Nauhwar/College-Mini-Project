/**
 * Super-Admin Bootstrap CLI Tool
 * Usage: node backend/scripts/bootstrap-superadmin.js [email] [password] [name]
 * Or via env variables: SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, SUPERADMIN_NAME
 * 
 * Safely creates or updates a super-admin account in production or development.
 */

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load environment configuration
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { User, AuditLog } = require('../src/models');
const { hashPassword } = require('../src/utils/crypto');

async function bootstrapSuperadmin() {
  const email = (process.argv[2] || process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.argv[3] || process.env.SUPERADMIN_PASSWORD || '';
  const name = (process.argv[4] || process.env.SUPERADMIN_NAME || 'System Administrator').trim();

  // Validate inputs
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    console.error('[Error] A valid super-admin email address is required.');
    console.error('Usage: node backend/scripts/bootstrap-superadmin.js <email> <password> [name]');
    process.exit(1);
  }

  if (!password || password.length < 8) {
    console.error('[Error] Password must be at least 8 characters long (recommend 12+ for production).');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('<username>') || uri.includes('<password>')) {
    console.error('[Error] MONGODB_URI is not configured in backend/.env');
    process.exit(1);
  }

  console.log('[Connecting] Connecting to MongoDB...');
  await mongoose.connect(uri);
  const dbName = mongoose.connection.name;
  console.log(`[Connected] Connected to database: "${dbName}"\n`);

  const hashedPassword = await hashPassword(password);

  let existing = await User.findOne({ email });
  if (existing) {
    console.log(`[Update] Existing user found for "${email}". Elevating to superadmin role and updating password...`);
    existing.role = 'superadmin';
    existing.businessId = null;
    existing.password = hashedPassword;
    if (name) existing.name = name;
    await existing.save();
    console.log(`[Success] Superadmin "${email}" successfully updated.`);
  } else {
    console.log(`[Create] Creating new superadmin user for "${email}"...`);
    const newAdmin = new User({
      email,
      name,
      password: hashedPassword,
      role: 'superadmin',
      businessId: null,
      avatar: '🛡️'
    });
    await newAdmin.save();
    console.log(`[Success] Superadmin "${email}" successfully created.`);
  }

  // Audit log entry
  try {
    await AuditLog.create({
      action: 'Superadmin Bootstrapped',
      actor: name || email,
      details: `Superadmin account ${email} was provisioned via bootstrap script`,
      createdAt: new Date()
    });
  } catch (auditErr) {
    // Non-fatal if audit log fails
  }

  await mongoose.connection.close();
  console.log('[Completed] Database connection closed cleanly.\n');
  process.exit(0);
}

if (require.main === module) {
  bootstrapSuperadmin().catch(err => {
    console.error('[Bootstrap Error]:', err.message);
    process.exit(1);
  });
}

module.exports = bootstrapSuperadmin;
