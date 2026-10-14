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

    // Test 13: Unsupported HTTP methods on API routes return JSON 404 (never HTML)
    console.log('\n[Test 13] Verifying unsupported HTTP methods return JSON 404...');
    const unsupportedMethodRes = await fetch(`${BASE_URL}/api/auth/login`, { method: 'DELETE' });
    assert.strictEqual(unsupportedMethodRes.status, 404);
    const methodErrJson = await unsupportedMethodRes.json();
    assert.ok(methodErrJson.error && methodErrJson.error.includes('not found'));
    console.log('  ✓ Unsupported HTTP method returned JSON 404');
    passedCount++;

    // Test 14: Negative Academic Field Validation (missing required, forged, department mismatch)
    console.log('\n[Test 14] Verifying strict academic field validation...');
    const validCollegeAnswers = {
      q_academic_clarity: 5,
      q_syllabus_coverage: 5,
      q_doubt_solving: 'Always addressed thoroughly',
      q_college_nps: 10
    };

    // Missing required department
    const missingDeptRes = await fetch(`${BASE_URL}/api/feedback/submit/${collegeForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academicDetails: {
          department: '',
          course: 'B.Tech',
          academicYear: '2025-2026',
          yearOfStudy: '1st Year',
          semester: 'Semester 1',
          section: 'Section A',
          faculty: 'Dr. Alan Turing',
          subject: 'Data Structures',
          category: 'Theory'
        },
        rating: 5,
        answers: validCollegeAnswers
      })
    });
    assert.strictEqual(missingDeptRes.status, 400);
    const missingDeptErr = await missingDeptRes.json();
    assert.ok(missingDeptErr.error.includes('Department'), `Must reject missing department, got: ${missingDeptErr.error}`);
    console.log('  ✓ Rejected missing required department with HTTP 400');

    // Forged department not in institution configuration
    const forgedDeptRes = await fetch(`${BASE_URL}/api/feedback/submit/${collegeForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academicDetails: {
          department: 'Astronautical Engineering (Unregistered)',
          course: 'B.Tech',
          academicYear: '2025-2026',
          yearOfStudy: '1st Year',
          semester: 'Semester 1',
          section: 'Section A',
          faculty: 'Dr. Alan Turing',
          subject: 'Data Structures',
          category: 'Theory'
        },
        rating: 5,
        answers: validCollegeAnswers
      })
    });
    assert.strictEqual(forgedDeptRes.status, 400);
    const forgedDeptErr = await forgedDeptRes.json();
    assert.ok(forgedDeptErr.error.includes('Invalid department'), 'Must reject unregistered department');
    console.log('  ✓ Rejected forged department with HTTP 400');
    passedCount++;

    // Test 15: Conditional Dynamic Questions (hidden questions not required; active questions enforced)
    console.log('\n[Test 15] Verifying conditional questions logic...');
    const condFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cafeData.token}`
      },
      body: JSON.stringify({
        title: 'Conditional Branching Form',
        overallRatingEnabled: false,
        questions: [
          {
            id: 'q_recommend',
            type: 'choice',
            text: 'Would you recommend us?',
            options: ['Yes', 'No'],
            required: true
          },
          {
            id: 'q_reason',
            type: 'text',
            text: 'Why would you not recommend us?',
            required: true,
            conditional: {
              dependsOn: 'q_recommend',
              operator: 'equals',
              value: 'No'
            }
          }
        ]
      })
    });
    assert.strictEqual(condFormRes.status, 201);
    const condForm = (await condFormRes.json()).form;
    await fetch(`${BASE_URL}/api/forms/${condForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${cafeData.token}` }
    });

    // Submitting 'Yes' -> q_reason is inactive and not required (must succeed)
    const condYesRes = await fetch(`${BASE_URL}/api/feedback/submit/${condForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_recommend: 'Yes' }
      })
    });
    assert.strictEqual(condYesRes.status, 201, 'Inactive conditional question should not be required');
    console.log('  ✓ Inactive conditional question correctly skipped from requirement');

    // Submitting 'No' without q_reason -> must fail with HTTP 400
    const condNoMissingRes = await fetch(`${BASE_URL}/api/feedback/submit/${condForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_recommend: 'No' }
      })
    });
    assert.strictEqual(condNoMissingRes.status, 400, 'Active conditional question must be required');
    const condNoMissingErr = await condNoMissingRes.json();
    assert.ok(condNoMissingErr.error.includes('required'), 'Must enforce active conditional question');

    // Submitting 'No' with q_reason -> must succeed
    const condNoSuccessRes = await fetch(`${BASE_URL}/api/feedback/submit/${condForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_recommend: 'No', q_reason: 'Slow response' }
      })
    });
    assert.strictEqual(condNoSuccessRes.status, 201);
    console.log('  ✓ Active conditional question validated and saved');
    passedCount++;

    // Test 16: Multiple Rating Questions with overallRatingEnabled: false
    console.log('\n[Test 16] Verifying multiple rating questions with overallRatingEnabled: false...');
    const multiRatingFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cafeData.token}`
      },
      body: JSON.stringify({
        title: 'Multi-Rating Category Evaluation',
        overallRatingEnabled: false,
        questions: [
          { id: 'q_speed', type: 'rating', text: 'Speed of delivery', required: true },
          { id: 'q_quality', type: 'rating', text: 'Food quality', required: true }
        ]
      })
    });
    assert.strictEqual(multiRatingFormRes.status, 201);
    const multiRatingForm = (await multiRatingFormRes.json()).form;
    await fetch(`${BASE_URL}/api/forms/${multiRatingForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${cafeData.token}` }
    });

    const multiSubmitRes = await fetch(`${BASE_URL}/api/feedback/submit/${multiRatingForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_speed: 3, q_quality: 5 }
      })
    });
    assert.strictEqual(multiSubmitRes.status, 201);
    const multiData = await multiSubmitRes.json();
    assert.strictEqual(multiData.rating, null, 'Overall rating must be null');
    const multiDoc = await db.getFeedbackById(multiData.feedbackId);
    const multiDocAnswers = multiDoc.answers instanceof Map
      ? Object.fromEntries(multiDoc.answers)
      : (multiDoc.toObject ? multiDoc.toObject().answers : multiDoc.answers);
    assert.strictEqual(multiDoc.rating, null);
    assert.strictEqual(multiDocAnswers.q_speed, 3);
    assert.strictEqual(multiDocAnswers.q_quality, 5);
    console.log('  ✓ Multiple rating questions stored independently; overall rating remains null');
    passedCount++;

    // Test 17: NPS-Only Form without overall rating
    console.log('\n[Test 17] Verifying NPS-only form submission and analytics...');
    const npsFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cafeData.token}`
      },
      body: JSON.stringify({
        title: 'Net Promoter Survey',
        overallRatingEnabled: false,
        questions: [
          { id: 'q_nps_only', type: 'nps', text: 'Recommend us? (0-10)', required: true }
        ]
      })
    });
    assert.strictEqual(npsFormRes.status, 201);
    const npsForm = (await npsFormRes.json()).form;
    await fetch(`${BASE_URL}/api/forms/${npsForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${cafeData.token}` }
    });

    const npsSubmitRes = await fetch(`${BASE_URL}/api/feedback/submit/${npsForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_nps_only: 10 }
      })
    });
    assert.strictEqual(npsSubmitRes.status, 201);
    const npsSubData = await npsSubmitRes.json();
    assert.strictEqual(npsSubData.rating, null);
    const npsDoc = await db.getFeedbackById(npsSubData.feedbackId);
    assert.strictEqual(npsDoc.rating, null);
    assert.strictEqual(npsDoc.nps, 10);

    const npsScore = calculateNps([npsDoc]);
    assert.strictEqual(npsScore.npsScore, 100);
    const avgScore = calculateAverageRating([npsDoc]);
    assert.strictEqual(avgScore, 'N/A');
    console.log('  ✓ NPS-only submission recorded: NPS = +100, Average Rating = "N/A"');
    passedCount++;

    // Test 18: Optional Overall Rating (overallRatingEnabled: true, overallRatingRequired: false)
    console.log('\n[Test 18] Verifying optional overall rating form...');
    const optRatingFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cafeData.token}`
      },
      body: JSON.stringify({
        title: 'Optional Star Survey',
        overallRatingEnabled: true,
        overallRatingRequired: false,
        questions: [
          { id: 'q_comment', type: 'text', text: 'Notes' }
        ]
      })
    });
    assert.strictEqual(optRatingFormRes.status, 201);
    const optRatingForm = (await optRatingFormRes.json()).form;
    await fetch(`${BASE_URL}/api/forms/${optRatingForm.id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${cafeData.token}` }
    });

    // Unrated submission succeeds
    const unratedSubmitRes = await fetch(`${BASE_URL}/api/feedback/submit/${optRatingForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_comment: 'No stars given' }
      })
    });
    assert.strictEqual(unratedSubmitRes.status, 201);
    const unratedData = await unratedSubmitRes.json();
    assert.strictEqual(unratedData.rating, null);

    // Rated submission succeeds
    const ratedSubmitRes = await fetch(`${BASE_URL}/api/feedback/submit/${optRatingForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        answers: { q_comment: 'Four stars given' }
      })
    });
    assert.strictEqual(ratedSubmitRes.status, 201);
    const ratedData = await ratedSubmitRes.json();
    assert.strictEqual(ratedData.rating, 4);

    const unratedDoc = await db.getFeedbackById(unratedData.feedbackId);
    const ratedDoc = await db.getFeedbackById(ratedData.feedbackId);
    const combinedAvg = calculateAverageRating([unratedDoc, ratedDoc]);
    assert.strictEqual(String(combinedAvg), '4.0', 'Average must be calculated strictly on rated submission');
    console.log('  ✓ Optional overall rating: unrated is null, rated is 4, combined avg = 4.0');
    passedCount++;

    // Test 19: QR Code Generation Endpoint
    console.log('\n[Test 19] Verifying QR image generation endpoint...');
    const qrRes = await fetch(`${BASE_URL}/api/qr/image?url=${encodeURIComponent(`${BASE_URL}/feedback/${collegeForm.slug}`)}`);
    assert.strictEqual(qrRes.status, 200);
    const qrType = qrRes.headers.get('content-type') || '';
    assert.ok(qrType.includes('image/svg+xml') || qrType.includes('image/png'), `Expected image MIME type, got ${qrType}`);
    console.log(`  ✓ QR image generated with Content-Type: ${qrType}`);
    passedCount++;

    // Test 20: Complete College Onboarding E2E Lifecycle
    console.log('\n[Test 20] Verifying end-to-end college onboarding lifecycle...');
    const e2eCollegeEmail = `lifecycle_college_${timestamp}@apexuniv.edu`;
    const e2eRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: `Apex Lifecycle University ${timestamp}`,
        businessType: 'college',
        ownerName: 'Registrar Jones',
        email: e2eCollegeEmail,
        password: 'Password@123',
        isOnlineOnly: false,
        address: {
          addressLine1: '400 North Campus Way',
          city: 'Tech Hub',
          state: 'Haryana',
          postalCode: '122001',
          country: 'India'
        }
      })
    });
    assert.strictEqual(e2eRegRes.status, 201);
    const e2eData = await e2eRegRes.json();
    const e2eToken = e2eData.token;
    const e2eInitialForm = e2eData.firstForm;
    assert.strictEqual(e2eInitialForm.status, 'draft', 'College starts with draft form');

    // 1. Submit blocked on draft form
    const e2eDraftSubmitRes = await fetch(`${BASE_URL}/api/feedback/submit/${e2eInitialForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: {} })
    });
    assert.strictEqual(e2eDraftSubmitRes.status, 403, 'Public submit on draft form must be 403');

    // 2. Publish blocked before configuration
    const e2ePrematurePublish = await fetch(`${BASE_URL}/api/forms/${e2eInitialForm.id || e2eInitialForm._id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${e2eToken}` }
    });
    assert.strictEqual(e2ePrematurePublish.status, 400);

    // 3. Configure academic master data in settings
    const e2eConfigRes = await fetch(`${BASE_URL}/api/auth/business-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${e2eToken}`
      },
      body: JSON.stringify({
        name: e2eData.business.name,
        academicConfig: {
          departments: ['Computer Science'],
          courses: ['B.Tech'],
          academicYears: ['2026-2027'],
          years: ['Final Year'],
          semesters: ['Semester 8'],
          sections: ['Section Alpha'],
          faculty: [{ name: 'Prof. Donald Knuth', department: 'Computer Science' }],
          subjects: [{ name: 'Art of Programming', department: 'Computer Science' }],
          feedbackCategories: ['Academic Delivery']
        }
      })
    });
    assert.strictEqual(e2eConfigRes.status, 200);

    // 4. Publish evaluation form
    const e2ePublishRes = await fetch(`${BASE_URL}/api/forms/${e2eInitialForm.id || e2eInitialForm._id}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${e2eToken}` }
    });
    assert.strictEqual(e2ePublishRes.status, 200);
    const e2ePubForm = (await e2ePublishRes.json()).form;
    assert.strictEqual(e2ePubForm.status, 'published');

    // 5. Retrieve public form metadata
    const e2ePublicFormRes = await fetch(`${BASE_URL}/api/forms/slug/${e2ePubForm.slug}`);
    assert.strictEqual(e2ePublicFormRes.status, 200);
    const e2ePubData = await e2ePublicFormRes.json();
    assert.strictEqual(e2ePubData.form.status, 'published');
    assert.ok(e2ePubData.business.academicConfig.faculty.length > 0);

    // 6. Submit feedback successfully
    const e2eSubmitSuccess = await fetch(`${BASE_URL}/api/feedback/submit/${e2ePubForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Student Alpha',
        academicDetails: {
          department: 'Computer Science',
          course: 'B.Tech',
          academicYear: '2026-2027',
          yearOfStudy: 'Final Year',
          semester: 'Semester 8',
          section: 'Section Alpha',
          faculty: 'Prof. Donald Knuth',
          subject: 'Art of Programming',
          category: 'Academic Delivery'
        },
        rating: 5,
        answers: {
          q_academic_clarity: 5,
          q_syllabus_coverage: 5,
          q_doubt_solving: 'Always addressed thoroughly',
          q_college_nps: 10
        }
      })
    });
    assert.strictEqual(e2eSubmitSuccess.status, 201);
    console.log('  ✓ Full college onboarding, configuration, publication and submission verified');
    passedCount++;

    console.log('\n===============================================================');
    console.log(`>>> [PASS] All ${passedCount} Phase 10/12 Verification Tests Passed!`);
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
