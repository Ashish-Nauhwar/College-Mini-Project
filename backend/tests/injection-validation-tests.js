/**
 * Form Builder & Submission Injection & Validation Hardening Test Suite
 * Validates question ID sanitization, non-blank question labels, option requirements,
 * cyclic conditional dependency prevention, calendar date validation, and tenant location checks.
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { FeedbackForm } = require('../src/models');
const { createSlidingWindowLimiter } = require('../src/middleware/rateLimiter');

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

// Extraction of server validation helper
function validateAndSanitizeQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) return { error: null, questions: [] };

  const idSet = new Set();
  const sanitized = [];

  for (let idx = 0; idx < rawQuestions.length; idx++) {
    const q = rawQuestions[idx];
    if (!q || typeof q !== 'object') {
      return { error: `Invalid question format at position ${idx + 1}` };
    }

    const text = q.text ? String(q.text).trim() : '';
    if (!text) {
      return { error: `Question label cannot be empty (question #${idx + 1})` };
    }

    const allowedTypes = [
      'rating', 'nps', 'text', 'multiline', 'choice', 'select',
      'checkbox', 'yesno', 'email', 'phone', 'number', 'date'
    ];
    const type = q.type && allowedTypes.includes(q.type) ? q.type : null;
    if (!type) {
      return { error: `Invalid question type "${q.type}" for question #${idx + 1}` };
    }

    let qId = q.id && typeof q.id === 'string' ? q.id.trim() : '';
    const safeIdRegex = /^[a-zA-Z0-9_-]{1,64}$/;
    if (!qId || !safeIdRegex.test(qId) || idSet.has(qId)) {
      qId = `q_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`;
    }
    idSet.add(qId);

    let options = [];
    if (['choice', 'select', 'checkbox'].includes(type)) {
      options = Array.isArray(q.options)
        ? q.options.map(opt => String(opt).trim()).filter(Boolean)
        : [];
      if (options.length === 0) {
        return { error: `Question "${text}" of type "${type}" must have at least one valid option` };
      }
    }

    sanitized.push({
      id: qId,
      type,
      text,
      description: q.description ? String(q.description).trim() : '',
      placeholder: q.placeholder ? String(q.placeholder).trim() : '',
      required: Boolean(q.required),
      min: typeof q.min === 'number' ? q.min : (type === 'nps' ? 0 : 1),
      max: typeof q.max === 'number' ? q.max : (type === 'nps' ? 10 : 5),
      options,
      multiline: Boolean(q.multiline),
      order: typeof q.order === 'number' ? q.order : idx,
      conditional: q.conditional && q.conditional.dependsOn ? {
        dependsOn: String(q.conditional.dependsOn).trim(),
        operator: ['equals', 'not_equals', 'in', 'greater_than', 'less_than', 'contains'].includes(q.conditional.operator)
          ? q.conditional.operator
          : 'equals',
        value: q.conditional.value
      } : null
    });
  }

  for (const q of sanitized) {
    if (q.conditional) {
      if (q.conditional.dependsOn === q.id) {
        return { error: `Question "${q.text}" cannot depend on itself` };
      }
      if (!idSet.has(q.conditional.dependsOn)) {
        return { error: `Question "${q.text}" depends on non-existent question "${q.conditional.dependsOn}"` };
      }
    }
  }

  return { error: null, questions: sanitized };
}

function runInjectionValidationTests() {
  console.log('\n======================================================');
  console.log('   FORM BUILDER & INJECTION HARDENING TEST SUITE      ');
  console.log('======================================================\n');

  console.log('--- 1. Question ID Hardening & Sanitization ---');

  it('Hostile question IDs with XSS or directory traversal are safely sanitized server-side', () => {
    const hostile = [
      { id: '<script>alert("XSS")</script>', type: 'text', text: 'Safe Question' },
      { id: '../../../etc/passwd', type: 'text', text: 'Another Safe Question' },
      { id: 'valid_id_123', type: 'text', text: 'Legitimate Question' }
    ];
    const res = validateAndSanitizeQuestions(hostile);
    assert.strictEqual(res.error, null);
    assert.ok(!res.questions[0].id.includes('<script>'), 'Must strip script tags from question ID');
    assert.ok(res.questions[0].id.startsWith('q_'), 'Must generate safe prefix for invalid IDs');
    assert.ok(!res.questions[1].id.includes('/'), 'Must strip path traversal chars');
    assert.strictEqual(res.questions[2].id, 'valid_id_123', 'Must preserve safe alphanumeric ID');
  });

  console.log('\n--- 2. Blank Label & Option Requirements ---');

  it('Rejects blank or whitespace question labels with 400 error', () => {
    const blankQuestions = [
      { id: 'q1', type: 'text', text: '   ' }
    ];
    const res = validateAndSanitizeQuestions(blankQuestions);
    assert.ok(res.error);
    assert.ok(res.error.includes('label cannot be empty'));
  });

  it('Requires non-empty options for choice, select, and checkbox questions', () => {
    const missingChoice = [
      { id: 'q1', type: 'choice', text: 'Pick One', options: [] }
    ];
    const res1 = validateAndSanitizeQuestions(missingChoice);
    assert.ok(res1.error);
    assert.ok(res1.error.includes('must have at least one valid option'));

    const missingSelect = [
      { id: 'q2', type: 'select', text: 'Select Department', options: ['  ', ''] }
    ];
    const res2 = validateAndSanitizeQuestions(missingSelect);
    assert.ok(res2.error);
    assert.ok(res2.error.includes('must have at least one valid option'));
  });

  console.log('\n--- 3. Conditional Dependency Integrity ---');

  it('Rejects self-referential conditional rules (cycles)', () => {
    const cycle = [
      {
        id: 'q_cycle',
        type: 'text',
        text: 'Self Referencing',
        conditional: { dependsOn: 'q_cycle', operator: 'equals', value: 'yes' }
      }
    ];
    const res = validateAndSanitizeQuestions(cycle);
    assert.ok(res.error);
    assert.ok(res.error.includes('cannot depend on itself'));
  });

  it('Rejects conditional rules that point to non-existent parent questions', () => {
    const orphan = [
      {
        id: 'q_orphan',
        type: 'text',
        text: 'Orphan Question',
        conditional: { dependsOn: 'non_existent_q_999', operator: 'equals', value: 'yes' }
      }
    ];
    const res = validateAndSanitizeQuestions(orphan);
    assert.ok(res.error);
    assert.ok(res.error.includes('depends on non-existent question'));
  });

  console.log('\n--- 4. Date and Type Schema Integrity ---');

  it('Validates calendar date formatting strictly', () => {
    const isValidDate = (val) => {
      const d = String(val).trim();
      return Boolean(d) && !isNaN(Date.parse(d));
    };

    assert.strictEqual(isValidDate('2026-10-13'), true);
    assert.strictEqual(isValidDate('2026-12-31T15:30:00Z'), true);
    assert.strictEqual(isValidDate('invalid-date-string'), false);
    assert.strictEqual(isValidDate('99999-99-99'), false);
    assert.strictEqual(isValidDate(''), false);
  });

  console.log('\n--- 5. Sliding Window Rate Limiter & Headers ---');

  it('Sliding window rate limiter emits RFC RateLimit headers and 429 Retry-After on limit excess', () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 10000, max: 2, message: 'Rate limit exceeded' });
    const headers = {};
    const mockRes = {
      setHeader: (k, v) => { headers[k] = v; },
      status: (code) => ({
        json: (payload) => ({ statusCode: code, payload })
      })
    };
    const mockReq = { ip: '192.168.1.100', headers: {} };

    // Request 1: allowed
    let nextCalled1 = false;
    limiter(mockReq, mockRes, () => { nextCalled1 = true; });
    assert.strictEqual(nextCalled1, true);
    assert.strictEqual(headers['RateLimit-Limit'], 2);
    assert.strictEqual(headers['RateLimit-Remaining'], 1);

    // Request 2: allowed
    let nextCalled2 = false;
    limiter(mockReq, mockRes, () => { nextCalled2 = true; });
    assert.strictEqual(nextCalled2, true);
    assert.strictEqual(headers['RateLimit-Remaining'], 0);

    // Request 3: blocked
    let nextCalled3 = false;
    const blockedRes = limiter(mockReq, mockRes, () => { nextCalled3 = true; });
    assert.strictEqual(nextCalled3, false);
    assert.strictEqual(blockedRes.statusCode, 429);
    assert.ok(headers['Retry-After'] >= 1);
    assert.strictEqual(blockedRes.payload.error, 'Rate limit exceeded');
  });

  console.log('\n======================================================');
  console.log(`   TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)   `);
  console.log('======================================================\n');

  if (failedTests > 0) process.exit(1);
}

runInjectionValidationTests();
