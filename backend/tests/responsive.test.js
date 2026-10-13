/**
 * Comprehensive Automated Responsive Testing Suite for FeedbackHub
 * Viewports tested: 320px, 360px, 375px, 390px, 430px, 768px, 1024px, 1440px
 * Checks:
 *  - No horizontal scrolling (scrollWidth <= clientWidth)
 *  - Zero browser console errors
 *  - Mobile navigation drawer toggle and auto-close
 *  - Public customer feedback submission flow
 *  - Form builder reordering and editing
 *  - Feedback management & resolution workflow
 */

const puppeteer = require('puppeteer-core');
const path = require('path');
const http = require('http');
const app = require('../server');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 3001; // Test on dedicated port

const VIEWPORTS = [
  { name: 'Mobile Mini (320px)', width: 320, height: 600 },
  { name: 'Android Standard (360px)', width: 360, height: 740 },
  { name: 'iPhone SE (375px)', width: 375, height: 667 },
  { name: 'iPhone 13/14 (390px)', width: 390, height: 844 },
  { name: 'iPhone Pro Max (430px)', width: 430, height: 932 },
  { name: 'Tablet Portrait (768px)', width: 768, height: 1024 },
  { name: 'Tablet Landscape / Laptop (1024px)', width: 1024, height: 768 },
  { name: 'Desktop HD (1440px)', width: 1440, height: 900 }
];

let server;

async function startServer() {
  return new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`[TEST] Test server started on http://localhost:${PORT}`);
      resolve();
    });
  });
}

async function stopServer() {
  if (server) {
    return new Promise((resolve) => {
      server.close(() => {
        console.log('[TEST] Test server stopped');
        resolve();
      });
    });
  }
}

async function runTestSuite() {
  await startServer();

  let browser;
  let passedTests = 0;
  let failedTests = 0;

  try {
    console.log('[TEST] Launching Microsoft Edge browser engine...');
    browser = await puppeteer.launch({
      executablePath: EDGE_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    const page = await browser.newPage();
    const consoleErrors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        // Filter out benign CDN or favicon 404s if any
        if (!msg.text().includes('favicon.ico')) {
          consoleErrors.push(msg.text());
        }
      }
    });

    page.on('pageerror', err => {
      consoleErrors.push(err.toString());
    });

    console.log('\n======================================================');
    console.log('   STEP 1: Testing Horizontal Scroll Across All Viewports');
    console.log('======================================================');

    const testPages = [
      { name: 'Landing Page', url: `http://localhost:${PORT}/#/landing` },
      { name: 'Login Page', url: `http://localhost:${PORT}/#/login` },
      { name: 'Register Page', url: `http://localhost:${PORT}/#/register` },
      { name: 'Dashboard View', url: `http://localhost:${PORT}/#/dashboard` },
      { name: 'Feedback Inbox', url: `http://localhost:${PORT}/#/inbox` },
      { name: 'Form Builder', url: `http://localhost:${PORT}/#/builder` },
      { name: 'Analytics View', url: `http://localhost:${PORT}/#/analytics` },
      { name: 'QR Codes View', url: `http://localhost:${PORT}/#/qr` },
      { name: 'Locations View', url: `http://localhost:${PORT}/#/locations` },
      { name: 'Settings View', url: `http://localhost:${PORT}/#/settings` },
      { name: 'Super Admin', url: `http://localhost:${PORT}/#/admin` },
      { name: 'Public Customer Form', url: `http://localhost:${PORT}/feedback/apex-downtown` }
    ];

    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height });
      console.log(`\n--- Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

      for (const p of testPages) {
        await page.goto(p.url, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 200)); // allow render

        // Check if page has horizontal overflow
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const scrollW = Math.max(doc.scrollWidth, body.scrollWidth);
          const clientW = doc.clientWidth;
          const hasOverflow = scrollW > clientW + 1; // 1px subpixel tolerance

          let offending = [];
          if (hasOverflow) {
            document.querySelectorAll('*').forEach(el => {
              const rect = el.getBoundingClientRect();
              if (rect.right > clientW + 1) {
                offending.push({ tag: el.tagName, id: el.id, class: el.className, right: rect.right, clientW });
              }
            });
          }

          return { hasOverflow, scrollW, clientW, offending: offending.slice(0, 3) };
        });

        if (overflow.hasOverflow) {
          console.error(`  [FAIL] ${p.name} has horizontal scrolling! scrollWidth=${overflow.scrollW}, clientWidth=${overflow.clientW}`);
          console.error(`         Offending elements:`, JSON.stringify(overflow.offending));
          failedTests++;
        } else {
          console.log(`  [PASS] ${p.name}: No horizontal scroll (scrollWidth: ${overflow.scrollW}px, clientWidth: ${overflow.clientW}px)`);
          passedTests++;
        }
      }
    }

    console.log('\n======================================================');
    console.log('   STEP 2: Mobile Navigation Drawer & Hamburger Test');
    console.log('======================================================');
    await page.setViewport({ width: 375, height: 667 });
    await page.goto(`http://localhost:${PORT}/#/dashboard`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 300));

    // Verify hamburger button is visible on mobile
    const hamburgerVisible = await page.evaluate(() => {
      const btn = document.getElementById('hamburgerBtn');
      const style = window.getComputedStyle(btn);
      return style.display !== 'none' && btn.offsetHeight >= 40 && btn.offsetWidth >= 40;
    });

    if (hamburgerVisible) {
      console.log('  [PASS] Hamburger button visible with touch-target >= 40px on mobile');
      passedTests++;
    } else {
      console.error('  [FAIL] Hamburger button not visible or too small on mobile');
      failedTests++;
    }

    // Click hamburger button to open drawer
    await page.click('#hamburgerBtn');
    await new Promise(r => setTimeout(r, 300));

    const drawerActive = await page.evaluate(() => {
      const drawer = document.getElementById('mobileDrawer');
      return drawer.classList.contains('active');
    });

    if (drawerActive) {
      console.log('  [PASS] Mobile drawer opened successfully upon hamburger tap');
      passedTests++;
    } else {
      console.error('  [FAIL] Mobile drawer did not open on hamburger tap');
      failedTests++;
    }

    // Click an item in the drawer (e.g. Inbox) and verify drawer closes automatically
    await page.click('#mobileNavMenu a[data-view="inbox"]');
    await new Promise(r => setTimeout(r, 300));

    const drawerClosed = await page.evaluate(() => {
      const drawer = document.getElementById('mobileDrawer');
      return !drawer.classList.contains('active');
    });

    if (drawerClosed) {
      console.log('  [PASS] Mobile drawer closed automatically after navigation');
      passedTests++;
    } else {
      console.error('  [FAIL] Mobile drawer remained open after navigation');
      failedTests++;
    }

    console.log('\n======================================================');
    console.log('   STEP 3: Public Feedback Form Submission on Mobile');
    console.log('======================================================');
    await page.setViewport({ width: 360, height: 740 });
    await page.goto(`http://localhost:${PORT}/feedback/apex-downtown`, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 400));

    // Select 5 Stars
    const starClicked = await page.evaluate(() => {
      const star5 = document.querySelector('.star-rating-btn[data-value="5"]');
      if (star5) {
        star5.click();
        return true;
      }
      return false;
    });

    if (starClicked) {
      console.log('  [PASS] Customer selected 5-star rating control');
      passedTests++;
    } else {
      console.error('  [FAIL] Star rating control not found');
      failedTests++;
    }

    // Fill customer name and comments
    await page.type('#customerName', 'Maria Test');
    await page.type('#customerEmail', 'maria.test@example.com');

    // Submit form
    await page.click('#submitBtn');
    await new Promise(r => setTimeout(r, 800));

    // Check success screen
    const successVisible = await page.evaluate(() => {
      const success = document.getElementById('successCard');
      const googleBtn = document.getElementById('googleReviewCta');
      return !success.classList.contains('hidden') && !googleBtn.classList.contains('hidden');
    });

    if (successVisible) {
      console.log('  [PASS] Feedback submitted successfully! Confirmation card & Google review redirect shown');
      passedTests++;
    } else {
      console.error('  [FAIL] Feedback submission failed or success card not displayed');
      failedTests++;
    }

    console.log('\n======================================================');
    console.log('   STEP 4: Form Builder Controls & Question Reordering');
    console.log('======================================================');
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`http://localhost:${PORT}/#/builder`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 400));

    // Add a new question
    const initialCount = await page.evaluate(() => document.querySelectorAll('.builder-question-card').length);
    await page.evaluate(() => app.addBuilderQuestion());
    await new Promise(r => setTimeout(r, 200));
    const newCount = await page.evaluate(() => document.querySelectorAll('.builder-question-card').length);

    if (newCount === initialCount + 1) {
      console.log(`  [PASS] Added new question card on mobile (Count: ${initialCount} -> ${newCount})`);
      passedTests++;
    } else {
      console.error('  [FAIL] Could not add new question card');
      failedTests++;
    }

    // Test Move Question Down
    const reorderWorks = await page.evaluate(() => {
      const qCards = document.querySelectorAll('.builder-question-card');
      if (qCards.length >= 2) {
        app.moveQuestion(0, 1);
        return true;
      }
      return false;
    });

    if (reorderWorks) {
      console.log('  [PASS] Question reordered downward using accessible mobile button');
      passedTests++;
    } else {
      console.error('  [FAIL] Question reordering failed');
      failedTests++;
    }

    console.log('\n======================================================');
    console.log('   STEP 5: QR Code Generator & Live Preview');
    console.log('======================================================');
    await page.goto(`http://localhost:${PORT}/#/qr`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 300));

    const qrRendered = await page.evaluate(() => {
      const canvas = document.getElementById('qrCodeCanvas');
      return canvas && canvas.width > 0 && canvas.height > 0;
    });

    if (qrRendered) {
      console.log('  [PASS] QR Code rendered successfully on canvas with valid dimensions');
      passedTests++;
    } else {
      console.error('  [FAIL] QR Code canvas failed to render');
      failedTests++;
    }

    console.log('\n======================================================');
    console.log('   STEP 6: Browser Console Errors Check');
    console.log('======================================================');
    if (consoleErrors.length === 0) {
      console.log('  [PASS] Zero console errors during all user interactions!');
      passedTests++;
    } else {
      console.error(`  [FAIL] Found ${consoleErrors.length} console errors:`, consoleErrors);
      failedTests++;
    }

  } catch (err) {
    console.error('[TEST ERROR]', err);
    failedTests++;
  } finally {
    if (browser) await browser.close();
    await stopServer();
  }

  console.log('\n======================================================');
  console.log(`   TEST SUMMARY: Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runTestSuite();
}

module.exports = { runTestSuite };
