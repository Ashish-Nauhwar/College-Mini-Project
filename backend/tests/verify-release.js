/**
 * Strict Release Verification Gating Runner
 * 
 * POLICY:
 * 1. Requires valid, non-placeholder TEST_MONGODB_URI pointing to a disposable test database.
 * 2. If TEST_MONGODB_URI is missing, invalid, or non-disposable, FAILS IMMEDIATELY with exit code 1.
 * 3. Executes all offline unit & API test suites.
 * 4. Executes all live database test suites (real-mongo-integration-test.js, smoke-test-final.js).
 * 5. If ANY test fails or ANY live test reports SKIPPED, FAILS with exit code 1.
 * 6. Only exits 0 when 100% of offline AND live database verification tests pass.
 */

const { spawn } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

// Load environment configuration
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { isDisposableDatabase } = require('../scripts/seed');

async function runScript(scriptPath, name) {
  return new Promise((resolve) => {
    console.log(`\n======================================================`);
    console.log(`>>> Gating Suite: ${name}`);
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

async function verifyRelease() {
  console.log('\n***************************************************************');
  console.log('       FEEDBACKHUB STRICT RELEASE GATING VERIFICATION          ');
  console.log('***************************************************************\n');

  const testUri = process.env.TEST_MONGODB_URI;

  // STRICT REQUIREMENT: TEST_MONGODB_URI must be set and valid
  if (!testUri || !testUri.trim() || testUri.includes('<username>') || testUri.includes('<password>')) {
    console.error('[GATE REJECTION] verify:release failed!');
    console.error('Release gating requires a live disposable MongoDB Atlas database configured in TEST_MONGODB_URI.');
    console.error('TEST_MONGODB_URI is missing or contains template placeholders.');
    console.error('\nTo unblock release gating:');
    console.error('1. Provision a disposable test database (e.g. feedbackhub_test).');
    console.error('2. Set TEST_MONGODB_URI in backend/.env:');
    console.error('   TEST_MONGODB_URI=mongodb+srv://<user>:<pwd>@cluster.mongodb.net/feedbackhub_test?retryWrites=true&w=majority\n');
    process.exit(1);
  }

  // Pre-check database name safety
  let dbName = '';
  try {
    const clean = testUri.replace(/^mongodb(\+srv)?:\/\//, 'http://');
    const parsed = new URL(clean);
    dbName = parsed.pathname ? parsed.pathname.replace(/^\//, '').split('?')[0] : '';
  } catch (err) {}

  if (!isDisposableDatabase(dbName)) {
    console.error(`[SAFETY REFUSAL] Release verification refused: Database name "${dbName}" is not disposable.`);
    console.error('The database name in TEST_MONGODB_URI must contain "test", "dev", or "temp".');
    process.exit(1);
  }

  console.log(`[Config Check] Verified disposable test database target: "${dbName}"\n`);

  const suites = [
    { name: 'Unit Tests: Graph / Analytics / JWT', file: 'phase4-unit-tests.js', requiredLive: false },
    { name: 'Data Safety & Database Name Protection', file: 'phase4-data-safety-tests.js', requiredLive: false },
    { name: 'Security & Auth Isolation', file: 'security-tests.js', requiredLive: false },
    { name: 'NPS & Rating Formula Correctness', file: 'nps-rating-tests.js', requiredLive: false },
    { name: 'Injection Hardening & Form Validation', file: 'injection-validation-tests.js', requiredLive: false },
    { name: 'College Academic 12-Step E2E Flow', file: 'college-e2e-test.js', requiredLive: false },
    { name: 'RBAC, Lifecycle & Safety', file: 'phase5-rbac-lifecycle-tests.js', requiredLive: false },
    { name: 'Signup & Routing Resilience', file: 'phase7-signup-routing-tests.js', requiredLive: false },
    { name: 'Production Safety & Escalation Lockout', file: 'phase8-production-safety-tests.js', requiredLive: false },
    { name: 'Phase 10 Release Readiness & Usability', file: 'phase10-release-verification-tests.js', requiredLive: false },
    { name: 'Phase 13 Logic & Release Verification', file: 'phase13-logic-and-release-tests.js', requiredLive: false },
    { name: 'Phase 14 Regression & Final Workflows', file: 'phase14-regression-and-workflow-tests.js', requiredLive: false },
    { name: 'Phase 15 Secure Sentiment & Release Verification', file: 'phase15-sentiment-security-and-release-tests.js', requiredLive: false },
    { name: 'Real MongoDB Atlas 16-Step API Integration', file: 'real-mongo-integration-test.js', requiredLive: true },
    { name: 'Final 13-Step Release Smoke Verification', file: 'smoke-test-final.js', requiredLive: true }
  ];

  const results = [];
  let gatingFailed = false;

  for (const suite of suites) {
    const outcome = await runScript(path.join(__dirname, suite.file), suite.name);
    results.push({ ...suite, ...outcome });

    if (!outcome.success) {
      gatingFailed = true;
    } else if (suite.requiredLive && outcome.skipped) {
      console.error(`\n[GATE REJECTION] Suite "${suite.name}" was skipped! Release gating does not allow skipping live tests.`);
      gatingFailed = true;
    }
  }

  console.log('\n=============================================================================');
  console.log('              RELEASE GATING VERIFICATION SUMMARY                            ');
  console.log('=============================================================================');

  results.forEach((r, idx) => {
    let statusText = 'PASS ✓';
    if (!r.success) {
      statusText = `FAIL ✗ (exit code ${r.exitCode})`;
    } else if (r.skipped) {
      statusText = 'SKIPPED ✗ (DISALLOWED FOR RELEASE GATING)';
    }
    const num = (idx + 1).toString().padStart(2, ' ');
    console.log(`${num}. ${r.name.padEnd(65)}: ${statusText}`);
  });

  console.log('=============================================================================');

  if (gatingFailed) {
    console.error('\n>>> [FAIL] Release verification failed. All checks and live tests must pass without skips.\n');
    process.exit(1);
  } else {
    console.log('\n>>> [PASS] All offline and live release gating tests passed with 100% SUCCESS!\n');
    process.exit(0);
  }
}

if (require.main === module) {
  verifyRelease().catch((err) => {
    console.error('Fatal release verification error:', err);
    process.exit(1);
  });
}

module.exports = verifyRelease;
