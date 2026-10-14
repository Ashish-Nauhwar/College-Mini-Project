/**
 * Database Seeding Script
 * Usage: node backend/scripts/seed.js
 * 
 * SAFETY POLICY (Phase 4):
 * 1. Seeding is NON-DESTRUCTIVE by default using deterministic upserts.
 * 2. Unrelated existing businesses, users, forms, and feedbacks are strictly preserved.
 * 3. Existing user passwords are NEVER overwritten without explicit authorization.
 * 4. Destructive operations strictly require ALLOW_DESTRUCTIVE_SEED=true AND
 *    a database name containing verified development/testing keywords.
 * 5. Target database name and operation mode are printed before any modification.
 */

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const dns = require('dns');

// Load environment configuration first
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// DNS server fallback for development when explicitly opted in
if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_FALLBACK_DNS === 'true') {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch (e) {
    // Ignore in restricted environments
  }
}

const { Business, User, Location, FeedbackForm, Feedback, AuditLog } = require('../src/models');
const { hashPassword } = require('../src/utils/crypto');

/**
 * Returns the list of standard demo accounts for development and testing.
 * Strictly NEVER includes any super-admin accounts.
 */
function getDemoUsers() {
  return [
    { email: 'sarah@apexinstitute.edu.in', name: 'Dr. Sarah Jenkins', role: 'owner', avatar: '👩‍🏫', businessType: 'college' },
    { email: 'dean@apexinstitute.edu.in', name: 'Prof. Anil Gupta', role: 'college_admin', avatar: '👨‍🏫', businessType: 'college' },
    { email: 'staff@apexinstitute.edu.in', name: 'Rita Roy', role: 'staff', avatar: '👩‍💼', businessType: 'college' },
    { email: 'sarah@apexcafe.com', name: 'Sarah Jenkins', role: 'owner', avatar: '👩‍💼', businessType: 'restaurant' },
    { email: 'marcus@apexcafe.com', name: 'Marcus Vance', role: 'manager', avatar: '👨‍💼', businessType: 'restaurant' }
  ];
}

/**
 * Validates that a database name is explicitly and unmistakably disposable.
 * Rejects production, live, master, or unrecognized database names.
 * 
 * @param {string} dbName 
 * @returns {boolean}
 */
function isDisposableDatabase(dbName) {
  if (!dbName || typeof dbName !== 'string') return false;
  const name = dbName.toLowerCase().trim();

  // Strictly forbid any production, live, or master database
  if (/prod|production|live|master|main/i.test(name)) {
    return false;
  }

  // Must match explicit disposable, dev, or test keywords
  return /test|dev|development|disposable|local|temp/i.test(name);
}

function extractDbNameFromUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    const clean = uri.replace(/^mongodb(\+srv)?:\/\//, 'http://');
    const parsed = new URL(clean);
    return parsed.pathname ? parsed.pathname.replace(/^\//, '').split('?')[0] : '';
  } catch (err) {
    return '';
  }
}

async function seed(options = {}) {
  // PRIORITY 1: Strictly refuse to execute demo seeding in production or unspecified environments
  const currentEnv = process.env.NODE_ENV;
  if (currentEnv === 'production') {
    const err = '[SAFETY REFUSAL] Demo seed script is strictly forbidden in production mode (NODE_ENV=production). Use the secure bootstrap-superadmin CLI tool to provision initial administrative accounts.';
    console.error(err);
    if (require.main === module) process.exit(1);
    throw new Error(err);
  }

  if (!['development', 'test'].includes(currentEnv)) {
    const err = `[SAFETY REFUSAL] Demo seed script requires an explicitly configured development or test environment (NODE_ENV='development' or 'test'). Detected NODE_ENV='${currentEnv || 'unspecified'}'. Refusing to seed default demo accounts in unspecified environments.`;
    console.error(err);
    if (require.main === module) process.exit(1);
    throw new Error(err);
  }

  // Support isolated in-memory mock seeding for behavioral unit tests without hitting network/Atlas
  if (options.useMockDb || options.skipConnect) {
    const db = require('../src/db');
    const demoUsers = getDemoUsers();
    const defaultBizId = options.mockBusinessId || new mongoose.Types.ObjectId().toString();
    for (const u of demoUsers) {
      await db.createUser({
        name: u.name,
        email: u.email.toLowerCase(),
        password: 'Hash@Password123',
        role: u.role,
        businessId: defaultBizId,
        avatar: u.avatar
      });
    }
    return {
      success: true,
      dbName: 'mock_memory_db',
      operation: 'MOCK_SEEDED',
      usersCount: demoUsers.length
    };
  }

  // Precedence: explicit options.uri -> MONGODB_URI (never silently choose TEST_MONGODB_URI for ordinary seeding)
  const uri = options.uri || process.env.MONGODB_URI;
  const allowDestructive = options.allowDestructive !== undefined
    ? Boolean(options.allowDestructive)
    : process.env.ALLOW_DESTRUCTIVE_SEED === 'true';
  const shouldClose = options.closeConnection !== undefined ? options.closeConnection : true;

  if (!uri || uri.includes('<username>') || uri.includes('<password>')) {
    console.error('[Error] Valid MongoDB URI is not set in backend/.env');
    if (require.main === module) process.exit(1);
    throw new Error('Valid MongoDB URI is not configured');
  }

  // Pre-connection safety check on URI database name
  const uriDbName = extractDbNameFromUri(uri);
  if (allowDestructive && uriDbName && !isDisposableDatabase(uriDbName)) {
    const err = `[SAFETY REFUSAL] Destructive seeding rejected. Target database "${uriDbName}" is NOT verified as a disposable development or test database. Destructive operations require BOTH ALLOW_DESTRUCTIVE_SEED=true AND a database name containing 'test', 'dev', or 'local'.`;
    console.error(err);
    if (require.main === module) process.exit(1);
    throw new Error(err);
  }

  if (mongoose.connection.readyState === 0) {
    console.log('[Connecting] Connecting to database...');
    await mongoose.connect(uri);
  }

  const dbName = mongoose.connection.name || uriDbName || '';
  console.log(`[Target Database] "${dbName}"`);

  let operationMode = 'NON-DESTRUCTIVE DETERMINISTIC UPSERT';

  if (allowDestructive) {
    if (!isDisposableDatabase(dbName)) {
      const err = `[SAFETY REFUSAL] Destructive seeding rejected. Target database "${dbName}" is NOT verified as a disposable development or test database. Destructive operations require BOTH ALLOW_DESTRUCTIVE_SEED=true AND a database name containing 'test', 'dev', or 'local'.`;
      console.error(err);
      if (shouldClose) await mongoose.connection.close();
      if (require.main === module) process.exit(1);
      throw new Error(err);
    }

    operationMode = 'DESTRUCTIVE SEEDING (Clearing collections)';
    console.log(`[Operation] ${operationMode}`);

    // Destructive clearance (allowed ONLY because DB is verified disposable AND flag is set)
    await Promise.all([
      Business.deleteMany({}),
      User.deleteMany({}),
      Location.deleteMany({}),
      FeedbackForm.deleteMany({}),
      Feedback.deleteMany({}),
      AuditLog.deleteMany({})
    ]);
  } else {
    console.log(`[Operation] ${operationMode}`);
    console.log('Preserving all unrelated businesses, users, passwords, forms, and responses.');
  }

  // 1. College Business (Deterministic Upsert)
  let collegeBiz = await Business.findOne({ email: 'admin@apexinstitute.edu.in' });
  if (!collegeBiz) {
    collegeBiz = await Business.create({
      name: 'Apex Institute of Engineering & Technology',
      type: 'college',
      category: 'Engineering & Technology College',
      email: 'admin@apexinstitute.edu.in',
      phone: '+91 98765 43210',
      address: {
        addressLine1: 'Campus Green, Sector 62',
        addressLine2: 'Knowledge Park III',
        city: 'Noida',
        state: 'Uttar Pradesh',
        postalCode: '201301',
        country: 'India'
      },
      logo: '🎓',
      googleReviewUrl: 'https://g.page/r/demo-apex-college/review',
      active: true,
      academicConfig: {
        departments: ['Computer Science (CSE)', 'Electronics & Comm (ECE)', 'Mechanical Engineering', 'Information Technology', 'Civil Engineering'],
        courses: ['B.Tech', 'M.Tech', 'BCA', 'MCA'],
        years: ['1st Year', '2nd Year', '3rd Year', '4th Year'],
        semesters: ['Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8'],
        sections: ['Section A', 'Section B', 'Section C'],
        academicYears: ['2024-2025', '2025-2026', '2026-2027'],
        feedbackCategories: ['teaching', 'laboratory', 'facilities', 'library', 'administration'],
        faculty: [
          { name: 'Dr. Ramesh Sharma', department: 'Computer Science (CSE)', email: 'ramesh.sharma@apexinstitute.edu.in' },
          { name: 'Prof. Priya Verma', department: 'Computer Science (CSE)', email: 'priya.verma@apexinstitute.edu.in' },
          { name: 'Dr. Anil Kapoor', department: 'Electronics & Comm (ECE)', email: 'anil.kapoor@apexinstitute.edu.in' }
        ],
        subjects: [
          { name: 'Data Structures & Algorithms', code: 'CS301', department: 'Computer Science (CSE)' },
          { name: 'Operating Systems', code: 'CS402', department: 'Computer Science (CSE)' },
          { name: 'Digital Signal Processing', code: 'EC401', department: 'Electronics & Comm (ECE)' }
        ]
      }
    });
  }

  // 2. Restaurant Business (Deterministic Upsert)
  let cafeBiz = await Business.findOne({ email: 'sarah@apexcafe.com' });
  if (!cafeBiz) {
    cafeBiz = await Business.create({
      name: 'Apex Specialty Coffee & Roasters',
      type: 'restaurant',
      category: 'Cafe & Restaurant',
      email: 'sarah@apexcafe.com',
      phone: '+1 (555) 234-5678',
      address: {
        addressLine1: '104 Market Street',
        city: 'Downtown Arts District',
        state: 'California',
        postalCode: '90013',
        country: 'USA'
      },
      logo: '☕',
      googleReviewUrl: 'https://g.page/r/demo-apex-coffee/review',
      active: true
    });
  }

  // 3. Locations (Deterministic Upsert)
  let collegeMainCampus = await Location.findOne({ businessId: collegeBiz._id, name: 'Main Academic Campus' });
  if (!collegeMainCampus) {
    collegeMainCampus = await Location.create({
      businessId: collegeBiz._id,
      name: 'Main Academic Campus',
      code: 'CAMPUS-01',
      address: 'Campus Green, Knowledge Park III, Greater Noida',
      phone: '+91 98765 43210',
      manager: 'Dean Academic Affairs',
      active: true
    });
  }

  let cafeDowntownLoc = await Location.findOne({ businessId: cafeBiz._id, name: 'Downtown Flagship' });
  if (!cafeDowntownLoc) {
    cafeDowntownLoc = await Location.create({
      businessId: cafeBiz._id,
      name: 'Downtown Flagship',
      code: 'DT-01',
      address: '104 Market Street, Downtown',
      phone: '+1 (555) 234-5678',
      manager: 'Marcus Vance',
      active: true
    });
  }

  // 4. Users (Deterministic Upsert - NEVER overwrite existing passwords!)
  const passwordHash = await hashPassword('Password@123');

  const demoUsers = [
    { email: 'sarah@apexinstitute.edu.in', name: 'Dr. Sarah Jenkins', role: 'owner', businessId: collegeBiz._id, avatar: '👩‍🏫', defaultHash: passwordHash },
    { email: 'dean@apexinstitute.edu.in', name: 'Prof. Anil Gupta', role: 'college_admin', businessId: collegeBiz._id, avatar: '👨‍🏫', defaultHash: passwordHash },
    { email: 'staff@apexinstitute.edu.in', name: 'Rita Roy', role: 'staff', businessId: collegeBiz._id, avatar: '👩‍💼', defaultHash: passwordHash },
    { email: 'sarah@apexcafe.com', name: 'Sarah Jenkins', role: 'owner', businessId: cafeBiz._id, avatar: '👩‍💼', defaultHash: passwordHash },
    { email: 'marcus@apexcafe.com', name: 'Marcus Vance', role: 'manager', businessId: cafeBiz._id, avatar: '👨‍💼', defaultHash: passwordHash }
  ];

  for (const u of demoUsers) {
    const existingUser = await User.findOne({ email: u.email.toLowerCase() });
    if (!existingUser) {
      await User.create({
        email: u.email.toLowerCase(),
        name: u.name,
        password: u.defaultHash,
        role: u.role,
        businessId: u.businessId,
        avatar: u.avatar
      });
    }
  }

  // 5. Feedback Forms (Deterministic Upsert by slug)
  let collegeAcademicForm = await FeedbackForm.findOne({ slug: 'apex-college-academic' });
  if (!collegeAcademicForm) {
    collegeAcademicForm = await FeedbackForm.create({
      businessId: collegeBiz._id,
      locationId: collegeMainCampus._id,
      slug: 'apex-college-academic',
      title: 'Student Academic & Teaching Evaluation',
      description: 'Help us maintain excellence in education. Your honest feedback guides continuous syllabus and pedagogy improvements.',
      formType: 'college',
      status: 'published',
      allowAnonymous: true,
      googleReviewUrl: 'https://g.page/r/demo-apex-college/review',
      collegeFieldsConfig: {
        departmentEnabled: true,
        departmentRequired: true,
        courseEnabled: true,
        courseRequired: true,
        academicYearEnabled: true,
        academicYearRequired: true,
        yearOfStudyEnabled: true,
        yearOfStudyRequired: true,
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
        {
          id: 'q_academic_clarity',
          type: 'rating',
          text: 'Clarity of concepts explained and lecture preparation by faculty:',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_syllabus_coverage',
          type: 'rating',
          text: 'Pace of syllabus coverage and timely completion of course units:',
          required: true,
          min: 1,
          max: 5,
          order: 2
        },
        {
          id: 'q_practical_guidance',
          type: 'rating',
          text: 'Laboratory demonstration and hands-on practical assistance:',
          required: false,
          min: 1,
          max: 5,
          order: 3
        },
        {
          id: 'q_doubt_solving',
          type: 'choice',
          text: 'Are doubts and student queries addressed constructively during or after class?',
          options: ['Always addressed thoroughly', 'Addressed mostly', 'Occasionally addressed', 'Rarely or never'],
          required: true,
          order: 4
        },
        {
          id: 'q_college_nps',
          type: 'nps',
          text: 'How likely are you to recommend Apex Institute to aspiring engineering students? (0-10)',
          required: true,
          min: 0,
          max: 10,
          order: 5
        },
        {
          id: 'q_department_feedback',
          type: 'multiline',
          text: 'Specific suggestions for departmental workshops, curriculum enhancements, or lab equipment:',
          required: false,
          placeholder: 'Share your thoughts on lab machines, software tools, library books, or seminar topics...',
          order: 6
        }
      ]
    });
  }

  let cafeForm = await FeedbackForm.findOne({ slug: 'apex-downtown' });
  if (!cafeForm) {
    cafeForm = await FeedbackForm.create({
      businessId: cafeBiz._id,
      locationId: cafeDowntownLoc._id,
      slug: 'apex-downtown',
      title: 'Downtown Flagship Customer Experience',
      description: 'Thank you for visiting Apex Specialty Coffee! We value your honest thoughts to help us brew your day better.',
      formType: 'restaurant',
      status: 'published',
      allowAnonymous: true,
      googleReviewUrl: 'https://g.page/r/demo-apex-coffee/review',
      questions: [
        {
          id: 'q_cafe_rating',
          type: 'rating',
          text: 'How would you rate your overall experience today?',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_cafe_nps',
          type: 'nps',
          text: 'How likely are you to recommend Apex Coffee to a friend or colleague?',
          required: true,
          min: 0,
          max: 10,
          order: 2
        },
        {
          id: 'q_cafe_order',
          type: 'choice',
          text: 'What did you order today?',
          options: [
            'Hand-poured Single Origin Coffee',
            'Signature Espresso / Flat White',
            'Fresh Bakery & Artisanal Pastry',
            'Bag of Whole Bean Coffee to go'
          ],
          required: false,
          order: 3
        },
        {
          id: 'q_cafe_hospitality',
          type: 'yesno',
          text: 'Was your order served promptly and with friendly hospitality?',
          required: false,
          order: 4
        },
        {
          id: 'q_cafe_comments',
          type: 'multiline',
          text: 'What did you love most or how can we improve?',
          required: false,
          placeholder: 'Tell us about the coffee, service, seating, or music...',
          order: 5
        }
      ]
    });
  }

  // 6. Feedbacks (Insert demo responses if none exist for demo forms)
  const existingCollegeFeedbacks = await Feedback.countDocuments({ formId: collegeAcademicForm._id });
  if (existingCollegeFeedbacks === 0) {
    await Feedback.create([
      {
        businessId: collegeBiz._id,
        formId: collegeAcademicForm._id,
        locationId: collegeMainCampus._id,
        rating: 5,
        nps: 10,
        sentiment: 'positive',
        status: 'resolved',
        priority: 'low',
        customerName: 'Aarav Patel',
        customerEmail: 'aarav.cse@gmail.com',
        academicDetails: {
          department: 'Computer Science (CSE)',
          course: 'B.Tech',
          academicYear: '2026-2027',
          yearOfStudy: '3rd Year',
          semester: 'Semester 5',
          section: 'Section A',
          faculty: 'Dr. Ramesh Sharma',
          subject: 'Data Structures & Algorithms',
          category: 'teaching'
        },
        answers: new Map([
          ['q_academic_clarity', 5],
          ['q_syllabus_coverage', 5],
          ['q_doubt_solving', 'Always addressed thoroughly'],
          ['q_college_nps', 10],
          ['q_department_feedback', 'Dr. Sharma explains complex tree and graph traversal algorithms with outstanding practical live coding examples!']
        ]),
        comments: 'Outstanding pedagogy and helpful lab assistants.',
        source: 'QR Code'
      },
      {
        businessId: collegeBiz._id,
        formId: collegeAcademicForm._id,
        locationId: collegeMainCampus._id,
        rating: 2,
        nps: 4,
        sentiment: 'negative',
        status: 'in_review',
        priority: 'urgent',
        customerName: 'Anonymous Student',
        academicDetails: {
          department: 'Electronics & Comm (ECE)',
          course: 'B.Tech',
          academicYear: '2026-2027',
          yearOfStudy: '2nd Year',
          semester: 'Semester 3',
          faculty: 'Dr. Anil Kapoor',
          subject: 'Digital Signal Processing',
          category: 'laboratory'
        },
        answers: new Map([
          ['q_academic_clarity', 2],
          ['q_syllabus_coverage', 3],
          ['q_doubt_solving', 'Occasionally addressed'],
          ['q_college_nps', 4],
          ['q_department_feedback', 'Lab oscilloscope equipment in Room 204 has calibration faults. Please inspect.']
        ]),
        comments: 'Lab equipment needs urgent calibration for signal testing.',
        assignedTo: 'Dean Academic Affairs',
        internalNotes: [
          {
            text: 'Lab technician requested to inspect oscilloscope calibration in Room 204.',
            author: 'Dean Academic Affairs',
            createdAt: new Date()
          }
        ],
        source: 'QR Code'
      }
    ]);
  }

  const existingCafeFeedbacks = await Feedback.countDocuments({ formId: cafeForm._id });
  if (existingCafeFeedbacks === 0) {
    await Feedback.create([
      {
        businessId: cafeBiz._id,
        formId: cafeForm._id,
        locationId: cafeDowntownLoc._id,
        rating: 5,
        nps: 10,
        sentiment: 'positive',
        status: 'new',
        priority: 'low',
        customerName: 'Emily Watson',
        customerEmail: 'emily.w@example.com',
        answers: new Map([
          ['q_cafe_rating', 5],
          ['q_cafe_nps', 10],
          ['q_cafe_order', 'Hand-poured Single Origin Coffee'],
          ['q_cafe_hospitality', 'Yes'],
          ['q_cafe_comments', 'The Ethiopian pour-over had incredible floral notes. Great study spot!']
        ]),
        comments: 'The Ethiopian pour-over was fantastic.',
        source: 'QR Code'
      }
    ]);
  }

  // 7. Seed Initial Audit Log
  await AuditLog.create({
    action: 'Database Seeding Executed',
    actor: 'System Seeder',
    details: `Executed seeding in mode: ${operationMode} on database "${dbName}"`,
    createdAt: new Date()
  });

  console.log(`[Success] Seeding completed safely on database "${dbName}".\n`);

  if (shouldClose) {
    await mongoose.connection.close();
  }

  return {
    success: true,
    dbName,
    operation: operationMode
  };
}

if (require.main === module) {
  seed().catch(err => {
    console.error('[Seed Error]:', err.message);
    process.exit(1);
  });
}

module.exports = {
  seed,
  isDisposableDatabase,
  getDemoUsers
};
