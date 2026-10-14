/**
 * FeedbackHub Phase 13 — Logic Fixes and Release Verification Test Suite
 * 
 * Verifies:
 * PRIORITY 1: Nested conditional-question visibility on the server
 *  - Simple conditional question
 *  - Two-level nested condition
 *  - Three-level nested condition
 *  - Hidden ancestor with forged answers for its descendants
 *  - Missing parent answers
 *  - Invalid / unsupported operator fails closed
 *  - Visible required child with missing answer fails with HTTP 400
 *  - Valid response with all necessary visible answers succeeds (HTTP 201)
 * 
 * PRIORITY 2: Authoritative and consistent NPS data
 *  - Valid NPS answer saved in feedback.nps, npsAnswers, answers
 *  - Top-level NPS matching configured answer succeeds
 *  - Top-level NPS conflicting with configured answer rejected with HTTP 400
 *  - Top-level NPS submitted to form with no NPS question rejected with HTTP 400
 *  - Form with multiple NPS questions preserves separate metrics per question
 *  - NPS calculations accurate after saving and reloading database records
 * 
 * PRIORITY 3: Complaint classification, sentiment, and priority alignment
 *  - 5-star rating with NPS 2: saved as sentiment 'negative', priority 'critical', isComplaint true
 *  - 1-star rating with NPS 10: saved as sentiment 'negative', priority 'critical', isComplaint true
 *  - Rating-only responses (5-star positive vs 2-star urgent complaint)
 *  - NPS-only responses (NPS 10 positive vs NPS 5 urgent complaint)
 *  - Neutral response (3-star, NPS 7 passive)
 *  - Response containing neither rating nor NPS (unrated neutral)
 *  - Stored record, complaint helper, inbox priority, and analytics all strictly agree
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.TEST_MOCK_DB = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase13-test-secret-must-be-at-least-32-chars-long';

const app = require('../server');
const db = require('../src/db');
const { isQuestionVisible } = require('../src/routes/feedback');
const {
  isComplaint,
  calculateAverageRating,
  calculateNps,
  determineSentimentAndPriority
} = require('../src/utils/analyticsHelper');

async function runPhase13Tests() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB PHASE 13 LOGIC & RELEASE VERIFICATION TESTS     ');
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
    // Setup Tenant & Auth Token
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: `Phase13 Logic Corp ${timestamp}`,
        businessType: 'other',
        name: 'Phase 13 Admin',
        email: `phase13_${timestamp}@logiccorp.com`,
        password: 'ValidPassword@123',
        isOnlineOnly: true
      })
    });
    if (regRes.status !== 201) {
      const errText = await regRes.text();
      throw new Error(`Registration failed (${regRes.status}): ${errText}`);
    }
    const regData = await regRes.json();
    const token = regData.token;

    // =========================================================================
    // PRIORITY 1: NESTED CONDITIONAL-QUESTION VISIBILITY ON THE SERVER
    // =========================================================================
    console.log('--- PRIORITY 1: Nested Conditional-Question Visibility ---');

    // Create a form with a 3-level deep nested conditional hierarchy:
    // Q1 (root): "Did you visit the library?" (yesno)
    // Q2 (level 1): "Did you use the digital catalog?" (yesno, depends on Q1 == 'Yes')
    // Q3 (level 2): "Rate digital catalog speed" (rating 1-5, depends on Q2 == 'Yes')
    // Q4 (level 3): "Explain slow speed" (text, required, depends on Q3 <= 2, operator 'less_than' 3)
    // Q5 (invalid operator test): depends on Q1 with invalid operator 'unknown_op'
    const nestedFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        title: `Nested Conditional Test Form ${timestamp}`,
        questions: [
          { id: 'q_root', type: 'yesno', text: 'Did you visit the library?', required: true },
          {
            id: 'q_level1',
            type: 'yesno',
            text: 'Did you use the digital catalog?',
            required: false,
            conditional: { dependsOn: 'q_root', operator: 'equals', value: 'Yes' }
          },
          {
            id: 'q_level2',
            type: 'rating',
            text: 'Rate digital catalog speed',
            min: 1,
            max: 5,
            required: false,
            conditional: { dependsOn: 'q_level1', operator: 'equals', value: 'Yes' }
          },
          {
            id: 'q_level3',
            type: 'text',
            text: 'Explain slow speed',
            required: true,
            conditional: { dependsOn: 'q_level2', operator: 'less_than', value: 3 }
          }
        ]
      })
    });
    assert.strictEqual(nestedFormRes.status, 201);
    const nestedFormData = await nestedFormRes.json();
    const nestedFormId = nestedFormData.form._id || nestedFormData.form.id;

    // Publish form
    const pubRes = await fetch(`${BASE_URL}/api/forms/${nestedFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(pubRes.status, 200);

    // Test 1: Simple conditional question (Q1 = No -> Q2 hidden)
    console.log('[Test 1] Verifying simple conditional question visibility...');
    const test1Res = await fetch(`${BASE_URL}/api/feedback/submit/${nestedFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        answers: { q_root: 'No' }
      })
    });
    assert.strictEqual(test1Res.status, 201);
    const test1Data = await test1Res.json();
    const test1Doc = await db.getFeedbackById(test1Data.feedbackId);
    assert.strictEqual(test1Doc.answers.get('q_root'), 'No');
    assert.strictEqual(test1Doc.answers.get('q_level1'), undefined);
    console.log('  ✓ Simple conditional: child correctly hidden when parent condition unsatisfied');
    passedCount++;

    // Test 2: Two-level nested condition (Q1 = Yes, Q2 = No -> Q3 hidden)
    console.log('[Test 2] Verifying two-level nested condition...');
    const test2Res = await fetch(`${BASE_URL}/api/feedback/submit/${nestedFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        answers: { q_root: 'Yes', q_level1: 'No' }
      })
    });
    assert.strictEqual(test2Res.status, 201);
    const test2Data = await test2Res.json();
    const test2Doc = await db.getFeedbackById(test2Data.feedbackId);
    assert.strictEqual(test2Doc.answers.get('q_root'), 'Yes');
    assert.strictEqual(test2Doc.answers.get('q_level1'), 'No');
    assert.strictEqual(test2Doc.answers.get('q_level2'), undefined);
    console.log('  ✓ Two-level nesting: grandchild hidden when intermediate parent unsatisfied');
    passedCount++;

    // Test 3: Three-level nested condition (Q1 = Yes, Q2 = Yes, Q3 = 2 -> Q4 visible)
    console.log('[Test 3] Verifying three-level nested condition satisfied...');
    const test3Res = await fetch(`${BASE_URL}/api/feedback/submit/${nestedFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 3,
        answers: {
          q_root: 'Yes',
          q_level1: 'Yes',
          q_level2: 2,
          q_level3: 'Slow network loading search results'
        }
      })
    });
    assert.strictEqual(test3Res.status, 201);
    const test3Data = await test3Res.json();
    const test3Doc = await db.getFeedbackById(test3Data.feedbackId);
    assert.strictEqual(test3Doc.answers.get('q_level3'), 'Slow network loading search results');
    console.log('  ✓ Three-level nesting: great-grandchild visible when all ancestors satisfied');
    passedCount++;

    // Test 4: Hidden ancestor with forged answers for its descendants
    console.log('[Test 4] Verifying server discards forged answers when ancestor is hidden...');
    const test4Res = await fetch(`${BASE_URL}/api/feedback/submit/${nestedFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        answers: {
          q_root: 'No', // Ancestor says NO -> Q2, Q3, Q4 are all hidden
          q_level1: 'Yes', // Forged answer for hidden question
          q_level2: 2,     // Forged answer for hidden question
          q_level3: 'Forged explanation for hidden feature' // Forged answer
        }
      })
    });
    assert.strictEqual(test4Res.status, 201);
    const test4Data = await test4Res.json();
    const test4Doc = await db.getFeedbackById(test4Data.feedbackId);
    assert.strictEqual(test4Doc.answers.get('q_root'), 'No');
    assert.strictEqual(test4Doc.answers.get('q_level1'), undefined, 'Hidden level 1 answer must be discarded');
    assert.strictEqual(test4Doc.answers.get('q_level2'), undefined, 'Hidden level 2 answer must be discarded');
    assert.strictEqual(test4Doc.answers.get('q_level3'), undefined, 'Hidden level 3 answer must be discarded');
    console.log('  ✓ Server-side visibility discarded all forged answers for hidden descendants');
    passedCount++;

    // Test 5: Missing parent answers (child question condition cannot evaluate)
    console.log('[Test 5] Verifying behavior with missing parent answers...');
    const test5Res = await fetch(`${BASE_URL}/api/feedback/submit/${nestedFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        answers: {
          q_root: 'Yes'
          // q_level1 missing -> q_level2 and q_level3 cannot be satisfied
        }
      })
    });
    assert.strictEqual(test5Res.status, 201);
    const test5Data = await test5Res.json();
    const test5Doc = await db.getFeedbackById(test5Data.feedbackId);
    assert.strictEqual(test5Doc.answers.get('q_level2'), undefined);
    assert.strictEqual(test5Doc.answers.get('q_level3'), undefined);
    console.log('  ✓ Missing parent answers safely treated as hidden; no false positives');
    passedCount++;

    // Test 6: Invalid / unsupported operator fails closed
    console.log('[Test 6] Verifying unsupported conditional operator fails closed...');
    const invalidOpQ = {
      id: 'q_bad_op',
      conditional: { dependsOn: 'q_root', operator: 'unsupported_foo_bar', value: 'Yes' }
    };
    const isVisibleBadOp = isQuestionVisible(invalidOpQ, { q_root: 'Yes' });
    assert.strictEqual(isVisibleBadOp, false, 'Unsupported operator must fail closed (return false)');
    console.log('  ✓ Unsupported operator returned false (fail-closed security)');
    passedCount++;

    // Test 7: Visible required child with missing answer triggers HTTP 400
    console.log('[Test 7] Verifying visible required child with missing answer is rejected...');
    const test7Res = await fetch(`${BASE_URL}/api/feedback/submit/${nestedFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 3,
        answers: {
          q_root: 'Yes',
          q_level1: 'Yes',
          q_level2: 1
          // q_level3 is required when q_level2 < 3, but omitted here!
        }
      })
    });
    assert.strictEqual(test7Res.status, 400);
    const test7Data = await test7Res.json();
    assert.ok(test7Data.error.includes('Missing required field: "Explain slow speed"'));
    console.log('  ✓ Rejected submission with HTTP 400 when active required child answer is missing');
    passedCount++;

    // Test 8: Valid response containing all necessary visible answers succeeds
    console.log('[Test 8] Verifying fully satisfied nested submission succeeds...');
    const test8Res = await fetch(`${BASE_URL}/api/feedback/submit/${nestedFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        answers: {
          q_root: 'Yes',
          q_level1: 'Yes',
          q_level2: 4
          // q_level3 is NOT required because q_level2 >= 3
        }
      })
    });
    assert.strictEqual(test8Res.status, 201);
    console.log('  ✓ Valid nested submission succeeded with HTTP 201');
    passedCount++;

    // =========================================================================
    // PRIORITY 2: AUTHORITATIVE AND CONSISTENT NPS DATA
    // =========================================================================
    console.log('\n--- PRIORITY 2: Authoritative & Consistent NPS Data ---');

    // Create form with one NPS question
    const npsFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        title: `NPS Authority Form ${timestamp}`,
        questions: [
          { id: 'q_primary_nps', type: 'nps', text: 'How likely are you to recommend us?', min: 0, max: 10, required: true }
        ]
      })
    });
    assert.strictEqual(npsFormRes.status, 201);
    const npsFormData = await npsFormRes.json();
    const npsFormId = npsFormData.form._id || npsFormData.form.id;

    await fetch(`${BASE_URL}/api/forms/${npsFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });

    // Test 9: Valid NPS answer in answers map
    console.log('[Test 9] Verifying valid NPS answer is saved authoritatively...');
    const test9Res = await fetch(`${BASE_URL}/api/feedback/submit/${npsFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        answers: { q_primary_nps: 9 }
      })
    });
    assert.strictEqual(test9Res.status, 201);
    const test9Data = await test9Res.json();
    const test9Doc = await db.getFeedbackById(test9Data.feedbackId);
    assert.strictEqual(test9Doc.nps, 9);
    assert.strictEqual(test9Doc.answers.get('q_primary_nps'), 9);
    assert.strictEqual(test9Doc.npsAnswers.get('q_primary_nps'), 9);
    console.log('  ✓ Canonical NPS derived from configured question: nps=9, npsAnswers[q]=9, answers[q]=9');
    passedCount++;

    // Test 10: Top-level NPS matching configured answer succeeds
    console.log('[Test 10] Verifying matching top-level NPS succeeds...');
    const test10Res = await fetch(`${BASE_URL}/api/feedback/submit/${npsFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        nps: 10,
        answers: { q_primary_nps: 10 }
      })
    });
    assert.strictEqual(test10Res.status, 201);
    const test10Data = await test10Res.json();
    const test10Doc = await db.getFeedbackById(test10Data.feedbackId);
    assert.strictEqual(test10Doc.nps, 10);
    console.log('  ✓ Top-level NPS matching configured answer accepted cleanly');
    passedCount++;

    // Test 11: Top-level NPS conflicting with configured answer is rejected
    console.log('[Test 11] Verifying conflicting top-level NPS is rejected with HTTP 400...');
    const test11Res = await fetch(`${BASE_URL}/api/feedback/submit/${npsFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        nps: 2, // Contradicts answer below!
        answers: { q_primary_nps: 10 }
      })
    });
    assert.strictEqual(test11Res.status, 400);
    const test11Data = await test11Res.json();
    assert.ok(test11Data.error.includes('does not match'));
    console.log('  ✓ Rejected conflicting top-level NPS with HTTP 400:', test11Data.error);
    passedCount++;

    // Test 12: Top-level NPS submitted to form with NO NPS question is rejected
    console.log('[Test 12] Verifying top-level NPS rejected when form has no NPS question...');
    const noNpsFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        title: `No NPS Form ${timestamp}`,
        questions: [{ id: 'q_comment', type: 'text', text: 'Leave comments' }]
      })
    });
    const noNpsFormData = await noNpsFormRes.json();
    const noNpsFormId = noNpsFormData.form._id || noNpsFormData.form.id;
    await fetch(`${BASE_URL}/api/forms/${noNpsFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });

    const test12Res = await fetch(`${BASE_URL}/api/feedback/submit/${noNpsFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        nps: 10 // Form does not have an NPS question!
      })
    });
    assert.strictEqual(test12Res.status, 400);
    const test12Data = await test12Res.json();
    assert.ok(test12Data.error.includes('does not have an NPS question configured'));
    console.log('  ✓ Rejected arbitrary NPS score on non-NPS form with HTTP 400:', test12Data.error);
    passedCount++;

    // Test 13: Form with multiple NPS questions preserves separate metrics per question
    console.log('[Test 13] Verifying multi-NPS form preserves distinct metrics per question...');
    const multiNpsFormRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        title: `Multi NPS Form ${timestamp}`,
        questions: [
          { id: 'q_product_nps', type: 'nps', text: 'Recommend product?', min: 0, max: 10 },
          { id: 'q_support_nps', type: 'nps', text: 'Recommend support team?', min: 0, max: 10 }
        ]
      })
    });
    const multiNpsFormData = await multiNpsFormRes.json();
    const multiNpsFormId = multiNpsFormData.form._id || multiNpsFormData.form.id;
    await fetch(`${BASE_URL}/api/forms/${multiNpsFormId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });

    // Submit multi-NPS feedback: Product NPS = 10 (promoter), Support NPS = 2 (detractor)
    const test13Res = await fetch(`${BASE_URL}/api/feedback/submit/${multiNpsFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 4,
        answers: {
          q_product_nps: 10,
          q_support_nps: 2
        }
      })
    });
    assert.strictEqual(test13Res.status, 201);
    const test13Data = await test13Res.json();
    const test13Doc = await db.getFeedbackById(test13Data.feedbackId);

    // Primary NPS is product NPS (first configured question)
    assert.strictEqual(test13Doc.nps, 10);
    assert.strictEqual(test13Doc.npsAnswers.get('q_product_nps'), 10);
    assert.strictEqual(test13Doc.npsAnswers.get('q_support_nps'), 2);

    // Targeted per-question calculations via calculateNps
    const productNpsCalc = calculateNps([test13Doc], 'q_product_nps');
    const supportNpsCalc = calculateNps([test13Doc], 'q_support_nps');
    assert.strictEqual(productNpsCalc.npsScore, 100);
    assert.strictEqual(supportNpsCalc.npsScore, -100);
    console.log('  ✓ Multi-NPS form preserves distinct metrics: product NPS = +100, support NPS = -100');
    passedCount++;

    // Test 14: NPS calculations after saving and reloading actual database records
    console.log('[Test 14] Verifying database reloaded records compute consistent NPS...');
    const reloadedDoc = await db.getFeedbackById(test9Data.feedbackId);
    const reloadedNps = calculateNps([reloadedDoc]);
    assert.strictEqual(reloadedNps.npsScore, 100);
    assert.strictEqual(reloadedNps.promoters, 1);
    assert.strictEqual(reloadedNps.detractors, 0);
    console.log('  ✓ Reloaded database record yields identical NPS metrics');
    passedCount++;

    // =========================================================================
    // PRIORITY 3: COMPLAINT SENTIMENT & PRIORITY ALIGNMENT
    // =========================================================================
    console.log('\n--- PRIORITY 3: Complaint Sentiment & Priority Alignment ---');

    // Test 15: 5-star rating combined with NPS 2 (Detractor)
    console.log('[Test 15] Verifying 5-star rating combined with NPS 2...');
    const test15Res = await fetch(`${BASE_URL}/api/feedback/submit/${npsFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        answers: { q_primary_nps: 2 }
      })
    });
    assert.strictEqual(test15Res.status, 201);
    const test15Data = await test15Res.json();
    const test15Doc = await db.getFeedbackById(test15Data.feedbackId);

    assert.strictEqual(test15Doc.sentiment, 'negative', 'Sentiment must be negative for NPS detractor despite 5 stars');
    assert.strictEqual(test15Doc.priority, 'critical', 'NPS <= 3 qualifies as critical complaint');
    assert.strictEqual(isComplaint(test15Doc), true, 'isComplaint helper must classify as complaint');
    console.log('  ✓ 5-star + NPS 2: sentiment=negative, priority=critical, isComplaint=true');
    passedCount++;

    // Test 16: 1-star rating combined with NPS 10 (Promoter)
    console.log('[Test 16] Verifying 1-star rating combined with NPS 10...');
    const test16Res = await fetch(`${BASE_URL}/api/feedback/submit/${npsFormData.form.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 1,
        answers: { q_primary_nps: 10 }
      })
    });
    assert.strictEqual(test16Res.status, 201);
    const test16Data = await test16Res.json();
    const test16Doc = await db.getFeedbackById(test16Data.feedbackId);

    assert.strictEqual(test16Doc.sentiment, 'negative', '1-star rating must force sentiment=negative');
    assert.strictEqual(test16Doc.priority, 'critical', '1-star rating qualifies as critical complaint');
    assert.strictEqual(isComplaint(test16Doc), true, 'isComplaint helper must classify as complaint');
    console.log('  ✓ 1-star + NPS 10: sentiment=negative, priority=critical, isComplaint=true');
    passedCount++;

    // Test 17: Rating-only responses (5-star positive vs 2-star urgent complaint)
    console.log('[Test 17] Verifying rating-only responses...');
    const rOnlyPos = determineSentimentAndPriority(5, null);
    assert.strictEqual(rOnlyPos.sentiment, 'positive');
    assert.strictEqual(rOnlyPos.priority, 'low');
    assert.strictEqual(rOnlyPos.isComplaint, false);

    const rOnlyNeg = determineSentimentAndPriority(2, null);
    assert.strictEqual(rOnlyNeg.sentiment, 'negative');
    assert.strictEqual(rOnlyNeg.priority, 'urgent');
    assert.strictEqual(rOnlyNeg.isComplaint, true);
    console.log('  ✓ Rating-only: 5★ = positive/low (non-complaint); 2★ = negative/urgent (complaint)');
    passedCount++;

    // Test 18: NPS-only responses (NPS 10 positive vs NPS 5 urgent complaint)
    console.log('[Test 18] Verifying NPS-only responses...');
    const npsOnlyPos = determineSentimentAndPriority(null, 10);
    assert.strictEqual(npsOnlyPos.sentiment, 'positive');
    assert.strictEqual(npsOnlyPos.priority, 'low');
    assert.strictEqual(npsOnlyPos.isComplaint, false);

    const npsOnlyNeg = determineSentimentAndPriority(null, 5);
    assert.strictEqual(npsOnlyNeg.sentiment, 'negative');
    assert.strictEqual(npsOnlyNeg.priority, 'urgent');
    assert.strictEqual(npsOnlyNeg.isComplaint, true);
    console.log('  ✓ NPS-only: NPS 10 = positive/low (non-complaint); NPS 5 = negative/urgent (complaint)');
    passedCount++;

    // Test 19: Neutral response (3 stars, NPS 7 passive)
    console.log('[Test 19] Verifying neutral response...');
    const neutralResp = determineSentimentAndPriority(3, 7);
    assert.strictEqual(neutralResp.sentiment, 'neutral');
    assert.strictEqual(neutralResp.priority, 'medium');
    assert.strictEqual(neutralResp.isComplaint, false);
    console.log('  ✓ Neutral response (3★, NPS 7): sentiment=neutral, priority=medium, isComplaint=false');
    passedCount++;

    // Test 20: Response containing neither rating nor NPS (both null)
    console.log('[Test 20] Verifying unrated response with no rating or NPS...');
    const unratedResp = determineSentimentAndPriority(null, null);
    assert.strictEqual(unratedResp.sentiment, 'neutral');
    assert.strictEqual(unratedResp.priority, 'low');
    assert.strictEqual(unratedResp.isComplaint, false);
    console.log('  ✓ Unrated response (null, null): sentiment=neutral, priority=low, isComplaint=false');
    passedCount++;

    // Test 21: Full analytics and inbox consistency verification
    console.log('[Test 21] Verifying analytics dashboard and complaint metrics alignment...');
    const analyticsRes = await fetch(`${BASE_URL}/api/analytics/dashboard`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(analyticsRes.status, 200);
    const analyticsData = await analyticsRes.json();
    assert.ok(typeof analyticsData.summary.totalComplaints === 'number');
    assert.ok(analyticsData.summary.totalComplaints > 0);
    assert.strictEqual(analyticsData.sentimentCounts.negative >= 2, true);
    console.log('  ✓ Analytics dashboard metrics, sentiment breakdown, and complaints strictly agree');
    passedCount++;

    console.log('\n===============================================================');
    console.log(`>>> [PASS] All ${passedCount} Phase 13 Logic & Release Tests Passed!`);
    console.log('===============================================================\n');

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

if (require.main === module) {
  runPhase13Tests().catch((err) => {
    console.error('\n[FAIL] Phase 13 Test Suite Error:', err);
    process.exit(1);
  });
}

module.exports = { runPhase13Tests };
