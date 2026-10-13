const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// Helper to evaluate conditional visibility on the server
function isQuestionVisible(q, answers) {
  if (!q.conditional || !q.conditional.dependsOn) return true;
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
    case 'greater_than':
      return Number(parentValue) > Number(target);
    case 'less_than':
      return Number(parentValue) < Number(target);
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
            if (isNaN(num) || num < min || num > max) {
              return res.status(400).json({
                error: `Rating for "${q.text}" must be between ${min} and ${max}`
              });
            }
            sanitizedAnswers[q.id] = num;
            break;
          }
          case 'nps': {
            const num = Number(answerVal);
            if (isNaN(num) || num < 0 || num > 10) {
              return res.status(400).json({
                error: `NPS score for "${q.text}" must be between 0 and 10`
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
            const boolVal = answerVal === true || answerVal === 'yes' || answerVal === 'Yes' || answerVal === 'true';
            sanitizedAnswers[q.id] = boolVal ? 'Yes' : 'No';
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
          case 'number': {
            const num = Number(answerVal);
            if (isNaN(num)) {
              return res.status(400).json({
                error: `Field "${q.text}" must be a valid number`
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

    // Validate college fields if enabled on form
    const cfConfig = form.collegeFieldsConfig || {};
    const sanitizedAcademic = {};

    if (cfConfig.departmentRequired && (!academicDetails || !academicDetails.department)) {
      return res.status(400).json({ error: 'Department is required for this academic feedback form' });
    }
    if (cfConfig.facultyRequired && (!academicDetails || !academicDetails.faculty)) {
      return res.status(400).json({ error: 'Faculty member is required for this academic feedback form' });
    }
    if (cfConfig.subjectRequired && (!academicDetails || !academicDetails.subject)) {
      return res.status(400).json({ error: 'Subject is required for this academic feedback form' });
    }

    if (academicDetails && typeof academicDetails === 'object') {
      sanitizedAcademic.department = academicDetails.department ? String(academicDetails.department).trim() : '';
      sanitizedAcademic.course = academicDetails.course ? String(academicDetails.course).trim() : '';
      sanitizedAcademic.academicYear = academicDetails.academicYear ? String(academicDetails.academicYear).trim() : '';
      sanitizedAcademic.yearOfStudy = academicDetails.yearOfStudy ? String(academicDetails.yearOfStudy).trim() : '';
      sanitizedAcademic.semester = academicDetails.semester ? String(academicDetails.semester).trim() : '';
      sanitizedAcademic.section = academicDetails.section ? String(academicDetails.section).trim() : '';
      sanitizedAcademic.faculty = academicDetails.faculty ? String(academicDetails.faculty).trim() : '';
      sanitizedAcademic.subject = academicDetails.subject ? String(academicDetails.subject).trim() : '';
      sanitizedAcademic.category = academicDetails.category ? String(academicDetails.category).trim() : '';
    }

    // Determine overall rating
    let overallRating = 5;
    if (rating !== undefined && rating !== null && rating !== '') {
      overallRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 5));
    } else {
      // Find rating question if present
      for (const [key, val] of Object.entries(sanitizedAnswers)) {
        const matchingQ = form.questions.find(q => q.id === key);
        if (matchingQ && matchingQ.type === 'rating' && typeof val === 'number') {
          overallRating = val;
          break;
        }
      }
    }

    // Automatic sentiment & priority routing
    let sentiment = 'neutral';
    let priority = 'low';

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

    // Save feedback to database
    const newFeedback = await db.createFeedback({
      businessId: form.businessId,
      locationId: form.locationId || null,
      formId: form._id,
      rating: overallRating,
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

    const business = await db.getBusinessById(form.businessId);

    // NON-GATED GOOGLE REVIEW PROMPT: Show to ALL respondents if configured!
    const effectiveGoogleUrl = form.googleReviewUrl || business?.googleReviewUrl || '';
    const showGoogleReview = Boolean(effectiveGoogleUrl);

    return res.status(201).json({
      success: true,
      message: overallRating >= 4
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
router.get('/export/csv', requireAuth, async (req, res) => {
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
        escapeCsv(f.rating),
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
router.patch('/:id/status', requireAuth, async (req, res) => {
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
router.patch('/:id/priority', requireAuth, async (req, res) => {
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
router.post('/:id/resolve', requireAuth, async (req, res) => {
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
