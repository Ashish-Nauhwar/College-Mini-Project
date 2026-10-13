/**
 * NPS & Rating Data Correctness Test Suite
 * Validates standard NPS formulas, star rating isolation, non-rating form handling,
 * and exclusion of non-NPS submissions from denominators.
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { Feedback, FeedbackForm } = require('../src/models');

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

const { calculateAverageRating, calculateNps } = require('../src/utils/analyticsHelper');

// Pure formula helper delegating directly to real production implementation
function calculateMetrics(feedbacks) {
  const avgRating = calculateAverageRating(feedbacks);
  const npsData = calculateNps(feedbacks);
  return {
    avgRating,
    npsScore: npsData.npsScore,
    promoters: npsData.promoters,
    passives: npsData.passives,
    detractors: npsData.detractors,
    totalNps: npsData.total
  };
}

async function runNpsRatingTests() {
  console.log('\n======================================================');
  console.log('       NPS & RATING DATA CORRECTNESS TEST SUITE       ');
  console.log('======================================================\n');

  console.log('--- 1. Standard NPS Formula Calculation ---');

  it('All Promoters (Scores 9 and 10) yields NPS +100', () => {
    const sample = [{ nps: 9 }, { nps: 10 }, { nps: 10 }, { nps: 9 }];
    const res = calculateMetrics(sample);
    assert.strictEqual(res.npsScore, 100);
    assert.strictEqual(res.promoters, 4);
    assert.strictEqual(res.detractors, 0);
  });

  it('All Detractors (Scores 0 to 6) yields NPS -100', () => {
    const sample = [{ nps: 0 }, { nps: 3 }, { nps: 5 }, { nps: 6 }];
    const res = calculateMetrics(sample);
    assert.strictEqual(res.npsScore, -100);
    assert.strictEqual(res.promoters, 0);
    assert.strictEqual(res.detractors, 4);
  });

  it('All Passives (Scores 7 and 8) yields NPS 0', () => {
    const sample = [{ nps: 7 }, { nps: 8 }, { nps: 8 }, { nps: 7 }];
    const res = calculateMetrics(sample);
    assert.strictEqual(res.npsScore, 0);
    assert.strictEqual(res.promoters, 0);
    assert.strictEqual(res.detractors, 0);
    assert.strictEqual(res.passives, 4);
  });

  it('Known Mixed Dataset: 5 Promoters (50%), 3 Passives (30%), 2 Detractors (20%) -> NPS +30', () => {
    const sample = [
      { nps: 10 }, { nps: 9 }, { nps: 9 }, { nps: 10 }, { nps: 9 }, // 5 promoters
      { nps: 8 }, { nps: 7 }, { nps: 8 },                           // 3 passives
      { nps: 4 }, { nps: 6 }                                        // 2 detractors
    ];
    const res = calculateMetrics(sample);
    assert.strictEqual(res.npsScore, 30);
    assert.strictEqual(res.promoters, 5);
    assert.strictEqual(res.passives, 3);
    assert.strictEqual(res.detractors, 2);
    assert.strictEqual(res.totalNps, 10);
  });

  it('Submissions without NPS answers are EXCLUDED from the NPS denominator', () => {
    const sample = [
      { nps: 10 }, { nps: 9 }, // 2 promoters
      { nps: null }, { nps: undefined }, { nps: null } // 3 non-NPS submissions
    ];
    const res = calculateMetrics(sample);
    // Denominator must be 2, NOT 5! Therefore, NPS must be 100, not 40!
    assert.strictEqual(res.totalNps, 2);
    assert.strictEqual(res.npsScore, 100);
  });

  it('Zero NPS responses returns N/A (not 0 or NaN)', () => {
    const sample = [{ nps: null }, { rating: 5 }];
    const res = calculateMetrics(sample);
    assert.strictEqual(res.npsScore, 'N/A');
    assert.strictEqual(res.totalNps, 0);
  });

  console.log('\n--- 2. Star Rating Isolation & Empty States ---');

  it('Star rating averages only rated responses on 1-5 scale', () => {
    const sample = [
      { rating: 5 }, { rating: 4 }, { rating: 3 },
      { rating: null } // non-rated submission
    ];
    const res = calculateMetrics(sample);
    assert.strictEqual(res.avgRating, '4.0');
  });

  it('Submissions with no rating questions return N/A for average rating', () => {
    const sample = [
      { rating: null, nps: 9 },
      { rating: null, nps: 8 }
    ];
    const res = calculateMetrics(sample);
    assert.strictEqual(res.avgRating, 'N/A');
    assert.strictEqual(res.npsScore, 50); // 1 promoter, 1 passive -> 50%
  });

  console.log('\n--- 3. Mongoose Schema Constraints for Ratings and NPS ---');

  it('Feedback model schema enforces 1-5 star rating bounds', () => {
    const validFeedback = new Feedback({
      businessId: new mongoose.Types.ObjectId(),
      formId: new mongoose.Types.ObjectId(),
      rating: 5,
      nps: 10
    });
    assert.strictEqual(validFeedback.validateSync(), undefined);

    const invalidRatingLow = new Feedback({
      businessId: new mongoose.Types.ObjectId(),
      formId: new mongoose.Types.ObjectId(),
      rating: 0
    });
    const errLow = invalidRatingLow.validateSync();
    assert.ok(errLow && errLow.errors.rating, 'Should reject star rating < 1');

    const invalidRatingHigh = new Feedback({
      businessId: new mongoose.Types.ObjectId(),
      formId: new mongoose.Types.ObjectId(),
      rating: 6
    });
    const errHigh = invalidRatingHigh.validateSync();
    assert.ok(errHigh && errHigh.errors.rating, 'Should reject star rating > 5');
  });

  it('Feedback model schema enforces 0-10 NPS bounds', () => {
    const invalidNpsLow = new Feedback({
      businessId: new mongoose.Types.ObjectId(),
      formId: new mongoose.Types.ObjectId(),
      nps: -1
    });
    const errLow = invalidNpsLow.validateSync();
    assert.ok(errLow && errLow.errors.nps, 'Should reject NPS < 0');

    const invalidNpsHigh = new Feedback({
      businessId: new mongoose.Types.ObjectId(),
      formId: new mongoose.Types.ObjectId(),
      nps: 11
    });
    const errHigh = invalidNpsHigh.validateSync();
    assert.ok(errHigh && errHigh.errors.nps, 'Should reject NPS > 10');
  });

  it('Feedback model accepts null rating when form has no star rating question', () => {
    const nullRatingFb = new Feedback({
      businessId: new mongoose.Types.ObjectId(),
      formId: new mongoose.Types.ObjectId(),
      rating: null,
      nps: 8,
      sentiment: 'neutral',
      priority: 'low'
    });
    assert.strictEqual(nullRatingFb.validateSync(), undefined);
    assert.strictEqual(nullRatingFb.rating, null);
  });

  console.log('\n======================================================');
  console.log(`   TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)   `);
  console.log('======================================================\n');

  if (failedTests > 0) process.exit(1);
}

runNpsRatingTests();
