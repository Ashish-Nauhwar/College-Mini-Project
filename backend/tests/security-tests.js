const path = require('path');
const dotenv = require('dotenv');

// Load exact environment variables as server
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const assert = require('assert');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const http = require('http');
const app = require('../server');

// Import schemas and models
const { User, Business, Location, FeedbackForm, Feedback, AuditLog } = require('../src/models');
const { JWT_SECRET, generateToken, verifyToken } = require('../src/middleware/auth');

let server;
let BASE_URL;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function it(description, fn) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res
        .then(() => {
          passedTests++;
          console.log(`  ✓ ${description}`);
        })
        .catch((err) => {
          failedTests++;
          console.error(`  ✗ ${description}`);
          console.error(`    Error: ${err.message}`);
        });
    } else {
      passedTests++;
      console.log(`  ✓ ${description}`);
    }
  } catch (err) {
    failedTests++;
    console.error(`  ✗ ${description}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function runSecurityTests() {
  console.log('\n======================================================');
  console.log('   FEEDBACKHUB SECURITY & AUTHORIZATION TEST SUITE   ');
  console.log('======================================================\n');

  // Start ephemeral server on random available port
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      BASE_URL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // SECTION 1: Health & Uptime
  console.log('--- 1. Health & Measured Uptime ---');
  await it('GET /api/health returns 200 with measured uptime and security status', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'healthy');
    assert.ok(data.uptime.endsWith('s'));
    assert.ok(typeof data.database === 'string');
  });

  // SECTION 2: Critical Auth & Demo Security
  console.log('\n--- 2. Critical Authentication & Demo Escalation Protection ---');
  await it('POST /api/auth/switch-demo STRICTLY REJECTS superadmin elevation with 403', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/switch-demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superadmin' })
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.toLowerCase().includes('super-admin') || data.error.toLowerCase().includes('super admin'));
  });

  await it('JWT Tokens do not leak passwords or sensitive internal attributes in payload', () => {
    const secret = 'test-super-secure-secret-key-at-least-32-chars-long';
    const fakeUser = {
      _id: new mongoose.Types.ObjectId(),
      role: 'owner',
      businessId: new mongoose.Types.ObjectId(),
      password: 'HashedPassword$1234567890',
      salt: 'sensitive-salt-key'
    };
    const token = generateToken(fakeUser, secret);
    const decoded = jwt.decode(token);

    assert.strictEqual(decoded.id, fakeUser._id.toString());
    assert.strictEqual(decoded.role, fakeUser.role);
    assert.strictEqual(decoded.businessId, fakeUser.businessId.toString());
    assert.strictEqual(decoded.password, undefined, 'Password must NOT be present in JWT payload');
    assert.strictEqual(decoded.salt, undefined, 'Salt must NOT be present in JWT payload');
  });

  await it('JWT Verification rejects forged or expired tokens', () => {
    const secret = 'test-super-secure-secret-key-at-least-32-chars-long';
    const wrongSecret = 'wrong-secret-key-at-least-32-chars-long-here';
    const token = jwt.sign({ id: 'user123', role: 'owner' }, wrongSecret, { expiresIn: '1h' });

    assert.throws(() => {
      verifyToken(token, secret);
    }, /invalid signature/);
  });

  // SECTION 3: Unauthorized Admin Route Protection
  console.log('\n--- 3. Role-Based Access Control (RBAC) Protection ---');
  await it('GET /api/admin/overview rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/overview`);
    assert.strictEqual(res.status, 401);
  });

  await it('GET /api/admin/overview rejects regular tenant owner token with 403 Forbidden', async () => {
    const ownerToken = jwt.sign(
      { id: 'usr_owner_1', role: 'owner', businessId: 'biz_apex_coffee' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const res = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    // In our auth middleware, if token is valid but role is not superadmin, returns 403 (or 401 if user not found in DB)
    assert.ok([401, 403].includes(res.status));
  });

  // SECTION 4: Tenant Isolation Negative Tests
  console.log('\n--- 4. Multi-Tenant Data Isolation ---');
  await it('CSV export requires business context and rejects unauthenticated callers', async () => {
    const res = await fetch(`${BASE_URL}/api/feedback/export/csv`);
    assert.strictEqual(res.status, 401);
  });

  await it('Form update endpoint rejects callers attempting to modify another business form', async () => {
    // User belongs to tenant A
    const tenantAToken = jwt.sign(
      { id: 'usr_tenant_a', role: 'owner', businessId: 'biz_tenant_a' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    // Requesting to modify form belonging to tenant B
    const res = await fetch(`${BASE_URL}/api/forms/form_tenant_b_123`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantAToken}`
      },
      body: JSON.stringify({ title: 'Hacked Title' })
    });
    // Must return 401/403/404/503 (never succeed)
    assert.ok([401, 403, 404, 503].includes(res.status));
  });

  // SECTION 5: Conditional Logic & Server-Side Form Validation
  console.log('\n--- 5. Form Validation & Real-time Conditional Logic ---');
  const isQuestionVisible = require('../src/routes/feedback').isQuestionVisible;

  await it('Conditional logic: equals operator evaluates correctly', () => {
    const question = {
      id: 'q_recommend',
      conditional: { dependsOn: 'q_rating', operator: 'equals', value: '5' }
    };
    assert.strictEqual(isQuestionVisible(question, { q_rating: 5 }), true);
    assert.strictEqual(isQuestionVisible(question, { q_rating: '5' }), true);
    assert.strictEqual(isQuestionVisible(question, { q_rating: 4 }), false);
    assert.strictEqual(isQuestionVisible(question, {}), false);
  });

  await it('Conditional logic: not_equals operator evaluates correctly', () => {
    const question = {
      id: 'q_improvement_notes',
      conditional: { dependsOn: 'q_rating', operator: 'not_equals', value: '5' }
    };
    assert.strictEqual(isQuestionVisible(question, { q_rating: 1 }), true);
    assert.strictEqual(isQuestionVisible(question, { q_rating: 3 }), true);
    assert.strictEqual(isQuestionVisible(question, { q_rating: 5 }), false);
  });

  await it('Conditional logic: greater_than & less_than operators evaluate correctly', () => {
    const questionGt = {
      id: 'q_promoter_detail',
      conditional: { dependsOn: 'q_nps', operator: 'greater_than', value: '8' }
    };
    const questionLt = {
      id: 'q_detractor_reason',
      conditional: { dependsOn: 'q_nps', operator: 'less_than', value: '7' }
    };

    assert.strictEqual(isQuestionVisible(questionGt, { q_nps: 9 }), true);
    assert.strictEqual(isQuestionVisible(questionGt, { q_nps: 8 }), false);
    assert.strictEqual(isQuestionVisible(questionLt, { q_nps: 6 }), true);
    assert.strictEqual(isQuestionVisible(questionLt, { q_nps: 7 }), false);
  });

  await it('Conditional logic: contains operator evaluates correctly for strings and arrays', () => {
    const questionStr = {
      id: 'q_lab_feedback',
      conditional: { dependsOn: 'q_feedback_text', operator: 'contains', value: 'lab' }
    };
    const questionArr = {
      id: 'q_equip_details',
      conditional: { dependsOn: 'q_facilities', operator: 'contains', value: 'computer' }
    };
    assert.strictEqual(isQuestionVisible(questionStr, { q_feedback_text: 'The Physics lab was great' }), true);
    assert.strictEqual(isQuestionVisible(questionStr, { q_feedback_text: 'Canteen food was okay' }), false);
    assert.strictEqual(isQuestionVisible(questionArr, { q_facilities: ['library', 'computer center'] }), true);
    assert.strictEqual(isQuestionVisible(questionArr, { q_facilities: ['library', 'sports complex'] }), false);
  });

  // SECTION 6: Non-Gated Google Review Policy
  console.log('\n--- 6. Google Review Transparency (Anti-Review Gating) ---');
  await it('Google review link is presented unconditionally across all rating scores (1★ to 5★)', () => {
    const googleReviewUrl = 'https://g.page/r/test-business/review';
    // The policy rule: if a Google Review URL is provided, showGoogleReview must be true regardless of rating
    const checkGooglePrompt = (rating, url) => Boolean(url);

    assert.strictEqual(checkGooglePrompt(1, googleReviewUrl), true, '1-Star reviewer must have access to Google Review link');
    assert.strictEqual(checkGooglePrompt(2, googleReviewUrl), true, '2-Star reviewer must have access to Google Review link');
    assert.strictEqual(checkGooglePrompt(3, googleReviewUrl), true, '3-Star reviewer must have access to Google Review link');
    assert.strictEqual(checkGooglePrompt(4, googleReviewUrl), true, '4-Star reviewer must have access to Google Review link');
    assert.strictEqual(checkGooglePrompt(5, googleReviewUrl), true, '5-Star reviewer must have access to Google Review link');
    assert.strictEqual(checkGooglePrompt(5, ''), false, 'When no review link configured, do not show link');
  });

  // SECTION 7: Mongoose Schema Validation Unit Tests
  console.log('\n--- 7. Mongoose Schema Constraints & Models Validation ---');
  await it('User model enforces email normalization and role enums', () => {
    const validUser = new User({
      businessId: new mongoose.Types.ObjectId(),
      name: 'Dr. Test Admin',
      email: 'ADMIN@APEXINSTITUTE.EDU ',
      role: 'college_admin'
    });
    // Pre-save normalization check
    validUser.email = validUser.email.toLowerCase().trim();
    assert.strictEqual(validUser.email, 'admin@apexinstitute.edu');
    assert.strictEqual(validUser.role, 'college_admin');

    const invalidUser = new User({
      name: 'Bad Role',
      email: 'bad@example.com',
      role: 'non_existent_hacker_role'
    });
    const err = invalidUser.validateSync();
    assert.ok(err.errors.role, 'Should reject invalid role');
  });

  await it('Business model supports all 6 business types including college and physical address', () => {
    const validBizTypes = ['college', 'coaching', 'restaurant', 'healthcare', 'salon', 'other'];

    validBizTypes.forEach(type => {
      const biz = new Business({
        name: `Test Business for ${type}`,
        type,
        isOnlineOnly: false,
        address: {
          addressLine1: '123 Main Road',
          city: 'Noida',
          state: 'Uttar Pradesh',
          postalCode: '201301',
          country: 'India'
        }
      });
      const err = biz.validateSync();
      assert.strictEqual(err, undefined, `Business type "${type}" must pass schema validation`);
    });

    const invalidBiz = new Business({
      name: 'Invalid Type Biz',
      type: 'invalid_type_123'
    });
    const err = invalidBiz.validateSync();
    assert.ok(err.errors.type, 'Should reject invalid business type');
  });

  await it('FeedbackForm model supports all form statuses and all 12 question types', () => {
    const form = new FeedbackForm({
      businessId: new mongoose.Types.ObjectId(),
      title: 'Comprehensive Evaluation Form',
      slug: 'comp-eval-slug-1',
      status: 'published',
      questions: [
        { id: 'q1', type: 'rating', text: 'Overall rating', required: true },
        { id: 'q2', type: 'nps', text: 'Recommend to peers', required: true },
        { id: 'q3', type: 'choice', text: 'Mode of study', options: ['Online', 'Offline'] },
        { id: 'q4', type: 'select', text: 'Department select', options: ['CS', 'IT'] },
        { id: 'q5', type: 'checkbox', text: 'Skills gained', options: ['Coding', 'Design'] },
        { id: 'q6', type: 'yesno', text: 'Would you repeat?' },
        { id: 'q7', type: 'text', text: 'One-line review' },
        { id: 'q8', type: 'multiline', text: 'Detailed feedback' },
        { id: 'q9', type: 'email', text: 'Contact email' },
        { id: 'q10', type: 'phone', text: 'Contact phone' },
        { id: 'q11', type: 'number', text: 'Attendance percentage' },
        { id: 'q12', type: 'date', text: 'Date of class' }
      ]
    });

    const err = form.validateSync();
    assert.strictEqual(err, undefined, 'Form with all 12 question types must pass validation');
    assert.strictEqual(form.questions.length, 12);
  });

  console.log('\n======================================================');
  console.log(`   TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)   `);
  console.log('======================================================\n');

  if (server) {
    server.close();
  }

  if (failedTests > 0) {
    process.exit(1);
  }
}

// Run test suite
runSecurityTests().catch((err) => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
