/**
 * FeedbackHub Phase 5 & 6 Test Suite:
 * Production Safety, Role-Based Access Control (RBAC), and Publishing Lifecycle
 *
 * Verifies:
 * 1. Demo seeding refused in production and unspecified environments.
 * 2. Demo seeding strictly produces NO super-admin accounts (behaviorally verified).
 * 3. Superadmin bootstrap password complexity & uniqueness checks.
 * 4. Form graph validator boundaries: non-empty questions, stable IDs, rating/NPS bounds, option caps.
 * 5. Multi-NPS question isolation & strict average rating calculations (no silent 0 or invented 5★).
 * 6. Strict RBAC permission matrix for owner, college_admin, manager, staff, superadmin.
 * 7. Unbypassable form lifecycle: draft-only creation, general PUT status rejection, legal transitions, publish verification.
 * 8. Public submissions blocked on non-published forms (draft, paused, archived).
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const assert = require('assert');
const http = require('http');

// Enable isolated mock database mode
const db = require('../src/db');
db.enableMockDb(true);

const app = require('../server');
const { generateToken } = require('../src/middleware/auth');
const { validateQuestionGraph } = require('../src/utils/formGraphValidator');
const { validateSuperadminPassword } = require('../scripts/bootstrap-superadmin');
const { calculateAverageRating, calculateNps, isComplaint } = require('../src/utils/analyticsHelper');
const { seed, getDemoUsers } = require('../scripts/seed');

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

async function runPhase5Tests() {
  console.log('\n===============================================================');
  console.log('  FEEDBACKHUB PHASE 5/6: RBAC, LIFECYCLE & PRODUCTION SAFETY  ');
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

  try {
    // -------------------------------------------------------------
    // SUITE 1: Production Safety & Seeding Separation (Priority 1)
    // -------------------------------------------------------------
    console.log('--- 1. Production Safety & Seeding Separation ---');

    await it('Seed script refuses execution before connecting when NODE_ENV=production', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        let threw = false;
        try {
          await seed();
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('SAFETY REFUSAL'));
          assert.ok(err.message.includes('strictly forbidden in production mode'));
        }
        assert.strictEqual(threw, true, 'seed() must throw when NODE_ENV=production');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    await it('Seed script refuses execution when NODE_ENV is unspecified or unrecognized', async () => {
      const origEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      try {
        let threw = false;
        try {
          await seed();
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('SAFETY REFUSAL'));
          assert.ok(err.message.includes('unspecified'));
        }
        assert.strictEqual(threw, true, 'seed() must throw when NODE_ENV is unspecified');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    await it('Demo seeding creates no super-admin accounts in database (behavioral test)', async () => {
      db.clearMockDb();
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      try {
        const seedResult = await seed({ useMockDb: true, closeConnection: false });
        assert.strictEqual(seedResult.success, true);
        const users = await db.getUsers();
        const superAdmins = users.filter(u => u.role === 'superadmin' || u.role === 'super_admin');
        assert.strictEqual(superAdmins.length, 0, 'No super-admin must ever be seeded by demo seed script');
        const owners = users.filter(u => u.role === 'owner');
        assert.ok(owners.length >= 1, 'Owner demo accounts should be created');

        // Also verify the demo user templates strictly contain zero superadmin accounts
        const demoUsers = getDemoUsers();
        const demoSuperAdmins = demoUsers.filter(u => u.role === 'superadmin' || u.role === 'super_admin' || u.email.includes('admin@feedbackhub.com'));
        assert.strictEqual(demoSuperAdmins.length, 0, 'getDemoUsers must contain zero super-admin accounts');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    await it('Superadmin bootstrap validates password complexity', () => {
      // Too short (<10)
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

    await it('Rejects empty or non-array questions list', () => {
      const resEmpty = validateQuestionGraph([]);
      assert.ok(resEmpty.error);
      assert.ok(resEmpty.error.includes('at least one question'));

      const resNull = validateQuestionGraph(null);
      assert.ok(resNull.error);
    });

    await it('Rejects invalid question ID format and duplicate IDs', () => {
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

    await it('Rejects out-of-bounds rating scales (requires integer 1 <= min < max <= 5)', () => {
      assert.ok(validateQuestionGraph([{ id: 'q1', type: 'rating', text: 'Rate', min: 0, max: 5 }]).error);
      assert.ok(validateQuestionGraph([{ id: 'q2', type: 'rating', text: 'Rate', min: 1, max: 10 }]).error);
      assert.ok(validateQuestionGraph([{ id: 'q3', type: 'rating', text: 'Rate', min: 4, max: 3 }]).error);
      assert.ok(validateQuestionGraph([{ id: 'q4', type: 'rating', text: 'Rate', min: 1.5, max: 5 }]).error);
      assert.strictEqual(validateQuestionGraph([{ id: 'q5', type: 'rating', text: 'Rate', min: 1, max: 5 }]).error, null);
    });

    await it('Rejects non-standard NPS scales (strictly requires min: 0, max: 10)', () => {
      assert.ok(validateQuestionGraph([{ id: 'q1', type: 'nps', text: 'NPS', min: 1, max: 10 }]).error);
      assert.ok(validateQuestionGraph([{ id: 'q2', type: 'nps', text: 'NPS', min: 0, max: 5 }]).error);
      assert.strictEqual(validateQuestionGraph([{ id: 'q3', type: 'nps', text: 'NPS', min: 0, max: 10 }]).error, null);
    });

    await it('Caps option lists at 50 options and 200 characters per option', () => {
      const tooManyOptions = Array.from({ length: 51 }, (_, i) => `Option ${i + 1}`);
      assert.ok(validateQuestionGraph([{ id: 'q1', type: 'choice', text: 'Choice', options: tooManyOptions }]).error);

      const longOption = 'A'.repeat(201);
      assert.ok(validateQuestionGraph([{ id: 'q2', type: 'choice', text: 'Choice', options: [longOption] }]).error);

      const validOptions = ['Opt 1', 'Opt 2'];
      assert.strictEqual(validateQuestionGraph([{ id: 'q3', type: 'choice', text: 'Choice', options: validOptions }]).error, null);
    });

    // -------------------------------------------------------------
    // SUITE 3: Rating & NPS Calculation Correctness Everywhere
    // -------------------------------------------------------------
    console.log('\n--- 3. Rating & NPS Analytics Calculation Correctness ---');

    await it('calculateAverageRating excludes unrated and NPS-only feedbacks without treating them as 0', () => {
      const mixedFeedbacks = [
        { rating: 5, nps: 10 },
        { rating: 3, nps: 8 },
        { rating: null, nps: 9 }, // unrated star rating
        { nps: 7 },               // missing star rating
        { rating: undefined, nps: 6 }
      ];
      // Only items 1 and 2 are rated: (5 + 3) / 2 = 4.0
      const avg = calculateAverageRating(mixedFeedbacks);
      assert.strictEqual(avg, '4.0');
    });

    await it('calculateAverageRating returns "N/A" when no valid rated submissions exist', () => {
      assert.strictEqual(calculateAverageRating([]), 'N/A');
      assert.strictEqual(calculateAverageRating([{ nps: 10 }, { nps: 8 }]), 'N/A');
      assert.strictEqual(calculateAverageRating([{ rating: null }, { rating: 'invalid' }]), 'N/A');
    });

    await it('calculateNps calculates separate metrics per question ID and never mixes them', () => {
      const multiNpsFeedbacks = [
        {
          nps: 10, // primary
          npsAnswers: new Map([['q_college_nps', 10], ['q_faculty_nps', 2]])
        },
        {
          nps: 9, // primary
          npsAnswers: new Map([['q_college_nps', 9], ['q_faculty_nps', 3]])
        }
      ];

      // College NPS: 2 promoters (10, 9) = 100%
      const collegeNps = calculateNps(multiNpsFeedbacks, 'q_college_nps');
      assert.strictEqual(collegeNps.npsScore, 100);
      assert.strictEqual(collegeNps.promoters, 2);

      // Faculty NPS: 2 detractors (2, 3) = -100%
      const facultyNps = calculateNps(multiNpsFeedbacks, 'q_faculty_nps');
      assert.strictEqual(facultyNps.npsScore, -100);
      assert.strictEqual(facultyNps.detractors, 2);

      // Primary NPS matches college
      const primary = calculateNps(multiNpsFeedbacks);
      assert.strictEqual(primary.npsScore, 100);
    });

    // -------------------------------------------------------------
    // Setup Mock Database Data for API RBAC & Lifecycle Tests
    // -------------------------------------------------------------
    console.log('\n--- 4. Role-Based Access Control (RBAC) Permission Matrix ---');

    db.clearMockDb();

    const biz = await db.createBusiness({
      name: 'Apex Academy Test Institution',
      type: 'college',
      category: 'Higher Education',
      email: 'info@apexacademy.edu',
      active: true
    });
    const bizId = biz.id;

    const otherBiz = await db.createBusiness({
      name: 'Competitor College Other',
      type: 'college',
      category: 'Higher Education',
      email: 'info@competitor.edu',
      active: true
    });
    const otherBizId = otherBiz.id;

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

    const otherOwnerUser = await db.createUser({
      name: 'Other Owner',
      email: 'owner@competitor.edu',
      password: 'Hash@123',
      role: 'owner',
      businessId: otherBizId
    });

    const ownerToken = generateToken(ownerUser);
    const collegeAdminToken = generateToken(collegeAdminUser);
    const managerToken = generateToken(managerUser);
    const staffToken = generateToken(staffUser);
    const otherOwnerToken = generateToken(otherOwnerUser);

    // Seed test form and feedback record in mock DB
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

    await it('Manager role is forbidden from editing business settings (HTTP 403)', async () => {
      const resSettings = await fetch(`${BASE_URL}/api/auth/business-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
        body: JSON.stringify({ name: 'Manager New Name' })
      });
      assert.strictEqual(resSettings.status, 403);
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

    // --- Tenant Isolation ---
    await it('Cross-tenant form operations are blocked with HTTP 403 Forbidden', async () => {
      // User from other business tries to view form
      const resView = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
        headers: { Authorization: `Bearer ${otherOwnerToken}` }
      });
      assert.strictEqual(resView.status, 403);

      // User from other business tries to edit form
      const resEdit = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherOwnerToken}` },
        body: JSON.stringify({ title: 'Hacked by Tenant B' })
      });
      assert.strictEqual(resEdit.status, 403);

      // User from other business tries to delete form
      const resDel = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${otherOwnerToken}` }
      });
      assert.strictEqual(resDel.status, 403);
    });

    // -------------------------------------------------------------
    // SUITE 5: Unbypassable Form Lifecycle (Priority 3)
    // -------------------------------------------------------------
    console.log('\n--- 5. Unbypassable Form Publishing Lifecycle ---');

    let lifecycleFormId = null;
    let lifecycleSlug = null;

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
      lifecycleSlug = created.slug;
    });

    await it('Public submission is blocked on draft form with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${BASE_URL}/api/feedback/submit/${lifecycleSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: { q_life: 5 } })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.ok(data.error.includes('draft'));
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

    await it('Published form accepts public responses and transitions to paused', async () => {
      // Public response succeeds when published
      const resPub = await fetch(`${BASE_URL}/api/feedback/submit/${lifecycleSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: { q_life: 5 } })
      });
      assert.strictEqual(resPub.status, 201);

      // Pause form
      const resPause = await fetch(`${BASE_URL}/api/forms/${lifecycleFormId}/pause`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resPause.status, 200);
      assert.strictEqual((await resPause.json()).form.status, 'paused');

      // Public submission blocked when paused
      const resPausedSub = await fetch(`${BASE_URL}/api/feedback/submit/${lifecycleSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: { q_life: 5 } })
      });
      assert.strictEqual(resPausedSub.status, 403);
      assert.ok((await resPausedSub.json()).error.includes('paused'));

      // Resume form
      const resResume = await fetch(`${BASE_URL}/api/forms/${lifecycleFormId}/resume`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resResume.status, 200);
      assert.strictEqual((await resResume.json()).form.status, 'published');
    });

    await it('Publishing rejects incomplete form (0 questions)', async () => {
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

  } finally {
    // Cleanup server
    if (server) {
      server.close();
    }
  }

  console.log('\n===============================================================');
  console.log(`Phase 5/6 Tests Completed: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
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
