const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment configuration from backend/.env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`[ENV] Successfully loaded configuration from: ${envPath}`);
} else {
  dotenv.config();
}

const express = require('express');
const cors = require('cors');
const { connectDB, isDbConnected } = require('./src/config/db');

const authRoutes = require('./src/routes/auth');
const locationRoutes = require('./src/routes/locations');
const formRoutes = require('./src/routes/forms');
const feedbackRoutes = require('./src/routes/feedback');
const analyticsRoutes = require('./src/routes/analytics');
const adminRoutes = require('./src/routes/admin');
const qrRoutes = require('./src/routes/qr');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Resolve frontend static directory
const FRONTEND_DIR = fs.existsSync(path.join(__dirname, '..', 'frontend'))
  ? path.join(__dirname, '..', 'frontend')
  : (fs.existsSync(path.join(__dirname, 'frontend'))
    ? path.join(__dirname, 'frontend')
    : path.join(__dirname, '..', 'public'));

// --- Security Middleware ---
// 1. Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// 2. CORS configuration with explicit origin allowlist
const corsOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : (process.env.PUBLIC_APP_URL ? [process.env.PUBLIC_APP_URL] : ['http://localhost:3000', 'http://127.0.0.1:3000']);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (NODE_ENV !== 'production') {
      if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
        return callback(null, true);
      }
    }
    if (corsOrigins.includes(origin) || corsOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true
}));

// 3. Request parsing with safe payload limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 4. Production Sliding Window Rate Limiters
const { createSlidingWindowLimiter } = require('./src/middleware/rateLimiter');
const authLimiter = createSlidingWindowLimiter({ windowMs: 60000, max: 30, message: 'Too many authentication attempts. Please try again shortly.' });
const submitLimiter = createSlidingWindowLimiter({ windowMs: 60000, max: 45, message: 'Too many feedback submissions. Please slow down.' });

// Serve static frontend assets
app.use(express.static(FRONTEND_DIR));

// Health check endpoint (Distinguishes running process from database readiness)
app.get('/api/health', (req, res) => {
  const ready = isDbConnected();
  return res.status(200).json({
    status: 'healthy',
    ready,
    database: ready ? 'connected' : 'disconnected',
    uptime: `${Math.floor(process.uptime())}s`,
    environment: NODE_ENV
  });
});

// Mount API routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/feedback', (req, res, next) => {
  if (req.method === 'POST' && req.path.startsWith('/submit')) {
    return submitLimiter(req, res, next);
  }
  next();
}, feedbackRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/qr', qrRoutes);

// Public Feedback Form route: /feedback/:slug
app.get('/feedback/:slug', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'feedback.html'));
});

// Single Page Application fallback for all dashboard routes
app.use((req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Global Error Handler (Sanitizes stack traces and secrets)
app.use((err, req, res, next) => {
  const isCors = err.message && err.message.includes('CORS');
  if (isCors) {
    return res.status(403).json({ error: err.message });
  }
  const status = err.statusCode || 500;
  const message = (NODE_ENV === 'production' && status === 500)
    ? 'Internal server error'
    : (err.message || 'Server error');
  return res.status(status).json({ error: message });
});

// Start Server
if (require.main === module) {
  (async () => {
    // Attempt MongoDB connection
    const dbConnected = await connectDB();
    if (!dbConnected && NODE_ENV === 'production') {
      console.error('[CRITICAL] Production server cannot start without an active MongoDB connection. Exiting.');
      process.exit(1);
    }

    app.listen(PORT, () => {
      console.log(`FeedbackHub server running at http://localhost:${PORT} (ENV: ${NODE_ENV}, DB: ${dbConnected ? 'CONNECTED' : 'STANDBY'})`);
    });
  })();
}

module.exports = app;
