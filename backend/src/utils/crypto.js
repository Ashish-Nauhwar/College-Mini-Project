const crypto = require('crypto');

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

function hashPassword(password) {
  if (bcryptLib) {
    return bcryptLib.hashSync(password, 10);
  }
  // Pure Node.js crypto fallback
  const salt = 'feedbackhub_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

function comparePassword(password, hash) {
  if (bcryptLib && hash.startsWith('$2')) {
    return bcryptLib.compareSync(password, hash);
  }
  const computed = hashPassword(password);
  return computed === hash;
}

module.exports = {
  hashPassword,
  comparePassword
};
