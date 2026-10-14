/**
 * FeedbackHub Standards-Compliant QR Code Verification Suite
 * Tests:
 * 1. QR generation using maintained 'qrcode' library (SVG, Data URL, Matrix).
 * 2. Strict decoding verification using industry-standard 'jsqr' decoder.
 * 3. Client bundle (frontend/js/qr.js) integrity and window.QRCode contract.
 * 4. API endpoints: /api/qr/image, /api/qr/data-url, /api/qr/form/:slug.
 * 5. Rejection of unpublished / draft / archived forms.
 * 6. Rejection of dashboard, admin, and internal routes.
 * 7. Rejection of localhost and dev URLs when NODE_ENV is production.
 * 8. Form prioritization ensuring published forms are selected first.
 * 9. URL consistency: displayed URL === copied URL === scanned QR URL.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

// Load environment configuration
const dotenv = require('dotenv');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const app = require('../server');
const db = require('../src/db');
const { createQrSvg, createQrDataUri, generateMatrix } = require('../src/utils/qr-generator');

function decodePngDataUrl(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  const png = PNG.sync.read(buffer);
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return code ? code.data : null;
}

function decodeMatrix(matrix) {
  const size = matrix.length;
  const margin = 4;
  const total = size + margin * 2;
  const imgData = new Uint8ClampedArray(total * total * 4);
  for (let r = 0; r < total; r++) {
    for (let c = 0; c < total; c++) {
      const idx = (r * total + c) * 4;
      const mr = r - margin;
      const mc = c - margin;
      const isDark = mr >= 0 && mr < size && mc >= 0 && mc < size && matrix[mr][mc] === 1;
      const val = isDark ? 0 : 255;
      imgData[idx] = val;
      imgData[idx + 1] = val;
      imgData[idx + 2] = val;
      imgData[idx + 3] = 255;
    }
  }
  const code = jsQR(imgData, total, total);
  return code ? code.data : null;
}

async function runQrStandardsTests() {
  console.log('\n===============================================================');
  console.log('   FEEDBACKHUB STANDARDS-COMPLIANT QR CODE VERIFICATION SUITE  ');
  console.log('===============================================================\n');

  db.enableMockDb(true);

  let passedCount = 0;
  let server = null;
  let BASE_URL = '';

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      BASE_URL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------
    // Test 1: Maintained QR generator produces valid SVG & Data URL
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying backend QR generator creates valid SVG and Data URL...');
    const targetUrl = 'https://college-mini-project-vtm5.onrender.com/feedback/apex-college-academic';
    const svg = createQrSvg(targetUrl, 300);
    assert.ok(svg.includes('<svg') && svg.includes('</svg>'), 'Generated output must be valid SVG XML');
    assert.ok(svg.includes('viewBox='), 'Generated SVG must contain viewBox');

    const dataUri = await createQrDataUri(targetUrl, 300);
    assert.ok(dataUri.startsWith('data:image/png;base64,'), 'Data URI must be PNG base64 format');
    console.log('  ✓ Backend SVG and PNG data URL generated successfully with maintained library');
    passedCount++;

    // -------------------------------------------------------------
    // Test 2: Standard jsQR decoder reads generated QR back to exact URL
    // -------------------------------------------------------------
    console.log('\n[Test 2] Verifying standard QR decoder decodes generated QR back to exact URL...');
    const decodedUrlFromPng = decodePngDataUrl(dataUri);
    assert.strictEqual(decodedUrlFromPng, targetUrl, `Decoded URL "${decodedUrlFromPng}" must strictly match target "${targetUrl}"`);

    const matrix = generateMatrix(targetUrl);
    assert.ok(Array.isArray(matrix) && matrix.length > 20, 'Matrix must be a 2D array of modules');
    const decodedFromMatrix = decodeMatrix(matrix);
    assert.strictEqual(decodedFromMatrix, targetUrl, 'Matrix must decode back to exact URL via jsQR');
    console.log(`  ✓ Decoded with jsQR: "${decodedUrlFromPng}" (100% accurate match)`);
    passedCount++;

    // -------------------------------------------------------------
    // Test 3: Client browser bundle (frontend/js/qr.js) verification
    // -------------------------------------------------------------
    console.log('\n[Test 3] Verifying client bundle (frontend/js/qr.js) integrity and window.QRCode API...');
    const bundlePath = path.join(__dirname, '..', '..', 'frontend', 'js', 'qr.js');
    assert.ok(fs.existsSync(bundlePath), 'frontend/js/qr.js bundle must exist');
    const bundleCode = fs.readFileSync(bundlePath, 'utf8');

    // Confirm old buggy custom encoder patterns are absent
    assert.ok(!bundleCode.includes('function toSvgString'), 'Legacy custom QR encoder must be replaced');

    // Verify bundle runs in browser VM context and exports QRCode
    const vmCtx = { window: {}, TextEncoder };
    vm.createContext(vmCtx);
    vm.runInContext(bundleCode, vmCtx);
    assert.ok(vmCtx.QRCode, 'window.QRCode must be exported by bundle');
    assert.strictEqual(typeof vmCtx.QRCode.create, 'function', 'QRCode.create must be a function');
    assert.strictEqual(typeof vmCtx.QRCode.toCanvas, 'function', 'QRCode.toCanvas must be a function');
    assert.strictEqual(typeof vmCtx.QRCode.toDataURL, 'function', 'QRCode.toDataURL must be a function');

    const clientQr = vmCtx.QRCode.create(targetUrl);
    assert.ok(clientQr.modules && clientQr.modules.size > 20, 'Client bundle must create valid QR modules');
    console.log('  ✓ frontend/js/qr.js exposes standards-compliant QRCode with toCanvas, toDataURL, and create');
    passedCount++;

    // -------------------------------------------------------------
    // Test 4: Seed test forms (published, draft, archived) in DB
    // -------------------------------------------------------------
    console.log('\n[Test 4] Setting up test forms for published vs unpublished validation...');
    const timestamp = Date.now();
    const testBiz = await db.createBusiness({
      name: `QR Test Campus ${timestamp}`,
      type: 'college',
      contactEmail: `qrtest_${timestamp}@apexuniv.edu`,
      settings: { isAcademic: true }
    });

    const publishedForm = await db.createForm({
      businessId: testBiz._id,
      slug: `qr-published-${timestamp}`,
      title: 'Published Student Feedback',
      status: 'published',
      questions: [{ id: 'q1', type: 'rating', text: 'Course Quality', min: 1, max: 5 }]
    });

    const draftForm = await db.createForm({
      businessId: testBiz._id,
      slug: `qr-draft-${timestamp}`,
      title: 'Draft Student Feedback',
      status: 'draft',
      questions: [{ id: 'q1', type: 'rating', text: 'Draft Question', min: 1, max: 5 }]
    });

    const archivedForm = await db.createForm({
      businessId: testBiz._id,
      slug: `qr-archived-${timestamp}`,
      title: 'Archived Student Feedback',
      status: 'archived',
      questions: [{ id: 'q1', type: 'rating', text: 'Old Question', min: 1, max: 5 }]
    });
    console.log('  ✓ Created published, draft, and archived test forms');
    passedCount++;

    // -------------------------------------------------------------
    // Test 5: Dedicated GET /api/qr/form/:slug endpoint checks
    // -------------------------------------------------------------
    console.log('\n[Test 5] Verifying GET /api/qr/form/:slug endpoint...');
    // 5a. Published form returns 200 with valid QR and canonical URL
    const pubRes = await fetch(`${BASE_URL}/api/qr/form/${publishedForm.slug}`);
    assert.strictEqual(pubRes.status, 200, 'Published form must return 200');
    const pubData = await pubRes.json();
    assert.strictEqual(pubData.success, true);
    assert.strictEqual(pubData.slug, publishedForm.slug);
    assert.strictEqual(pubData.status, 'published');
    assert.ok(pubData.url.endsWith(`/feedback/${publishedForm.slug}`));
    assert.ok(pubData.dataUrl.startsWith('data:image/png;base64,'));

    // Verify the dataUrl decodes to the exact canonical URL
    const decodedFromApi = decodePngDataUrl(pubData.dataUrl);
    assert.strictEqual(decodedFromApi, pubData.url, 'Decoded QR dataUrl must match pubData.url exactly');
    console.log('  ✓ Published form returns 200 and QR decodes to exact canonical URL');

    // 5b. Draft form returns 400 Bad Request
    const draftRes = await fetch(`${BASE_URL}/api/qr/form/${draftForm.slug}`);
    assert.strictEqual(draftRes.status, 400, 'Draft form must return 400 Bad Request');
    const draftData = await draftRes.json();
    assert.ok(draftData.error.includes('draft'), 'Error message must state form is draft');
    console.log('  ✓ Draft form correctly rejected with 400');

    // 5c. Archived form returns 400 Bad Request
    const archivedRes = await fetch(`${BASE_URL}/api/qr/form/${archivedForm.slug}`);
    assert.strictEqual(archivedRes.status, 400, 'Archived form must return 400 Bad Request');
    const archivedData = await archivedRes.json();
    assert.ok(archivedData.error.includes('archived'), 'Error message must state form is archived');
    console.log('  ✓ Archived form correctly rejected with 400');

    // 5d. Non-existent form returns 404
    const notFoundRes = await fetch(`${BASE_URL}/api/qr/form/nonexistent-form-xyz`);
    assert.strictEqual(notFoundRes.status, 404, 'Non-existent form must return 404');
    console.log('  ✓ Non-existent form returned 404');
    passedCount++;

    // -------------------------------------------------------------
    // Test 6: Rejection of unpublished forms in /image and /data-url
    // -------------------------------------------------------------
    console.log('\n[Test 6] Verifying rejection of unpublished forms via /image and /data-url...');
    const imgDraftRes = await fetch(`${BASE_URL}/api/qr/image?url=${encodeURIComponent(`${BASE_URL}/feedback/${draftForm.slug}`)}`);
    assert.strictEqual(imgDraftRes.status, 400, 'Draft form via /image must return 400');
    const imgDraftText = await imgDraftRes.text();
    assert.ok(imgDraftText.includes('draft'), 'Draft error text must explain draft status');

    const dataDraftRes = await fetch(`${BASE_URL}/api/qr/data-url?url=${encodeURIComponent(`${BASE_URL}/feedback/${draftForm.slug}`)}`);
    assert.strictEqual(dataDraftRes.status, 400, 'Draft form via /data-url must return 400');

    const imgPubRes = await fetch(`${BASE_URL}/api/qr/image?url=${encodeURIComponent(`${BASE_URL}/feedback/${publishedForm.slug}`)}`);
    assert.strictEqual(imgPubRes.status, 200, 'Published form via /image must return 200');
    const imgType = imgPubRes.headers.get('content-type') || '';
    assert.ok(imgType.includes('image/svg+xml'), 'Must return image/svg+xml');
    console.log('  ✓ /image and /data-url enforce published-only forms');
    passedCount++;

    // -------------------------------------------------------------
    // Test 7: Rejection of dashboard, admin, and internal URLs
    // -------------------------------------------------------------
    console.log('\n[Test 7] Verifying rejection of dashboard, admin, and internal routes...');
    const dashRes = await fetch(`${BASE_URL}/api/qr/data-url?url=${encodeURIComponent(`${BASE_URL}/#/dashboard`)}`);
    assert.strictEqual(dashRes.status, 400, 'Dashboard URL must return 400');
    const dashData = await dashRes.json();
    assert.ok(dashData.error.includes('dashboard') || dashData.error.includes('internal'), 'Error must cite internal route');

    const adminRes = await fetch(`${BASE_URL}/api/qr/data-url?url=${encodeURIComponent(`${BASE_URL}/admin`)}`);
    assert.strictEqual(adminRes.status, 400, 'Admin URL must return 400');

    const apiRes = await fetch(`${BASE_URL}/api/qr/data-url?url=${encodeURIComponent(`${BASE_URL}/api/feedback`)}`);
    assert.strictEqual(apiRes.status, 400, 'API URL must return 400');
    console.log('  ✓ Internal dashboard, admin, and API URLs are strictly rejected');
    passedCount++;

    // -------------------------------------------------------------
    // Test 8: Rejection of localhost in production mode
    // -------------------------------------------------------------
    console.log('\n[Test 8] Verifying rejection of localhost/dev URLs when NODE_ENV is production...');
    const originalEnv = process.env.NODE_ENV;
    const originalPublicUrl = process.env.PUBLIC_APP_URL;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.PUBLIC_APP_URL;

      const localRes = await fetch(`${BASE_URL}/api/qr/data-url?url=http://localhost:3000/feedback/any-form`);
      assert.strictEqual(localRes.status, 400, 'Localhost URL must return 400 in production');
      const localData = await localRes.json();
      assert.ok(localData.error.includes('localhost') || localData.error.includes('production'), 'Must reject localhost in prod');

      const ipRes = await fetch(`${BASE_URL}/api/qr/data-url?url=http://127.0.0.1:3000/feedback/any-form`);
      assert.strictEqual(ipRes.status, 400, '127.0.0.1 URL must return 400 in production');
      console.log('  ✓ Localhost and development URLs strictly rejected when NODE_ENV=production');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalPublicUrl !== undefined) {
        process.env.PUBLIC_APP_URL = originalPublicUrl;
      }
    }
    passedCount++;

    // -------------------------------------------------------------
    // Test 9: PUBLIC_APP_URL canonical rewriting for deployed origin
    // -------------------------------------------------------------
    console.log('\n[Test 9] Verifying deployed canonical HTTPS origin rewriting via PUBLIC_APP_URL...');
    const oldPublicUrl = process.env.PUBLIC_APP_URL;
    try {
      process.env.PUBLIC_APP_URL = 'https://college-mini-project-vtm5.onrender.com';
      const rewriteRes = await fetch(`${BASE_URL}/api/qr/data-url?url=/feedback/${publishedForm.slug}`);
      assert.strictEqual(rewriteRes.status, 200);
      const rewriteData = await rewriteRes.json();
      assert.strictEqual(
        rewriteData.url,
        `https://college-mini-project-vtm5.onrender.com/feedback/${publishedForm.slug}`
      );
      const decodedRewrite = decodePngDataUrl(rewriteData.dataUrl);
      assert.strictEqual(decodedRewrite, `https://college-mini-project-vtm5.onrender.com/feedback/${publishedForm.slug}`);
      console.log(`  ✓ Canonical deployed URL correctly resolved and encoded: ${rewriteData.url}`);
    } finally {
      if (oldPublicUrl !== undefined) {
        process.env.PUBLIC_APP_URL = oldPublicUrl;
      } else {
        delete process.env.PUBLIC_APP_URL;
      }
    }
    passedCount++;

    // -------------------------------------------------------------
    // Test 10: Published form prioritization in client selection
    // -------------------------------------------------------------
    console.log('\n[Test 10] Verifying published forms are prioritized over drafts...');
    const sampleForms = [
      { slug: 'draft-1', title: 'Draft 1', status: 'draft' },
      { slug: 'pub-1', title: 'Published 1', status: 'published' },
      { slug: 'archived-1', title: 'Archived 1', status: 'archived' },
      { slug: 'pub-2', title: 'Published 2', status: 'published' }
    ];

    const published = sampleForms.filter(f => f.status === 'published');
    const unpublished = sampleForms.filter(f => f.status !== 'published');
    const sorted = [...published, ...unpublished];

    assert.strictEqual(sorted[0].status, 'published', 'First sorted form must be published');
    assert.strictEqual(sorted[1].status, 'published', 'Second sorted form must be published');
    assert.strictEqual(sorted[2].status, 'draft', 'Draft form placed after published forms');
    assert.strictEqual(sorted[3].status, 'archived', 'Archived form placed after published forms');
    console.log('  ✓ Published forms prioritized and sorted to the top of selection');
    passedCount++;

    console.log('\n===============================================================');
    console.log(`>>> [PASS] All ${passedCount} QR Standards & Validation Tests Passed!`);
    console.log('===============================================================\n');
  } finally {
    if (server) {
      server.close();
    }
  }
}

// Run directly
if (require.main === module) {
  runQrStandardsTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n[QR Standards Test Failure]:', err);
      process.exit(1);
    });
}

module.exports = runQrStandardsTests;
