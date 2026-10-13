/**
 * FeedbackHub Cryptographic & Password Hashing Utilities
 * 
 * Uses maintained bcrypt with per-password salts and standard work factor.
 * Insecure fixed-salt fallback algorithms are strictly prohibited and removed.
 */

let bcryptLib = null;
try {
  bcryptLib = require('bcrypt');
} catch (e) {
  try {
    bcryptLib = require('bcryptjs');
  } catch (e2) {
    bcryptLib = null;
  }
}

/**
 * Asserts that the password hashing library is loaded.
 * Fails safely if bcrypt cannot be loaded.
 */
function assertBcryptAvailable() {
  if (!bcryptLib) {
    throw new Error(
      '[Security Configuration Error] Maintained password hashing library (bcrypt) could not be loaded. ' +
      'Silent fallback to insecure fixed-salt algorithms is strictly prohibited. ' +
      'Please ensure bcrypt or bcryptjs is installed.'
    );
  }
}

/**
 * Hash a password using bcrypt with securely generated per-password salt.
 * Standard work factor: 10
 */
function hashPassword(password) {
  assertBcryptAvailable();
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return bcryptLib.hashSync(password, 10);
}

/**
 * Verify a plain-text password against a stored bcrypt hash.
 * Safely handles bcrypt formats ($2a$, $2b$, $2y$).
 */
function comparePassword(password, hash) {
  assertBcryptAvailable();
  if (!password || !hash || typeof password !== 'string' || typeof hash !== 'string') {
    return false;
  }
  // All supported bcrypt hashes start with $2
  if (hash.startsWith('$2')) {
    try {
      return bcryptLib.compareSync(password, hash);
    } catch (_) {
      return false;
    }
  }
  return false;
}

module.exports = {
  hashPassword,
  comparePassword,
  assertBcryptAvailable
};
