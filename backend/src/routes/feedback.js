const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Helper to strictly validate calendar dates (rejects Feb 31, Apr 31, invalid leaps, etc.)
function isValidCalendarDate(str) {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;

  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  if (month === 2 && isLeap) {
    daysInMonth[2] = 29;
  }

  if (day < 1 || day > daysInMonth[month]) return false;

  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

// Helper to evaluate conditional visibility on the server
function isQuestionVisible(q, answers, questionsMap) {
  if (!q.conditional || !q.conditional.dependsOn) return true;

  // Check parent visibility if graph map provided
  if (questionsMap && questionsMap.has(q.conditional.dependsOn)) {
    const parentQ = questionsMap.get(q.conditional.dependsOn);
    if (!isQuestionVisible(parentQ, answers, questionsMap)) {
      return false;
    }
  }

  const parentValue = answers[q.conditional.dependsOn];
  const target = q.conditional.value;
  const op = q.conditional.operator || 'equals';

  if (parentValue === undefined || parentValue === null) return false;

  switch (op) {
    case 'equals':
      return String(parentValue).trim() === String(target).trim();
    case 'not_equals':
      return String(parentValue).trim() !== String(target).trim();
    case 'in':
      if (Array.isArray(target)) {
        return target.some(t => String(t).trim() === String(parentValue).trim());
      }
      return false;
    case 'greater_than': {
      const p = Number(parentValue);
      const t = Number(target);
      return Number.isFinite(p) && Number.isFinite(t) && p > t;
    }
    case 'less_than': {
      const p = Number(parentValue);
      const t = Number(target);
      return Number.isFinite(p) && Number.isFinite(t) && p < t;
    }
    case 'contains':
      if (Array.isArray(parentValue)) {
        return parentValue.some(item => String(item).toLowerCase().includes(String(target).toLowerCase()));
      }
      return String(parentValue).toLowerCase().includes(String(target).toLowerCase());
    default:
      return true;
  }
}

// POST /api/feedback/submit/:slug or /api/feedback/submit (PUBLIC ENDPOINT)
async function handleSubmit(req, res) {
  try {
    const slug = req.params.slug;
    const {
      formId,
      rating,
      nps,
      customerName,
      customerEmail,
      customerPhone,
      comments,
      academicDetails,
      answers = {},
      source
    } = req.body;

    let form = null;
    if (slug) {
      form = await db.getFormBySlug(slug);
    } else if (formId) {
      form = await db.getFormById(formId);
    }

    if (!form) {
      return res.status(404).json({ error: 'Feedback form not found' });
    }

    // Form lifecycle check
    if (form.status !== 'published') {
      return res.status(403).json({
        error: `This feedback form is currently ${form.status} and is not accepting responses.`
      });
    }

    // SERVER-SIDE VALIDATION: Validate every configured question
    const sanitizedAnswers = {};

    for (const q of form.questions || []) {
      const isVisible = isQuestionVisible(q, answers);
      if (!isVisible) {
        // If question condition is not met, do not enforce or store invalid dependencies
        continue;
      }

      const answerVal = answers[q.id];

      // Required check
      if (q.required) {
        if (answerVal === undefined || answerVal === null || answerVal === '' || (Array.isArray(answerVal) && answerVal.length === 0)) {
          return res.status(400).json({
            error: `Missing required field: "${q.text}"`
          });
        }
      }

      // If answer provided, validate its type
      if (answerVal !== undefined && answerVal !== null && answerVal !== '') {
        switch (q.type) {
          case 'rating': {
            const num = Number(answerVal);
            const min = q.min !== undefined ? q.min : 1;
            const max = q.max !== undefined ? q.max : 5;
            if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
              return res.status(400).json({
                error: `Rating for "${q.text}" must be an integer between ${min} and ${max}`
              });
            }
            sanitizedAnswers[q.id] = num;
            break;
          }
          case 'nps': {
            const num = Number(answerVal);
            if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > 10) {
              return res.status(400).json({
                error: `NPS score for "${q.text}" must be an integer between 0 and 10`
              });
            }
            sanitizedAnswers[q.id] = num;
            break;
          }
          case 'choice':
          case 'select': {
            const strVal = String(answerVal).trim();
            if (q.options && q.options.length > 0 && !q.options.includes(strVal)) {
              return res.status(400).json({
                error: `Invalid selection for "${q.text}". Must be one of: ${q.options.join(', ')}`
              });
            }
            sanitizedAnswers[q.id] = strVal;
            break;
          }
          case 'checkbox': {
            if (!Array.isArray(answerVal)) {
              return res.status(400).json({
                error: `Field "${q.text}" must be an array of selected choices`
              });
            }
            for (const item of answerVal) {
              if (q.options && q.options.length > 0 && !q.options.includes(String(item).trim())) {
                return res.status(400).json({
                  error: `Invalid choice "${item}" for "${q.text}"`
                });
              }
            }
            sanitizedAnswers[q.id] = answerVal.map(x => String(x).trim());
            break;
          }
          case 'yesno': {
            const raw = typeof answerVal === 'string' ? answerVal.trim().toLowerCase() : answerVal;
            if (raw === true || raw === 'yes' || raw === 'true') {
              sanitizedAnswers[q.id] = 'Yes';
            } else if (raw === false || raw === 'no' || raw === 'false') {
              sanitizedAnswers[q.id] = 'No';
            } else {
              return res.status(400).json({
                error: `Field "${q.text}" must be answered with Yes or No`
              });
            }
            break;
          }
          case 'email': {
            const emailStr = String(answerVal).trim();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(emailStr)) {
              return res.status(400).json({
                error: `Invalid email address format for "${q.text}"`
              });
            }
            sanitizedAnswers[q.id] = emailStr;
            break;
          }
          case 'phone': {
            const phoneStr = String(answerVal).trim();
            if (phoneStr.length < 5 || phoneStr.length > 25) {
              return res.status(400).json({
                error: `Invalid telephone number for "${q.text}"`
              });
            }
            sanitizedAnswers[q.id] = phoneStr;
            break;
          }
          case 'date': {
            const dateStr = String(answerVal).trim();
            if (!isValidCalendarDate(dateStr)) {
              return res.status(400).json({
                error: `Field "${q.text}" must be a valid calendar date (YYYY-MM-DD)`
              });
            }
            sanitizedAnswers[q.id] = dateStr;
            break;
          }
          case 'number': {
            const num = Number(answerVal);
            if (!Number.isFinite(num)) {
              return res.status(400).json({
                error: `Field "${q.text}" must be a valid finite number`
              });
            }
            sanitizedAnswers[q.id] = num;
            break;
          }
          case 'text': {
            const str = String(answerVal).trim();
            if (str.length > 500) {
              return res.status(400).json({
                error: `Answer for "${q.text}" exceeds maximum 500 characters`
              });
            }
            sanitizedAnswers[q.id] = str;
            break;
          }
          case 'multiline': {
            const str = String(answerVal).trim();
            if (str.length > 3000) {
              return res.status(400).json({
                error: `Answer for "${q.text}" exceeds maximum 3000 characters`
              });
            }
            sanitizedAnswers[q.id] = str;
            break;
          }
          default:
            sanitizedAnswers[q.id] = answerVal;
        }
      }
    }

    // Retrieve business for configuration verification
    const business = await db.getBusinessById(form.businessId);
    const acConfig = business?.academicConfig || {};
    const cfConfig = form.collegeFieldsConfig || {};
    const sanitizedAcademic = {};

    // Validate Required College Fields according to form config
    if (cfConfig.departmentRequired && (!academicDetails || !academicDetails.department)) {
      return res.status(400).json({ error: 'Department is required for this academic feedback form' });
    }
    if (cfConfig.courseRequired && (!academicDetails || !academicDetails.course)) {
      return res.status(400).json({ error: 'Course is required for this academic feedback form' });
    }
    if (cfConfig.academicYearRequired && (!academicDetails || !academicDetails.academicYear)) {
      return res.status(400).json({ error: 'Academic Year is required for this academic feedback form' });
    }
    if (cfConfig.yearOfStudyRequired && (!academicDetails || !academicDetails.yearOfStudy)) {
      return res.status(400).json({ error: 'Year of study is required for this academic feedback form' });
    }
    if (cfConfig.semesterRequired && (!academicDetails || !academicDetails.semester)) {
      return res.status(400).json({ error: 'Semester is required for this academic feedback form' });
    }
    if (cfConfig.sectionRequired && (!academicDetails || !academicDetails.section)) {
      return res.status(400).json({ error: 'Section is required for this academic feedback form' });
    }
    if (cfConfig.facultyRequired && (!academicDetails || !academicDetails.faculty)) {
      return res.status(400).json({ error: 'Faculty member is required for this academic feedback form' });
    }
    if (cfConfig.subjectRequired && (!academicDetails || !academicDetails.subject)) {
      return res.status(400).json({ error: 'Subject is required for this academic feedback form' });
    }
    if (cfConfig.categoryRequired && (!academicDetails || !academicDetails.category)) {
      return res.status(400).json({ error: 'Feedback category is required for this academic feedback form' });
    }

    if (academicDetails && typeof academicDetails === 'object') {
      const dept = academicDetails.department ? String(academicDetails.department).trim() : '';
      const course = academicDetails.course ? String(academicDetails.course).trim() : '';
      const acadYear = academicDetails.academicYear ? String(academicDetails.academicYear).trim() : '';
      const yos = academicDetails.yearOfStudy ? String(academicDetails.yearOfStudy).trim() : '';
      const sem = academicDetails.semester ? String(academicDetails.semester).trim() : '';
      const sec = academicDetails.section ? String(academicDetails.section).trim() : '';
      const fac = academicDetails.faculty ? String(academicDetails.faculty).trim() : '';
      const subj = academicDetails.subject ? String(academicDetails.subject).trim() : '';
      const cat = academicDetails.category ? String(academicDetails.category).trim() : '';

      // Validate against allowed business lists (prevent forged values)
      if (dept && Array.isArray(acConfig.departments) && acConfig.departments.length > 0) {
        if (!acConfig.departments.includes(dept)) {
          return res.status(400).json({ error: `Invalid department "${dept}". Must match institution configuration.` });
        }
      }
      if (course && Array.isArray(acConfig.courses) && acConfig.courses.length > 0) {
        if (!acConfig.courses.includes(course)) {
          return res.status(400).json({ error: `Invalid course "${course}". Must match institution configuration.` });
        }
      }
      if (acadYear && Array.isArray(acConfig.academicYears) && acConfig.academicYears.length > 0) {
        if (!acConfig.academicYears.includes(acadYear)) {
          return res.status(400).json({ error: `Invalid academic year "${acadYear}". Must match institution configuration.` });
        }
      }
      if (yos && Array.isArray(acConfig.years) && acConfig.years.length > 0) {
        if (!acConfig.years.includes(yos)) {
          return res.status(400).json({ error: `Invalid year of study "${yos}". Must match institution configuration.` });
        }
      }
      if (sem && Array.isArray(acConfig.semesters) && acConfig.semesters.length > 0) {
        if (!acConfig.semesters.includes(sem)) {
          return res.status(400).json({ error: `Invalid semester "${sem}". Must match institution configuration.` });
        }
      }
      if (sec && Array.isArray(acConfig.sections) && acConfig.sections.length > 0) {
        if (!acConfig.sections.includes(sec)) {
          return res.status(400).json({ error: `Invalid section "${sec}". Must match institution configuration.` });
        }
      }
      if (cat && Array.isArray(acConfig.feedbackCategories) && acConfig.feedbackCategories.length > 0) {
        if (!acConfig.feedbackCategories.includes(cat)) {
          return res.status(400).json({ error: `Invalid feedback category "${cat}". Must match institution configuration.` });
        }
      }

      // Validate faculty and departmental mapping
      if (fac) {
        if (Array.isArray(acConfig.faculty) && acConfig.faculty.length > 0) {
          const matchedFaculty = acConfig.faculty.find(f => f.name.toLowerCase() === fac.toLowerCase());
          if (!matchedFaculty) {
            return res.status(400).json({ error: `Invalid faculty member "${fac}". Not registered with this institution.` });
          }
          if (dept && matchedFaculty.department && matchedFaculty.department.toLowerCase() !== dept.toLowerCase()) {
            return res.status(400).json({
              error: `Faculty member "${fac}" belongs to department "${matchedFaculty.department}", not "${dept}"`
            });
          }
        }
      }

      // Validate subject and departmental mapping
      if (subj) {
        if (Array.isArray(acConfig.subjects) && acConfig.subjects.length > 0) {
          const matchedSubject = acConfig.subjects.find(
            s => s.name.toLowerCase() === subj.toLowerCase() || (s.code && s.code.toLowerCase() === subj.toLowerCase())
          );
          if (!matchedSubject) {
            return res.status(400).json({ error: `Invalid subject "${subj}". Not registered with this institution.` });
          }
          if (dept && matchedSubject.department && matchedSubject.department.toLowerCase() !== dept.toLowerCase()) {
            return res.status(400).json({
              error: `Subject "${subj}" belongs to department "${matchedSubject.department}", not "${dept}"`
            });
          }
        }
      }

      if (dept) sanitizedAcademic.department = dept;
      if (course) sanitizedAcademic.course = course;
      if (acadYear) sanitizedAcademic.academicYear = acadYear;
      if (yos) sanitizedAcademic.yearOfStudy = yos;
      if (sem) sanitizedAcademic.semester = sem;
      if (sec) sanitizedAcademic.section = sec;
      if (fac) sanitizedAcademic.faculty = fac;
      if (subj) sanitizedAcademic.subject = subj;
      if (cat) sanitizedAcademic.category = cat;
    }

    // Extract Star Rating (1 to 5 scale) - Do NOT fabricate 5 stars if not present!
    let overallRating = null;
    if (rating !== undefined && rating !== null && rating !== '') {
      const parsedRating = Number(rating);
      if (!Number.isFinite(parsedRating) || !Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
        return res.status(400).json({ error: 'Overall star rating must be an integer between 1 and 5' });
      }
      overallRating = parsedRating;
    } else {
      // Find rating question if answered
      for (const [key, val] of Object.entries(sanitizedAnswers)) {
        const matchingQ = form.questions.find(q => q.id === key);
        if (matchingQ && matchingQ.type === 'rating' && typeof val === 'number') {
          overallRating = val;
          break;
        }
      }
    }

    // Extract NPS responses (0 to 10 scale)
    const npsAnswersMap = new Map();
    let primaryNps = null;
    if (nps !== undefined && nps !== null && nps !== '') {
      const parsedNps = Number(nps);
      if (!Number.isFinite(parsedNps) || !Number.isInteger(parsedNps) || parsedNps < 0 || parsedNps > 10) {
        return res.status(400).json({ error: 'NPS score must be an integer between 0 and 10' });
      }
      primaryNps = parsedNps;
    }
    for (const [key, val] of Object.entries(sanitizedAnswers)) {
      const matchingQ = form.questions.find(q => q.id === key);
      if (matchingQ && matchingQ.type === 'nps' && typeof val === 'number') {
        npsAnswersMap.set(key, val);
        if (primaryNps === null) {
          primaryNps = val;
        }
      }
    }

    // Explicit sentiment & priority routing
    let sentiment = 'neutral';
    let priority = 'low';

    if (overallRating !== null) {
      if (overallRating >= 4) {
        sentiment = 'positive';
        priority = 'low';
      } else if (overallRating === 3) {
        sentiment = 'neutral';
        priority = 'medium';
      } else {
        sentiment = 'negative';
        priority = overallRating === 1 ? 'critical' : 'urgent';
      }
    } else if (primaryNps !== null) {
      if (primaryNps >= 9) {
        sentiment = 'positive';
        priority = 'low';
      } else if (primaryNps >= 7) {
        sentiment = 'neutral';
        priority = 'low';
      } else {
        sentiment = 'negative';
        priority = primaryNps <= 3 ? 'critical' : 'urgent';
      }
    } else {
      sentiment = 'neutral';
      priority = 'low';
    }

    // Save feedback to database
    const newFeedback = await db.createFeedback({
      businessId: form.businessId,
      locationId: form.locationId || null,
      formId: form._id,
      rating: overallRating,
      nps: primaryNps,
      npsAnswers: npsAnswersMap,
      sentiment,
      status: 'new',
      priority,
      customerName: customerName ? customerName.trim() : 'Anonymous',
      customerEmail: customerEmail ? customerEmail.trim().toLowerCase() : '',
      customerPhone: customerPhone ? customerPhone.trim() : '',
      academicDetails: Object.keys(sanitizedAcademic).length > 0 ? sanitizedAcademic : null,
      answers: new Map(Object.entries(sanitizedAnswers)),
      comments: comments ? comments.trim() : '',
      source: source || 'QR Code'
    });

    // NON-GATED GOOGLE REVIEW PROMPT: Show to ALL respondents if configured!
    const effectiveGoogleUrl = form.googleReviewUrl || business?.googleReviewUrl || '';
    const showGoogleReview = Boolean(effectiveGoogleUrl);

    return res.status(201).json({
      success: true,
      message: (overallRating !== null && overallRating >= 4)
        ? 'Thank you for your fantastic feedback! We are thrilled to hear about your experience.'
        : 'Thank you for your feedback. We take all feedback seriously, and our team will review your comments promptly.',
      feedbackId: newFeedback._id ? newFeedback._id.toString() : newFeedback.id,
      rating: overallRating,
      showGoogleReview,
      googleReviewUrl: effectiveGoogleUrl,
      businessName: business?.name || 'our organization'
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Feedback Submission Error]:', err);
    return res.status(500).json({ error: 'Failed to record feedback response' });
  }
}

router.post('/submit/:slug', handleSubmit);
router.post('/submit', handleSubmit);

// GET /api/feedback (Authenticated - Multi-Tenant Isolated)
router.get('/', requireAuth, async (req, res) => {
  try {
    const businessId = req.user.role === 'superadmin' && req.query.businessId
      ? req.query.businessId
      : req.user.businessId;

    if (!businessId) {
      return res.json({ feedbacks: [] });
    }

    const filter = { businessId };

    if (req.query.rating && req.query.rating !== 'all') {
      filter.rating = parseInt(req.query.rating, 10);
    }
    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status;
    }
    if (req.query.priority && req.query.priority !== 'all') {
      filter.priority = req.query.priority;
    }
    if (req.query.locationId && req.query.locationId !== 'all') {
      filter.locationId = req.query.locationId;
    }
    if (req.query.formId && req.query.formId !== 'all') {
      filter.formId = req.query.formId;
    }

    const feedbacks = await db.getFeedbacks(filter);

    return res.json({
      feedbacks: feedbacks.map(f => {
        const obj = f.toObject ? f.toObject() : f;
        return {
          ...obj,
          id: f._id ? f._id.toString() : f.id,
          rating: obj.rating,
          nps: obj.nps,
          npsAnswers: obj.npsAnswers instanceof Map ? Object.fromEntries(obj.npsAnswers) : (obj.npsAnswers || {}),
          answers: obj.answers instanceof Map ? Object.fromEntries(obj.answers) : (obj.answers || {})
        };
      })
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Get Feedbacks Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve feedback list' });
  }
});

// GET /api/feedback/export/csv (Authenticated - Multi-Tenant Scoped CSV Export)
router.get('/export/csv', requireAuth, requireRole('owner', 'college_admin', 'manager', 'superadmin'), async (req, res) => {
  try {
    const businessId = req.user.role === 'superadmin' && req.query.businessId
      ? req.query.businessId
      : req.user.businessId;

    if (!businessId) {
      return res.status(400).send('Business context required');
    }

    const feedbacks = await db.getFeedbacks({ businessId });

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    const headers = [
      'ID',
      'Date',
      'Rating',
      'NPS',
      'Sentiment',
      'Status',
      'Priority',
      'Customer Name',
      'Customer Email',
      'Department',
      'Subject',
      'Faculty',
      'Comments',
      'Source'
    ];

    const rows = feedbacks.map(f => {
      const acad = f.academicDetails || {};
      return [
        escapeCsv(f._id ? f._id.toString() : f.id),
        escapeCsv(f.createdAt ? new Date(f.createdAt).toISOString() : ''),
        escapeCsv(f.rating !== null && f.rating !== undefined ? f.rating : 'N/A'),
        escapeCsv(f.nps !== null && f.nps !== undefined ? f.nps : 'N/A'),
        escapeCsv(f.sentiment),
        escapeCsv(f.status),
        escapeCsv(f.priority),
        escapeCsv(f.customerName),
        escapeCsv(f.customerEmail),
        escapeCsv(acad.department || ''),
        escapeCsv(acad.subject || ''),
        escapeCsv(acad.faculty || ''),
        escapeCsv(f.comments),
        escapeCsv(f.source)
      ].join(',');
    });

    // UTF-8 BOM for Excel compatibility
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="feedbackhub-export-${Date.now()}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('[CSV Export Error]:', err);
    return res.status(500).send('Failed to export feedback as CSV');
  }
});

// GET /api/feedback/:id (Authenticated - Multi-Tenant Protected)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const fb = await db.getFeedbackById(req.params.id);
    if (!fb) {
      return res.status(404).json({ error: 'Feedback record not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const fbBizId = fb.businessId ? fb.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && fbBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to view this record. Cross-tenant access is prohibited.' });
    }

    const obj = fb.toObject ? fb.toObject() : fb;
    return res.json({
      feedback: {
        ...obj,
        id: fb._id ? fb._id.toString() : fb.id,
        answers: obj.answers instanceof Map ? Object.fromEntries(obj.answers) : (obj.answers || {})
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Get Feedback Detail Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve feedback record' });
  }
});

// PATCH /api/feedback/:id/status (Authenticated - Multi-Tenant Protected)
router.patch('/:id/status', requireAuth, requireRole('owner', 'college_admin', 'manager', 'superadmin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['new', 'in_review', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const fb = await db.getFeedbackById(req.params.id);
    if (!fb) {
      return res.status(404).json({ error: 'Feedback record not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const fbBizId = fb.businessId ? fb.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && fbBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to modify this record. Cross-tenant access is prohibited.' });
    }

    const updated = await db.updateFeedback(req.params.id, { status });
    await db.logAudit('Feedback Status Changed', req.user.name, `Changed status of feedback to ${status}`, fb.businessId, req.ip);

    const obj = updated.toObject ? updated.toObject() : updated;
    return res.json({
      feedback: {
        ...obj,
        id: updated._id ? updated._id.toString() : updated.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Update Status Error]:', err);
    return res.status(500).json({ error: 'Failed to update feedback status' });
  }
});

// PATCH /api/feedback/:id/priority (Authenticated - Multi-Tenant Protected)
router.patch('/:id/priority', requireAuth, requireRole('owner', 'college_admin', 'manager', 'superadmin'), async (req, res) => {
  try {
    const { priority } = req.body;
    if (!['low', 'medium', 'urgent', 'critical'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority value' });
    }

    const fb = await db.getFeedbackById(req.params.id);
    if (!fb) {
      return res.status(404).json({ error: 'Feedback record not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const fbBizId = fb.businessId ? fb.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && fbBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to modify this record. Cross-tenant access is prohibited.' });
    }

    const updated = await db.updateFeedback(req.params.id, { priority });
    await db.logAudit('Feedback Priority Changed', req.user.name, `Changed priority of feedback to ${priority}`, fb.businessId, req.ip);

    const obj = updated.toObject ? updated.toObject() : updated;
    return res.json({
      feedback: {
        ...obj,
        id: updated._id ? updated._id.toString() : updated.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Update Priority Error]:', err);
    return res.status(500).json({ error: 'Failed to update feedback priority' });
  }
});

// POST /api/feedback/:id/notes (Authenticated - Multi-Tenant Protected)
router.post('/:id/notes', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Note text cannot be empty' });
    }

    const fb = await db.getFeedbackById(req.params.id);
    if (!fb) {
      return res.status(404).json({ error: 'Feedback record not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const fbBizId = fb.businessId ? fb.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && fbBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to add notes. Cross-tenant access is prohibited.' });
    }

    const newNote = {
      text: text.trim(),
      author: req.user.name,
      createdAt: new Date()
    };

    const notes = fb.internalNotes || [];
    notes.push(newNote);

    const updated = await db.updateFeedback(req.params.id, { internalNotes: notes });
    await db.logAudit('Internal Note Added', req.user.name, `Added internal note to feedback record`, fb.businessId, req.ip);

    const obj = updated.toObject ? updated.toObject() : updated;
    return res.status(201).json({
      note: newNote,
      feedback: {
        ...obj,
        id: updated._id ? updated._id.toString() : updated.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Add Note Error]:', err);
    return res.status(500).json({ error: 'Failed to add internal note' });
  }
});

// POST /api/feedback/:id/resolve (Authenticated - Multi-Tenant Protected)
router.post('/:id/resolve', requireAuth, requireRole('owner', 'college_admin', 'manager', 'superadmin'), async (req, res) => {
  try {
    const { resolutionNotes } = req.body;
    const fb = await db.getFeedbackById(req.params.id);
    if (!fb) {
      return res.status(404).json({ error: 'Feedback record not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const fbBizId = fb.businessId ? fb.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && fbBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to resolve this complaint. Cross-tenant access is prohibited.' });
    }

    const notes = fb.internalNotes || [];
    notes.push({
      text: `Case resolved by ${req.user.name}. Resolution summary: ${resolutionNotes || 'Follow-up completed.'}`,
      author: req.user.name,
      createdAt: new Date()
    });

    const updated = await db.updateFeedback(req.params.id, {
      status: 'resolved',
      resolutionNotes: resolutionNotes ? resolutionNotes.trim() : 'Complaint resolved',
      internalNotes: notes
    });

    await db.logAudit('Complaint Resolved', req.user.name, `Resolved feedback complaint with resolution note`, fb.businessId, req.ip);

    const obj = updated.toObject ? updated.toObject() : updated;
    return res.json({
      success: true,
      message: 'Complaint marked as resolved',
      feedback: {
        ...obj,
        id: updated._id ? updated._id.toString() : updated.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Resolve Complaint Error]:', err);
    return res.status(500).json({ error: 'Failed to resolve complaint' });
  }
});

router.isQuestionVisible = isQuestionVisible;

module.exports = router;
module.exports.isQuestionVisible = isQuestionVisible;
