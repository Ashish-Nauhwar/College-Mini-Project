/**
 * Real MongoDB Atlas Integration Test Suite
 * 
 * SAFETY POLICY:
 * 1. Requires explicit TEST_MONGODB_URI environment variable pointing to a disposable test database.
 * 2. If TEST_MONGODB_URI is not configured, reports SKIPPED cleanly with clear instructions (NEVER false pass).
 * 3. Verifies that the target database name is explicitly disposable before operating.
 * 4. Cleans up all created test documents after execution.
 */

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const assert = require('assert');

// Load environment configuration
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { isDisposableDatabase } = require('../scripts/seed');
const { Business, User, FeedbackForm, Feedback } = require('../src/models');
const { hashPassword } = require('../src/utils/crypto');

async function runRealMongoIntegrationTest() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB REAL MONGODB INTEGRATION TEST SUITE            ');
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

  console.log(`[Connecting] Connecting to verified test database: "${dbName}"...`);
  await mongoose.connect(testUri);
  console.log(`[Connected] Connected to live MongoDB test database: "${mongoose.connection.name}"\n`);

  let testBizId = null;
  let testFormId = null;

  try {
    // 1. Create isolated test business
    const biz = await Business.create({
      name: `Real-Test-College-${Date.now()}`,
      type: 'college',
      email: `test-${Date.now()}@test-college.edu`,
      active: true,
      academicConfig: {
        departments: ['Computer Science'],
        courses: ['B.Tech'],
        academicYears: ['2026-2027'],
        faculty: [{ name: 'Dr. Test Faculty', department: 'Computer Science' }],
        subjects: [{ name: 'Test Algorithms', code: 'CS999', department: 'Computer Science' }]
      }
    });
    testBizId = biz._id;
    console.log('  ✓ Created isolated test business record in Atlas');

    // 2. Create test feedback form
    const form = await FeedbackForm.create({
      businessId: testBizId,
      slug: `live-test-form-${Date.now()}`,
      title: 'Live Integration Form',
      status: 'draft',
      questions: [
        { id: 'q1', type: 'rating', text: 'Rate quality (1-5)', min: 1, max: 5 },
        { id: 'q2', type: 'nps', text: 'Recommend likelihood (0-10)', min: 0, max: 10 }
      ]
    });
    testFormId = form._id;
    console.log('  ✓ Created test feedback form in draft status');

    // 3. Verify status transition
    form.status = 'published';
    await form.save();
    const refreshedForm = await FeedbackForm.findById(testFormId);
    assert.strictEqual(refreshedForm.status, 'published');
    console.log('  ✓ Verified form status transition from draft to published in Atlas');

    // 4. Create verified feedback response
    const fb = await Feedback.create({
      businessId: testBizId,
      formId: testFormId,
      rating: 5,
      nps: 10,
      sentiment: 'positive',
      answers: new Map([['q1', 5], ['q2', 10]]),
      academicDetails: {
        department: 'Computer Science',
        faculty: 'Dr. Test Faculty',
        subject: 'Test Algorithms'
      }
    });
    console.log('  ✓ Stored feedback submission with verified academic metadata in Atlas');

    const fetchedFb = await Feedback.findById(fb._id);
    assert.strictEqual(fetchedFb.rating, 5);
    assert.strictEqual(fetchedFb.nps, 10);
    assert.strictEqual(fetchedFb.academicDetails.subject, 'Test Algorithms');
    console.log('  ✓ Verified feedback response data integrity in Atlas');

    console.log('\n[PASS] Real MongoDB Atlas integration verified with live database!\n');
    return { skipped: false, testsRun: 5, passed: 5 };
  } finally {
    // Cleanup created test records
    console.log('[Cleanup] Cleaning up ephemeral test records from Atlas test database...');
    if (testFormId) {
      await Feedback.deleteMany({ formId: testFormId });
      await FeedbackForm.findByIdAndDelete(testFormId);
    }
    if (testBizId) {
      await Business.findByIdAndDelete(testBizId);
    }
    await mongoose.connection.close();
    console.log('[Completed] MongoDB Atlas connection cleanly closed.\n');
  }
}

if (require.main === module) {
  runRealMongoIntegrationTest().catch(err => {
    console.error('Real Mongo test execution failed:', err);
    process.exit(1);
  });
}

module.exports = runRealMongoIntegrationTest;
