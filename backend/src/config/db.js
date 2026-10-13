const mongoose = require('mongoose');
const dns = require('dns');

// Apply public DNS fallback for Windows local router SRV resolution bugs (querySrv ECONNREFUSED)
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (dnsErr) {
  // Non-fatal in restricted sandbox environments
}

// Attach persistent connection event listeners once
let listenersAttached = false;
function attachConnectionListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on('connected', () => {
    console.log('[MongoDB] Connected successfully to database');
  });

  mongoose.connection.on('error', (err) => {
    console.error('[MongoDB] Connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] Disconnected from database');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[MongoDB] Reconnected successfully to database');
  });
}

attachConnectionListeners();

/**
 * Connect to MongoDB Atlas using the configured MONGODB_URI.
 * Safe against double-connects and credentials leaks.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri || uri.includes('<username>') || uri.includes('<password>')) {
    console.error('\n===============================================================');
    console.error(' [FATAL] MONGODB_URI is not configured in backend/.env');
    console.error(' Please configure a valid MongoDB Atlas connection string:');
    console.error(' Example: MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/feedbackhub');
    console.error('===============================================================\n');
    return false;
  }

  // If already connected, return immediately
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });
    return mongoose.connection.readyState === 1;
  } catch (err) {
    console.error('\n===============================================================');
    console.error(' [FATAL] Failed to connect to MongoDB Atlas:');
    console.error(' ' + err.message);
    console.error(' Ensure your IP is whitelisted in Atlas Network Access and');
    console.error(' that your credentials in MONGODB_URI are correct.');
    console.error('===============================================================\n');
    return false;
  }
}

// Graceful shutdown
async function closeDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    console.log('[MongoDB] Connection closed through graceful shutdown');
  }
}

process.on('SIGINT', async () => {
  await closeDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDB();
  process.exit(0);
});

/**
 * Authoritative Database Readiness Check.
 * Directly inspects the underlying Mongoose connection readyState.
 * Returns true strictly when connected (readyState === 1).
 * Never relies on a stale boolean.
 */
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Returns diagnostic metadata about database state without exposing secrets.
 */
function getDbState() {
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const readyState = mongoose.connection.readyState;
  return {
    connected: readyState === 1,
    readyState,
    status: states[readyState] || 'unknown',
    dbName: mongoose.connection.name || null
  };
}

module.exports = {
  connectDB,
  closeDB,
  isDbConnected,
  getDbState
};
