const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Robust environment detection: check backend/.env first, then root .env
const envPathBackend = path.join(__dirname, '.env');
const envPathRoot = path.join(__dirname, '..', '.env');
let activeEnvPath = null;
if (fs.existsSync(envPathBackend)) {
  activeEnvPath = envPathBackend;
} else if (fs.existsSync(envPathRoot)) {
  activeEnvPath = envPathRoot;
}

if (activeEnvPath) {
  dotenv.config({ path: activeEnvPath });
} else {
  dotenv.config();
}

const express = require('express');
const cors = require('cors');
const { connectDB, isDbConnected } = require('./src/config/db');
const db = require('./src/db');

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
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : (process.env.PUBLIC_APP_URL ? [process.env.PUBLIC_APP_URL.trim()] : ['http://localhost:3000', 'http://127.0.0.1:3000']);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (NODE_ENV !== 'production') {
      if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
        return callback(null, true);
      }
    }
    if (corsOrigins.includes(origin)) {
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

// Health check endpoint (Accurately reports database readiness; returns 503 if disconnected)
app.get('/api/health', (req, res) => {
  const isProd = NODE_ENV === 'production';
  const realDbReady = isDbConnected();
  const mockActive = db.isMockDbActive();

  // In production, ready ONLY if genuine persistent MongoDB is connected and mock is NOT active
  const isReady = isProd ? (realDbReady && !mockActive) : (realDbReady || mockActive);
  const statusCode = isReady ? 200 : 503;

  return res.status(statusCode).json({
    status: isReady ? 'healthy' : 'degraded',
    ready: isReady,
    database: realDbReady ? 'connected' : (mockActive ? 'mock' : 'disconnected'),
    storage: mockActive ? 'in-memory-mock' : (realDbReady ? 'mongodb' : 'none'),
    uptime: `${Math.floor(process.uptime())}s`,
    environment: NODE_ENV,
    pid: process.pid
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

// Unknown API route fallback: returns JSON 404 (never HTML)
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API endpoint "${req.method} ${req.path}" not found` });
});

// Public Feedback Form route: /feedback/:slug
app.get('/feedback/:slug', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'feedback.html'));
});

// Static asset 404 handler (prevents returning index.html for missing .js, .css, images, etc.)
app.use((req, res, next) => {
  if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
    return res.status(404).type('text/plain').send('File not found');
  }
  next();
});

// Single Page Application fallback for all dashboard routes
app.get('*', (req, res) => {
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
  const http = require('http');
  const server = http.createServer(app);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('\n===============================================================');
      console.error(` [FATAL] Port ${PORT} is already occupied by another process [PID: ${process.pid}].`);
      console.error(` Another Node.js instance is already listening on port ${PORT}.`);
      console.error(` Terminate the conflicting process (e.g. netstat -ano | findstr :${PORT}) or configure PORT in your environment.`);
      console.error('===============================================================\n');
      process.exit(1);
    }
    console.error('[Server Error]:', err);
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n===============================================================`);
    console.log(`[Startup] FeedbackHub Application Server Initialized`);
    console.log(`[Startup] Process ID: ${process.pid}`);
    console.log(`[Startup] Listening on: http://0.0.0.0:${PORT} [PID: ${process.pid}]`);
    console.log(`[Startup] Environment: ${NODE_ENV} (.env: ${activeEnvPath || 'System environment'})`);
    console.log(`[Startup] MongoDB URI: ${process.env.MONGODB_URI ? 'Configured' : 'NOT CONFIGURED'}`);

    if (NODE_ENV === 'production') {
      if (process.env.TEST_MOCK_DB === 'true' || db.isMockDbActive()) {
        console.error('\n===============================================================');
        console.error('[FATAL CONFIGURATION ERROR] Mock database mode cannot be activated in production (NODE_ENV=production).');
        console.error('Production environments require a genuine MongoDB Atlas connection. Exiting.');
        console.error('===============================================================\n');
        server.close(() => process.exit(1));
        return;
      }
    }

    // Attempt MongoDB connection after successful port binding
    const dbConnected = await connectDB();
    console.log(`[Startup] Database Readiness: ${dbConnected ? 'CONNECTED' : 'DISCONNECTED (STANDBY)'}`);
    console.log(`===============================================================\n`);

    if (!dbConnected && NODE_ENV === 'production') {
      console.error('[CRITICAL] Production server cannot start without an active MongoDB connection. Exiting.');
      server.close(() => process.exit(1));
    }
  });
}

module.exports = app;
