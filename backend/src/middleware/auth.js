const jwt = require('jsonwebtoken');
const db = require('../db');

const FORBIDDEN_SECRETS = [
  'feedbackhub-super-secret-key-2026',
  'feedbackhub-dev-secret-key-for-local-testing-min-32-chars',
  'replace-with-a-very-secure-random-secret-key-at-least-32-chars',
  'GENERATE_SECURE_SECRET_WITH_CRYPTO_RANDOMBYTES_32',
  'your_jwt_secret_here',
  'jwt_secret',
  'secret',
  'supersecret',
  '12345678901234567890123456789012'
];

function validateJwtSecret(secret, isProd = process.env.NODE_ENV === 'production') {
  if (!secret || typeof secret !== 'string') {
    return { valid: false, reason: 'JWT_SECRET must be a non-empty string' };
  }

  const trimmed = secret.trim();

  if (isProd) {
    const lower = trimmed.toLowerCase();
    for (const forbidden of FORBIDDEN_SECRETS) {
      if (lower === forbidden.toLowerCase()) {
        return { valid: false, reason: `JWT_SECRET matches known placeholder or default "${forbidden}". Please generate a unique cryptographic secret.` };
      }
    }
    if (trimmed.length < 32) {
      return { valid: false, reason: 'JWT_SECRET must be at least 32 characters in production' };
    }
  }

  return { valid: true };
}

const isProd = process.env.NODE_ENV === 'production';
let JWT_SECRET = process.env.JWT_SECRET;

const validation = validateJwtSecret(JWT_SECRET, isProd);
if (isProd && !validation.valid) {
  console.error('\n===============================================================');
  console.error(' [FATAL SECURITY ERROR] Insecure or invalid JWT_SECRET in production!');
  console.error(` ${validation.reason}`);
  console.error(' Generate a secure secret using: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('===============================================================\n');
  process.exit(1);
} else if (!isProd) {
  if (!JWT_SECRET || JWT_SECRET.length < 16) {
    JWT_SECRET = 'feedbackhub-dev-secret-key-for-local-testing-min-32-chars';
  }
}

function generateToken(user) {
  const userId = user._id ? user._id.toString() : user.id;
  const businessId = user.businessId
    ? (user.businessId._id ? user.businessId._id.toString() : user.businessId.toString())
    : null;

  return jwt.sign(
    {
      id: userId,
      role: user.role,
      businessId: businessId
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.findUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found or session expired' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role) && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Permission denied for this action' });
    }
    next();
  };
}

function verifyToken(token, secret = JWT_SECRET) {
  return jwt.verify(token, secret);
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken,
  requireAuth,
  requireRole,
  validateJwtSecret,
  FORBIDDEN_SECRETS
};
