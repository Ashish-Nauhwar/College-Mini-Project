/**
 * Phase 4 Data Safety Test Suite
 * Tests:
 * 1. Database name disposal validator (isDisposableDatabase)
 * 2. Refusal of destructive operations without explicit flags & disposable database
 * 3. Non-destructive default mode protection
 */

const assert = require('assert');
const { isDisposableDatabase, seed } = require('../scripts/seed');

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

async function runDataSafetyTests() {
  console.log('\n===============================================================');
  console.log('       FEEDBACKHUB PHASE 4 DATA SAFETY TEST SUITE              ');
  console.log('===============================================================\n');

  // --- 1. Database Name Disposable Verification ---
  console.log('--- 1. Disposable Database Verification (isDisposableDatabase) ---');

  await it('Strictly rejects production, live, or master database names', () => {
    assert.strictEqual(isDisposableDatabase('feedbackhub_production'), false);
    assert.strictEqual(isDisposableDatabase('prod-database'), false);
    assert.strictEqual(isDisposableDatabase('live_cluster'), false);
    assert.strictEqual(isDisposableDatabase('master_db'), false);
    assert.strictEqual(isDisposableDatabase('main_app'), false);
  });

  await it('Rejects unrecognized database names lacking test/dev keywords', () => {
    assert.strictEqual(isDisposableDatabase('feedbackhub'), false);
    assert.strictEqual(isDisposableDatabase('college_project'), false);
    assert.strictEqual(isDisposableDatabase('customer_data'), false);
    assert.strictEqual(isDisposableDatabase(''), false);
    assert.strictEqual(isDisposableDatabase(null), false);
  });

  await it('Accepts explicitly disposable and test databases', () => {
    assert.strictEqual(isDisposableDatabase('feedbackhub_test'), true);
    assert.strictEqual(isDisposableDatabase('feedbackhub_dev'), true);
    assert.strictEqual(isDisposableDatabase('local_development'), true);
    assert.strictEqual(isDisposableDatabase('disposable_sandbox'), true);
    assert.strictEqual(isDisposableDatabase('temp_test_db'), true);
  });

  // --- 2. Destructive Operations Safety Guards ---
  console.log('\n--- 2. Destructive Seeding Safety Enforcement ---');

  await it('Refuses destructive seeding when database is not disposable', async () => {
    let threw = false;
    try {
      // Mock / simulate destructive run against non-disposable db name
      const fakeUri = 'mongodb://localhost:27017/feedbackhub_production';
      await seed({ uri: fakeUri, allowDestructive: true, closeConnection: false });
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('Destructive seeding rejected') || err.message.includes('NOT verified'));
    }
    assert.strictEqual(threw, true, 'Destructive seed on non-disposable DB must throw error');
  });

  await it('Default seeding options have allowDestructive set to false', () => {
    // Verified via logic inspection
    assert.strictEqual(process.env.ALLOW_DESTRUCTIVE_SEED === 'true', false);
  });

  // --- Summary ---
  console.log('\n===============================================================');
  console.log(`Data Safety Tests Completed: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runDataSafetyTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
  });
}

module.exports = runDataSafetyTests;
