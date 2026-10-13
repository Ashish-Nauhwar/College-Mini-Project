#!/usr/bin/env node
/**
 * Safe Diagnostic CLI Script for FeedbackHub
 * 
 * Inspects local environment, checks port availability, verifies database connectivity,
 * and confirms presence of essential frontend assets without leaking secrets or credentials.
 * 
 * Usage:
 *   npm run diagnose
 *   node backend/scripts/diagnose.js
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns');
const dotenv = require('dotenv');

// Public DNS fallback for Windows local router SRV resolution
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (_) {}

// Locate environment files (same resolution order as backend/server.js)
const backendEnvPath = path.resolve(__dirname, '..', '.env');
const rootEnvPath = path.resolve(__dirname, '..', '..', '.env');

let detectedEnvPath = null;
if (fs.existsSync(backendEnvPath)) {
  detectedEnvPath = backendEnvPath;
  dotenv.config({ path: backendEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  detectedEnvPath = rootEnvPath;
  dotenv.config({ path: rootEnvPath });
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const MONGODB_URI = process.env.MONGODB_URI || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
const FRONTEND_DIR = path.resolve(__dirname, '..', '..', 'frontend');

// Mask MongoDB URI to safely display connection target without exposing credentials
function maskMongoUri(uri) {
  if (!uri) return 'None (not configured)';
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//****:****@${parsed.host}${parsed.pathname || ''}`;
  } catch (_) {
    return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
  }
}

// Check whether another process is currently binding the configured port
async function testPortAvailability(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ available: false, error: 'EADDRINUSE: Port is already bound by another process' });
      } else {
        resolve({ available: false, error: err.message });
      }
    });
    tester.once('listening', () => {
      tester.close(() => resolve({ available: true, error: null }));
    });
    tester.listen(port, '0.0.0.0');
  });
}

// Check real database connectivity with timeout
async function testDatabaseConnectivity(uri) {
  if (!uri || uri.includes('<username>') || uri.includes('<password>')) {
    return { ok: false, message: 'Invalid or placeholder credentials in MONGODB_URI' };
  }
  const mongoose = require('mongoose');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const isReady = mongoose.connection.readyState === 1;
    const dbName = mongoose.connection.name || 'default';
    await mongoose.connection.close();
    return { ok: isReady, message: `Connected successfully (database: "${dbName}", readyState: 1)` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// Check presence and readability of core frontend files
function checkFrontendFiles() {
  const files = [
    { relative: 'index.html', required: true },
    { relative: 'feedback.html', required: true },
    { relative: 'js/app.js', required: true },
    { relative: 'css/style.css', required: true }
  ];

  return files.map((file) => {
    const fullPath = path.join(FRONTEND_DIR, file.relative);
    if (!fs.existsSync(fullPath)) {
      return { path: `frontend/${file.relative}`, exists: false, size: 0 };
    }
    const stat = fs.statSync(fullPath);
    return { path: `frontend/${file.relative}`, exists: true, size: stat.size };
  });
}

async function runDiagnostics() {
  console.log('\n===============================================================');
  console.log('              FEEDBACKHUB SYSTEM DIAGNOSTICS REPORT            ');
  console.log('===============================================================\n');

  let hasErrors = false;

  // 1. Environment File Check
  console.log('[1/5] Environment File Detection:');
  if (detectedEnvPath) {
    console.log(`  ✓ Detected: ${detectedEnvPath}`);
  } else {
    console.log(`  ✗ Warning: No .env found at backend/.env or root .env`);
    console.log(`    Ensure backend/.env is created from backend/.env.example`);
    hasErrors = true;
  }
  console.log(`  ✓ NODE_ENV: ${NODE_ENV}\n`);

  // 2. Configured Port and Availability
  console.log('[2/5] Server Port Availability:');
  console.log(`  Configured Port: ${PORT}`);
  const portResult = await testPortAvailability(PORT);
  if (portResult.available) {
    console.log(`  ✓ Port ${PORT} is AVAILABLE for binding.`);
  } else {
    console.log(`  ✗ Port ${PORT} is OCCUPIED: ${portResult.error}`);
    console.log(`    Remediation: Terminate the conflicting process or change PORT in backend/.env.`);
    console.log(`    Windows lookup command: netstat -ano | findstr :${PORT}`);
    hasErrors = true;
  }
  console.log('');

  // 3. MongoDB URI Status
  console.log('[3/5] Database URI Configuration:');
  if (!MONGODB_URI) {
    console.log('  ✗ MONGODB_URI is NOT set in environment.');
    console.log('    Set MONGODB_URI in backend/.env to your MongoDB Atlas cluster URI.');
    hasErrors = true;
  } else if (MONGODB_URI.includes('<username>') || MONGODB_URI.includes('<password>')) {
    console.log(`  ✗ MONGODB_URI contains unreplaced placeholders: ${maskMongoUri(MONGODB_URI)}`);
    console.log('    Replace <username> and <password> with your actual database user credentials.');
    hasErrors = true;
  } else {
    console.log(`  ✓ Configured URI: ${maskMongoUri(MONGODB_URI)}`);
  }
  console.log('');

  // 4. Database Connection Test
  console.log('[4/5] Live Database Connectivity:');
  if (MONGODB_URI && !MONGODB_URI.includes('<username>')) {
    process.stdout.write('  Pinging MongoDB Atlas (5s timeout)... ');
    const dbResult = await testDatabaseConnectivity(MONGODB_URI);
    if (dbResult.ok) {
      console.log(`\n  ✓ ${dbResult.message}`);
    } else {
      console.log(`\n  ✗ Connection failed: ${dbResult.message}`);
      console.log('    Ensure your current IP address is whitelisted in Atlas Network Access');
      console.log('    and that database credentials in backend/.env are accurate.');
      hasErrors = true;
    }
  } else {
    console.log('  - Skipped live connection check due to missing or placeholder URI.');
  }
  console.log('');

  // 5. Frontend Files Check
  console.log('[5/5] Frontend Static Assets Check:');
  const frontendResults = checkFrontendFiles();
  frontendResults.forEach((f) => {
    if (f.exists) {
      console.log(`  ✓ ${f.path.padEnd(26)} (OK, ${(f.size / 1024).toFixed(1)} KB)`);
    } else {
      console.log(`  ✗ ${f.path.padEnd(26)} (MISSING)`);
      hasErrors = true;
    }
  });
  console.log('');

  // Diagnostic Summary
  console.log('===============================================================');
  if (hasErrors) {
    console.log('  STATUS: ISSUES DETECTED ⚠️');
    console.log('  Review the messages above to address configuration problems.');
    console.log('===============================================================\n');
    process.exit(1);
  } else {
    console.log('  STATUS: ALL CHECKS PASSED ✓');
    console.log('  System is healthy and ready to run via `npm start`.');
    console.log('===============================================================\n');
    process.exit(0);
  }
}

if (require.main === module) {
  runDiagnostics().catch((err) => {
    console.error('[Diagnostic Fatal Error]:', err);
    process.exit(1);
  });
}

module.exports = {
  testPortAvailability,
  testDatabaseConnectivity,
  maskMongoUri,
  checkFrontendFiles
};
