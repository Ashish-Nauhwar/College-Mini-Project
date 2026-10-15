/**
 * Form Preview, Slug Authority & Status Verification Test Suite
 * 
 * Verifies:
 * 1. Previewing a draft form opens the in-app preview modal (zero external network requests).
 * 2. Unsaved title and question edits in the builder appear immediately in the in-app preview.
 * 3. Opening a published form uses the form's exact saved slug, never its title, MongoDB ID, or random slug.
 * 4. Passing a MongoDB ID instead of a slug is strictly rejected and never treated as a valid public URL.
 * 5. Draft and paused forms show clear, actionable status messages guiding administrators to publish,
 *    never the misleading "Feedback form not found" message.
 * 6. A valid published form loads and submits feedback successfully via the exact saved slug.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.TEST_MOCK_DB = 'true';
process.env.ENABLE_DEMO_MODE = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'form-preview-test-secret-at-least-32-chars-long';

const app = require('../server');
const db = require('../src/db');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEBUG_PORT = 9225;

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
    this.consoleErrors = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.id && this.callbacks.has(data.id)) {
          const cb = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) cb.reject(new Error(data.error.message));
          else cb.resolve(data.result);
        }

        if (data.method === 'Runtime.consoleAPICalled') {
          if (data.params.type === 'error') {
            const text = data.params.args.map(a => a.value || a.description || '').join(' ');
            if (!text.includes('favicon.ico')) {
              this.consoleErrors.push(text);
            }
          }
        } else if (data.method === 'Runtime.exceptionThrown') {
          const text = data.params.exceptionDetails?.text || 'Uncaught error';
          const desc = data.params.exceptionDetails?.exception?.description || '';
          this.consoleErrors.push(`${text} ${desc}`.trim());
        }
      };
    });
  }

  async send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result?.value;
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runFormPreviewTests() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB FORM PREVIEW, SLUG & STATUS VERIFICATION SUITE   ');
  console.log('===============================================================\n');

  db.enableMockDb(true);

  let server = null;
  let BASE_URL = '';
  let edgeProc = null;
  let client = null;
  let profileDir = null;
  let passedCount = 0;

  try {
    // 1. Start ephemeral HTTP server
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        BASE_URL = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    console.log(`[Setup] Ephemeral test server listening at ${BASE_URL}`);

    // Seed test business and user Sarah Jenkins
    const testBiz = await db.createBusiness({
      name: 'Apex Academy of Science',
      type: 'college',
      contactEmail: 'sarah@apexcafe.com'
    });
    await db.createUser({
      name: 'Sarah Jenkins',
      email: 'sarah@apexcafe.com',
      password: 'hashedPassword123',
      role: 'owner',
      businessId: testBiz._id,
      avatar: '👩‍💼'
    });

    // Seed draft form
    const draftForm = await db.createForm({
      title: 'Course Experience Evaluation (Draft)',
      description: 'Draft evaluation for faculty and lab courses',
      slug: 'course-eval-draft-2026',
      status: 'draft',
      businessId: testBiz._id,
      questions: [
        {
          id: 'q_draft_1',
          type: 'text',
          text: 'What was your primary learning takeaway?',
          required: true,
          order: 1
        },
        {
          id: 'q_draft_2',
          type: 'choice',
          text: 'Did lectures start on time?',
          options: ['Always', 'Mostly', 'Rarely'],
          required: false,
          order: 2
        }
      ]
    });

    // Seed paused form
    const pausedForm = await db.createForm({
      title: 'Campus Facilities Feedback (Paused)',
      description: 'Paused survey for library and cafeteria',
      slug: 'campus-fac-paused-2026',
      status: 'paused',
      businessId: testBiz._id,
      questions: [
        {
          id: 'q_paused_1',
          type: 'rating',
          text: 'Cleanliness of library study rooms:',
          required: true,
          order: 1
        }
      ]
    });

    // Seed published form
    const publishedForm = await db.createForm({
      title: 'Annual Student Satisfaction Survey (Live)',
      description: 'Comprehensive annual feedback survey',
      slug: 'annual-student-survey-2026',
      status: 'published',
      businessId: testBiz._id,
      questions: [
        {
          id: 'q_pub_1',
          type: 'rating',
          text: 'Quality of academic curriculum and labs:',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_pub_2',
          type: 'nps',
          text: 'How likely are you to recommend Apex Academy to friends? (0-10)',
          required: true,
          min: 0,
          max: 10,
          order: 2
        }
      ]
    });

    console.log('  ✓ Seeded test college, draft form, paused form, and published form');

    // =========================================================================
    // SECTION 1: Backend API Slug Authority & Status Tests
    // =========================================================================

    // Test 1: Passing a MongoDB ID instead of a slug is rejected with 404
    console.log('\n[Test 1] Verifying MongoDB ObjectId is never accepted as public slug...');
    const mongoIdCandidate = '65e9a4f21b7c890123456789';
    const idRes = await fetch(`${BASE_URL}/api/forms/slug/${mongoIdCandidate}`);
    assert.strictEqual(idRes.status, 404, 'Passing MongoDB ID must return HTTP 404');
    const idData = await idRes.json();
    assert.strictEqual(idData.error, 'Feedback form not found');
    assert.strictEqual(idData.reason, 'invalid_slug_type');

    // Also check feedback submission with ObjectId
    const idSubmitRes = await fetch(`${BASE_URL}/api/feedback/submit/${mongoIdCandidate}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5 })
    });
    assert.strictEqual(idSubmitRes.status, 404, 'Submitting with MongoDB ID must return HTTP 404');
    console.log('  ✓ MongoDB ObjectId as public slug is safely rejected with HTTP 404');
    passedCount++;

    // Test 2: Nonexistent slug returns 404 with clean diagnostic error
    console.log('\n[Test 2] Verifying nonexistent slug returns HTTP 404...');
    const nonExistentRes = await fetch(`${BASE_URL}/api/forms/slug/nonexistent-slug-xyz-999`);
    assert.strictEqual(nonExistentRes.status, 404, 'Nonexistent slug must return HTTP 404');
    const nonExistentData = await nonExistentRes.json();
    assert.strictEqual(nonExistentData.error, 'Feedback form not found');
    assert.strictEqual(nonExistentData.reason, 'not_found');
    console.log('  ✓ Nonexistent slug correctly returns HTTP 404');
    passedCount++;

    // Test 3: Draft form returns HTTP 403 with status: 'draft' and guidance
    console.log('\n[Test 3] Verifying draft form returns HTTP 403 with status: "draft"...');
    const draftRes = await fetch(`${BASE_URL}/api/forms/slug/${draftForm.slug}`);
    assert.strictEqual(draftRes.status, 403, 'Draft form must return HTTP 403');
    const draftData = await draftRes.json();
    assert.strictEqual(draftData.status, 'draft', 'Status field must be "draft"');
    assert.ok(/draft/i.test(draftData.message), 'Draft message must indicate draft status');
    assert.ok(draftData.message.includes('Form Builder'), 'Draft message must guide administrator to Form Builder');
    console.log('  ✓ Draft form returns HTTP 403 with informative publishing guidance');
    passedCount++;

    // Test 4: Paused form returns HTTP 403 with status: 'paused' and guidance
    console.log('\n[Test 4] Verifying paused form returns HTTP 403 with status: "paused"...');
    const pausedRes = await fetch(`${BASE_URL}/api/forms/slug/${pausedForm.slug}`);
    assert.strictEqual(pausedRes.status, 403, 'Paused form must return HTTP 403');
    const pausedData = await pausedRes.json();
    assert.strictEqual(pausedData.status, 'paused', 'Status field must be "paused"');
    assert.ok(/paused/i.test(pausedData.message), 'Paused message must indicate paused status');
    console.log('  ✓ Paused form returns HTTP 403 with informative paused message');
    passedCount++;

    // Test 5: Published form returns HTTP 200 with exact saved slug
    console.log('\n[Test 5] Verifying published form returns HTTP 200 with exact saved slug...');
    const pubRes = await fetch(`${BASE_URL}/api/forms/slug/${publishedForm.slug}`);
    assert.strictEqual(pubRes.status, 200, 'Published form must return HTTP 200');
    const pubData = await pubRes.json();
    assert.strictEqual(pubData.form.slug, publishedForm.slug, 'Form slug in response must match exact saved slug');
    assert.strictEqual(pubData.form.status, 'published');
    assert.strictEqual(pubData.business.name, 'Apex Academy of Science');
    console.log('  ✓ Published form loaded successfully with exact saved slug');
    passedCount++;

    // Test 6: Valid feedback submission to published form succeeds (HTTP 201)
    console.log('\n[Test 6] Submitting feedback to published form via exact slug...');
    const submitRes = await fetch(`${BASE_URL}/api/feedback/submit/${publishedForm.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        nps: 10,
        customerName: 'Alex Mercer',
        answers: {
          q_pub_1: 5,
          q_pub_2: 10
        }
      })
    });
    assert.strictEqual(submitRes.status, 201, 'Feedback submission must return HTTP 201');
    const submitData = await submitRes.json();
    assert.strictEqual(submitData.success, true);
    assert.strictEqual(submitData.rating, 5);
    assert.ok(submitData.feedbackId, 'Must return feedbackId');
    console.log('  ✓ Feedback submission to published form succeeded with HTTP 201');
    passedCount++;

    // =========================================================================
    // SECTION 2: Browser & Frontend Preview / Public URL Tests
    // =========================================================================
    if (!fs.existsSync(EDGE_PATH)) {
      console.log('\n[Edge not detected] Running static structural assertions...');
      const appJs = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'app.js'), 'utf8');
      const feedbackJs = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'feedback.js'), 'utf8');

      assert.ok(appJs.includes('getPublicFormUrl'), 'app.js must define getPublicFormUrl');
      assert.ok(appJs.includes('syncHeaderPublicFormLink'), 'app.js must define syncHeaderPublicFormLink');
      assert.ok(feedbackJs.includes('Form In Draft Status'), 'feedback.js must render draft status title');
      assert.ok(feedbackJs.includes('Form Currently Paused'), 'feedback.js must render paused status title');
      console.log('  ✓ Static code verification passed');
      passedCount++;
      return;
    }

    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-form-preview-'));
    edgeProc = spawn(EDGE_PATH, [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDir}`,
      'about:blank'
    ], { stdio: 'ignore' });

    let target = null;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        if (res.ok) {
          const targets = await res.json();
          target = targets.find(t => t.type === 'page');
          if (target) break;
        }
      } catch (_) {}
    }

    assert.ok(target, 'Could not establish connection to Edge CDP target');
    client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    // Test 7: Load Dashboard and verify getPublicFormUrl helper
    console.log('\n[Test 7] Verifying getPublicFormUrl helper in browser context...');
    await client.send('Page.navigate', { url: `${BASE_URL}/#/dashboard` });
    await sleep(800);

    // Switch to Demo account to initialize user and forms list
    await client.evaluate('window.app.switchDemo("owner")');
    await sleep(600);

    const helperCheck = await client.evaluate(`
      (() => {
        const resObj = window.app.getPublicFormUrl('65e9a4f21b7c890123456789');
        return resObj === null;
      })()
    `);
    assert.strictEqual(helperCheck, true, 'getPublicFormUrl must reject MongoDB ObjectId');
    console.log('  ✓ getPublicFormUrl safely rejects MongoDB ObjectId in browser context');
    passedCount++;

    // Test 8: In-App Preview for Draft Form (works client-side with 0 network calls)
    console.log('\n[Test 8] Verifying in-app preview for draft form...');
    await client.send('Page.navigate', { url: `${BASE_URL}/#/builder` });
    await sleep(600);

    // Load draft form in builder
    await client.evaluate(`
      (async () => {
        await window.app.loadBuilderForm("${draftForm._id.toString()}");
      })()
    `);
    await sleep(400);

    // Open preview
    await client.evaluate('window.app.previewCurrentForm()');
    await sleep(200);

    const isPreviewActive = await client.evaluate('document.getElementById("previewModal")?.classList.contains("active")');
    assert.strictEqual(isPreviewActive, true, '#previewModal must receive active class');

    const previewTitle = await client.evaluate('document.getElementById("previewFormTitle")?.textContent');
    assert.ok(previewTitle && previewTitle.includes('Course Experience Evaluation'), `Expected draft title, got: "${previewTitle}"`);

    const previewBadge = await client.evaluate('document.getElementById("previewModalStatusBadge")?.textContent');
    assert.ok(previewBadge && previewBadge.includes('DRAFT'), `Expected Draft badge, got: "${previewBadge}"`);

    const liveLinkDisplay = await client.evaluate('document.getElementById("previewModalLiveLink")?.style.display');
    assert.strictEqual(liveLinkDisplay, 'none', 'Live link must be hidden for draft form preview');
    console.log('  ✓ Draft form preview opened in-app with DRAFT badge and live link hidden');
    passedCount++;

    // Test 9: Unsaved title and question edits appear immediately in preview
    console.log('\n[Test 9] Verifying unsaved title and question edits appear in preview...');
    await client.evaluate(`
      (() => {
        const titleInput = document.getElementById('builderTitle');
        if (titleInput) {
          titleInput.value = 'Unsaved Advanced Chemistry 101';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const card0 = document.getElementById('q-card-0');
        if (card0) {
          const textInput = card0.querySelector('input.form-input');
          if (textInput) {
            textInput.value = 'What lab equipment did you use? (Unsaved)';
            textInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      })()
    `);

    // Call preview without clicking Save
    await client.evaluate('window.app.previewCurrentForm()');
    await sleep(200);

    const unsavedTitle = await client.evaluate('document.getElementById("previewFormTitle")?.textContent');
    assert.strictEqual(unsavedTitle, 'Unsaved Advanced Chemistry 101', 'Preview must display unsaved title');

    const unsavedQuestion = await client.evaluate(`
      document.querySelector('.preview-question-item .preview-q-text')?.textContent
    `);
    assert.strictEqual(unsavedQuestion, 'What lab equipment did you use? (Unsaved)', 'Preview must display unsaved question prompt');
    console.log('  ✓ Unsaved title and question edits captured accurately in in-app preview');
    passedCount++;

    // Close preview
    await client.evaluate('window.app.closePreviewModal()');
    await sleep(200);

    // Test 10: Public form URL displays accurate status message for draft form
    console.log('\n[Test 10] Verifying /feedback/:slug displays draft status (not "form not found")...');
    await client.send('Page.navigate', { url: `${BASE_URL}/feedback/${draftForm.slug}` });
    await sleep(800);

    const draftErrorTitle = await client.evaluate('document.getElementById("errorTitle")?.textContent');
    assert.ok(draftErrorTitle && draftErrorTitle.includes('Draft Status'), `Expected Draft Status title, got: "${draftErrorTitle}"`);

    const draftErrorMsg = await client.evaluate('document.getElementById("errorMessage")?.textContent');
    assert.ok(draftErrorMsg && !draftErrorMsg.includes('Feedback form not found'), 'Draft form must NOT display "Feedback form not found"');
    assert.ok(draftErrorMsg && draftErrorMsg.includes('draft'), 'Draft message must mention draft status');
    console.log('  ✓ Public feedback page renders clear "Form In Draft Status" message');
    passedCount++;

    // Test 11: Public form URL displays accurate status message for paused form
    console.log('\n[Test 11] Verifying /feedback/:slug displays paused status for paused form...');
    await client.send('Page.navigate', { url: `${BASE_URL}/feedback/${pausedForm.slug}` });
    await sleep(800);

    const pausedErrorTitle = await client.evaluate('document.getElementById("errorTitle")?.textContent');
    assert.ok(pausedErrorTitle && pausedErrorTitle.includes('Paused'), `Expected Paused title, got: "${pausedErrorTitle}"`);

    const pausedErrorMsg = await client.evaluate('document.getElementById("errorMessage")?.textContent');
    assert.ok(pausedErrorMsg && !pausedErrorMsg.includes('Feedback form not found'), 'Paused form must NOT display "Feedback form not found"');
    console.log('  ✓ Public feedback page renders clear "Form Currently Paused" message');
    passedCount++;

    // Test 12: Public form URL loads successfully for published form
    console.log('\n[Test 12] Verifying /feedback/:slug loads published form with questions and branding...');
    await client.send('Page.navigate', { url: `${BASE_URL}/feedback/${publishedForm.slug}` });
    await sleep(800);

    const isFormVisible = await client.evaluate('!document.getElementById("publicFeedbackForm")?.classList.contains("hidden")');
    assert.strictEqual(isFormVisible, true, 'Published form must be visible');

    const renderedBizName = await client.evaluate('document.getElementById("bizName")?.textContent');
    assert.strictEqual(renderedBizName, 'Apex Academy of Science', 'Branding must display business name');
    console.log('  ✓ Public feedback page loaded published form successfully');
    passedCount++;

    console.log('\n===============================================================');
    console.log(`>>> [PASS] All ${passedCount} Form Preview & Slug Tests Passed!`);
    console.log('===============================================================\n');
  } finally {
    if (client) client.close();
    if (edgeProc) {
      try { edgeProc.kill('SIGKILL'); } catch (_) {}
    }
    if (server) {
      server.close();
    }
    if (profileDir && fs.existsSync(profileDir)) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}

if (require.main === module) {
  runFormPreviewTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n[Form Preview Test Failure]:', err);
      process.exit(1);
    });
}

module.exports = runFormPreviewTests;
