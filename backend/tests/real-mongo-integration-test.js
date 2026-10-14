/**
 * Real MongoDB Atlas API Integration Test Suite
 * 
 * SAFETY POLICY (Phase 6):
 * 1. Requires explicit TEST_MONGODB_URI environment variable pointing to a disposable test database.
 * 2. If TEST_MONGODB_URI is not configured, reports SKIPPED cleanly with clear instructions (NEVER false pass).
 * 3. Verifies that the target database name is explicitly disposable before operating.
 * 4. Spins up a real Express app on an ephemeral port.
 * 5. Exercises the full 16-step lifecycle via real HTTP calls:
 *    - Step 1: Verified disposable database connection
 *    - Step 2: Ephemeral Express HTTP server startup
 *    - Step 3: Isolated test business & owner provisioning
 *    - Step 4: JWT authentication token generation
 *    - Step 5: Draft form creation via POST /api/forms
 *    - Step 6: General PUT status update rejection (HTTP 400)
 *    - Step 7: Draft form public submission rejection (HTTP 403)
 *    - Step 8: Dedicated form publication via PUT /api/forms/:id/publish
 *    - Step 9: Academic department validation rejection on public submit (HTTP 400)
 *    - Step 10: Valid public feedback 1 submission (Rating 2 / NPS 1 - complaint detractor)
 *    - Step 11: Valid public feedback 2 submission (Rating 5 / NPS 10 - promoter)
 *    - Step 12: Authenticated feedback inbox retrieval & complaint verification
 *    - Step 13: Accurate average rating & separate NPS calculations
 *    - Step 14: MongoDB reconnect & data persistence verification
 *    - Step 15: Cross-tenant isolation verification (HTTP 403)
 *    - Step 16: Teardown only created test records by ID & clean shutdown
 */

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const assert = require('assert');
const http = require('http');
const dns = require('dns');

// Load environment configuration
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// DNS server fallback for development when explicitly opted in
if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_FALLBACK_DNS === 'true') {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch (e) {
    // Ignore in restricted environments
  }
}

const { isDisposableDatabase } = require('../scripts/seed');
const { Business, User, Location, FeedbackForm, Feedback, AuditLog } = require('../src/models');
const { generateToken } = require('../src/middleware/auth');
const { hashPassword } = require('../src/utils/crypto');
const { calculateAverageRating, calculateNps } = require('../src/utils/analyticsHelper');

async function runRealMongoIntegrationTest() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB REAL MONGODB ATLAS API INTEGRATION SUITE       ');
  console.log('===============================================================\n');

  const testUri = process.env.TEST_MONGODB_URI;

  if (!testUri || testUri.includes('<username>') || testUri.includes('<password>')) {
    console.log('[STATUS: SKIPPED]');
    console.log('Real MongoDB Atlas integration tests were skipped because TEST_MONGODB_URI is not configured.');
    console.log('To run this suite against a live database without touching production:');
    console.log('1. Create a disposable test database in MongoDB Atlas (e.g., "feedbackhub_test").');
    console.log('2. Set TEST_MONGODB_URI in backend/.env:');
    console.log('   TEST_MONGODB_URI=mongodb+srv://<user>:<pwd>@cluster0.mongodb.net/feedbackhub_test?retryWrites=true&w=majority\n');
    return { skipped: true, testsRun: 0, passed: 0 };
  }

  // Pre-check database name safety
  let dbName = '';
  try {
    const clean = testUri.replace(/^mongodb(\+srv)?:\/\//, 'http://');
    const parsed = new URL(clean);
    dbName = parsed.pathname ? parsed.pathname.replace(/^\//, '').split('?')[0] : '';
  } catch (err) {}

  if (!isDisposableDatabase(dbName)) {
    console.error(`[SAFETY REFUSAL] Real DB test refused: Database name "${dbName}" is not verified disposable.`);
    console.error('The database name in TEST_MONGODB_URI must contain "test", "dev", or "temp".');
    process.exit(1);
  }

  const created = {
    businesses: [],
    users: [],
    locations: [],
    forms: [],
    feedbacks: [],
    auditLogs: []
  };

  let server;
  let BASE_URL;
  let testError = null;

  try {
    // Step 1: Connect to verified disposable test DB
    console.log(`[Step 1] Connecting to verified disposable database: "${dbName}"...`);
    await mongoose.connect(testUri);
    console.log(`  ✓ Connected to live MongoDB Atlas test database: "${mongoose.connection.name}"`);

    // Step 2: Spin up Express server on ephemeral port
    console.log('[Step 2] Starting ephemeral Express HTTP test server...');
    const app = require('../server');
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        BASE_URL = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    console.log(`  ✓ Express test server listening at ${BASE_URL}`);

    // Step 3: Register isolated test business & owner via real API (POST /api/auth/register)
    console.log('[Step 3] Registering isolated test college & owner via real API (POST /api/auth/register)...');
    const testTimestamp = Date.now();
    const registerPayload = {
      businessName: `Apex Live Test University ${testTimestamp}`,
      businessType: 'college',
      ownerName: 'Test Dean',
      email: `dean-${testTimestamp}@apextest.edu`,
      password: 'LiveTestPassword@123',
      isOnlineOnly: false,
      address: {
        addressLine1: 'Campus Drive 101',
        city: 'Academic City',
        state: 'State',
        postalCode: '110001',
        country: 'India'
      }
    };

    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerPayload)
    });

    assert.strictEqual(regRes.status, 201, 'Registration via real API must succeed with 201 Created');
    const regData = await regRes.json();
    assert.ok(regData.token, 'Registration must return valid JWT token');

    const testBiz = regData.business;
    const ownerUser = regData.user;
    const ownerToken = regData.token;

    if (testBiz && (testBiz._id || testBiz.id)) {
      created.businesses.push(testBiz._id || testBiz.id);
    }
    if (ownerUser && (ownerUser.id || ownerUser._id)) {
      created.users.push(ownerUser.id || ownerUser._id);
    }
    if (regData.firstLocation && (regData.firstLocation._id || regData.firstLocation.id)) {
      created.locations.push(regData.firstLocation._id || regData.firstLocation.id);
    }
    if (regData.firstForm && (regData.firstForm._id || regData.firstForm.id)) {
      created.forms.push(regData.firstForm._id || regData.firstForm.id);
    }

    // Update business with academic configuration for college workflow
    await Business.updateOne(
      { _id: testBiz._id },
      {
        $set: {
          academicConfig: {
            departments: ['Computer Science (CSE)', 'Mechanical Engineering'],
            courses: ['B.Tech', 'M.Tech'],
            academicYears: ['2026-2027'],
            faculty: [{ name: 'Dr. Atlas Test', department: 'Computer Science (CSE)' }],
            subjects: [{ name: 'Cloud Computing', code: 'CS801', department: 'Computer Science (CSE)' }]
          }
        }
      }
    );
    console.log('  ✓ Test college and owner registered via real API and JWT bearer token issued');

    // Step 5: Create draft college feedback form via POST /api/forms
    console.log('[Step 5] Creating draft college feedback form via POST /api/forms...');
    const formSlug = `atlas-e2e-form-${testTimestamp}`;
    const createFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`
      },
      body: JSON.stringify({
        title: 'Atlas Integration Academic Survey',
        slug: formSlug,
        formType: 'college',
        status: 'published', // Attempt to create directly published
        collegeFieldsConfig: {
          departmentRequired: true,
          courseRequired: true,
          facultyRequired: true,
          subjectRequired: true
        },
        questions: [
          { id: 'q_rate', type: 'rating', text: 'Rate lecture quality (1-5):', required: true, min: 1, max: 5 },
          { id: 'q_nps', type: 'nps', text: 'How likely are you to recommend? (0-10):', required: true, min: 0, max: 10 }
        ]
      })
    });
    assert.strictEqual(createFormRes.status, 201, 'Form creation must return 201');
    const formJson = await createFormRes.json();
    const testFormId = formJson.form.id || formJson.form._id;
    const actualFormSlug = formJson.form.slug;
    created.forms.push(testFormId);
    assert.strictEqual(formJson.form.status, 'draft', 'New form must unconditionally be in draft status');
    console.log('  ✓ Form created and verified in "draft" status');

    // Step 6: General PUT update rejection on status
    console.log('[Step 6] Verifying general PUT /api/forms/:id rejects status mutation...');
    const putStatusRes = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`
      },
      body: JSON.stringify({ status: 'published' })
    });
    assert.strictEqual(putStatusRes.status, 400, 'Direct status update via PUT must be rejected (400)');
    const putErr = await putStatusRes.json();
    assert.ok(putErr.error.includes('general update'), 'Error must specify general update status restriction');
    console.log('  ✓ General status mutation safely rejected with HTTP 400');

    // Step 7: Draft form rejects public submissions
    console.log('[Step 7] Verifying draft form rejects public feedback submissions (HTTP 403)...');
    const submitDraftRes = await fetch(`${BASE_URL}/api/feedback/submit/${actualFormSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5, answers: { q_rate: 5, q_nps: 10 } })
    });
    assert.strictEqual(submitDraftRes.status, 403, 'Draft form must return 403 for public submissions');
    console.log('  ✓ Draft form correctly refused public feedback with HTTP 403');

    // Step 8: Dedicated /publish endpoint publishes the form
    console.log('[Step 8] Publishing form via dedicated PUT /api/forms/:id/publish...');
    const publishRes = await fetch(`${BASE_URL}/api/forms/${testFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(publishRes.status, 200, 'Publishing form must return 200');
    const publishJson = await publishRes.json();
    assert.strictEqual(publishJson.form.status, 'published', 'Form status must transition to published');
    console.log('  ✓ Form successfully published via dedicated lifecycle endpoint');

    // Step 9: Public submission with invalid academic department rejected
    console.log('[Step 9] Verifying public submission with unconfigured academic department is rejected...');
    const invalidDeptRes = await fetch(`${BASE_URL}/api/feedback/submit/${actualFormSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        answers: { q_rate: 4, q_nps: 9 },
        academicDetails: {
          department: 'Unauthorized Department XYZ',
          course: 'B.Tech',
          faculty: 'Dr. Atlas Test',
          subject: 'Cloud Computing'
        }
      })
    });
    assert.strictEqual(invalidDeptRes.status, 400, 'Invalid academic department must return 400');
    console.log('  ✓ Forged academic department rejected with HTTP 400');

    // Step 10: Valid public submission 1 (Complaint / Detractor)
    console.log('[Step 10] Submitting valid feedback #1 (Rating 2 / NPS 1 - Complaint Detractor)...');
    const sub1Res = await fetch(`${BASE_URL}/api/feedback/submit/${actualFormSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 2,
        nps: 1,
        answers: { q_rate: 2, q_nps: 1 },
        comments: 'Classroom audio equipment was malfunctioning',
        academicDetails: {
          department: 'Computer Science (CSE)',
          course: 'B.Tech',
          faculty: 'Dr. Atlas Test',
          subject: 'Cloud Computing'
        }
      })
    });
    assert.strictEqual(sub1Res.status, 201, 'Valid feedback 1 must return 201');
    const sub1Json = await sub1Res.json();
    assert.strictEqual(sub1Json.rating, 2, 'Rating must be preserved as 2');
    created.feedbacks.push(sub1Json.feedbackId);
    console.log('  ✓ Feedback #1 successfully recorded in live MongoDB');

    // Step 11: Valid public submission 2 (Promoter)
    console.log('[Step 11] Submitting valid feedback #2 (Rating 5 / NPS 10 - Promoter)...');
    const sub2Res = await fetch(`${BASE_URL}/api/feedback/submit/${actualFormSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        nps: 10,
        answers: { q_rate: 5, q_nps: 10 },
        comments: 'Excellent lecture clarity and great real-world examples',
        academicDetails: {
          department: 'Computer Science (CSE)',
          course: 'B.Tech',
          faculty: 'Dr. Atlas Test',
          subject: 'Cloud Computing'
        }
      })
    });
    assert.strictEqual(sub2Res.status, 201, 'Valid feedback 2 must return 201');
    const sub2Json = await sub2Res.json();
    assert.strictEqual(sub2Json.rating, 5, 'Rating must be preserved as 5');
    created.feedbacks.push(sub2Json.feedbackId);
    console.log('  ✓ Feedback #2 successfully recorded in live MongoDB');

    // Step 12: Authenticated feedback inbox retrieval & complaint verification
    console.log('[Step 12] Fetching feedbacks via GET /api/feedback and verifying complaint categorization...');
    const inboxRes = await fetch(`${BASE_URL}/api/feedback`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(inboxRes.status, 200, 'Inbox retrieval must return 200');
    const inboxJson = await inboxRes.json();
    const fetchedFbs = inboxJson.feedbacks.filter(f => f.formId?.toString() === testFormId?.toString());
    assert.strictEqual(fetchedFbs.length, 2, 'Exactly 2 feedback records must be returned for this form');
    const complaintFb = fetchedFbs.find(f => f.rating === 2);
    assert.ok(complaintFb, 'Complaint feedback (rating 2) must be present');
    assert.strictEqual(complaintFb.priority, 'critical', 'Rating 2 with detractor NPS 1 (NPS <= 3) must have critical priority');
    assert.strictEqual(complaintFb.sentiment, 'negative', 'Detractor feedback must have negative sentiment');
    console.log('  ✓ Feedbacks retrieved and complaint status verified');

    // Step 13: Accurate average rating & separate NPS calculations
    console.log('[Step 13] Verifying average rating and isolated NPS calculations...');
    const avgRating = calculateAverageRating(fetchedFbs);
    assert.strictEqual(avgRating, '3.5', 'Average rating of [2, 5] must be exactly 3.5');
    const npsMetric = calculateNps(fetchedFbs);
    // 1 promoter (10), 1 detractor (1) -> NPS = (1/2 - 1/2) * 100 = 0
    assert.strictEqual(npsMetric.npsScore, 0, 'NPS score of 1 promoter and 1 detractor must be 0');
    assert.strictEqual(npsMetric.promoters, 1);
    assert.strictEqual(npsMetric.detractors, 1);
    console.log('  ✓ Average rating (3.5) and NPS score (0) correctly calculated');

    // Step 14: MongoDB reconnect & data persistence verification
    console.log('[Step 14] Simulating MongoDB disconnect and reconnect to verify data persistence...');
    await mongoose.connection.close();
    await mongoose.connect(testUri);
    const persistedForm = await FeedbackForm.findById(testFormId);
    assert.ok(persistedForm, 'Feedback form must persist in database after reconnect');
    assert.strictEqual(persistedForm.status, 'published');
    const persistedFbCount = await Feedback.countDocuments({ formId: testFormId });
    assert.strictEqual(persistedFbCount, 2, 'Both feedback documents must persist in database after reconnect');
    console.log('  ✓ Data persistence across database reconnection confirmed');

    // Step 15: Cross-tenant isolation verification
    console.log('[Step 15] Verifying cross-tenant isolation with a secondary tenant...');
    const bizB = await Business.create({
      name: `Competitor Business ${testTimestamp}`,
      type: 'restaurant',
      email: `competitor-${testTimestamp}@cafe.com`,
      active: true
    });
    created.businesses.push(bizB._id);

    const pwdHash = await hashPassword('ValidPassword@123');
    const ownerB = await User.create({
      name: 'Owner B',
      email: `owner-b-${testTimestamp}@cafe.com`,
      password: pwdHash,
      role: 'owner',
      businessId: bizB._id
    });
    created.users.push(ownerB._id);
    const tokenB = generateToken(ownerB);
    assert.ok(tokenB, 'Secondary tenant owner token must be generated');

    // Tenant B attempts to read Tenant A's form
    const crossTenantGet = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert.strictEqual(crossTenantGet.status, 403, 'Cross-tenant form access must be blocked with HTTP 403');

    // Tenant B attempts to modify Tenant A's form
    const crossTenantPut = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ title: 'Hacked Title' })
    });
    assert.strictEqual(crossTenantPut.status, 403, 'Cross-tenant form update must be blocked with HTTP 403');
    console.log('  ✓ Cross-tenant access strictly prevented with HTTP 403 Forbidden');

    // Step 16: Verification complete, proceeding to teardown
    console.log('[Step 16] All integration assertions completed successfully.');

    console.log('\n===============================================================');
    console.log('>>> [PASS] All 16 Live MongoDB Atlas Integration Steps Passed!  ');
    console.log('===============================================================\n');

    return { skipped: false, testsRun: 16, passed: 16 };
  } catch (err) {
    testError = err;
    throw err;
  } finally {
    // Teardown: Clean up test documents by ID inside finally block
    console.log('[Teardown] Performing deterministic teardown of test records by ID...');
    const cleanupErrors = [];

    const cleanupStep = async (description, action) => {
      try {
        await action();
      } catch (err) {
        console.error(`[Teardown Failure] ${description}:`, err.message);
        cleanupErrors.push({ description, error: err });
      }
    };

    if (created.feedbacks.length > 0) {
      await cleanupStep('Delete created feedbacks', () =>
        Feedback.deleteMany({ _id: { $in: created.feedbacks } })
      );
    }
    if (created.forms.length > 0) {
      await cleanupStep('Delete created forms', () =>
        FeedbackForm.deleteMany({ _id: { $in: created.forms } })
      );
    }
    if (created.locations.length > 0) {
      await cleanupStep('Delete created locations', () =>
        Location.deleteMany({ _id: { $in: created.locations } })
      );
    }
    if (created.users.length > 0) {
      await cleanupStep('Delete created users', () =>
        User.deleteMany({ _id: { $in: created.users } })
      );
    }
    if (created.businesses.length > 0) {
      await cleanupStep('Delete created businesses', () =>
        Business.deleteMany({ _id: { $in: created.businesses } })
      );
      await cleanupStep('Delete audit logs for created businesses', () =>
        AuditLog.deleteMany({ businessId: { $in: created.businesses } })
      );
    }
    if (created.auditLogs.length > 0) {
      await cleanupStep('Delete created audit logs', () =>
        AuditLog.deleteMany({ _id: { $in: created.auditLogs } })
      );
    }

    // Await Express server closure before closing MongoDB connection
    if (server && server.listening) {
      await cleanupStep('Shutdown Express HTTP server', () =>
        new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        })
      );
    }

    // Close MongoDB connection after server is closed
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await cleanupStep('Close MongoDB Atlas connection', () =>
        mongoose.connection.close()
      );
    }

    if (cleanupErrors.length > 0) {
      const cleanupSummary = cleanupErrors.map((e) => `${e.description}: ${e.error.message}`).join('; ');
      if (testError) {
        console.error(`[Teardown Warning] Cleanup had failures after test assertion failed: ${cleanupSummary}`);
      } else {
        throw new Error(`Integration test passed but teardown cleanup failed: ${cleanupSummary}`);
      }
    } else {
      console.log('  ✓ All test documents cleanly deleted by ID, server stopped, and DB connection closed');
    }
  }
}

if (require.main === module) {
  runRealMongoIntegrationTest().then(result => {
    if (result && result.skipped) {
      process.exit(0);
    }
    process.exit(0);
  }).catch(err => {
    console.error('\n[Real Mongo Integration Test Failed]:', err);
    process.exit(1);
  });
}

module.exports = runRealMongoIntegrationTest;
