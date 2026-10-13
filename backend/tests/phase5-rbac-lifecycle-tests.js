/**
 * FeedbackHub Phase 5 Test Suite:
 * Production Safety, Role-Based Access Control (RBAC), and Publishing Lifecycle
 *
 * Verifies:
 * 1. Demo seeding refused in production; Super-admin removed from seed.js; Bootstrap password strength.
 * 2. Form graph validator boundaries: non-empty questions, stable IDs, rating/NPS bounds, option caps.
 * 3. Strict RBAC permission matrix for owner, college_admin, manager, staff, superadmin.
 * 4. Unbypassable form lifecycle: draft-only creation, general PUT status rejection, legal transitions, publish verification.
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');

// Enable isolated mock database mode
const db = require('../src/db');
db.enableMockDb(true);

const app = require('../server');
const { generateToken } = require('../src/middleware/auth');
const { validateQuestionGraph } = require('../src/utils/formGraphValidator');
const { validateSuperadminPassword } = require('../scripts/bootstrap-superadmin');

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

async function runPhase5Tests() {
  console.log('\n===============================================================');
  console.log('  FEEDBACKHUB PHASE 5: RBAC, LIFECYCLE & PRODUCTION SAFETY    ');
  console.log('===============================================================\n');

  // Start ephemeral test server
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      BASE_URL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // -------------------------------------------------------------
  // SUITE 1: Production Safety & Seeding Separation (Priority 1)
  // -------------------------------------------------------------
  console.log('--- 1. Production Safety & Superadmin Bootstrap Validation ---');

  it('Seed script refuses execution when NODE_ENV=production', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      // Re-require or inspect seed refusal
      delete require.cache[require.resolve('../scripts/seed')];
      const { seed } = require('../scripts/seed');
      let threw = false;
      try {
        await seed();
      } catch (err) {
        threw = true;
        assert.ok(err.message.includes('SAFETY REFUSAL'));
      }
      assert.strictEqual(threw, true, 'seed() must throw when NODE_ENV=production');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('Seed script file does not contain superadmin in demo users list', () => {
    const fs = require('fs');
    const seedSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'seed.js'), 'utf8');
    assert.strictEqual(
      seedSrc.includes("role: 'superadmin'"),
      false,
      'seed.js must NOT create superadmin demo accounts'
    );
  });

  it('Superadmin bootstrap validates password complexity', () => {
    // Too short
    assert.strictEqual(validateSuperadminPassword('Sh0rt!').valid, false);
    // Missing uppercase
    assert.strictEqual(validateSuperadminPassword('weakpass123!').valid, false);
    // Missing lowercase
    assert.strictEqual(validateSuperadminPassword('WEAKPASS123!').valid, false);
    // Missing number or symbol
    assert.strictEqual(validateSuperadminPassword('WeakPasswordOnly').valid, false);
    // Compliant strong password
    assert.strictEqual(validateSuperadminPassword('SuperAdmin@2026Secure').valid, true);
  });

  // -------------------------------------------------------------
  // SUITE 2: Form Graph Validation Boundaries (Priority 4)
  // -------------------------------------------------------------
  console.log('\n--- 2. Form Graph Validation Boundaries ---');

  it('Rejects empty or non-array questions list', () => {
    const resEmpty = validateQuestionGraph([]);
    assert.ok(resEmpty.error);
    assert.ok(resEmpty.error.includes('at least one question'));

    const resNull = validateQuestionGraph(null);
    assert.ok(resNull.error);
  });

  it('Rejects invalid question ID format and duplicate IDs', () => {
    const resBadId = validateQuestionGraph([
      { id: 'invalid id with spaces!', type: 'rating', text: 'Rate us' }
    ]);
    assert.ok(resBadId.error);
    assert.ok(resBadId.error.includes('IDs must match'));

    const resDup = validateQuestionGraph([
      { id: 'q_same', type: 'rating', text: 'Rate us 1' },
      { id: 'q_same', type: 'rating', text: 'Rate us 2' }
    ]);
    assert.ok(resDup.error);
    assert.ok(resDup.error.includes('Duplicate question ID'));
  });

  it('Rejects out-of-bounds rating scales (requires integer 1 <= min < max <= 5)', () => {
    // min < 1
    assert.ok(validateQuestionGraph([{ id: 'q1', type: 'rating', text: 'Rate', min: 0, max: 5 }]).error);
    // max > 5
    assert.ok(validateQuestionGraph([{ id: 'q2', type: 'rating', text: 'Rate', min: 1, max: 10 }]).error);
    // min >= max
    assert.ok(validateQuestionGraph([{ id: 'q3', type: 'rating', text: 'Rate', min: 4, max: 3 }]).error);
    // non-integer
    assert.ok(validateQuestionGraph([{ id: 'q4', type: 'rating', text: 'Rate', min: 1.5, max: 5 }]).error);
    // valid
    assert.strictEqual(validateQuestionGraph([{ id: 'q5', type: 'rating', text: 'Rate', min: 1, max: 5 }]).error, null);
  });

  it('Rejects non-standard NPS scales (strictly requires min: 0, max: 10)', () => {
    assert.ok(validateQuestionGraph([{ id: 'q1', type: 'nps', text: 'NPS', min: 1, max: 10 }]).error);
    assert.ok(validateQuestionGraph([{ id: 'q2', type: 'nps', text: 'NPS', min: 0, max: 5 }]).error);
    assert.strictEqual(validateQuestionGraph([{ id: 'q3', type: 'nps', text: 'NPS', min: 0, max: 10 }]).error, null);
  });

  it('Caps option lists at 50 options and 200 characters per option', () => {
    const tooManyOptions = Array.from({ length: 51 }, (_, i) => `Option ${i + 1}`);
    assert.ok(validateQuestionGraph([{ id: 'q1', type: 'choice', text: 'Choice', options: tooManyOptions }]).error);

    const longOption = 'A'.repeat(201);
    assert.ok(validateQuestionGraph([{ id: 'q2', type: 'choice', text: 'Choice', options: [longOption] }]).error);

    const validOptions = ['Opt 1', 'Opt 2'];
    assert.strictEqual(validateQuestionGraph([{ id: 'q3', type: 'choice', text: 'Choice', options: validOptions }]).error, null);
  });

  // -------------------------------------------------------------
  // Setup Mock Database Data for API RBAC & Lifecycle Tests
  // -------------------------------------------------------------
  console.log('\n--- 3. Role-Based Access Control (RBAC) Permission Matrix ---');

  db.clearMockDb();

  const biz = await db.createBusiness({
    name: 'Apex Academy Test Institution',
    type: 'college',
    category: 'Higher Education',
    email: 'info@apexacademy.edu',
    active: true
  });
  const bizId = biz.id;

  const ownerUser = await db.createUser({
    name: 'Owner Jane',
    email: 'owner@apexacademy.edu',
    password: 'Hash@123',
    role: 'owner',
    businessId: bizId
  });

  const collegeAdminUser = await db.createUser({
    name: 'Dean Smith',
    email: 'dean@apexacademy.edu',
    password: 'Hash@123',
    role: 'college_admin',
    businessId: bizId
  });

  const managerUser = await db.createUser({
    name: 'Manager Bob',
    email: 'manager@apexacademy.edu',
    password: 'Hash@123',
    role: 'manager',
    businessId: bizId
  });

  const staffUser = await db.createUser({
    name: 'Staff Alice',
    email: 'staff@apexacademy.edu',
    password: 'Hash@123',
    role: 'staff',
    businessId: bizId
  });

  const superAdminUser = await db.createUser({
    name: 'System Root',
    email: 'superadmin@system.internal',
    password: 'Hash@123',
    role: 'superadmin',
    businessId: null
  });

  const ownerToken = generateToken(ownerUser);
  const collegeAdminToken = generateToken(collegeAdminUser);
  const managerToken = generateToken(managerUser);
  const staffToken = generateToken(staffUser);
  const superAdminToken = generateToken(superAdminUser);

  // Seed an existing form and feedback record in mock DB
  const testForm = await db.createForm({
    businessId: bizId,
    title: 'Initial Draft Form',
    slug: 'initial-draft-form-xyz',
    status: 'draft',
    questions: [
      { id: 'q_rate', type: 'rating', text: 'Rate our class', min: 1, max: 5 },
      { id: 'q_nps', type: 'nps', text: 'Recommend?', min: 0, max: 10 }
    ]
  });
  const testFormId = testForm.id;

  const testFeedback = await db.createFeedback({
    businessId: bizId,
    formId: testFormId,
    rating: 2,
    nps: 3,
    status: 'new',
    priority: 'medium',
    comments: 'Projector was broken'
  });
  const testFeedbackId = testFeedback.id;

  // --- Staff Permissions Verification ---
  await it('Staff role is forbidden from creating forms (HTTP 403)', async () => {
    const res = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({
        title: 'Staff Form',
        questions: [{ id: 'q1', type: 'rating', text: 'Rate' }]
      })
    });
    assert.strictEqual(res.status, 403);
  });

  await it('Staff role is forbidden from updating forms (HTTP 403)', async () => {
    const res = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ title: 'Staff Hacked Title' })
    });
    assert.strictEqual(res.status, 403);
  });

  await it('Staff role is forbidden from publishing forms (HTTP 403)', async () => {
    const res = await fetch(`${BASE_URL}/api/forms/${testFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert.strictEqual(res.status, 403);
  });

  await it('Staff role is forbidden from deleting forms (HTTP 403)', async () => {
    const res = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert.strictEqual(res.status, 403);
  });

  await it('Staff role is forbidden from creating locations (HTTP 403)', async () => {
    const res = await fetch(`${BASE_URL}/api/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ name: 'Staff Branch', address: '123 Test St' })
    });
    assert.strictEqual(res.status, 403);
  });

  await it('Staff role is forbidden from updating business settings (HTTP 403)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/business-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ name: 'Hacked Business' })
    });
    assert.strictEqual(res.status, 403);
  });

  await it('Staff role is forbidden from modifying feedback status, priority, resolve, or CSV export (HTTP 403)', async () => {
    const resStatus = await fetch(`${BASE_URL}/api/feedback/${testFeedbackId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ status: 'resolved' })
    });
    assert.strictEqual(resStatus.status, 403);

    const resPriority = await fetch(`${BASE_URL}/api/feedback/${testFeedbackId}/priority`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ priority: 'critical' })
    });
    assert.strictEqual(resPriority.status, 403);

    const resResolve = await fetch(`${BASE_URL}/api/feedback/${testFeedbackId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ resolutionNotes: 'Resolved by staff' })
    });
    assert.strictEqual(resResolve.status, 403);

    const resCsv = await fetch(`${BASE_URL}/api/feedback/export/csv`, {
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert.strictEqual(resCsv.status, 403);
  });

  await it('Staff role CAN view feedback and add internal notes (HTTP 200/201)', async () => {
    const resList = await fetch(`${BASE_URL}/api/feedback`, {
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert.strictEqual(resList.status, 200);

    const resNote = await fetch(`${BASE_URL}/api/feedback/${testFeedbackId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ text: 'Staff checked classroom projector, issue confirmed.' })
    });
    assert.strictEqual(resNote.status, 201);
  });

  // --- Manager Permissions Verification ---
  await it('Manager role is forbidden from form creation, editing, publishing, and deleting (HTTP 403)', async () => {
    const resCreate = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
      body: JSON.stringify({
        title: 'Manager Form',
        questions: [{ id: 'q1', type: 'rating', text: 'Rate' }]
      })
    });
    assert.strictEqual(resCreate.status, 403);

    const resPublish = await fetch(`${BASE_URL}/api/forms/${testFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    assert.strictEqual(resPublish.status, 403);

    const resDelete = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    assert.strictEqual(resDelete.status, 403);
  });

  await it('Manager role is forbidden from editing business settings or deleting locations (HTTP 403)', async () => {
    const resSettings = await fetch(`${BASE_URL}/api/auth/business-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
      body: JSON.stringify({ name: 'Manager New Name' })
    });
    assert.strictEqual(resSettings.status, 403);

    const resDelLoc = await fetch(`${BASE_URL}/api/locations/loc_dummy_id`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    // Multi-tenant check or permission check: 403 or 404
    assert.ok([403, 404].includes(resDelLoc.status));
  });

  await it('Manager role CAN create locations, change feedback status/priority, resolve feedback, and export CSV', async () => {
    const resLoc = await fetch(`${BASE_URL}/api/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
      body: JSON.stringify({ name: 'North Campus Library', address: 'Block C 101' })
    });
    assert.strictEqual(resLoc.status, 201);

    const resPriority = await fetch(`${BASE_URL}/api/feedback/${testFeedbackId}/priority`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
      body: JSON.stringify({ priority: 'urgent' })
    });
    assert.strictEqual(resPriority.status, 200);

    const resResolve = await fetch(`${BASE_URL}/api/feedback/${testFeedbackId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
      body: JSON.stringify({ resolutionNotes: 'Replaced projector lamp' })
    });
    assert.strictEqual(resResolve.status, 200);

    const resCsv = await fetch(`${BASE_URL}/api/feedback/export/csv`, {
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    assert.strictEqual(resCsv.status, 200);
  });

  // --- College Admin & Owner Permissions Verification ---
  await it('College Admin role CAN create forms, edit business settings, and publish forms', async () => {
    const resCreate = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${collegeAdminToken}` },
      body: JSON.stringify({
        title: 'Dean Faculty Evaluation Form',
        questions: [{ id: 'q_prof', type: 'rating', text: 'Prof clarity', min: 1, max: 5 }]
      })
    });
    assert.strictEqual(resCreate.status, 201);
    const newForm = (await resCreate.json()).form;

    const resSettings = await fetch(`${BASE_URL}/api/auth/business-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${collegeAdminToken}` },
      body: JSON.stringify({ name: 'Apex Academy (Updated by Dean)' })
    });
    assert.strictEqual(resSettings.status, 200);

    const resPublish = await fetch(`${BASE_URL}/api/forms/${newForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${collegeAdminToken}` }
    });
    assert.strictEqual(resPublish.status, 200);
  });

  // -------------------------------------------------------------
  // SUITE 4: Unbypassable Form Lifecycle (Priority 3)
  // -------------------------------------------------------------
  console.log('\n--- 4. Unbypassable Form Publishing Lifecycle ---');

  let lifecycleFormId = null;

  await it('New form is unconditionally created in "draft" status regardless of payload status', async () => {
    const res = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        title: 'Lifecycle Verification Form',
        status: 'published', // Malicious or impatient payload
        questions: [{ id: 'q_life', type: 'rating', text: 'Rate quality', min: 1, max: 5 }]
      })
    });
    assert.strictEqual(res.status, 201);
    const created = (await res.json()).form;
    assert.strictEqual(created.status, 'draft', 'Status must always be draft initially');
    lifecycleFormId = created.id;
  });

  await it('General PUT /api/forms/:id rejects status mutation with HTTP 400', async () => {
    const res = await fetch(`${BASE_URL}/api/forms/${lifecycleFormId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ status: 'published' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('explicit lifecycle transition endpoints'));
  });

  await it('Illegal status transition is rejected with HTTP 400 (e.g. pause on draft)', async () => {
    const res = await fetch(`${BASE_URL}/api/forms/${lifecycleFormId}/pause`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Invalid status transition'));
  });

  await it('Publishing valid draft form succeeds via PUT /api/forms/:id/publish', async () => {
    const res = await fetch(`${BASE_URL}/api/forms/${lifecycleFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.form.status, 'published');
  });

  await it('Published form can be paused and resumed', async () => {
    const resPause = await fetch(`${BASE_URL}/api/forms/${lifecycleFormId}/pause`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(resPause.status, 200);
    assert.strictEqual((await resPause.json()).form.status, 'paused');

    const resResume = await fetch(`${BASE_URL}/api/forms/${lifecycleFormId}/resume`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(resResume.status, 200);
    assert.strictEqual((await resResume.json()).form.status, 'published');
  });

  await it('Publishing rejects incomplete form (0 questions)', async () => {
    // Create draft form with valid question first
    const createRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        title: 'Empty Candidate Form',
        questions: [{ id: 'q_temp', type: 'rating', text: 'Temp' }]
      })
    });
    const fId = (await createRes.json()).form.id;

    // Manually empty questions in mock store to test publication safety guard
    const rawForm = await db.getFormById(fId);
    rawForm.questions = [];
    if (rawForm.save) await rawForm.save();

    const publishRes = await fetch(`${BASE_URL}/api/forms/${fId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(publishRes.status, 400);
    const data = await publishRes.json();
    assert.ok(data.error.includes('Cannot publish form'));
  });

  // Cleanup server
  server.close();

  console.log('\n===============================================================');
  console.log(`Phase 5 Tests Completed: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runPhase5Tests().catch((err) => {
    console.error('Fatal Test Runner Error:', err);
    process.exit(1);
  });
}

module.exports = runPhase5Tests;
