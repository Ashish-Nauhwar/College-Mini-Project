/**
 * Master Test Runner for FeedbackHub
 * Executes:
 * 1. Security & RBAC Suite (security-tests.js)
 * 2. NPS & Rating Data Correctness Suite (nps-rating-tests.js)
 * 3. Form Builder & Injection Hardening Suite (injection-validation-tests.js)
 * 4. College Academic End-to-End Scenario Suite (college-e2e-test.js)
 */

const { spawn } = require('child_process');
const path = require('path');

async function runScript(scriptPath, name) {
  return new Promise((resolve) => {
    console.log(`\n======================================================`);
    console.log(`>>> Executing Suite: ${name}`);
    console.log(`======================================================`);
    const proc = spawn('node', [scriptPath], { stdio: 'inherit' });
    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

async function main() {
  console.log('******************************************************');
  console.log('       FEEDBACKHUB PHASE 3 MASTER TEST RUNNER         ');
  console.log('******************************************************');

  const suites = [
    { name: 'Security, RBAC & Isolation', file: 'security-tests.js' },
    { name: 'NPS & Rating Formula Correctness', file: 'nps-rating-tests.js' },
    { name: 'Injection Hardening & Validation', file: 'injection-validation-tests.js' },
    { name: 'College Academic 12-Step E2E Flow', file: 'college-e2e-test.js' }
  ];

  const results = [];

  for (const suite of suites) {
    const success = await runScript(path.join(__dirname, suite.file), suite.name);
    results.push({ name: suite.name, success });
  }

  console.log('\n======================================================');
  console.log('              PHASE 3 VERIFICATION SUMMARY            ');
  console.log('======================================================');

  let allPassed = true;
  results.forEach((r, idx) => {
    console.log(`${idx + 1}. ${r.name.padEnd(38)}: ${r.success ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!r.success) allPassed = false;
  });

  console.log('======================================================');

  if (!allPassed) {
    console.error('\nOne or more test suites failed.\n');
    process.exit(1);
  } else {
    console.log('\nAll test suites passed with 100% verification!\n');
    process.exit(0);
  }
}

main();
