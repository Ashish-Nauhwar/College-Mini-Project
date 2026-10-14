/**
 * Phase 10 Release Readiness & Verification Test Suite
 * 
 * Verifies:
 * 1. College registration creates initial form in "draft" status (not published).
 * 2. Non-college registration creates initial form in "published" status.
 * 3. Attempting to publish a college form when required academic fields (faculty/subject) have 0 options fails with 400.
 * 4. Publishing succeeds once faculty/subjects are configured.
 * 5. Publishing blocked if choice/select/checkbox questions have empty options list.
 * 6. Form schema supports showOverallRating and requireOverallRating.
 * 7. When showOverallRating is false, feedback.rating remains null (does not steal rating question answer).
 * 8. Average rating calculation excludes unrated feedbacks (null) from the denominator.
 * 9. Server route ordering: Unknown /api/* returns JSON 404.
 * 10. Missing static assets (*.css, *.js) return 404 text, not HTML.
 * 11. Public form route /feedback/:slug returns feedback.html.
 * 12. Dashboard routes return index.html SPA.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.TEST_MOCK_DB = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase10-test-secret-must-be-at-least-32-chars-long';

const app = require('../server');
const db = require('../src/db');
const { calculateAverageRating, calculateNps } = require('../src/utils/analyticsHelper');

async function runPhase10Tests() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB PHASE 10 RELEASE VERIFICATION TEST SUITE        ');
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
    // Test 1: College registration creates initial form in "draft" status
    console.log('[Test 1] Verifying college registration creates initial form in "draft" status...');
    const collegeRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: `Apex Institute of Tech ${timestamp}`,
        businessType: 'college',
        ownerName: 'Dean Smith',
        email: `dean_${timestamp}@apextech.edu`,
        password: 'Password@123',
        isOnlineOnly: false,
        address: {
          addressLine1: '100 University Ave',
          city: 'Tech City',
          state: 'Delhi',
          postalCode: '110001',
          country: 'India'
        }
      })
    });
    assert.strictEqual(collegeRegRes.status, 201, `College registration failed: ${collegeRegRes.status}`);
    const collegeData = await collegeRegRes.json();
    assert.ok(collegeData.token, 'Token returned');
    assert.strictEqual(collegeData.business.type, 'college');

    // Retrieve the initial form for the college
    const collegeFormsRes = await fetch(`${BASE_URL}/api/forms`, {
      headers: { Authorization: `Bearer ${collegeData.token}` }
    });
    assert.strictEqual(collegeFormsRes.status, 200);
    const collegeFormsData = await collegeFormsRes.json();
    assert.ok(collegeFormsData.forms.length >= 1, 'Initial form must exist');
    const collegeForm = collegeFormsData.forms[0];
    assert.strictEqual(collegeForm.status, 'draft', 'Initial college form MUST be created in "draft" status');
    console.log(`  ✓ Initial college form created with status: "${collegeForm.status}" (draft)`);
    passedCount++;

    // Test 2: Non-college registration creates initial form in "published" status
    console.log('\n[Test 2] Verifying non-college registration creates initial form in "published" status...');
    const cafeRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: `City Cafe ${timestamp}`,
        businessType: 'restaurant',
        ownerName: 'Cafe Owner',
        email: `owner_${timestamp}@citycafe.com`,
        password: 'Password@123',
        isOnlineOnly: false,
        address: {
          addressLine1: '45 Market St',
          city: 'Mumbai',
          state: 'Maharashtra',
          postalCode: '400001',
          country: 'India'
        }
      })
    });
    assert.strictEqual(cafeRegRes.status, 201);
    const cafeData = await cafeRegRes.json();
    const cafeFormsRes = await fetch(`${BASE_URL}/api/forms`, {
      headers: { Authorization: `Bearer ${cafeData.token}` }
    });
    const cafeFormsData = await cafeFormsRes.json();
    assert.ok(cafeFormsData.forms.length >= 1);
    const cafeForm = cafeFormsData.forms[0];
    assert.strictEqual(cafeForm.status, 'published', 'Non-college initial form should be "published"');
    console.log(`  ✓ Non-college initial form created with status: "${cafeForm.status}" (published)`);
    passedCount++;

    // Test 3: Publishing college form blocked when required academic fields have 0 options
    console.log('\n[Test 3] Attempting to publish college form before academic setup...');
    const prematurePublishRes = await fetch(`${BASE_URL}/api/forms/${collegeForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${collegeData.token}` }
    });
    assert.strictEqual(prematurePublishRes.status, 400, 'Publishing must fail with HTTP 400 when required academic fields are empty');
    const prematureData = await prematurePublishRes.json();
    assert.ok(prematureData.error.includes('academic') || prematureData.error.includes('configured') || prematureData.error.includes('Faculty') || prematureData.error.includes('Subject'),
      `Error message should explain missing options: ${prematureData.error}`);
    console.log(`  ✓ Publishing blocked with HTTP 400: "${prematureData.error}"`);
    passedCount++;

    // Test 4: Configure faculty and subjects in Business Settings and publishing
    console.log('\n[Test 4] Configuring faculty and subjects in Business Settings and publishing...');
    const updateBizRes = await fetch(`${BASE_URL}/api/auth/business-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${collegeData.token}`
      },
      body: JSON.stringify({
        name: collegeData.business.name,
        academicConfig: {
          departments: ['Computer Science', 'Electrical'],
          courses: ['B.Tech', 'M.Tech'],
          academicYears: ['2025-2026'],
          years: ['1st Year', '2nd Year'],
          yearsOfStudy: ['1st Year', '2nd Year'],
          semesters: ['Semester 1', 'Semester 2'],
          sections: ['Section A', 'Section B'],
          faculty: [{ name: 'Dr. Alan Turing' }, { name: 'Dr. Grace Hopper' }],
          subjects: [{ name: 'Data Structures' }, { name: 'Operating Systems' }],
          feedbackCategories: ['Theory', 'Lab']
        }
      })
    });
    assert.strictEqual(updateBizRes.status, 200, 'Profile update must succeed');

    const validPublishRes = await fetch(`${BASE_URL}/api/forms/${collegeForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${collegeData.token}` }
    });
    const validPublishData = await validPublishRes.json();
    assert.strictEqual(validPublishRes.status, 200, `Publishing should now succeed: ${validPublishRes.status} - ${JSON.stringify(validPublishData)}`);
    assert.strictEqual(validPublishData.form.status, 'published');
    console.log('  ✓ Form published successfully after academic options configured');
    passedCount++;

    // Test 5: Form validation blocks choice questions with empty options
    console.log('\n[Test 5] Verifying form validation blocks choice question with empty options...');
    const emptyChoiceFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cafeData.token}`
      },
      body: JSON.stringify({
        title: 'Empty Choice Test Form',
        questions: [
          { id: 'q1', type: 'choice', text: 'Select one', options: [] }
        ]
      })
    });
    assert.strictEqual(emptyChoiceFormRes.status, 400, 'Must reject choice questions with 0 options');
    const emptyChoiceErr = await emptyChoiceFormRes.json();
    assert.ok(emptyChoiceErr.error.includes('option'), 'Error should specify choice options missing');
    console.log(`  ✓ Form validation blocked with HTTP 400: "${emptyChoiceErr.error}"`);
    passedCount++;

    // Test 6: Form settings support showOverallRating and requireOverallRating
    console.log('\n[Test 6] Creating form with showOverallRating=false...');
    const noRatingFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cafeData.token}`
      },
      body: JSON.stringify({
        title: 'Custom Questions Only Form',
        showOverallRating: false,
        requireOverallRating: false,
        questions: [
          { id: 'q_speed', type: 'rating', text: 'Rate service speed (1-5)', required: true },
          { id: 'q_text', type: 'text', text: 'Comments', required: false }
        ]
      })
    });
    assert.strictEqual(noRatingFormRes.status, 201);
    const noRatingForm = (await noRatingFormRes.json()).form;
    assert.strictEqual(noRatingForm.showOverallRating, false);
    assert.strictEqual(noRatingForm.requireOverallRating, false);

    // Publish the form so public submissions are accepted
    const pubNoRatingRes = await fetch(`${BASE_URL}/api/forms/${noRatingForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${cafeData.token}` }
    });
    assert.strictEqual(pubNoRatingRes.status, 200);
    console.log('  ✓ Form created and published with showOverallRating: false and requireOverallRating: false');
    passedCount++;

    // Test 7: Feedback submission does not steal question rating when showOverallRating=false
    console.log('\n[Test 7] Submitting feedback to form with showOverallRating=false...');
    const submitRes = await fetch(`${BASE_URL}/api/feedback/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formId: noRatingForm.id,
        answers: {
          q_speed: 4,
          q_text: 'Good service'
        }
      })
    });
    assert.strictEqual(submitRes.status, 201, `Submit failed: ${submitRes.status}`);
    const submitData = await submitRes.json();
    assert.strictEqual(submitData.rating, null, 'Overall rating in response must be null when showOverallRating is false');

    const storedFeedback = await db.getFeedbackById(submitData.feedbackId);
    const answersObj = (storedFeedback.answers instanceof Map)
      ? Object.fromEntries(storedFeedback.answers)
      : (storedFeedback.toObject ? storedFeedback.toObject().answers : storedFeedback.answers);
    assert.strictEqual(storedFeedback.rating, null, 'Overall rating in DB record must be null');
    assert.strictEqual(answersObj.q_speed, 4, 'Individual question answer preserved');
    console.log('  ✓ feedback.rating is null; individual question answer preserved in answers.q_speed');
    passedCount++;

    // Test 8: Analytics average rating excludes unrated records (null) from denominator
    console.log('\n[Test 8] Checking average rating calculation with mixed rated and unrated feedbacks...');
    const mixedFeedbacks = [
      { rating: 4 },
      { rating: null }, // from unrated form
      { rating: 5 },
      { rating: null }
    ];
    const avg = calculateAverageRating(mixedFeedbacks);
    // (4 + 5) / 2 rated records = 4.5. If null were counted, (4 + 5) / 4 = 2.25.
    assert.strictEqual(String(avg), '4.5', `Average should be 4.5, got ${avg}`);
    console.log(`  ✓ calculateAverageRating: (4 + 5) / 2 rated = ${avg}★ (nulls excluded from denominator)`);
    passedCount++;

    // Test 9: Unknown API route returns JSON 404
    console.log('\n[Test 9] Verifying unknown /api/* route returns JSON 404...');
    const unknownApiRes = await fetch(`${BASE_URL}/api/nonexistent-route-endpoint-xyz`);
    assert.strictEqual(unknownApiRes.status, 404, 'Must return 404');
    const contentType = unknownApiRes.headers.get('content-type') || '';
    assert.ok(contentType.includes('application/json'), `Content-Type must be JSON, got: ${contentType}`);
    const unknownApiData = await unknownApiRes.json();
    assert.ok(unknownApiData.error, 'Must contain error message');
    console.log(`  ✓ Unknown API returned HTTP 404 JSON: ${JSON.stringify(unknownApiData)}`);
    passedCount++;

    // Test 10: Missing static asset returns 404 text, not HTML
    console.log('\n[Test 10] Verifying missing static asset returns 404 (not index.html)...');
    const missingAssetRes = await fetch(`${BASE_URL}/css/nonexistent-file.css`);
    assert.strictEqual(missingAssetRes.status, 404, 'Must return 404 for missing static file');
    const assetBody = await missingAssetRes.text();
    assert.ok(!assetBody.includes('<!DOCTYPE html>'), 'Must NOT return index.html for missing asset');
    console.log(`  ✓ Missing asset returned HTTP 404: "${assetBody.trim()}"`);
    passedCount++;

    // Test 11: Public form route /feedback/:slug returns feedback.html
    console.log('\n[Test 11] Verifying /feedback/:slug serves feedback.html...');
    const feedbackRouteRes = await fetch(`${BASE_URL}/feedback/${collegeForm.slug}`);
    assert.strictEqual(feedbackRouteRes.status, 200);
    const feedbackHtml = await feedbackRouteRes.text();
    assert.ok(feedbackHtml.includes('feedbackForm') || feedbackHtml.includes('Feedback') || feedbackHtml.includes('feedback.js'),
      'Must contain feedback.html markup');
    console.log('  ✓ /feedback/:slug returns feedback.html');
    passedCount++;

    // Test 12: SPA catch-all serves index.html for dashboard routes
    console.log('\n[Test 12] Verifying dashboard routes serve index.html...');
    const spaRouteRes = await fetch(`${BASE_URL}/dashboard`);
    assert.strictEqual(spaRouteRes.status, 200);
    const spaHtml = await spaRouteRes.text();
    assert.ok(spaHtml.includes('app.js') && spaHtml.includes('FeedbackHub'), 'Must return SPA index.html');
    console.log('  ✓ /dashboard returns SPA index.html');
    passedCount++;

    console.log('\n===============================================================');
    console.log(`>>> [PASS] All ${passedCount} Phase 10 Verification Tests Passed!`);
    console.log('===============================================================\n');

    return { success: true, testsRun: passedCount, passed: passedCount };
  } finally {
    if (server) {
      server.close();
    }
  }
}

if (require.main === module) {
  runPhase10Tests().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('\n[PHASE 10 TEST FAILED]:', err);
    process.exit(1);
  });
}

module.exports = runPhase10Tests;
