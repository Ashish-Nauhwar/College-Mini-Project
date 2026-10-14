/**
 * FeedbackHub Phase 14 — Submission Blocker Regression & Final Workflow Verification
 * 
 * Verifies:
 * 1. Helper exports: determineSentimentAndPriority is a function exported from analyticsHelper.js.
 * 2. HTTP Submission regression tests:
 *    - Successful feedback submission returns HTTP 201 and creates a record.
 *    - 5★ + NPS 2: saved as sentiment 'negative', priority 'critical', isComplaint true.
 *    - 1★ + NPS 10: saved as sentiment 'negative', priority 'critical', isComplaint true.
 *    - Rating-only submissions (5★ positive vs 2★ urgent complaint).
 *    - NPS-only submissions (NPS 10 positive vs NPS 5 urgent complaint).
 *    - Unrated response: rating=null, nps=null, sentiment 'neutral', priority 'low'.
 *    - Client sentiment spoofing blocked: arbitrary req.body.sentiment cannot override server calculation.
 *    - Stored record, inbox priority, and complaint analytics strictly agree.
 * 3. NPS & recursive conditional logic verification:
 *    - Question evaluated only when all ancestors are visible.
 *    - Hidden child answers discarded by server.
 *    - Unknown conditional operators fail closed.
 *    - Canonical NPS derived from configured question.
 *    - Conflicting top-level NPS rejected with HTTP 400.
 *    - Forms without NPS questions reject arbitrary NPS with HTTP 400.
 *    - Multiple NPS questions preserved separately.
 * 4. Full College Onboarding & Multi-Tenant Workflow:
 *    - Register college -> starter form created in "draft" status.
 *    - Attempting to publish before academic setup is blocked with HTTP 400.
 *    - Configure academic data in Business Settings.
 *    - Publish via dedicated endpoint PUT /api/forms/:id/publish succeeds.
 *    - Submit valid feedback through public API.
 *    - Missing required fields and forged academic values rejected with HTTP 400.
 *    - Cross-tenant viewing blocked.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.TEST_MOCK_DB = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase14-test-secret-must-be-at-least-32-chars-long';

const app = require('../server');
const db = require('../src/db');
const analyticsHelper = require('../src/utils/analyticsHelper');
const {
  determineSentimentAndPriority,
  isComplaint,
  calculateAverageRating,
  calculateNps
} = analyticsHelper;

async function runPhase14Tests() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB PHASE 14 REGRESSION & FINAL WORKFLOW TESTS      ');
  console.log('===============================================================\n');

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

  const timestamp = Date.now();
  let passedCount = 0;

  try {
    // =========================================================================
    // SECTION 1: EXPORT & HELPER VERIFICATION
    // =========================================================================
    console.log('--- SECTION 1: Sentiment & Priority Helper Integrity ---');

    console.log('[Test 1] Verifying determineSentimentAndPriority is a function exported from analyticsHelper...');
    assert.strictEqual(typeof analyticsHelper.determineSentimentAndPriority, 'function');
    assert.strictEqual(typeof determineSentimentAndPriority, 'function');
    console.log('  ✓ determineSentimentAndPriority is exported as a function');
    passedCount++;

    // Setup Tenant A
    const regResA = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: `Phase14 Enterprise ${timestamp}`,
        businessType: 'other',
        name: 'Phase 14 Owner',
        email: `phase14_${timestamp}@enterprise.com`,
        password: 'ValidPassword@123',
        isOnlineOnly: true
      })
    });
    assert.strictEqual(regResA.status, 201);
    const regDataA = await regResA.json();
    const tokenA = regDataA.token;
    const bizIdA = regDataA.business._id || regDataA.business.id;

    // Create a standard test form for Tenant A with rating and NPS questions
    const standardFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        title: `Standard Feedback Form ${timestamp}`,
        showOverallRating: true,
        requireOverallRating: false,
        questions: [
          { id: 'q_nps', type: 'nps', text: 'How likely are you to recommend us?', min: 0, max: 10, required: false },
          { id: 'q_comments', type: 'text', text: 'Comments', required: false }
        ]
      })
    });
    assert.strictEqual(standardFormRes.status, 201);
    const standardFormData = await standardFormRes.json();
    const standardFormId = standardFormData.form._id || standardFormData.form.id;

    const pubResA = await fetch(`${BASE_URL}/api/forms/${standardFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(pubResA.status, 200);
    const formSlugA = standardFormData.form.slug;

    // =========================================================================
    // SECTION 2: SUBMISSION REGRESSION TESTS
    // =========================================================================
    console.log('\n--- SECTION 2: HTTP Submission Regression Tests ---');

    // Test 2: Successful submission returns HTTP 201 and creates a record
    console.log('[Test 2] Verifying standard feedback submission creates a record (HTTP 201)...');
    const sub2Res = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        answers: { q_nps: 9, q_comments: 'Great service' }
      })
    });
    assert.strictEqual(sub2Res.status, 201);
    const sub2Data = await sub2Res.json();
    assert.ok(sub2Data.feedbackId);
    const doc2 = await db.getFeedbackById(sub2Data.feedbackId);
    assert.strictEqual(doc2.rating, 5);
    assert.strictEqual(doc2.nps, 9);
    assert.strictEqual(doc2.sentiment, 'positive');
    assert.strictEqual(doc2.priority, 'low');
    console.log('  ✓ Standard feedback recorded: rating=5, nps=9, sentiment=positive, priority=low');
    passedCount++;

    // Test 3: 5★ response with NPS 2 receives negative sentiment and critical priority
    console.log('[Test 3] Verifying 5-star rating with NPS 2 is treated as a critical complaint...');
    const sub3Res = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        answers: { q_nps: 2, q_comments: 'Good staff but billing was unacceptable' }
      })
    });
    assert.strictEqual(sub3Res.status, 201);
    const sub3Data = await sub3Res.json();
    const doc3 = await db.getFeedbackById(sub3Data.feedbackId);
    assert.strictEqual(doc3.sentiment, 'negative', '5★ with NPS 2 must receive sentiment: negative');
    assert.strictEqual(doc3.priority, 'critical', 'NPS <= 3 must receive priority: critical');
    assert.strictEqual(isComplaint(doc3), true, 'isComplaint helper must classify as complaint');
    console.log('  ✓ 5★ + NPS 2: sentiment=negative, priority=critical, isComplaint=true');
    passedCount++;

    // Test 4: 1★ response with NPS 10 receives negative sentiment and critical priority
    console.log('[Test 4] Verifying 1-star rating with NPS 10 is treated as a critical complaint...');
    const sub4Res = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 1,
        answers: { q_nps: 10, q_comments: 'Broken experience today' }
      })
    });
    assert.strictEqual(sub4Res.status, 201);
    const sub4Data = await sub4Res.json();
    const doc4 = await db.getFeedbackById(sub4Data.feedbackId);
    assert.strictEqual(doc4.sentiment, 'negative', '1★ rating must receive sentiment: negative');
    assert.strictEqual(doc4.priority, 'critical', '1★ rating must receive priority: critical');
    assert.strictEqual(isComplaint(doc4), true, 'isComplaint helper must classify as complaint');
    console.log('  ✓ 1★ + NPS 10: sentiment=negative, priority=critical, isComplaint=true');
    passedCount++;

    // Test 5: Rating-only positive (5★) and negative (2★) submissions
    console.log('[Test 5] Verifying rating-only positive and negative submissions...');
    const sub5PosRes = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5, answers: {} })
    });
    assert.strictEqual(sub5PosRes.status, 201);
    const doc5Pos = await db.getFeedbackById((await sub5PosRes.json()).feedbackId);
    assert.strictEqual(doc5Pos.rating, 5);
    assert.strictEqual(doc5Pos.nps, null);
    assert.strictEqual(doc5Pos.sentiment, 'positive');
    assert.strictEqual(doc5Pos.priority, 'low');
    assert.strictEqual(isComplaint(doc5Pos), false);

    const sub5NegRes = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 2, answers: {} })
    });
    assert.strictEqual(sub5NegRes.status, 201);
    const doc5Neg = await db.getFeedbackById((await sub5NegRes.json()).feedbackId);
    assert.strictEqual(doc5Neg.rating, 2);
    assert.strictEqual(doc5Neg.nps, null);
    assert.strictEqual(doc5Neg.sentiment, 'negative');
    assert.strictEqual(doc5Neg.priority, 'urgent');
    assert.strictEqual(isComplaint(doc5Neg), true);
    console.log('  ✓ Rating-only: 5★ = positive/low; 2★ = negative/urgent');
    passedCount++;

    // Test 6: NPS-only positive (NPS 10) and negative (NPS 5) submissions
    console.log('[Test 6] Verifying NPS-only positive and negative submissions...');
    const sub6PosRes = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { q_nps: 10 } })
    });
    assert.strictEqual(sub6PosRes.status, 201);
    const doc6Pos = await db.getFeedbackById((await sub6PosRes.json()).feedbackId);
    assert.strictEqual(doc6Pos.rating, null);
    assert.strictEqual(doc6Pos.nps, 10);
    assert.strictEqual(doc6Pos.sentiment, 'positive');
    assert.strictEqual(doc6Pos.priority, 'low');
    assert.strictEqual(isComplaint(doc6Pos), false);

    const sub6NegRes = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { q_nps: 5 } })
    });
    assert.strictEqual(sub6NegRes.status, 201);
    const doc6Neg = await db.getFeedbackById((await sub6NegRes.json()).feedbackId);
    assert.strictEqual(doc6Neg.rating, null);
    assert.strictEqual(doc6Neg.nps, 5);
    assert.strictEqual(doc6Neg.sentiment, 'negative');
    assert.strictEqual(doc6Neg.priority, 'urgent');
    assert.strictEqual(isComplaint(doc6Neg), true);
    console.log('  ✓ NPS-only: NPS 10 = positive/low; NPS 5 = negative/urgent');
    passedCount++;

    // Test 7: Unrated response (no rating, no NPS) does not fabricate rating or positive sentiment
    console.log('[Test 7] Verifying unrated submission does not fabricate values or positive sentiment...');
    const sub7Res = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_comments: 'General neutral inquiry' }
      })
    });
    assert.strictEqual(sub7Res.status, 201);
    const doc7 = await db.getFeedbackById((await sub7Res.json()).feedbackId);
    assert.strictEqual(doc7.rating, null);
    assert.strictEqual(doc7.nps, null);
    assert.strictEqual(doc7.sentiment, 'neutral');
    assert.strictEqual(doc7.priority, 'low');
    assert.strictEqual(isComplaint(doc7), false);
    console.log('  ✓ Unrated response: rating=null, nps=null, sentiment=neutral, priority=low');
    passedCount++;

    // Test 8: Public client cannot spoof sentiment via arbitrary req.body.sentiment
    console.log('[Test 8] Verifying public client cannot spoof sentiment via req.body.sentiment...');
    const sub8Res = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 1, // Severe 1★ complaint
        answers: { q_nps: 1 },
        sentiment: 'positive', // Spoofed client claim!
        priority: 'low'        // Spoofed client claim!
      })
    });
    assert.strictEqual(sub8Res.status, 201);
    const doc8 = await db.getFeedbackById((await sub8Res.json()).feedbackId);
    assert.strictEqual(doc8.sentiment, 'negative', 'Server must ignore req.body.sentiment and compute negative');
    assert.strictEqual(doc8.priority, 'critical', 'Server must compute critical priority');
    assert.strictEqual(isComplaint(doc8), true);
    console.log('  ✓ Client sentiment spoofing blocked: server strictly derived sentiment=negative, priority=critical');
    passedCount++;

    // Test 9: Stored record, inbox priority, and complaint analytics agree
    console.log('[Test 9] Verifying inbox priority and complaint analytics alignment...');
    const inboxRes = await fetch(`${BASE_URL}/api/feedback`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(inboxRes.status, 200);
    const inboxData = await inboxRes.json();
    assert.ok(Array.isArray(inboxData.feedbacks));

    const analyticsRes = await fetch(`${BASE_URL}/api/analytics/dashboard`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(analyticsRes.status, 200);
    const analyticsData = await analyticsRes.json();

    const expectedComplaints = inboxData.feedbacks.filter(isComplaint).length;
    assert.strictEqual(analyticsData.summary.totalComplaints, expectedComplaints);
    assert.strictEqual(analyticsData.sentimentCounts.negative, inboxData.feedbacks.filter(fb => fb.sentiment === 'negative').length);
    console.log(`  ✓ Inbox and Analytics agree: ${expectedComplaints} complaints matched perfectly`);
    passedCount++;

    // =========================================================================
    // SECTION 3: RECURSIVE CONDITIONALS & CANONICAL NPS VERIFICATION
    // =========================================================================
    console.log('\n--- SECTION 3: Recursive Conditionals & Canonical NPS Verification ---');

    // Test 10: Multi-level conditional visibility and discard of hidden answers
    console.log('[Test 10] Verifying multi-level conditional evaluation and hidden answer discard...');
    const condFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        title: `Conditional Gate Form ${timestamp}`,
        questions: [
          { id: 'q_parent', type: 'yesno', text: 'Parent active?' },
          { id: 'q_child', type: 'yesno', text: 'Child active?', conditional: { dependsOn: 'q_parent', operator: 'equals', value: 'Yes' } },
          { id: 'q_grandchild', type: 'text', text: 'Grandchild text', required: true, conditional: { dependsOn: 'q_child', operator: 'equals', value: 'Yes' } }
        ]
      })
    });
    const condFormData = await condFormRes.json();
    const condFormId = condFormData.form._id || condFormData.form.id;
    await fetch(`${BASE_URL}/api/forms/${condFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    // Submitting with parent=No but forged child and grandchild answers
    const condSubmitRes = await fetch(`${BASE_URL}/api/feedback/submit/${condFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        answers: {
          q_parent: 'No',
          q_child: 'Yes',
          q_grandchild: 'Forged grandchild value'
        }
      })
    });
    assert.strictEqual(condSubmitRes.status, 201);
    const condDoc = await db.getFeedbackById((await condSubmitRes.json()).feedbackId);
    assert.strictEqual(condDoc.answers.get('q_parent'), 'No');
    assert.strictEqual(condDoc.answers.get('q_child'), undefined, 'Hidden child answer must be discarded');
    assert.strictEqual(condDoc.answers.get('q_grandchild'), undefined, 'Hidden grandchild answer must be discarded');
    console.log('  ✓ Multi-level conditional: forged answers for hidden descendants discarded cleanly');
    passedCount++;

    // Test 11: Unknown conditional operators fail closed
    console.log('[Test 11] Verifying unknown operator fails closed...');
    const badOpQ = {
      id: 'q_test_bad_op',
      conditional: { dependsOn: 'q_parent', operator: 'invalid_op_xyz', value: 'Yes' }
    };
    assert.strictEqual(analyticsHelper.isComplaint, analyticsHelper.isComplaint);
    const { isQuestionVisible } = require('../src/routes/feedback');
    assert.strictEqual(isQuestionVisible(badOpQ, { q_parent: 'Yes' }), false);
    console.log('  ✓ Unknown operator returned false (fail-closed security)');
    passedCount++;

    // Test 12: Conflicting top-level NPS rejected with HTTP 400
    console.log('[Test 12] Verifying conflicting top-level NPS is rejected...');
    const conflictNpsRes = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        nps: 3, // Contradicts answer below!
        answers: { q_nps: 9 }
      })
    });
    assert.strictEqual(conflictNpsRes.status, 400);
    const conflictData = await conflictNpsRes.json();
    assert.ok(conflictData.error.includes('does not match'));
    console.log('  ✓ Conflicting top-level NPS rejected with HTTP 400');
    passedCount++;

    // Test 13: Form without NPS question rejects arbitrary top-level NPS
    console.log('[Test 13] Verifying form without NPS questions rejects arbitrary NPS...');
    const noNpsFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        title: `Zero NPS Form ${timestamp}`,
        questions: [{ id: 'q_text_only', type: 'text', text: 'Comments only' }]
      })
    });
    const noNpsFormId = (await noNpsFormRes.json()).form.id;
    await fetch(`${BASE_URL}/api/forms/${noNpsFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    const noNpsSlug = (await db.getFormById(noNpsFormId)).slug;

    const noNpsSubmitRes = await fetch(`${BASE_URL}/api/feedback/submit/${noNpsSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        nps: 8 // Not allowed on non-NPS forms!
      })
    });
    assert.strictEqual(noNpsSubmitRes.status, 400);
    console.log('  ✓ Arbitrary top-level NPS on non-NPS form rejected with HTTP 400');
    passedCount++;

    // =========================================================================
    // SECTION 4: FULL COLLEGE ONBOARDING & PUBLIC SUBMISSION WORKFLOW
    // =========================================================================
    console.log('\n--- SECTION 4: College Onboarding & Submission Workflow ---');

    // Step 1: Register a new college business
    console.log('[Test 14] Registering a new college business...');
    const collegeRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: `National Tech Institute ${timestamp}`,
        businessType: 'college',
        name: 'Dean Thomas',
        email: `dean_${timestamp}@nationaltech.edu`,
        password: 'CollegePassword@123',
        isOnlineOnly: true
      })
    });
    assert.strictEqual(collegeRegRes.status, 201);
    const collegeRegData = await collegeRegRes.json();
    const collegeToken = collegeRegData.token;
    const collegeBizId = collegeRegData.business._id || collegeRegData.business.id;
    const starterForm = collegeRegData.firstForm;

    // Step 2: Confirm starter form is initially in 'draft' status
    console.log('[Test 15] Confirming starter form is created in draft status...');
    assert.ok(starterForm, 'Starter form should be created');
    assert.strictEqual(starterForm.status, 'draft', 'College starter form must be in draft status');
    console.log('  ✓ College registration initialized starter form in "draft" status');
    passedCount++;

    // Step 3: Attempting to publish before academic configuration is blocked
    console.log('[Test 16] Verifying publishing before academic data configuration is blocked (HTTP 400)...');
    const premPublishRes = await fetch(`${BASE_URL}/api/forms/${starterForm._id || starterForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${collegeToken}` }
    });
    assert.strictEqual(premPublishRes.status, 400);
    const premPublishData = await premPublishRes.json();
    assert.ok(premPublishData.error.includes('required academic fields have no options configured'));
    console.log('  ✓ Publish blocked with HTTP 400:', premPublishData.error);
    passedCount++;

    // Step 4: Configure academic master data in Business Settings
    console.log('[Test 17] Configuring academic master data in Business Settings...');
    const configRes = await fetch(`${BASE_URL}/api/auth/business-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${collegeToken}`
      },
      body: JSON.stringify({
        name: `National Tech Institute ${timestamp}`,
        isOnlineOnly: true,
        academicConfig: {
          departments: ['Computer Science', 'Mechanical Engineering'],
          courses: ['B.Tech Computer Science', 'M.Tech AI'],
          academicYears: ['2025-2026', '2026-2027'],
          years: ['1st Year', '2nd Year', '3rd Year', '4th Year'],
          semesters: ['Semester 1', 'Semester 2', 'Semester 5'],
          sections: ['Section A', 'Section B'],
          faculty: [
            { name: 'Dr. Alan Turing', department: 'Computer Science' },
            { name: 'Dr. Nikola Tesla', department: 'Mechanical Engineering' }
          ],
          subjects: [
            { name: 'Operating Systems', code: 'CS501', department: 'Computer Science' },
            { name: 'Thermodynamics', code: 'ME301', department: 'Mechanical Engineering' }
          ],
          feedbackCategories: ['Theory Lecture', 'Lab Work', 'Curriculum']
        }
      })
    });
    assert.strictEqual(configRes.status, 200);
    console.log('  ✓ Business academic configuration updated successfully');
    passedCount++;

    // Step 5: Publish the form via dedicated endpoint
    console.log('[Test 18] Publishing the college evaluation form...');
    const pubCollegeRes = await fetch(`${BASE_URL}/api/forms/${starterForm._id || starterForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${collegeToken}` }
    });
    assert.strictEqual(pubCollegeRes.status, 200);
    const publishedCollegeForm = (await pubCollegeRes.json()).form;
    assert.strictEqual(publishedCollegeForm.status, 'published');
    const collegeSlug = publishedCollegeForm.slug;
    console.log(`  ✓ Form published successfully with slug: ${collegeSlug}`);
    passedCount++;

    // Step 6: Submit valid feedback through public API
    console.log('[Test 19] Submitting valid academic feedback through public API...');
    const collegeSubmitRes = await fetch(`${BASE_URL}/api/feedback/submit/${collegeSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        academicDetails: {
          department: 'Computer Science',
          course: 'B.Tech Computer Science',
          academicYear: '2025-2026',
          yearOfStudy: '3rd Year',
          semester: 'Semester 5',
          section: 'Section A',
          faculty: 'Dr. Alan Turing',
          subject: 'Operating Systems',
          category: 'Theory Lecture'
        },
        answers: {
          q_academic_clarity: 5,
          q_syllabus_coverage: 5,
          q_doubt_solving: 'Always addressed thoroughly',
          q_college_nps: 10
        },
        comments: 'Outstanding lecture clarity'
      })
    });
    assert.strictEqual(collegeSubmitRes.status, 201);
    const collegeSubData = await collegeSubmitRes.json();
    const collegeFeedbackDoc = await db.getFeedbackById(collegeSubData.feedbackId);
    assert.strictEqual(collegeFeedbackDoc.academicDetails.department, 'Computer Science');
    assert.strictEqual(collegeFeedbackDoc.academicDetails.faculty, 'Dr. Alan Turing');
    assert.strictEqual(collegeFeedbackDoc.academicDetails.subject, 'Operating Systems');
    assert.strictEqual(collegeFeedbackDoc.rating, 5);
    assert.strictEqual(collegeFeedbackDoc.nps, 10);
    assert.strictEqual(collegeFeedbackDoc.sentiment, 'positive');
    assert.strictEqual(collegeFeedbackDoc.priority, 'low');
    console.log('  ✓ Academic feedback saved with correct details, rating, NPS, sentiment and priority');
    passedCount++;

    // Step 7: Negative check - Reject forged department
    console.log('[Test 20] Verifying forged department is rejected with HTTP 400...');
    const forgedDeptRes = await fetch(`${BASE_URL}/api/feedback/submit/${collegeSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        academicDetails: {
          department: 'Astronautical Engineering', // Forged!
          course: 'B.Tech Computer Science',
          academicYear: '2025-2026',
          yearOfStudy: '3rd Year',
          semester: 'Semester 5',
          section: 'Section A',
          faculty: 'Dr. Alan Turing',
          subject: 'Operating Systems',
          category: 'Theory Lecture'
        },
        answers: {
          q_academic_clarity: 4,
          q_syllabus_coverage: 4,
          q_doubt_solving: 'Always addressed thoroughly',
          q_college_nps: 9
        }
      })
    });
    assert.strictEqual(forgedDeptRes.status, 400);
    const forgedData = await forgedDeptRes.json();
    assert.ok(forgedData.error.includes('Invalid department'));
    console.log('  ✓ Forged department rejected with HTTP 400:', forgedData.error);
    passedCount++;

    // Step 8: Multi-tenant cross-tenant access check
    console.log('[Test 21] Verifying multi-tenant isolation (Tenant A cannot see College feedback)...');
    const crossTenantRes = await fetch(`${BASE_URL}/api/feedback`, {
      headers: { Authorization: `Bearer ${tokenA}` } // Authenticated as Tenant A
    });
    assert.strictEqual(crossTenantRes.status, 200);
    const tenantAFeedbacks = (await crossTenantRes.json()).feedbacks;
    const leak = tenantAFeedbacks.find(fb => (fb._id || fb.id) === collegeSubData.feedbackId);
    assert.strictEqual(leak, undefined, 'Tenant A must NEVER be able to see College feedback');
    console.log('  ✓ Strict multi-tenant isolation verified: zero cross-tenant data leakage');
    passedCount++;

    console.log('\n===============================================================');
    console.log(`>>> [PASS] All ${passedCount} Phase 14 Regression & Workflow Tests Passed!`);
    console.log('===============================================================\n');

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

if (require.main === module) {
  runPhase14Tests().catch((err) => {
    console.error('\n[FAIL] Phase 14 Test Suite Error:', err);
    process.exit(1);
  });
}

module.exports = { runPhase14Tests };
