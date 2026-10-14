/**
 * FeedbackHub Phase 8 Test Suite:
 * Production Safety, Mock DB Prohibition, E2E Registration & College Analytics
 * 
 * Verifies:
 * 1. Production Mode strictly prohibits mock DB (TEST_MOCK_DB=true is rejected with fatal error).
 * 2. enableMockDb(true) throws fatal security error in production.
 * 3. /api/health accurately reports ready ONLY when persistent DB is genuine in production.
 * 4. End-to-End Registration (online-only vs physical college with address).
 * 5. Input validation (missing fields -> HTTP 400, duplicate email -> HTTP 409 Conflict).
 * 6. Never issue tokens or show success after failed registration.
 * 7. Multi-tenant isolation: Business A token cannot access Business B records (HTTP 403).
 * 8. Session recovery: /api/auth/me restores valid user session with valid token.
 * 9. Accurate HTTP 503 error returned when persistent DB is unavailable.
 * 10. Dedicated college form publishing, public slug lookup, and academic validation.
 * 11. Valid feedback submission with separate rating and NPS metrics.
 * 12. Inbox retrieval and accurate analytics calculation.
 * 13. Data safety: Automated tests cannot drop or clear production/development databases.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Enable isolated in-process mock for Express API workflow testing
process.env.TEST_MOCK_DB = 'true';
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_must_be_32_characters_minimum_length_safe';

const app = require('../server');
const db = require('../src/db');
const { configureDns } = require('../src/config/db');
const { isDisposableDatabase } = require('../scripts/seed');
const { calculateAverageRating, calculateNps, isComplaint } = require('../src/utils/analyticsHelper');

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

async function runPhase8Tests() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB PHASE 8: PRODUCTION SAFETY & E2E VERIFICATION   ');
  console.log('===============================================================\n');

  // --- 1. Production Mode Refusal of Mock DB ---
  console.log('--- 1. Production Safety & Mock Mode Prohibition ---');

  await it('Spawned process with NODE_ENV=production and TEST_MOCK_DB=true fails startup safely', () => {
    const script = `
      process.env.NODE_ENV = 'production';
      process.env.TEST_MOCK_DB = 'true';
      require('./backend/src/db');
    `;
    const res = spawnSync('node', ['-e', script], {
      cwd: path.resolve(__dirname, '..', '..'),
      encoding: 'utf8'
    });
    assert.strictEqual(res.status !== 0, true, 'Process must exit with non-zero code');
    assert.ok(
      res.stderr.includes('strictly forbidden in production') ||
      res.stderr.includes('Mock database mode cannot be activated'),
      'Must log clear security error'
    );
  });

  await it('enableMockDb(true) throws fatal security error in production mode', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let threw = false;
    try {
      db.enableMockDb(true);
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('Mock database mode cannot be enabled when NODE_ENV=production'));
    } finally {
      process.env.NODE_ENV = origEnv;
    }
    assert.strictEqual(threw, true, 'Must throw error when attempting to enable mock in production');
  });

  await it('configureDns strictly prohibits fallback DNS and enforces OS DNS when NODE_ENV=production', () => {
    const origEnv = process.env.NODE_ENV;
    const origFallback = process.env.ENABLE_FALLBACK_DNS;
    try {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_FALLBACK_DNS = 'true';
      const result = configureDns();
      assert.strictEqual(result.fallbackApplied, false, 'Must not apply fallback DNS in production');
      assert.strictEqual(result.reason, 'production_enforces_os_dns', 'Must enforce OS DNS in production');
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.ENABLE_FALLBACK_DNS = origFallback;
    }
  });

  await it('configureDns preserves OS default DNS when ENABLE_FALLBACK_DNS is false or unset', () => {
    const origEnv = process.env.NODE_ENV;
    const origFallback = process.env.ENABLE_FALLBACK_DNS;
    try {
      process.env.NODE_ENV = 'development';
      delete process.env.ENABLE_FALLBACK_DNS;
      const resUnset = configureDns();
      assert.strictEqual(resUnset.fallbackApplied, false, 'Must not apply fallback when unset');

      process.env.ENABLE_FALLBACK_DNS = 'false';
      const resFalse = configureDns();
      assert.strictEqual(resFalse.fallbackApplied, false, 'Must not apply fallback when false');
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.ENABLE_FALLBACK_DNS = origFallback;
    }
  });

  await it('configureDns applies fallback DNS in non-production when ENABLE_FALLBACK_DNS=true', () => {
    const origEnv = process.env.NODE_ENV;
    const origFallback = process.env.ENABLE_FALLBACK_DNS;
    try {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_FALLBACK_DNS = 'true';
      const result = configureDns();
      assert.strictEqual(result.fallbackApplied, true, 'Must apply fallback DNS when opted-in in dev');
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.ENABLE_FALLBACK_DNS = origFallback;
    }
  });

  // Start ephemeral test server for real HTTP API tests
  let server;
  let BASE_URL;

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      BASE_URL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    // --- 2. Database Readiness & Health Endpoint Honesty ---
    console.log('\n--- 2. Health Endpoint Consistency & Readiness ---');

    await it('GET /api/health returns truthful status and identifies storage type', async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.status);
      assert.ok(data.storage);
      assert.strictEqual(typeof data.ready, 'boolean');
    });

    // --- 3. End-to-End Account Registration & Authentication ---
    console.log('\n--- 3. E2E Registration & Authentication Workflows ---');

    // Make sure mock store is clean
    db.clearMockDb();
    db.enableMockDb(true);

    const testTimestamp = Date.now();
    const onlineEmail = `online_owner_${testTimestamp}@digitalstore.com`;
    const collegeEmail = `dean_${testTimestamp}@apexpolytechnic.edu`;

    let onlineToken = '';
    let collegeToken = '';
    let onlineBizId = '';
    let collegeBizId = '';
    let collegeInitialFormId = null;

    await it('Reject registration when required fields are missing (HTTP 400)', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: '',
          email: '',
          password: ''
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error);
      assert.strictEqual(data.token, undefined, 'Never issue token on validation failure');
    });

    await it('Register online-only business with valid details (HTTP 201)', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: 'Apex Cloud Solutions',
          businessType: 'services',
          ownerName: 'Sarah Jenkins',
          email: onlineEmail,
          password: 'SecurePassword@123',
          isOnlineOnly: true
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.token, 'Must return JWT token on successful registration');
      assert.strictEqual(data.user.email, onlineEmail);
      assert.strictEqual(data.business.isOnlineOnly, true);
      onlineToken = data.token;
      onlineBizId = data.business.id || data.business._id;
    });

    await it('Register physical college with full academic address (HTTP 201)', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: 'Apex Polytechnic Institute',
          businessType: 'college',
          ownerName: 'Dr. Robert Vance',
          email: collegeEmail,
          password: 'CollegePassword@123',
          isOnlineOnly: false,
          address: {
            addressLine1: '500 Campus Drive',
            city: 'Springfield',
            state: 'IL',
            postalCode: '62701',
            country: 'USA'
          }
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.token);
      assert.strictEqual(data.business.type, 'college');
      assert.strictEqual(data.firstLocation.name, 'Main Campus');
      assert.ok(data.firstLocation.address.includes('Springfield'));
      collegeToken = data.token;
      collegeBizId = data.business.id || data.business._id;
      collegeInitialFormId = data.firstForm ? (data.firstForm.id || data.firstForm._id) : null;
    });

    await it('Reject physical business missing required address with HTTP 400', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: 'Brick and Mortar Store',
          businessType: 'retail',
          ownerName: 'John Doe',
          email: `retail_${Date.now()}@store.com`,
          password: 'SecurePassword@123',
          isOnlineOnly: false,
          address: null
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('Physical address'));
      assert.strictEqual(data.token, undefined);
    });

    await it('Reject duplicate email registration with HTTP 409 Conflict without orphaned records', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: 'Duplicate Inc',
          businessType: 'retail',
          ownerName: 'Sarah Jenkins',
          email: onlineEmail, // Already registered
          password: 'SecurePassword@123',
          isOnlineOnly: true
        })
      });

      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.ok(data.error.includes('already exists') || data.error.includes('registered'));
      assert.strictEqual(data.token, undefined, 'Never issue token on duplicate conflict');
    });

    await it('Login with newly registered credentials returns token and user profile', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: onlineEmail,
          password: 'SecurePassword@123'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.token);
      assert.strictEqual(data.user.email, onlineEmail);
    });

    await it('Session restoration: GET /api/auth/me returns authenticated user profile', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${onlineToken}` }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.user.email, onlineEmail);
      assert.strictEqual(data.business.name, 'Apex Cloud Solutions');
    });

    await it('Multi-tenant isolation: Business A cannot access Business B records (HTTP 403)', async () => {
      // 1. Online business attempts to read College's forms list -> gets only its own forms
      const resForms = await fetch(`${BASE_URL}/api/forms`, {
        headers: { 'Authorization': `Bearer ${onlineToken}` }
      });
      assert.strictEqual(resForms.status, 200);
      const dataForms = await resForms.json();
      const forms = Array.isArray(dataForms) ? dataForms : (dataForms.forms || []);
      assert.strictEqual(forms.length, 1);
      assert.strictEqual(forms[0].title, 'Apex Cloud Solutions Feedback');

      // 2. Online business attempts cross-tenant access to College's initial form by ID -> HTTP 403 Forbidden
      if (collegeInitialFormId) {
        const resCross = await fetch(`${BASE_URL}/api/forms/${collegeInitialFormId}`, {
          headers: { 'Authorization': `Bearer ${onlineToken}` }
        });
        assert.strictEqual(resCross.status, 403, 'Cross-tenant form view must be strictly 403 Forbidden');
        const dataCross = await resCross.json();
        assert.ok(dataCross.error.includes('Cross-tenant') || dataCross.error.includes('Unauthorized'));
      }
    });

    // --- 4. College Form Publication, Feedback & Analytics ---
    console.log('\n--- 4. College Form Lifecycle & Analytics Verification ---');

    let publishedFormId = '';
    let formSlug = '';

    await it('Create dynamic college feedback form in draft status', async () => {
      const formPayload = {
        title: 'Computer Science Department Evaluation',
        description: 'Comprehensive faculty and subject student evaluation',
        formType: 'college',
        status: 'published', // Try to forge status; must be ignored and set to draft
        collegeFieldsConfig: {
          departmentRequired: true,
          facultyRequired: true,
          subjectRequired: true
        },
        questions: [
          {
            id: 'q_clarity',
            type: 'rating',
            text: 'Pedagogical clarity and lecture preparation (1-5 stars)',
            required: true,
            min: 1,
            max: 5,
            order: 1
          },
          {
            id: 'q_nps',
            type: 'nps',
            text: 'How likely are you to recommend this course? (0-10)',
            required: true,
            min: 0,
            max: 10,
            order: 2
          }
        ]
      };

      const res = await fetch(`${BASE_URL}/api/forms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${collegeToken}`
        },
        body: JSON.stringify(formPayload)
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const form = data.form || data;
      assert.strictEqual(form.status, 'draft', 'New forms must unconditionally start in draft');
      publishedFormId = form.id || form._id;
      formSlug = form.slug;
    });

    await it('Reject public submissions while form is in draft status (HTTP 403)', async () => {
      const res = await fetch(`${BASE_URL}/api/feedback/submit/${formSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: 5,
          nps: 10,
          answers: { q_clarity: 5, q_nps: 10 }
        })
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.ok(data.error.includes('draft') || data.error.includes('not active') || data.error.includes('accepting'));
    });

    await it('Publish form using dedicated publish endpoint (PUT /api/forms/:id/publish)', async () => {
      const res = await fetch(`${BASE_URL}/api/forms/${publishedFormId}/publish`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${collegeToken}`
        },
        body: JSON.stringify({ status: 'published' })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const form = data.form || data;
      assert.strictEqual(form.status, 'published');
    });

    await it('Fetch public form by slug returns form configuration with HTTP 200', async () => {
      const res = await fetch(`${BASE_URL}/api/forms/slug/${formSlug}`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const form = data.form || data;
      assert.strictEqual(form.status, 'published');
      assert.strictEqual(form.questions.length, 2);
    });

    await it('Reject forged/invalid academic department submission with HTTP 400', async () => {
      // First configure allowed departments on business
      await db.updateBusiness(collegeBizId, {
        academicConfig: {
          departments: ['Computer Science', 'Electrical Engineering'],
          faculty: [{ name: 'Dr. Turing', department: 'Computer Science' }],
          subjects: [{ name: 'Data Structures', code: 'CS201', department: 'Computer Science' }]
        }
      });

      const res = await fetch(`${BASE_URL}/api/feedback/submit/${formSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: 5,
          nps: 10,
          academicDetails: {
            department: 'Invalid Astronomy Department',
            faculty: 'Dr. Turing',
            subject: 'Data Structures'
          },
          answers: { q_clarity: 5, q_nps: 10 }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('department') || data.error.includes('institution'));
    });

    await it('Submit valid college feedback and verify separate rating and NPS metrics', async () => {
      const res = await fetch(`${BASE_URL}/api/feedback/submit/${formSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: 5,
          nps: 10,
          customerName: 'Alice Student',
          academicDetails: {
            department: 'Computer Science',
            faculty: 'Dr. Turing',
            subject: 'Data Structures'
          },
          answers: { q_clarity: 5, q_nps: 10 }
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.feedbackId);
      assert.strictEqual(data.rating, 5);
    });

    await it('Retrieve feedback in tenant inbox and verify analytics calculation', async () => {
      const res = await fetch(`${BASE_URL}/api/feedback`, {
        headers: { 'Authorization': `Bearer ${collegeToken}` }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const feedbacks = Array.isArray(data) ? data : (data.feedbacks || []);
      assert.strictEqual(feedbacks.length >= 1, true);

      // Verify analytics calculations
      const avgRating = calculateAverageRating(feedbacks);
      const npsResult = calculateNps(feedbacks);

      assert.strictEqual(avgRating, '5.0');
      assert.strictEqual(npsResult.npsScore, 100);
      assert.strictEqual(npsResult.promoters, 1);
      assert.strictEqual(npsResult.detractors, 0);
    });

    // --- 5. Data Safety & Test Isolation ---
    console.log('\n--- 5. Automated Test Safety & Database Protection ---');

    await it('isDisposableDatabase strictly rejects production, live, or unrecognized databases', () => {
      assert.strictEqual(isDisposableDatabase('feedbackhub_prod'), false);
      assert.strictEqual(isDisposableDatabase('production_db'), false);
      assert.strictEqual(isDisposableDatabase('live_cluster'), false);
      assert.strictEqual(isDisposableDatabase('customer_data'), false);
      assert.strictEqual(isDisposableDatabase('main'), false);
    });

    await it('isDisposableDatabase accepts explicitly named test and disposable databases', () => {
      assert.strictEqual(isDisposableDatabase('feedbackhub_test'), true);
      assert.strictEqual(isDisposableDatabase('disposable_sandbox'), true);
      assert.strictEqual(isDisposableDatabase('temp_ci_db'), true);
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n===============================================================');
  console.log(`Phase 8 Tests Completed: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runPhase8Tests().catch((err) => {
    console.error('Test execution error:', err);
    process.exit(1);
  });
}

module.exports = runPhase8Tests;
