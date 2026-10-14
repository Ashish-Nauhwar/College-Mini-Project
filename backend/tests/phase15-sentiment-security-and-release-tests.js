/**
 * FeedbackHub Phase 15 — Secure Sentiment Classification & Final Release Verification
 * 
 * Verifies:
 * 1. Server-authoritative sentiment and priority calculation via real HTTP submissions.
 * 2. 5★ + NPS 2 classified as negative sentiment and critical priority.
 * 3. 1★ + NPS 10 classified as negative sentiment and critical priority.
 * 4. Neutral responses (3★, NPS 7-8, unrated) remain neutral and non-complaint.
 * 5. Requests with arbitrary `sentiment: "positive"` cannot turn neutral or negative responses into positive.
 * 6. Requests with arbitrary `sentiment: "negative"` cannot manipulate saved classification when no sentiment question is configured.
 * 7. When explicit sentiment question is configured, only its validated answer contributes to classification.
 * 8. Negative ratings and detractor NPS scores strictly override positive sentiment answers.
 * 9. Inbox priority, filtering, and analytics dashboard strictly agree with saved records and isComplaint helper.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.TEST_MOCK_DB = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase15-test-secret-must-be-at-least-32-chars-long';

const app = require('../server');
const db = require('../src/db');
const {
  isComplaint,
  calculateAverageRating,
  calculateNps,
  determineSentimentAndPriority
} = require('../src/utils/analyticsHelper');

const JWT_SECRET = process.env.JWT_SECRET;

async function runPhase15Tests() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB PHASE 15 SECURE SENTIMENT & RELEASE TESTS       ');
  console.log('===============================================================\n');

  let passedCount = 0;
  let server = null;
  let BASE_URL = '';

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      BASE_URL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {

    // 3. Register Tenant A with valid auth credentials
    const timestamp = Date.now();
    const regResA = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: `Titan Tech Labs ${timestamp}`,
        businessType: 'other',
        name: 'Titan Admin',
        email: `admin_${timestamp}@titantech.io`,
        password: 'ValidPassword@123',
        isOnlineOnly: true
      })
    });
    assert.strictEqual(regResA.status, 201);
    const regDataA = await regResA.json();
    const tokenA = regDataA.token;
    const businessAId = regDataA.business._id || regDataA.business.id;

    const formSlugStandard = `standard-eval-${Date.now()}`;
    const formStandard = await db.createForm({
      businessId: businessAId,
      title: 'Standard Product Feedback',
      slug: formSlugStandard,
      status: 'published',
      showOverallRating: true,
      requireOverallRating: false,
      overallRatingRequired: false,
      questions: [
        { id: 'q_nps', type: 'nps', text: 'How likely are you to recommend our platform?', required: false },
        { id: 'q_comments', type: 'multiline', text: 'Detailed Comments', required: false }
      ]
    });

    console.log('--- SECTION 1: Server-Authoritative Core Sentiment Rules ---');

    // Test 1: 5★ rating with NPS 2 produces negative sentiment and critical priority
    console.log('[Test 1] Verifying 5★ rating with NPS 2 produces negative sentiment and critical priority via HTTP...');
    const res1 = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugStandard}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        answers: { q_nps: 2, q_comments: 'Good UI but billing crashed' }
      })
    });
    assert.strictEqual(res1.status, 201);
    const doc1 = await db.getFeedbackById((await res1.json()).feedbackId);
    assert.strictEqual(doc1.rating, 5);
    assert.strictEqual(doc1.nps, 2);
    assert.strictEqual(doc1.sentiment, 'negative', 'Detractor NPS must make sentiment negative');
    assert.strictEqual(doc1.priority, 'critical', 'NPS <= 3 must make priority critical');
    assert.strictEqual(isComplaint(doc1), true, 'Must qualify as complaint');
    console.log('  ✓ 5★ + NPS 2 -> negative sentiment, critical priority, complaint=true');
    passedCount++;

    // Test 2: 1★ rating with NPS 10 produces negative sentiment and critical priority
    console.log('[Test 2] Verifying 1★ rating with NPS 10 produces negative sentiment and critical priority via HTTP...');
    const res2 = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugStandard}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 1,
        answers: { q_nps: 10, q_comments: 'Account got locked' }
      })
    });
    assert.strictEqual(res2.status, 201);
    const doc2 = await db.getFeedbackById((await res2.json()).feedbackId);
    assert.strictEqual(doc2.rating, 1);
    assert.strictEqual(doc2.nps, 10);
    assert.strictEqual(doc2.sentiment, 'negative', '1★ rating must make sentiment negative');
    assert.strictEqual(doc2.priority, 'critical', '1★ rating must make priority critical');
    assert.strictEqual(isComplaint(doc2), true, 'Must qualify as complaint');
    console.log('  ✓ 1★ + NPS 10 -> negative sentiment, critical priority, complaint=true');
    passedCount++;

    // Test 3: Neutral responses remain neutral and non-complaint
    console.log('[Test 3] Verifying neutral responses remain neutral and non-complaint...');
    // 3A: Rating 3 with passive NPS 7
    const res3A = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugStandard}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 3,
        answers: { q_nps: 7, q_comments: 'Average experience' }
      })
    });
    assert.strictEqual(res3A.status, 201);
    const doc3A = await db.getFeedbackById((await res3A.json()).feedbackId);
    assert.strictEqual(doc3A.sentiment, 'neutral');
    assert.strictEqual(doc3A.priority, 'medium');
    assert.strictEqual(isComplaint(doc3A), false);

    // 3B: Unrated (no rating, no NPS)
    const res3B = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugStandard}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_comments: 'General neutral inquiry' }
      })
    });
    assert.strictEqual(res3B.status, 201);
    const doc3B = await db.getFeedbackById((await res3B.json()).feedbackId);
    assert.strictEqual(doc3B.rating, null);
    assert.strictEqual(doc3B.nps, null);
    assert.strictEqual(doc3B.sentiment, 'neutral');
    assert.strictEqual(doc3B.priority, 'low');
    assert.strictEqual(isComplaint(doc3B), false);

    // 3C: Passive NPS 8 only
    const res3C = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugStandard}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_nps: 8 }
      })
    });
    assert.strictEqual(res3C.status, 201);
    const doc3C = await db.getFeedbackById((await res3C.json()).feedbackId);
    assert.strictEqual(doc3C.sentiment, 'neutral');
    assert.strictEqual(doc3C.priority, 'low');
    assert.strictEqual(isComplaint(doc3C), false);
    console.log('  ✓ Neutral responses (3★/NPS 7, unrated, passive NPS 8) correctly classified as neutral/non-complaint');
    passedCount++;

    console.log('\n--- SECTION 2: Client Sentiment Manipulation Resistance ---');

    // Test 4: Request with sentiment: "positive" cannot turn negative response into positive
    console.log('[Test 4] Verifying arbitrary sentiment: "positive" cannot override negative rating or NPS...');
    const res4 = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugStandard}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 1,
        answers: { q_nps: 1 },
        sentiment: 'positive', // Spoofed client attempt
        priority: 'low'        // Spoofed client attempt
      })
    });
    assert.strictEqual(res4.status, 201);
    const doc4 = await db.getFeedbackById((await res4.json()).feedbackId);
    assert.strictEqual(doc4.sentiment, 'negative', 'Server must ignore client sentiment and save negative');
    assert.strictEqual(doc4.priority, 'critical', 'Server must compute critical priority');
    assert.strictEqual(isComplaint(doc4), true);
    console.log('  ✓ Spoofed sentiment: "positive" on 1★/NPS 1 strictly overridden by server negative classification');
    passedCount++;

    // Test 5: Request with sentiment: "positive" cannot turn neutral response into positive
    console.log('[Test 5] Verifying arbitrary sentiment: "positive" cannot turn neutral 3★ response positive...');
    const res5 = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugStandard}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 3,
        answers: { q_nps: 7 },
        sentiment: 'positive' // Spoofed client attempt
      })
    });
    assert.strictEqual(res5.status, 201);
    const doc5 = await db.getFeedbackById((await res5.json()).feedbackId);
    assert.strictEqual(doc5.sentiment, 'neutral', 'Neutral response must remain neutral despite spoofed positive');
    assert.strictEqual(doc5.priority, 'medium');
    assert.strictEqual(isComplaint(doc5), false);
    console.log('  ✓ Spoofed sentiment: "positive" on neutral 3★ safely ignored; remains neutral');
    passedCount++;

    // Test 6: Request with sentiment: "negative" cannot manipulate classification when no sentiment question is configured
    console.log('[Test 6] Verifying sentiment: "negative" cannot manipulate classification when form has no sentiment question...');
    // 6A: Unrated submission with sentiment: "negative"
    const res6A = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugStandard}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { q_comments: 'Unrated remark' },
        sentiment: 'negative' // Arbitrary client property
      })
    });
    assert.strictEqual(res6A.status, 201);
    const doc6A = await db.getFeedbackById((await res6A.json()).feedbackId);
    assert.strictEqual(doc6A.sentiment, 'neutral', 'Unrated submission must remain neutral when no sentiment question exists');
    assert.strictEqual(doc6A.priority, 'low');
    assert.strictEqual(isComplaint(doc6A), false);

    // 6B: 5-star submission with sentiment: "negative"
    const res6B = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugStandard}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        answers: { q_nps: 10 },
        sentiment: 'negative' // Arbitrary client property
      })
    });
    assert.strictEqual(res6B.status, 201);
    const doc6B = await db.getFeedbackById((await res6B.json()).feedbackId);
    assert.strictEqual(doc6B.sentiment, 'positive', '5★ with NPS 10 must remain positive when no sentiment question exists');
    assert.strictEqual(doc6B.priority, 'low');
    assert.strictEqual(isComplaint(doc6B), false);
    console.log('  ✓ Arbitrary sentiment: "negative" without configured question cannot manipulate classification');
    passedCount++;

    console.log('\n--- SECTION 3: Explicit Sentiment Question Lifecycle & Server Validation ---');

    // Create a form WITH an explicit sentiment question
    const formSlugExplicit = `explicit-sent-${Date.now()}`;
    const formExplicit = await db.createForm({
      businessId: businessAId,
      title: 'Satisfaction with Sentiment Question',
      slug: formSlugExplicit,
      status: 'published',
      showOverallRating: true,
      requireOverallRating: false,
      overallRatingRequired: false,
      questions: [
        { id: 'q_nps', type: 'nps', text: 'Net Promoter Score', required: false },
        { id: 'q_sentiment', type: 'sentiment', text: 'How was your overall experience sentiment?', required: false },
        { id: 'q_comments', type: 'multiline', text: 'Comments', required: false }
      ]
    });

    // Test 7: Valid configured sentiment answer "negative" contributes to classification
    console.log('[Test 7] Verifying configured sentiment question answer "negative" creates complaint...');
    const res7 = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugExplicit}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 3, // neutral rating
        answers: {
          q_sentiment: 'negative',
          q_comments: 'Not satisfied with response time'
        }
      })
    });
    assert.strictEqual(res7.status, 201);
    const doc7 = await db.getFeedbackById((await res7.json()).feedbackId);
    assert.strictEqual(doc7.sentiment, 'negative', 'Configured sentiment question answer "negative" must be applied');
    assert.strictEqual(doc7.priority, 'urgent', 'Explicit negative on 3★ must receive urgent priority');
    assert.strictEqual(isComplaint(doc7), true);
    console.log('  ✓ Valid configured sentiment answer "negative" correctly applied as complaint');
    passedCount++;

    // Test 8: Valid configured sentiment answer "positive" on neutral rating
    console.log('[Test 8] Verifying configured sentiment question answer "positive" upgrades neutral 3★...');
    const res8 = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugExplicit}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 3,
        answers: {
          q_sentiment: 'positive',
          q_comments: 'Pretty good overall'
        }
      })
    });
    assert.strictEqual(res8.status, 201);
    const doc8 = await db.getFeedbackById((await res8.json()).feedbackId);
    assert.strictEqual(doc8.sentiment, 'positive');
    assert.strictEqual(doc8.priority, 'low');
    assert.strictEqual(isComplaint(doc8), false);
    console.log('  ✓ Valid configured sentiment answer "positive" correctly applied on neutral rating');
    passedCount++;

    // Test 9: Configured sentiment answer "positive" CANNOT override 1★ or detractor NPS
    console.log('[Test 9] Verifying configured sentiment answer "positive" CANNOT override 1★ or detractor NPS...');
    const res9 = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugExplicit}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 1, // Severe negative rating
        answers: {
          q_sentiment: 'positive', // Attempt to override with question answer
          q_nps: 2
        }
      })
    });
    assert.strictEqual(res9.status, 201);
    const doc9 = await db.getFeedbackById((await res9.json()).feedbackId);
    assert.strictEqual(doc9.sentiment, 'negative', 'Negative rating/NPS must strictly override positive sentiment');
    assert.strictEqual(doc9.priority, 'critical', '1★ rating must remain critical priority');
    assert.strictEqual(isComplaint(doc9), true);
    console.log('  ✓ Negative rating & detractor NPS strictly defeat positive sentiment question answer');
    passedCount++;

    // Test 10: Top-level sentiment property is ignored in favor of configured question answer
    console.log('[Test 10] Verifying top-level req.body.sentiment is ignored in favor of configured question answer...');
    const res10 = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugExplicit}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 3,
        sentiment: 'positive', // Spoofed top-level
        answers: {
          q_sentiment: 'negative' // Legitimate configured question answer
        }
      })
    });
    assert.strictEqual(res10.status, 201);
    const doc10 = await db.getFeedbackById((await res10.json()).feedbackId);
    assert.strictEqual(doc10.sentiment, 'negative', 'Configured question answer must win over top-level spoof');
    assert.strictEqual(doc10.priority, 'urgent');
    assert.strictEqual(isComplaint(doc10), true);
    console.log('  ✓ Configured question answer is used; arbitrary top-level sentiment property ignored');
    passedCount++;

    // Test 11: Invalid sentiment question answer is rejected with HTTP 400
    console.log('[Test 11] Verifying invalid sentiment value is rejected with HTTP 400...');
    const res11 = await fetch(`${BASE_URL}/api/feedback/submit/${formSlugExplicit}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: {
          q_sentiment: 'ultra_ecstatic' // Invalid value
        }
      })
    });
    assert.strictEqual(res11.status, 400);
    const data11 = await res11.json();
    assert.ok(data11.error.includes('Invalid sentiment'));
    console.log('  ✓ Invalid sentiment answer rejected with HTTP 400');
    passedCount++;

    console.log('\n--- SECTION 4: Stored Records, Inbox, & Analytics Alignment ---');

    // Test 12: Stored feedbacks, inbox priority/sentiment filtering, and analytics dashboard strictly agree
    console.log('[Test 12] Verifying stored records, inbox filtering, and analytics dashboard strictly agree...');
    const allDbDocs = await db.getFeedbacks({ businessId: businessAId });
    const dbComplaints = allDbDocs.filter(isComplaint);
    const dbNegatives = allDbDocs.filter(f => f.sentiment === 'negative');
    const dbPositives = allDbDocs.filter(f => f.sentiment === 'positive');
    const dbNeutrals = allDbDocs.filter(f => f.sentiment === 'neutral');

    // Fetch inbox with sentiment filter = 'negative'
    const inboxNegRes = await fetch(`${BASE_URL}/api/feedback?sentiment=negative`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(inboxNegRes.status, 200);
    const inboxNegData = await inboxNegRes.json();
    assert.strictEqual(inboxNegData.feedbacks.length, dbNegatives.length);

    // Fetch inbox with sentiment filter = 'positive'
    const inboxPosRes = await fetch(`${BASE_URL}/api/feedback?sentiment=positive`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(inboxPosRes.status, 200);
    const inboxPosData = await inboxPosRes.json();
    assert.strictEqual(inboxPosData.feedbacks.length, dbPositives.length);

    // Fetch analytics dashboard
    const analyticsRes = await fetch(`${BASE_URL}/api/analytics/dashboard`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(analyticsRes.status, 200);
    const analyticsData = await analyticsRes.json();

    assert.strictEqual(analyticsData.sentimentCounts.negative, dbNegatives.length);
    assert.strictEqual(analyticsData.sentimentCounts.positive, dbPositives.length);
    assert.strictEqual(analyticsData.sentimentCounts.neutral, dbNeutrals.length);
    assert.strictEqual(analyticsData.summary.totalComplaints, dbComplaints.length);
    assert.strictEqual(dbComplaints.length, dbNegatives.length, 'Every complaint must have negative sentiment');
    console.log(`  ✓ System metrics in full agreement: ${dbComplaints.length} complaints, ${dbPositives.length} positive, ${dbNeutrals.length} neutral`);
    passedCount++;

    console.log('\n===============================================================');
    console.log(`>>> [PASS] All ${passedCount} Phase 15 Sentiment & Security Tests Passed!`);
    console.log('===============================================================\n');
  } finally {
    if (server) {
      server.close();
    }
  }
}

// Run when executed directly
if (require.main === module) {
  runPhase15Tests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n[Phase 15 Test Failure]:', err);
      process.exit(1);
    });
}

module.exports = runPhase15Tests;
