/**
 * End-to-End College Feedback Scenario Test Suite (Priority 8)
 * Implements full 12-step verification:
 * 1. Seed college business
 * 2. Configure CSE/ECE departments, faculty, and subjects
 * 3. Create draft form
 * 4. Verify public feedback submission blocked on draft form (HTTP 403)
 * 5. Explicitly publish form
 * 6. Open public form via slug (HTTP 200)
 * 7. Submit valid feedback with department/faculty matching
 * 8. Prove negative metadata rejection (forged/mismatched faculty, invalid dept, out-of-range NPS)
 * 9. Verify inbox returns submitted feedback
 * 10. Verify analytics calculates separate star rating (5.0) and NPS (+100)
 * 11. Test database persistence
 * 12. Prove cross-business tenant isolation (HTTP 403)
 */

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');

// Enable isolated test mode in DB layer
const db = require('../src/db');
db.enableMockDb(true);
db.clearMockDb();

const app = require('../server');
const { generateToken } = require('../src/middleware/auth');

let server;
let baseUrl;

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

async function runCollegeE2EScenario() {
  console.log('\n======================================================');
  console.log('   COLLEGE FEEDBACK END-TO-END SCENARIO TEST SUITE   ');
  console.log('======================================================\n');

  // Start ephemeral server
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------
    // Step 1: Seed College Business
    // -------------------------------------------------------------
    console.log('--- Step 1: Seed College Business ---');
    const collegeBizId = new mongoose.Types.ObjectId();
    const collegeBiz = await db.createBusiness({
      _id: collegeBizId,
      name: 'Apex Institute of Technology',
      type: 'college',
      category: 'Engineering & Technology',
      email: 'dean@apextech.edu',
      logo: '🎓',
      address: {
        addressLine1: 'Campus Sector 62',
        city: 'Noida',
        state: 'Uttar Pradesh',
        postalCode: '201309',
        country: 'India'
      }
    });

    const collegeAdminUser = await db.createUser({
      _id: new mongoose.Types.ObjectId(),
      businessId: collegeBizId,
      name: 'Dean Sharma',
      email: 'dean@apextech.edu',
      password: '$2b$10$hashedpasswordfore2etestsample1234567890',
      role: 'owner'
    });
    const collegeToken = generateToken(collegeAdminUser);

    it('Step 1: College seeded successfully with valid credentials', () => {
      assert.strictEqual(collegeBiz.name, 'Apex Institute of Technology');
      assert.strictEqual(collegeBiz.type, 'college');
      assert.ok(collegeToken);
    });

    // -------------------------------------------------------------
    // Step 2: Configure Academic Configuration
    // -------------------------------------------------------------
    console.log('\n--- Step 2: Configure Academic Departments & Faculty ---');
    await db.updateBusiness(collegeBizId, {
      academicConfig: {
        departments: ['Computer Science (CSE)', 'Electronics (ECE)'],
        courses: ['B.Tech Computer Science', 'B.Tech Electronics'],
        academicYears: ['2024-2025', '2025-2026'],
        years: ['1st Year', '2nd Year', '3rd Year', '4th Year'],
        semesters: ['Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8'],
        sections: ['Section A', 'Section B'],
        feedbackCategories: ['Teaching & Delivery', 'Lab & Practical Experience', 'Infrastructure'],
        faculty: [
          { name: 'Dr. A. Sharma', department: 'Computer Science (CSE)', email: 'asharma@apextech.edu' },
          { name: 'Prof. B. Verma', department: 'Electronics (ECE)', email: 'bverma@apextech.edu' }
        ],
        subjects: [
          { name: 'Data Structures & Algorithms', code: 'CS301', department: 'Computer Science (CSE)' },
          { name: 'Digital Signal Processing', code: 'EC302', department: 'Electronics (ECE)' }
        ]
      }
    });

    it('Step 2: Business academicConfig contains CSE/ECE mappings', async () => {
      const refreshedBiz = await db.getBusinessById(collegeBizId);
      assert.strictEqual(refreshedBiz.academicConfig.departments.length, 2);
      assert.strictEqual(refreshedBiz.academicConfig.faculty.length, 2);
    });

    // -------------------------------------------------------------
    // Step 3: Create Draft Feedback Form
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Create Draft Feedback Form ---');
    const createFormRes = await fetch(`${baseUrl}/api/forms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${collegeToken}`
      },
      body: JSON.stringify({
        title: 'B.Tech CSE Semester Course Evaluation',
        slug: 'apex-cse-eval-2026',
        status: 'draft',
        formType: 'college',
        collegeFieldsConfig: {
          departmentEnabled: true,
          departmentRequired: true,
          courseEnabled: true,
          courseRequired: true,
          academicYearEnabled: true,
          academicYearRequired: true,
          yearOfStudyEnabled: true,
          yearOfStudyRequired: false,
          semesterEnabled: true,
          semesterRequired: true,
          sectionEnabled: true,
          sectionRequired: false,
          facultyEnabled: true,
          facultyRequired: true,
          subjectEnabled: true,
          subjectRequired: true,
          categoryEnabled: true,
          categoryRequired: true
        },
        questions: [
          { id: 'q_rating', type: 'rating', text: 'Concept clarity and lecture delivery', required: true, min: 1, max: 5 },
          { id: 'q_nps', type: 'nps', text: 'How likely are you to recommend this program to peers? (0-10)', required: true, min: 0, max: 10 },
          { id: 'q_comments', type: 'multiline', text: 'Suggestions for curriculum improvement' }
        ]
      })
    });

    assert.strictEqual(createFormRes.status, 201);
    const formCreated = (await createFormRes.json()).form;
    const formId = formCreated.id;
    const formSlug = formCreated.slug;

    it('Step 3: New form created with default draft status', () => {
      assert.strictEqual(formCreated.status, 'draft');
      assert.strictEqual(formCreated.title, 'B.Tech CSE Semester Course Evaluation');
    });

    // -------------------------------------------------------------
    // Step 4: Verify Public Submission Blocked on Draft Form
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Verify Public Submission Blocked on Draft Form ---');
    const draftSubmitRes = await fetch(`${baseUrl}/api/feedback/submit/${formSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Student Tester',
        academicDetails: {
          department: 'Computer Science (CSE)',
          course: 'B.Tech Computer Science',
          academicYear: '2024-2025',
          semester: 'Semester 5',
          faculty: 'Dr. A. Sharma',
          subject: 'Data Structures & Algorithms',
          category: 'Teaching & Delivery'
        },
        answers: {
          q_rating: 5,
          q_nps: 10
        }
      })
    });

    it('Step 4: Draft form rejects public feedback with HTTP 403 Forbidden', async () => {
      assert.strictEqual(draftSubmitRes.status, 403);
      const data = await draftSubmitRes.json();
      assert.ok(data.error.includes('draft'));
    });

    // -------------------------------------------------------------
    // Step 5: Explicitly Publish the Form
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Explicitly Publish Form ---');
    const publishRes = await fetch(`${baseUrl}/api/forms/${formId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${collegeToken}`
      },
      body: JSON.stringify({ status: 'published' })
    });
    assert.strictEqual(publishRes.status, 200);
    const updatedForm = (await publishRes.json()).form;

    it('Step 5: Form status successfully transitions to published', () => {
      assert.strictEqual(updatedForm.status, 'published');
    });

    // -------------------------------------------------------------
    // Step 6: Open Form via Slug
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Open Public Form via Slug ---');
    const publicGetRes = await fetch(`${baseUrl}/api/forms/slug/${formSlug}`);
    assert.strictEqual(publicGetRes.status, 200);
    const publicData = await publicGetRes.json();

    it('Step 6: Public form retrieves 200 with college branding and academicConfig', () => {
      assert.strictEqual(publicData.form.status, 'published');
      assert.strictEqual(publicData.business.name, 'Apex Institute of Technology');
      assert.ok(publicData.business.academicConfig);
    });

    // -------------------------------------------------------------
    // Step 7: Submit Valid Feedback with Matching Metadata
    // -------------------------------------------------------------
    console.log('\n--- Step 7: Submit Valid Academic Feedback ---');
    const validSubmitRes = await fetch(`${baseUrl}/api/feedback/submit/${formSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Aarav Patel',
        customerEmail: 'aarav.patel@apextech.edu',
        academicDetails: {
          department: 'Computer Science (CSE)',
          course: 'B.Tech Computer Science',
          academicYear: '2024-2025',
          semester: 'Semester 5',
          faculty: 'Dr. A. Sharma',
          subject: 'Data Structures & Algorithms',
          category: 'Teaching & Delivery'
        },
        answers: {
          q_rating: 5,
          q_nps: 10,
          q_comments: 'Outstanding pedagogy and comprehensive problem solving sessions!'
        }
      })
    });

    it('Step 7: Valid submission recorded successfully with HTTP 201 Created', async () => {
      assert.strictEqual(validSubmitRes.status, 201);
      const resJson = await validSubmitRes.json();
      assert.strictEqual(resJson.success, true);
      assert.strictEqual(resJson.rating, 5);
    });

    // -------------------------------------------------------------
    // Step 8: Prove Negative Metadata Rejection (Security & Validation)
    // -------------------------------------------------------------
    console.log('\n--- Step 8: Prove Negative Metadata Rejections ---');

    // 8a: Mismatched faculty department (Prof. B. Verma belongs to ECE, not CSE)
    const mismatchedFacRes = await fetch(`${baseUrl}/api/feedback/submit/${formSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academicDetails: {
          department: 'Computer Science (CSE)',
          course: 'B.Tech Computer Science',
          academicYear: '2024-2025',
          semester: 'Semester 5',
          faculty: 'Prof. B. Verma', // Belongs to ECE!
          subject: 'Data Structures & Algorithms',
          category: 'Teaching & Delivery'
        },
        answers: { q_rating: 5, q_nps: 9 }
      })
    });
    it('Step 8a: Rejects faculty mismatched with selected department with HTTP 400', async () => {
      assert.strictEqual(mismatchedFacRes.status, 400);
      const data = await mismatchedFacRes.json();
      assert.ok(data.error.includes('belongs to department "Electronics (ECE)"'));
    });

    // 8b: Forged department not in institution configuration
    const forgedDeptRes = await fetch(`${baseUrl}/api/feedback/submit/${formSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academicDetails: {
          department: 'Astronautics & Warp Drive (FORGED)',
          course: 'B.Tech Computer Science',
          academicYear: '2024-2025',
          semester: 'Semester 5',
          faculty: 'Dr. A. Sharma',
          subject: 'Data Structures & Algorithms',
          category: 'Teaching & Delivery'
        },
        answers: { q_rating: 5, q_nps: 9 }
      })
    });
    it('Step 8b: Rejects forged department not registered in config with HTTP 400', async () => {
      assert.strictEqual(forgedDeptRes.status, 400);
      const data = await forgedDeptRes.json();
      assert.ok(data.error.includes('Invalid department'));
    });

    // 8c: Missing required department
    const missingDeptRes = await fetch(`${baseUrl}/api/feedback/submit/${formSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academicDetails: {
          course: 'B.Tech Computer Science',
          faculty: 'Dr. A. Sharma',
          subject: 'Data Structures & Algorithms'
        },
        answers: { q_rating: 5, q_nps: 9 }
      })
    });
    it('Step 8c: Rejects missing required academic department with HTTP 400', async () => {
      assert.strictEqual(missingDeptRes.status, 400);
      const data = await missingDeptRes.json();
      assert.ok(data.error.includes('Department is required'));
    });

    // 8d: Out of range NPS score (15 on 0-10 scale)
    const invalidNpsRes = await fetch(`${baseUrl}/api/feedback/submit/${formSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academicDetails: {
          department: 'Computer Science (CSE)',
          course: 'B.Tech Computer Science',
          academicYear: '2024-2025',
          semester: 'Semester 5',
          faculty: 'Dr. A. Sharma',
          subject: 'Data Structures & Algorithms',
          category: 'Teaching & Delivery'
        },
        answers: {
          q_rating: 5,
          q_nps: 15 // Invalid!
        }
      })
    });
    it('Step 8d: Rejects out-of-range NPS score (15) with HTTP 400', async () => {
      assert.strictEqual(invalidNpsRes.status, 400);
      const data = await invalidNpsRes.json();
      assert.ok(data.error.includes('NPS score') && data.error.includes('between 0 and 10'));
    });

    // -------------------------------------------------------------
    // Step 9: Verify Feedback Inbox
    // -------------------------------------------------------------
    console.log('\n--- Step 9: Verify Feedback Inbox ---');
    const inboxRes = await fetch(`${baseUrl}/api/feedback`, {
      headers: { 'Authorization': `Bearer ${collegeToken}` }
    });
    assert.strictEqual(inboxRes.status, 200);
    const inboxData = await inboxRes.json();

    it('Step 9: Feedback Inbox retrieves submitted academic evaluation', () => {
      assert.strictEqual(inboxData.feedbacks.length, 1);
      const fb = inboxData.feedbacks[0];
      assert.strictEqual(fb.customerName, 'Aarav Patel');
      assert.strictEqual(fb.rating, 5);
      assert.strictEqual(fb.nps, 10);
      assert.strictEqual(fb.academicDetails.department, 'Computer Science (CSE)');
      assert.strictEqual(fb.academicDetails.faculty, 'Dr. A. Sharma');
    });

    // -------------------------------------------------------------
    // Step 10: Verify Ratings & NPS Analytics Separation
    // -------------------------------------------------------------
    console.log('\n--- Step 10: Verify Analytics Metrics Separation ---');
    const analyticsRes = await fetch(`${baseUrl}/api/analytics/dashboard`, {
      headers: { 'Authorization': `Bearer ${collegeToken}` }
    });
    assert.strictEqual(analyticsRes.status, 200);
    const analyticsData = await analyticsRes.json();

    it('Step 10: Dashboard reports separate average rating (5.0) and standard NPS (+100)', () => {
      assert.strictEqual(analyticsData.summary.total, 1);
      assert.strictEqual(analyticsData.summary.avgRating, '5.0');
      assert.strictEqual(analyticsData.summary.npsScore, 100);
      assert.strictEqual(analyticsData.summary.npsDetails.promoters, 1);
      assert.strictEqual(analyticsData.summary.npsDetails.detractors, 0);
      assert.strictEqual(analyticsData.sentimentCounts.positive, 1);
    });

    // -------------------------------------------------------------
    // Step 11: Test Data Persistence
    // -------------------------------------------------------------
    console.log('\n--- Step 11: Test Database Persistence ---');
    const allStored = await db.getFeedbacks({ businessId: collegeBizId });
    it('Step 11: Database layer preserves answers map and academic metadata intact', () => {
      assert.strictEqual(allStored.length, 1);
      const stored = allStored[0];
      assert.strictEqual(stored.rating, 5);
      assert.strictEqual(stored.nps, 10);
      assert.strictEqual(stored.academicDetails.subject, 'Data Structures & Algorithms');
    });

    // -------------------------------------------------------------
    // Step 12: Test Cross-Business Tenant Isolation
    // -------------------------------------------------------------
    console.log('\n--- Step 12: Test Cross-Business Tenant Isolation ---');
    const bizB_Id = new mongoose.Types.ObjectId();
    await db.createBusiness({
      _id: bizB_Id,
      name: 'Downtown Gourmet Cafe',
      type: 'restaurant'
    });
    const userB = await db.createUser({
      _id: new mongoose.Types.ObjectId(),
      businessId: bizB_Id,
      name: 'Chef Mario',
      email: 'mario@downtowncafe.com',
      password: '$2b$10$hashedpasswordfore2etestsample1234567890',
      role: 'owner'
    });
    const tokenB = generateToken(userB);

    // User B tries to view Apex College Form
    const crossViewRes = await fetch(`${baseUrl}/api/forms/${formId}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    it('Step 12a: Cross-business form view blocked with HTTP 403 Forbidden', async () => {
      assert.strictEqual(crossViewRes.status, 403);
      const data = await crossViewRes.json();
      assert.ok(data.error.includes('Cross-tenant'));
    });

    // User B tries to update Apex College Form
    const crossUpdateRes = await fetch(`${baseUrl}/api/forms/${formId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({ title: 'Hacked Title' })
    });
    it('Step 12b: Cross-business form modification blocked with HTTP 403 Forbidden', async () => {
      assert.strictEqual(crossUpdateRes.status, 403);
      const data = await crossUpdateRes.json();
      assert.ok(data.error.includes('Cross-tenant'));
    });

    // User B queries inbox: must see ZERO feedbacks from Apex College
    const inboxB_Res = await fetch(`${baseUrl}/api/feedback`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(inboxB_Res.status, 200);
    const inboxB_Data = await inboxB_Res.json();
    it('Step 12c: Tenant data strictly scoped; User B receives empty feedback list', () => {
      assert.strictEqual(inboxB_Data.feedbacks.length, 0);
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n======================================================');
  console.log(`   TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)   `);
  console.log('======================================================\n');

  if (failedTests > 0) process.exit(1);
}

runCollegeE2EScenario();
