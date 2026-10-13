/**
 * Master Test Runner for FeedbackHub (Phases 3 & 4)
 * Executes:
 * 1. Security & RBAC Suite (security-tests.js)
 * 2. NPS & Rating Formula Correctness Suite (nps-rating-tests.js)
 * 3. Form Builder & Injection Hardening Suite (injection-validation-tests.js)
 * 4. College Academic End-to-End Scenario Suite (college-e2e-test.js)
 * 5. Phase 4 Unit Tests (phase4-unit-tests.js)
 * 6. Phase 4 Data Safety Suite (phase4-data-safety-tests.js)
 * 7. Real MongoDB Atlas Integration Suite (real-mongo-integration-test.js)
 */

const { spawn } = require('child_process');
const path = require('path');

async function runScript(scriptPath, name) {
  return new Promise((resolve) => {
    console.log(`\n======================================================`);
    console.log(`>>> Executing Suite: ${name}`);
    console.log(`======================================================`);
    let output = '';
    const proc = spawn('node', [scriptPath], { stdio: ['inherit', 'pipe', 'pipe'] });
    
    proc.stdout.on('data', (data) => {
      process.stdout.write(data);
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      process.stderr.write(data);
      output += data.toString();
    });

    proc.on('close', (code) => {
      const isSkipped = (code === 0) && output.includes('[STATUS: SKIPPED]');
      resolve({ success: code === 0, skipped: isSkipped, exitCode: code });
    });
  });
}

async function main() {
  console.log('******************************************************');
  console.log('       FEEDBACKHUB MASTER AUTOMATED TEST RUNNER       ');
  console.log('******************************************************');

  const suites = [
    { name: 'Security & Auth Isolation [Isolated Mock DB]', file: 'security-tests.js' },
    { name: 'NPS & Rating Formula Correctness [Isolated Mock DB]', file: 'nps-rating-tests.js' },
    { name: 'Injection Hardening & Validation [Isolated Mock DB]', file: 'injection-validation-tests.js' },
    { name: 'College Academic 12-Step E2E Flow [Isolated Mock DB]', file: 'college-e2e-test.js' },
    { name: 'Phase 4 Unit Tests (Graph/Analytics/JWT) [Pure Unit Tests]', file: 'phase4-unit-tests.js' },
    { name: 'Phase 4 Data Safety & DB Protection [Safety Unit Tests]', file: 'phase4-data-safety-tests.js' },
    { name: 'Phase 5 RBAC, Lifecycle & Safety [Isolated Mock DB]', file: 'phase5-rbac-lifecycle-tests.js' },
    { name: 'Phase 7 Signup & Routing Resilience [App & DB Check]', file: 'phase7-signup-routing-tests.js' },
    { name: 'Phase 8 Production Safety & E2E Verification [Express App & Safety Check]', file: 'phase8-production-safety-tests.js' },
    { name: 'Real MongoDB Atlas Integration [Live Database]', file: 'real-mongo-integration-test.js' },
    { name: 'Final 13-Step Release Smoke Verification [Live Database]', file: 'smoke-test-final.js' }
  ];

  const results = [];

  for (const suite of suites) {
    const outcome = await runScript(path.join(__dirname, suite.file), suite.name);
    results.push({ name: suite.name, ...outcome });
  }

  console.log('\n=============================================================================');
  console.log('              FEEDBACKHUB AUTOMATED VERIFICATION SUMMARY                     ');
  console.log('=============================================================================');

  let allPassed = true;
  let passedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  results.forEach((r, idx) => {
    let statusText = 'PASS ✓';
    if (!r.success) {
      statusText = `FAIL ✗ (exit code ${r.exitCode})`;
      allPassed = false;
      failedCount++;
    } else if (r.skipped) {
      statusText = 'SKIPPED (requires TEST_MONGODB_URI configured)';
      skippedCount++;
    } else {
      passedCount++;
    }
    const num = (idx + 1).toString().padStart(2, ' ');
    console.log(`${num}. ${r.name.padEnd(72)}: ${statusText}`);
  });

  console.log('=============================================================================');
  console.log(`Verification Tally: ${passedCount} Passed | ${skippedCount} Skipped (Live DB optional) | ${failedCount} Failed`);
  console.log('=============================================================================');

  if (!allPassed) {
    console.error('\nOne or more test suites failed.\n');
    process.exit(1);
  } else {
    console.log('\nAll active verification suites completed with 100% SUCCESS!\n');
    process.exit(0);
  }
}

main();
