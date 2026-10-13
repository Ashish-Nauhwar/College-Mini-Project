/**
 * Super-Admin Bootstrap CLI Tool
 * Usage: node backend/scripts/bootstrap-superadmin.js <email> <password> [name] [--force-update]
 * Or via env variables: SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, SUPERADMIN_NAME, ALLOW_SUPERADMIN_UPDATE
 * 
 * Safely creates or updates a super-admin account in production or development.
 * Strict Phase 5 guarantees:
 * 1. Password complexity: min 10 chars, uppercase, lowercase, number/symbol.
 * 2. Account uniqueness check (requires explicit --force-update flag to modify existing accounts).
 * 3. Verified database write: re-queries MongoDB to confirm record persistence.
 */

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load environment configuration
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { User, AuditLog } = require('../src/models');
const { hashPassword } = require('../src/utils/crypto');

function validateSuperadminPassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, reason: 'Password is required' };
  }
  if (password.length < 10) {
    return { valid: false, reason: 'Password must be at least 10 characters long for production super-admin' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one uppercase letter (A-Z)' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one lowercase letter (a-z)' };
  }
  if (!/[0-9\W_]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one number or special symbol' };
  }
  return { valid: true };
}

async function bootstrapSuperadmin(opts = {}) {
  const isCli = require.main === module;

  const email = (opts.email || process.argv[2] || process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = opts.password || process.argv[3] || process.env.SUPERADMIN_PASSWORD || '';
  const name = (opts.name || process.argv[4] || process.env.SUPERADMIN_NAME || 'System Administrator').trim();
  const forceUpdate = opts.forceUpdate !== undefined
    ? Boolean(opts.forceUpdate)
    : (process.argv.includes('--force-update') || process.env.ALLOW_SUPERADMIN_UPDATE === 'true');
  const shouldClose = opts.closeConnection !== undefined ? opts.closeConnection : isCli;

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    const err = 'A valid super-admin email address is required.';
    if (isCli) {
      console.error(`[Error] ${err}`);
      console.error('Usage: node backend/scripts/bootstrap-superadmin.js <email> <password> [name] [--force-update]');
      process.exit(1);
    }
    throw new Error(err);
  }

  // Validate password strength
  const passCheck = validateSuperadminPassword(password);
  if (!passCheck.valid) {
    const err = `Password strength check failed: ${passCheck.reason}`;
    if (isCli) {
      console.error(`[Error] ${err}`);
      process.exit(1);
    }
    throw new Error(err);
  }

  const uri = opts.uri || process.env.MONGODB_URI;
  if (!uri || uri.includes('<username>') || uri.includes('<password>')) {
    const err = 'Valid MONGODB_URI is not configured in environment';
    if (isCli) {
      console.error(`[Error] ${err}`);
      process.exit(1);
    }
    throw new Error(err);
  }

  if (mongoose.connection.readyState === 0) {
    console.log('[Connecting] Connecting to MongoDB...');
    await mongoose.connect(uri);
  }

  const dbName = mongoose.connection.name;
  console.log(`[Connected] Connected to database: "${dbName}"\n`);

  const hashedPassword = await hashPassword(password);

  let existing = await User.findOne({ email });
  let savedUser = null;

  if (existing) {
    if (!forceUpdate) {
      const err = `Account "${email}" already exists. To update or elevate an existing account, pass --force-update or set ALLOW_SUPERADMIN_UPDATE=true.`;
      console.error(`[Safety Refusal] ${err}`);
      if (shouldClose) await mongoose.connection.close();
      if (isCli) process.exit(1);
      throw new Error(err);
    }

    console.log(`[Update] Updating existing user "${email}" to superadmin role with updated credentials...`);
    existing.role = 'superadmin';
    existing.businessId = null;
    existing.password = hashedPassword;
    if (name) existing.name = name;
    savedUser = await existing.save();
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
    savedUser = await newAdmin.save();
    console.log(`[Success] Superadmin "${email}" successfully created.`);
  }

  // Verify successful database write by re-querying MongoDB
  const verified = await User.findById(savedUser._id).lean();
  if (!verified || verified.role !== 'superadmin' || verified.email !== email) {
    const err = `Database write verification failed for "${email}". Record not persisted correctly.`;
    if (shouldClose) await mongoose.connection.close();
    if (isCli) {
      console.error(`[Fatal Error] ${err}`);
      process.exit(1);
    }
    throw new Error(err);
  }
  console.log(`[Verified] Database write verified in MongoDB. Account ID: ${verified._id}`);

  // Audit log entry
  try {
    await AuditLog.create({
      action: 'Superadmin Bootstrapped',
      actor: name || email,
      details: `Superadmin account ${email} provisioned/updated via bootstrap CLI (Write Verified)`,
      createdAt: new Date()
    });
  } catch (auditErr) {
    // Non-fatal if audit log fails
  }

  if (shouldClose) {
    await mongoose.connection.close();
    console.log('[Completed] Database connection closed cleanly.\n');
  }

  if (isCli) {
    process.exit(0);
  }

  return verified;
}

if (require.main === module) {
  bootstrapSuperadmin().catch(err => {
    console.error('[Bootstrap Error]:', err.message);
    process.exit(1);
  });
}

module.exports = {
  bootstrapSuperadmin,
  validateSuperadminPassword
};
