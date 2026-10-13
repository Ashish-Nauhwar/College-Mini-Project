const jwt = require('jsonwebtoken');
const db = require('../db');

const isProd = process.env.NODE_ENV === 'production';
let JWT_SECRET = process.env.JWT_SECRET;

if (isProd) {
  if (!JWT_SECRET || JWT_SECRET === 'feedbackhub-super-secret-key-2026' || JWT_SECRET.length < 32) {
    console.error('\n===============================================================');
    console.error(' [FATAL SECURITY ERROR] Insecure or missing JWT_SECRET in production!');
    console.error(' JWT_SECRET must be explicitly configured in backend/.env with at least 32 characters.');
    console.error('===============================================================\n');
    process.exit(1);
  }
} else {
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
  requireRole
};
