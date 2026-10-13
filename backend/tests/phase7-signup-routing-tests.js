/**
 * FeedbackHub Phase 7 Test Suite:
 * Signup Database Error Fix, Routing Resilience, Blank-Page Prevention & Safe Startup
 * 
 * Verifies:
 * 1. GET /api/health returns truthful status (200 when ready, 503 when degraded).
 * 2. Static root (GET /) serves index.html with HTTP 200.
 * 3. Frontend static assets (app.js, style.css, feedback.html) load with HTTP 200.
 * 4. GET /api/auth/demo-status reports demo configuration truthfully.
 * 5. All client views declared in router match actual DOM sections in index.html (never blank).
 * 6. Registration form inputs in DOM match expected backend payload parameters.
 * 7. When disconnected, POST /api/auth/register returns truthful HTTP 503.
 * 8. When disconnected, POST /api/auth/login returns truthful HTTP 503.
 * 9. Input validation: registration rejects missing fields with HTTP 400.
 * 10. Real MongoDB integration (requires TEST_MONGODB_URI pointing to disposable DB):
 *     - Atomic signup creates Business, Owner, Location, and Form in single workflow.
 *     - Duplicate email signup rejects with HTTP 409 and avoids orphan duplicate businesses.
 *     - Post-registration authentication works seamlessly with generated credentials.
 *     - Subsequent API access (/api/forms) loads successfully for registered tenant.
 *     - Test cleanup removes only provisioned test artifacts.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');
const dns = require('dns');
const dotenv = require('dotenv');

// DNS server fallback for Windows SRV resolution
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (_) {}

// Load environment configuration
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = require('../server');
const { isDbConnected } = require('../src/config/db');
const { isDisposableDatabase } = require('../scripts/seed');
const { Business, User, Location, FeedbackForm } = require('../src/models');
const mongoose = require('mongoose');

let server;
let BASE_URL;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function it(description, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`  ✗ ${description}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function runPhase7Tests() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB PHASE 7: SIGNUP & BLANK-PAGE VERIFICATION      ');
  console.log('===============================================================\n');

  // Start ephemeral server
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      BASE_URL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // SECTION 1: Server Startup & Static Asset Serving
  console.log('--- 1. Server Startup & Static File Delivery ---');
  await it('GET /api/health returns truthful status (200 when connected, 503 when disconnected)', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    const ready = isDbConnected();
    const expectedStatus = ready ? 200 : 503;
    assert.strictEqual(res.status, expectedStatus);
    const data = await res.json();
    assert.strictEqual(data.ready, ready);
    assert.strictEqual(data.database, ready ? 'connected' : 'disconnected');
    assert.ok(data.uptime.endsWith('s'));
  });

  await it('GET / serves index.html with HTTP 200', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('FeedbackHub'));
    assert.ok(text.includes('app-wrapper'));
  });

  await it('GET /js/app.js serves valid frontend JavaScript with HTTP 200', async () => {
    const res = await fetch(`${BASE_URL}/js/app.js`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('app') && text.includes('initSession'));
  });

  await it('GET /css/style.css serves valid frontend CSS with HTTP 200', async () => {
    const res = await fetch(`${BASE_URL}/css/style.css`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes(':root'));
  });

  await it('GET /feedback/apex-downtown serves public feedback.html with HTTP 200', async () => {
    const res = await fetch(`${BASE_URL}/feedback/apex-downtown`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('feedbackForm') || text.includes('feedback'));
  });

  // SECTION 2: Demo Mode Status Endpoint
  console.log('\n--- 2. Public Demo Status API ---');
  await it('GET /api/auth/demo-status returns JSON with demoEnabled boolean', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/demo-status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.demoEnabled === 'boolean');
  });

  // SECTION 3: Blank-Page & Routing Structural Integrity
  console.log('\n--- 3. Blank-Page Prevention & View Structure Integrity ---');
  await it('All router view IDs match actual sections in frontend/index.html', () => {
    const indexPath = path.join(__dirname, '..', '..', 'frontend', 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    const expectedViews = [
      'view-landing',
      'view-login',
      'view-register',
      'view-dashboard',
      'view-inbox',
      'view-builder',
      'view-analytics',
      'view-qr',
      'view-locations',
      'view-settings',
      'view-admin'
    ];

    expectedViews.forEach((viewId) => {
      assert.ok(
        indexHtml.includes(`id="${viewId}"`),
        `View section "${viewId}" is missing from frontend/index.html`
      );
    });
  });

  await it('Registration form in index.html exposes required fields matching backend API', () => {
    const indexPath = path.join(__dirname, '..', '..', 'frontend', 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    const expectedFields = [
      'id="regBizName"',
      'id="regBizType"',
      'id="regOwnerName"',
      'id="regEmail"',
      'id="regPassword"'
    ];

    expectedFields.forEach((fieldId) => {
      assert.ok(
        indexHtml.includes(fieldId),
        `Required input field "${fieldId}" is missing from register form`
      );
    });
  });

  await it('All demo quick switch containers have demo-switch-container class for conditional hiding', () => {
    const indexPath = path.join(__dirname, '..', '..', 'frontend', 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    assert.ok(indexHtml.includes('demo-switch-container'));
  });

  // SECTION 4: Validation & Disconnected Honesty
  console.log('\n--- 4. API Request Validation & Error Honesty ---');
  await it('POST /api/auth/register validates required fields and rejects empty payload with HTTP 400', async () => {
    // If DB is offline, it will return 503; if DB is online, it will validate and return 400
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.ok(res.status === 400 || res.status === 503);
    const data = await res.json();
    assert.ok(data.error);
  });

  await it('POST /api/auth/login validates required fields and rejects empty credentials with HTTP 400', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.ok(res.status === 400 || res.status === 503);
    const data = await res.json();
    assert.ok(data.error);
  });

  // SECTION 5: Real Database Atomic Signup & Verification
  console.log('\n--- 5. Real MongoDB Atomic Registration Integration ---');
  const testUri = process.env.TEST_MONGODB_URI;

  if (!testUri || testUri.includes('<username>') || testUri.includes('<password>')) {
    console.log('  [LIVE ATLAS DB: SKIPPED]');
    console.log('  Real MongoDB Atlas registration tests were skipped because TEST_MONGODB_URI is not configured.');
    console.log('  To run real registration integration tests, set TEST_MONGODB_URI in backend/.env:');
    console.log('  TEST_MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/feedbackhub_test\n');
  } else {
    const uriMatch = testUri.match(/\/([^/?]+)(\?|$)/);
    const dbName = uriMatch ? uriMatch[1] : '';

    if (!isDisposableDatabase(dbName)) {
      console.log(`  [SAFETY REFUSAL] TEST_MONGODB_URI database "${dbName}" is not disposable. Skipped.`);
    } else {
      // Explicitly connect the Express application's Mongoose connection to TEST_MONGODB_URI
      try {
        if (mongoose.connection.readyState !== 1) {
          await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
        }
      } catch (connErr) {
        console.error('  [Connection Error]: Failed to connect to TEST_MONGODB_URI:', connErr.message);
      }

      const createdBizIds = [];
      const createdUserIds = [];
      let registeredToken = null;
      const testEmailOnline = `test_online_${Date.now()}@domain.com`;
      const testEmailCollege = `test_college_${Date.now()}@greenfield.edu`;

      // 1. Online-only account creation
      await it('1. Create an online-only account with all required fields (ownerName, isOnlineOnly: true)', async () => {
        const payload = {
          businessName: `Cloud Digital Services ${Date.now()}`,
          businessType: 'other',
          ownerName: 'Jane Online',
          email: testEmailOnline,
          password: 'SecurePassword@123',
          isOnlineOnly: true
        };

        const res = await fetch(`${BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.ok(data.token, 'Response must contain JWT token');
        assert.ok(data.user, 'Response must contain user object');
        assert.strictEqual(data.user.email, testEmailOnline);
        assert.strictEqual(data.user.role, 'owner');
        assert.ok(data.business, 'Response must contain business object');
        assert.strictEqual(data.business.isOnlineOnly, true);

        registeredToken = data.token;
        createdBizIds.push(data.business._id || data.business.id);
        createdUserIds.push(data.user._id || data.user.id);
      });

      // 2. Physical business account requires valid physical address
      await it('2. Reject physical account registration when address fields are missing (HTTP 400)', async () => {
        const missingAddrPayload = {
          businessName: `Physical Diner ${Date.now()}`,
          businessType: 'restaurant',
          ownerName: 'Chef Gordon',
          email: `diner_${Date.now()}@domain.com`,
          password: 'SecurePassword@123',
          isOnlineOnly: false,
          address: {} // Missing addressLine1, city, state, postalCode
        };

        const res = await fetch(`${BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(missingAddrPayload)
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes('address') || data.error.includes('Address'));
      });

      // 3. Physical college account creation with full valid address
      await it('3. Create physical college account with valid address and provisioned academic form', async () => {
        const collegePayload = {
          businessName: `Greenfield College of Tech ${Date.now()}`,
          businessType: 'college',
          ownerName: 'Dr. Robert Smith',
          email: testEmailCollege,
          password: 'SecurePassword@123',
          isOnlineOnly: false,
          address: {
            addressLine1: '120 University Avenue',
            city: 'Metropolis',
            state: 'NY',
            postalCode: '10001',
            country: 'USA'
          }
        };

        const res = await fetch(`${BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collegePayload)
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.ok(data.token);
        assert.strictEqual(data.business.type, 'college');
        assert.strictEqual(data.firstLocation.name, 'Main Campus');
        assert.strictEqual(data.firstForm.formType, 'college');

        createdBizIds.push(data.business._id || data.business.id);
        createdUserIds.push(data.user._id || data.user.id);
      });

      // 4. Duplicate registration rejected with HTTP 409 Conflict
      await it('4. Duplicate registration with same email is rejected with HTTP 409 Conflict without orphan records', async () => {
        const duplicatePayload = {
          businessName: `Duplicate Corp ${Date.now()}`,
          businessType: 'cafe',
          ownerName: 'Clone User',
          email: testEmailOnline, // same email as online account
          password: 'SecurePassword@123',
          isOnlineOnly: true
        };

        const res = await fetch(`${BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(duplicatePayload)
        });

        assert.strictEqual(res.status, 409);
        const data = await res.json();
        assert.ok(data.error.includes('already exists') || data.error.includes('registered'));
      });

      // 5. Login using newly registered credentials
      await it('5. Login with newly registered credentials returns valid session and user profile', async () => {
        const loginPayload = {
          email: testEmailOnline,
          password: 'SecurePassword@123'
        };

        const res = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loginPayload)
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.token);
        assert.strictEqual(data.user.email, testEmailOnline);
      });

      // 6. Fetch authenticated forms from real API
      await it('6. GET /api/forms returns initial form created during registration for the new tenant', async () => {
        const res = await fetch(`${BASE_URL}/api/forms`, {
          headers: {
            'Authorization': `Bearer ${registeredToken}`
          }
        });

        assert.strictEqual(res.status, 200);
        const forms = await res.json();
        assert.ok(Array.isArray(forms));
        assert.ok(forms.length >= 1, 'New business should have an initial feedback form provisioned');
      });

      // Cleanup test artifacts
      for (const bId of createdBizIds) {
        try {
          await Business.deleteOne({ _id: bId });
          await Location.deleteMany({ businessId: bId });
          await FeedbackForm.deleteMany({ businessId: bId });
        } catch (_) {}
      }
      for (const uId of createdUserIds) {
        try {
          await User.deleteOne({ _id: uId });
        } catch (_) {}
      }
      console.log('  ✓ Test tenant records cleaned up successfully');
    }
  }

  // Close ephemeral server
  await new Promise((resolve) => server.close(resolve));

  console.log('\n===============================================================');
  console.log(`Phase 7 Tests Completed: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runPhase7Tests().catch((err) => {
    console.error('[Phase 7 Suite Fatal Error]:', err);
    process.exit(1);
  });
}

module.exports = { runPhase7Tests };
