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

const authRoutes = require('./src/routes/auth');
const locationRoutes = require('./src/routes/locations');
const formRoutes = require('./src/routes/forms');
const feedbackRoutes = require('./src/routes/feedback');
const analyticsRoutes = require('./src/routes/analytics');
const adminRoutes = require('./src/routes/admin');
const qrRoutes = require('./src/routes/qr');

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve frontend static directory (supports frontend/ or public/ fallback)
const FRONTEND_DIR = fs.existsSync(path.join(__dirname, '..', 'frontend'))
  ? path.join(__dirname, '..', 'frontend')
  : (fs.existsSync(path.join(__dirname, 'frontend'))
    ? path.join(__dirname, 'frontend')
    : path.join(__dirname, '..', 'public'));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(FRONTEND_DIR));

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/feedback', feedbackRoutes);
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

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FeedbackHub server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
