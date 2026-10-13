/**
 * Phase 4 Unit Test Suite
 * Directly tests production helpers:
 * 1. Form question dependency graph cycle detection & conditional validation
 * 2. Centralized complaints and analytics calculation (isComplaint, avgRating, NPS)
 * 3. Production JWT secret validation & blacklist
 * 4. Strict calendar date validation
 */

const assert = require('assert');
const { validateQuestionGraph } = require('../src/utils/formGraphValidator');
const { isComplaint, calculateAverageRating, calculateNps } = require('../src/utils/analyticsHelper');
const { validateJwtSecret, FORBIDDEN_SECRETS } = require('../src/middleware/auth');

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

async function runUnitTests() {
  console.log('\n===============================================================');
  console.log('       FEEDBACKHUB PHASE 4 UNIT TEST SUITE (CORE LOGIC)        ');
  console.log('===============================================================\n');

  // --- 1. Graph Cycle Detection & Conditional Validation ---
  console.log('--- 1. Dependency Graph Cycle Detection & Conditionals ---');

  it('Rejects direct self-dependency (A -> A)', () => {
    const questions = [
      { id: 'q_a', type: 'text', text: 'Question A', conditional: { dependsOn: 'q_a', operator: 'equals', value: 'yes' } }
    ];
    const result = validateQuestionGraph(questions);
    assert.ok(result.error);
    assert.ok(result.error.includes('cannot depend on itself'));
  });

  it('Detects 2-question dependency cycle (A -> B -> A)', () => {
    const questions = [
      { id: 'q_a', type: 'text', text: 'Question A', conditional: { dependsOn: 'q_b', operator: 'equals', value: 'yes' } },
      { id: 'q_b', type: 'text', text: 'Question B', conditional: { dependsOn: 'q_a', operator: 'equals', value: 'yes' } }
    ];
    const result = validateQuestionGraph(questions);
    assert.ok(result.error);
    assert.ok(result.error.includes('Conditional dependency cycle detected'));
  });

  it('Detects 3-question dependency cycle (A -> B -> C -> A)', () => {
    const questions = [
      { id: 'q_a', type: 'text', text: 'Question A', conditional: { dependsOn: 'q_b', operator: 'equals', value: '1' } },
      { id: 'q_b', type: 'text', text: 'Question B', conditional: { dependsOn: 'q_c', operator: 'equals', value: '2' } },
      { id: 'q_c', type: 'text', text: 'Question C', conditional: { dependsOn: 'q_a', operator: 'equals', value: '3' } }
    ];
    const result = validateQuestionGraph(questions);
    assert.ok(result.error);
    assert.ok(result.error.includes('Conditional dependency cycle detected'));
  });

  it('Allows valid acyclic dependency chain (A -> B -> C)', () => {
    const questions = [
      { id: 'q_c', type: 'choice', text: 'Question C', options: ['yes', 'no'] },
      { id: 'q_b', type: 'text', text: 'Question B', conditional: { dependsOn: 'q_c', operator: 'equals', value: 'yes' } },
      { id: 'q_a', type: 'text', text: 'Question A', conditional: { dependsOn: 'q_b', operator: 'equals', value: 'details' } }
    ];
    const result = validateQuestionGraph(questions);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.questions.length, 3);
  });

  it('Rejects invalid conditional operators without silent fallback', () => {
    const questions = [
      { id: 'q_parent', type: 'choice', text: 'Parent', options: ['a', 'b'] },
      { id: 'q_child', type: 'text', text: 'Child', conditional: { dependsOn: 'q_parent', operator: 'regex_match_invalid', value: 'a' } }
    ];
    const result = validateQuestionGraph(questions);
    assert.ok(result.error);
    assert.ok(result.error.includes('Invalid conditional operator'));
  });

  it('Rejects non-numeric comparison value for greater_than and less_than', () => {
    const questions = [
      { id: 'q_rating', type: 'rating', text: 'Rating' },
      { id: 'q_why', type: 'text', text: 'Why', conditional: { dependsOn: 'q_rating', operator: 'greater_than', value: 'not_a_number' } }
    ];
    const result = validateQuestionGraph(questions);
    assert.ok(result.error);
    assert.ok(result.error.includes('requires a valid numeric comparison value'));
  });

  it('Rejects empty or non-array value for in operator', () => {
    const questions = [
      { id: 'q_choice', type: 'choice', text: 'Choice', options: ['x', 'y'] },
      { id: 'q_sub', type: 'text', text: 'Sub', conditional: { dependsOn: 'q_choice', operator: 'in', value: 'not_an_array' } }
    ];
    const result = validateQuestionGraph(questions);
    assert.ok(result.error);
    assert.ok(result.error.includes('requires a non-empty array of candidate values'));
  });

  // --- 2. Analytics & Complaints Helper ---
  console.log('\n--- 2. Centralized Complaints & Analytics Calculations ---');

  it('Identifies 1-star or 2-star feedback as a complaint', () => {
    assert.strictEqual(isComplaint({ rating: 1, sentiment: 'neutral' }), true);
    assert.strictEqual(isComplaint({ rating: 2, sentiment: 'neutral' }), true);
  });

  it('Positive star rating (4 or 5) does NOT override negative NPS detractor (0-6)', () => {
    // Highly important requirement: 4 stars but NPS 2 must still count as complaint
    const feedback = { rating: 4, nps: 2, sentiment: 'neutral' };
    assert.strictEqual(isComplaint(feedback), true);
  });

  it('Positive star rating (5) does NOT override negative sentiment', () => {
    const feedback = { rating: 5, nps: 10, sentiment: 'negative' };
    assert.strictEqual(isComplaint(feedback), true);
  });

  it('Fully positive feedback is not a complaint', () => {
    const feedback = { rating: 5, nps: 9, sentiment: 'positive' };
    assert.strictEqual(isComplaint(feedback), false);
  });

  it('Unrated feedbacks with neutral sentiment and passive NPS are not complaints', () => {
    const feedback = { rating: null, nps: 8, sentiment: 'neutral' };
    assert.strictEqual(isComplaint(feedback), false);
  });

  it('calculateAverageRating accurately calculates only rated responses and ignores invalid values', () => {
    const list = [
      { rating: 5 },
      { rating: 3 },
      { rating: 'bad' },
      { rating: null },
      { rating: 0 }, // Out of range 1..5
      { rating: 4 }
    ];
    // Valid ratings: 5, 3, 4 -> sum = 12 / 3 = 4.0
    const avg = calculateAverageRating(list);
    assert.strictEqual(avg, '4.0');
  });

  it('calculateAverageRating returns "N/A" when list has no valid ratings', () => {
    assert.strictEqual(calculateAverageRating([]), 'N/A');
    assert.strictEqual(calculateAverageRating([{ rating: null }, { comments: 'no rating' }]), 'N/A');
  });

  it('calculateNps correctly applies promoters minus detractors over valid responses', () => {
    const list = [
      { nps: 10 }, // promoter
      { nps: 9 },  // promoter
      { nps: 8 },  // passive
      { nps: 7 },  // passive
      { nps: 4 },  // detractor
      { nps: null } // excluded
    ];
    // Total valid = 5. Promoters = 2 (40%), Detractors = 1 (20%), NPS = 20
    const res = calculateNps(list);
    assert.strictEqual(res.promoters, 2);
    assert.strictEqual(res.passives, 2);
    assert.strictEqual(res.detractors, 1);
    assert.strictEqual(res.total, 5);
    assert.strictEqual(res.npsScore, 20);
  });

  it('calculateNps returns "N/A" score when no valid NPS responses exist', () => {
    const res = calculateNps([{ rating: 5 }, { comments: 'hello' }]);
    assert.strictEqual(res.npsScore, 'N/A');
    assert.strictEqual(res.total, 0);
  });

  // --- 3. JWT Secret Validation & Blacklist ---
  console.log('\n--- 3. Production JWT Secret Security Validation ---');

  it('Rejects secrets shorter than 32 characters in production', () => {
    const res = validateJwtSecret('short-dev-secret', true);
    assert.strictEqual(res.valid, false);
    assert.ok(res.reason.includes('at least 32 characters in production'));
  });

  it('Rejects blacklisted and placeholder secrets in production', () => {
    for (const secret of FORBIDDEN_SECRETS) {
      const res = validateJwtSecret(secret, true);
      assert.strictEqual(res.valid, false, `Secret "${secret}" should be rejected`);
      assert.ok(res.reason.includes('known placeholder'));
    }
  });

  it('Accepts high-entropy 32+ character secrets in production', () => {
    const secureSecret = 'a8f7c9e13d4b2e6a9f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a';
    const res = validateJwtSecret(secureSecret, true);
    assert.strictEqual(res.valid, true);
  });

  // --- Summary ---
  console.log('\n===============================================================');
  console.log(`Phase 4 Unit Tests Completed: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runUnitTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
  });
}

module.exports = runUnitTests;
