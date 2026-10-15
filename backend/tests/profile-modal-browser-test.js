/**
 * Profile Modal & Logout Verification Test Suite
 * Tests:
 * 1. window.app.openProfileModal and window.app.closeProfileModal are exposed functions.
 * 2. Clicking #userProfileBadge opens #userProfileModal without console errors.
 * 3. Logged-in user's name, email, and role are rendered in #userProfileModalBody.
 * 4. Visible Log Out button is present in the modal.
 * 5. Pressing Escape key closes the profile modal.
 * 6. Clicking outside (on the modal backdrop) closes the modal.
 * 7. Clicking Log Out clears authentication token and navigates to #/login.
 * 8. All actions run in real headless Edge browser via Chrome DevTools Protocol (CDP).
 */

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = require('../server');
const db = require('../src/db');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEBUG_PORT = 9224;

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

async function runProfileModalTests() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB PROFILE MODAL & LOGOUT VERIFICATION SUITE       ');
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
    console.log(`[Setup] Express test server listening at ${BASE_URL}`);

    // Seed mock business and user for demo switch test
    const testBiz = await db.createBusiness({
      name: 'Apex Specialty Coffee',
      type: 'restaurant',
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
    console.log('  ✓ Seeded mock business and user Sarah Jenkins');

    // 2. Launch Edge CDP (or run static structural verification if Edge is absent)
    if (!fs.existsSync(EDGE_PATH)) {
      console.log('\n[Edge not detected] Running static structural and export assertions...');
      const indexPath = path.join(__dirname, '..', '..', 'frontend', 'index.html');
      const appJsPath = path.join(__dirname, '..', '..', 'frontend', 'js', 'app.js');
      const indexHtml = fs.readFileSync(indexPath, 'utf8');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      assert.ok(indexHtml.includes('id="userProfileModal"'), 'index.html must define userProfileModal');
      assert.ok(indexHtml.includes('id="userProfileModalBody"'), 'index.html must define userProfileModalBody');
      assert.ok(indexHtml.includes('onclick="app.openProfileModal()"'), 'userProfileBadge must call app.openProfileModal()');
      assert.ok(indexHtml.includes('onclick="app.closeProfileModal()"'), 'close button must call app.closeProfileModal()');
      assert.ok(appJs.includes('openProfileModal,'), 'app.js must export openProfileModal');
      assert.ok(appJs.includes('closeProfileModal,'), 'app.js must export closeProfileModal');
      assert.ok(appJs.includes('window.app = app;'), 'app.js must bind to window.app');
      console.log('  ✓ Static structural and export assertions passed');
      passedCount = 1;
      return;
    }

    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-profile-'));

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

    // 3. Navigate to Dashboard
    console.log('[Test 1] Navigating to dashboard and verifying app global object...');
    await client.send('Page.navigate', { url: `${BASE_URL}/#/dashboard` });
    await sleep(800);

    const hasApp = await client.evaluate('typeof window.app === "object"');
    assert.strictEqual(hasApp, true, 'window.app must be defined');

    const hasOpenProfile = await client.evaluate('typeof window.app.openProfileModal === "function"');
    assert.strictEqual(hasOpenProfile, true, 'window.app.openProfileModal must be an exported function');

    const hasCloseProfile = await client.evaluate('typeof window.app.closeProfileModal === "function"');
    assert.strictEqual(hasCloseProfile, true, 'window.app.closeProfileModal must be an exported function');
    console.log('  ✓ window.app correctly exposes openProfileModal and closeProfileModal');
    passedCount++;

    // 4. Switch to Demo User to establish active session
    console.log('\n[Test 2] Establishing active session via demo switch...');
    await client.evaluate('window.app.switchDemo("owner")');
    await sleep(500);

    const currentUserName = await client.evaluate('document.getElementById("userName")?.textContent');
    assert.ok(currentUserName && currentUserName.includes('Sarah'), `Expected user Sarah, got: "${currentUserName}"`);
    console.log(`  ✓ Active session established for user: "${currentUserName}"`);
    passedCount++;

    // 5. Click Profile Icon and verify NO runtime errors occur
    console.log('\n[Test 3] Clicking profile icon (#userProfileBadge)...');
    client.consoleErrors = [];
    await client.evaluate('document.getElementById("userProfileBadge").click()');
    await sleep(300);

    const openErrors = client.consoleErrors.filter(e => e.includes('openProfileModal') || e.includes('TypeError'));
    assert.strictEqual(openErrors.length, 0, `Clicking profile icon must not cause TypeError: ${openErrors.join('; ')}`);

    const isModalActive = await client.evaluate('document.getElementById("userProfileModal")?.classList.contains("active")');
    assert.strictEqual(isModalActive, true, '#userProfileModal must receive active class when profile icon is clicked');

    const ariaExpanded = await client.evaluate('document.getElementById("userProfileBadge")?.getAttribute("aria-expanded")');
    assert.strictEqual(ariaExpanded, 'true', '#userProfileBadge must have aria-expanded="true" when modal is open');
    console.log('  ✓ #userProfileModal opened without console errors');
    passedCount++;

    // 6. Verify user details in profile modal
    console.log('\n[Test 4] Verifying profile modal displays name, email, role, and Log Out button...');
    const modalName = await client.evaluate('document.getElementById("profileModalUserName")?.textContent?.trim()');
    const modalEmail = await client.evaluate('document.getElementById("profileModalUserEmail")?.textContent?.trim()');
    const modalRole = await client.evaluate('document.getElementById("profileModalUserRole")?.textContent?.trim()');
    const hasLogoutBtn = await client.evaluate('Boolean(document.querySelector("#userProfileModal button[onclick*=\'app.logout\']"))');

    assert.ok(modalName && modalName.includes('Sarah'), `Modal name must display Sarah, got: "${modalName}"`);
    assert.ok(modalEmail && modalEmail.includes('@'), `Modal email must be valid email, got: "${modalEmail}"`);
    assert.ok(modalRole && (modalRole.includes('OWNER') || modalRole.includes('Owner')), `Modal role must indicate Owner, got: "${modalRole}"`);
    assert.strictEqual(hasLogoutBtn, true, 'Profile modal must include a visible Log Out button');

    console.log(`  ✓ Modal content verified: Name="${modalName}", Email="${modalEmail}", Role="${modalRole}", LogoutButton=true`);
    passedCount++;

    // 7. Verify closing modal via Escape key
    console.log('\n[Test 5] Verifying closing profile modal via Escape key...');
    await client.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    `);
    await sleep(200);

    const isClosedAfterEsc = await client.evaluate('!document.getElementById("userProfileModal")?.classList.contains("active")');
    assert.strictEqual(isClosedAfterEsc, true, 'Modal must close on Escape key');
    console.log('  ✓ Modal closed successfully when Escape key was pressed');
    passedCount++;

    // 8. Re-open and verify closing by clicking outside (backdrop)
    console.log('\n[Test 6] Verifying closing profile modal by clicking outside on backdrop...');
    await client.evaluate('window.app.openProfileModal()');
    await sleep(200);
    const isOpenAgain = await client.evaluate('document.getElementById("userProfileModal")?.classList.contains("active")');
    assert.strictEqual(isOpenAgain, true, 'Modal must re-open on openProfileModal');

    // Click directly on the backdrop element
    await client.evaluate(`
      const modal = document.getElementById("userProfileModal");
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    `);
    await sleep(200);

    const isClosedAfterBackdropClick = await client.evaluate('!document.getElementById("userProfileModal")?.classList.contains("active")');
    assert.strictEqual(isClosedAfterBackdropClick, true, 'Modal must close when backdrop is clicked');
    console.log('  ✓ Modal closed successfully when backdrop outside container was clicked');
    passedCount++;

    // 9. Re-open and click Log Out button
    console.log('\n[Test 7] Verifying Log Out flow from profile modal...');
    await client.evaluate('window.app.openProfileModal()');
    await sleep(200);

    // Click Log Out
    await client.evaluate(`
      const logoutBtn = document.querySelector("#userProfileModal button[onclick*='app.logout']");
      logoutBtn.click();
    `);
    await sleep(400);

    const currentHash = await client.evaluate('window.location.hash');
    assert.strictEqual(currentHash, '#/login', `Clicking logout must redirect to #/login, got: "${currentHash}"`);

    const storedToken = await client.evaluate('localStorage.getItem("fh_token")');
    assert.strictEqual(storedToken, null, 'Authentication token must be cleared from localStorage on logout');

    const modalClosedOnLogout = await client.evaluate('!document.getElementById("userProfileModal")?.classList.contains("active")');
    assert.strictEqual(modalClosedOnLogout, true, 'Profile modal must be closed on logout');
    console.log('  ✓ Logout button cleared token and session, closed modal, and navigated to #/login');
    passedCount++;

    console.log('\n===============================================================');
    console.log(`>>> [PASS] All ${passedCount} Profile Modal & Logout Tests Passed!`);
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
  runProfileModalTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n[Profile Modal Test Failure]:', err);
      process.exit(1);
    });
}

module.exports = runProfileModalTests;
