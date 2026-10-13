/**
 * Master Test Runner for FeedbackHub
 * Executes security tests, schema validation, API negative tests, and reports verification status.
 */

const { spawn } = require('child_process');
const path = require('path');

async function runScript(scriptPath) {
  return new Promise((resolve) => {
    console.log(`\n>>> Executing: ${scriptPath}`);
    const proc = spawn('node', [scriptPath], { stdio: 'inherit' });
    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

async function main() {
  console.log('======================================================');
  console.log('       FEEDBACKHUB AUTOMATED TEST VERIFICATION        ');
  console.log('======================================================');

  const securitySuccess = await runScript(path.join(__dirname, 'security-tests.js'));

  console.log('\n======================================================');
  console.log('                  OVERALL RESULTS                    ');
  console.log('======================================================');
  console.log(`Security & Auth & Validation Suite: ${securitySuccess ? 'PASS ✓' : 'FAIL ✗'}`);

  if (!securitySuccess) {
    process.exit(1);
  } else {
    console.log('\nAll core security, authorization, and validation tests passed successfully!\n');
    process.exit(0);
  }
}

main();
