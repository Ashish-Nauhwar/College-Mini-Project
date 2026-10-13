const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/forms/templates (Starter Form Templates)
router.get('/templates', requireAuth, (req, res) => {
  const templates = [
    {
      type: 'college',
      name: 'College Academic & Course Evaluation',
      description: 'Comprehensive academic evaluation covering faculty lectures, concept clarity, doubt sessions and curriculum pacing.',
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
          text: 'Clarity of concepts explained and classroom preparation by faculty:',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_syllabus_coverage',
          type: 'rating',
          text: 'Pace of syllabus coverage and timely completion of academic units:',
          required: true,
          min: 1,
          max: 5,
          order: 2
        },
        {
          id: 'q_doubt_solving',
          type: 'choice',
          text: 'Are doubts and student queries addressed constructively during or after class?',
          options: ['Always addressed thoroughly', 'Addressed mostly', 'Occasionally addressed', 'Rarely or never'],
          required: true,
          order: 3
        },
        {
          id: 'q_college_nps',
          type: 'nps',
          text: 'How likely are you to recommend this institution to prospective students? (0-10)',
          required: true,
          min: 0,
          max: 10,
          order: 4
        },
        {
          id: 'q_college_comments',
          type: 'multiline',
          text: 'Suggestions for labs, infrastructure, library resources, or teaching improvements:',
          required: false,
          placeholder: 'Share your honest feedback...',
          order: 5
        }
      ]
    },
    {
      type: 'faculty',
      name: 'Faculty Teaching Performance Evaluation',
      description: 'Targeted survey evaluating pedagogy, subject mastery, accessibility, and mentorship.',
      collegeFieldsConfig: {
        departmentEnabled: true,
        departmentRequired: true,
        facultyEnabled: true,
        facultyRequired: true,
        subjectEnabled: true,
        subjectRequired: true,
        semesterEnabled: true,
        semesterRequired: false
      },
      questions: [
        {
          id: 'q_faculty_clarity',
          type: 'rating',
          text: 'Subject knowledge and clarity of presentation:',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_faculty_interaction',
          type: 'choice',
          text: 'Teacher encouragement of student interaction and participation:',
          options: ['Highly encouraging', 'Moderately encouraging', 'Neutral', 'Discouraging'],
          required: true,
          order: 2
        },
        {
          id: 'q_faculty_materials',
          type: 'yesno',
          text: 'Are lecture notes, reference slides, and study materials provided on time?',
          required: false,
          order: 3
        },
        {
          id: 'q_faculty_comments',
          type: 'multiline',
          text: 'Constructive suggestions for faculty pedagogy:',
          required: false,
          order: 4
        }
      ]
    },
    {
      type: 'facilities',
      name: 'Campus Facilities & Infrastructure Survey',
      description: 'Feedback on laboratories, library, Wi-Fi, hostel, canteen, and sports facilities.',
      collegeFieldsConfig: {
        departmentEnabled: false,
        categoryEnabled: true,
        categoryRequired: true
      },
      questions: [
        {
          id: 'q_facility_cleanliness',
          type: 'rating',
          text: 'Cleanliness and hygiene of campus classrooms and washrooms:',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_facility_wifi',
          type: 'rating',
          text: 'Speed and availability of campus Wi-Fi network:',
          required: true,
          min: 1,
          max: 5,
          order: 2
        },
        {
          id: 'q_facility_canteen',
          type: 'choice',
          text: 'Quality and pricing of food in college canteen / mess:',
          options: ['Excellent', 'Good', 'Needs Improvement', 'Unsatisfactory'],
          required: false,
          order: 3
        },
        {
          id: 'q_facility_comments',
          type: 'multiline',
          text: 'Specific infrastructure issues or maintenance requests:',
          required: false,
          order: 4
        }
      ]
    },
    {
      type: 'restaurant',
      name: 'Restaurant & Dining Experience',
      description: 'Collect customer ratings on food taste, ambiance, hospitality, and value.',
      questions: [
        {
          id: 'q_food_quality',
          type: 'rating',
          text: 'How would you rate the quality and presentation of your food?',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_rest_nps',
          type: 'nps',
          text: 'How likely are you to recommend our restaurant to friends? (0-10)',
          required: true,
          min: 0,
          max: 10,
          order: 2
        },
        {
          id: 'q_speed',
          type: 'yesno',
          text: 'Was your order prepared promptly and served with warm hospitality?',
          required: false,
          order: 3
        },
        {
          id: 'q_rest_comments',
          type: 'multiline',
          text: 'What did you enjoy most, or how can we improve your next meal?',
          required: false,
          order: 4
        }
      ]
    },
    {
      type: 'coaching',
      name: 'Coaching Institute & Test Prep Feedback',
      description: 'Evaluate test series, doubt clearing sessions, study modules, and mentor guidance.',
      questions: [
        {
          id: 'q_coaching_concept',
          type: 'rating',
          text: 'Effectiveness of problem-solving techniques taught in class:',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_test_series',
          type: 'choice',
          text: 'Difficulty and relevance of weekly mock test series:',
          options: ['Perfect balance (Exam level)', 'Too difficult', 'Too easy', 'Irrelevant pattern'],
          required: true,
          order: 2
        },
        {
          id: 'q_coaching_nps',
          type: 'nps',
          text: 'How likely are you to recommend this coaching institute? (0-10)',
          required: true,
          min: 0,
          max: 10,
          order: 3
        },
        {
          id: 'q_coaching_comments',
          type: 'multiline',
          text: 'Suggestions for study materials or doubt sessions:',
          required: false,
          order: 4
        }
      ]
    },
    {
      type: 'general',
      name: 'General Customer Experience',
      description: 'A clean 3-step feedback form suitable for any retail, clinic, or service business.',
      questions: [
        {
          id: 'q_gen_rating',
          type: 'rating',
          text: 'How would you rate your overall experience today?',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_gen_nps',
          type: 'nps',
          text: 'How likely are you to recommend us to others? (0-10)',
          required: true,
          min: 0,
          max: 10,
          order: 2
        },
        {
          id: 'q_gen_comments',
          type: 'multiline',
          text: 'How can we improve or make your next visit even better?',
          required: false,
          order: 3
        }
      ]
    }
  ];

  return res.json({ templates });
});

// GET /api/forms/slug/:slug (PUBLIC ENDPOINT)
router.get('/slug/:slug', async (req, res) => {
  try {
    const form = await db.getFormBySlug(req.params.slug);
    if (!form) {
      return res.status(404).json({ error: 'Feedback form not found' });
    }

    if (form.status !== 'published') {
      return res.status(403).json({
        error: `This feedback form is currently ${form.status} and is not accepting responses.`
      });
    }

    const business = await db.getBusinessById(form.businessId);
    const location = form.locationId ? await db.getLocationById(form.locationId) : null;

    return res.json({
      form,
      business: business ? {
        name: business.name,
        type: business.type,
        category: business.category,
        logo: business.logo,
        address: business.address,
        googleReviewUrl: business.googleReviewUrl || form.googleReviewUrl || '',
        academicConfig: business.academicConfig || null
      } : null,
      location: location ? {
        name: location.name,
        address: location.address
      } : null
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Public Form Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve public feedback form' });
  }
});

// GET /api/forms (Authenticated - Multi-Tenant Isolated)
router.get('/', requireAuth, async (req, res) => {
  try {
    const businessId = req.user.role === 'superadmin' && req.query.businessId
      ? req.query.businessId
      : req.user.businessId;

    if (!businessId) {
      return res.json({ forms: [] });
    }

    const forms = await db.getForms(businessId);
    const formsWithMeta = await Promise.all(
      forms.map(async f => {
        const loc = f.locationId ? await db.getLocationById(f.locationId) : null;
        const feedbacks = await db.getFeedbacks({ formId: f._id });
        const avgRating = feedbacks.length > 0
          ? (feedbacks.reduce((sum, item) => sum + (item.rating || 0), 0) / feedbacks.length).toFixed(1)
          : null;

        return {
          id: f._id ? f._id.toString() : f.id,
          _id: f._id,
          slug: f.slug,
          title: f.title,
          description: f.description,
          formType: f.formType,
          status: f.status,
          googleReviewUrl: f.googleReviewUrl,
          questions: f.questions,
          collegeFieldsConfig: f.collegeFieldsConfig,
          locationId: f.locationId,
          locationName: loc ? loc.name : 'All Locations',
          responseCount: feedbacks.length,
          averageRating: avgRating,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt
        };
      })
    );

    return res.json({ forms: formsWithMeta });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Get Forms Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve forms' });
  }
});

// GET /api/forms/:id (Authenticated - Multi-Tenant Protected)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const form = await db.getFormById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const formBizId = form.businessId ? form.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && formBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to view this form. Cross-tenant access is prohibited.' });
    }

    const loc = form.locationId ? await db.getLocationById(form.locationId) : null;
    return res.json({
      form: {
        ...form.toObject ? form.toObject() : form,
        id: form._id ? form._id.toString() : form.id,
        locationName: loc ? loc.name : 'All Locations'
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Get Form Detail Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve form details' });
  }
});

const { validateQuestionGraph } = require('../utils/formGraphValidator');

// Helper to sanitize questions using full graph validation
function validateAndSanitizeQuestions(rawQuestions) {
  return validateQuestionGraph(rawQuestions);
}

// POST /api/forms (Authenticated - Multi-Tenant Scoped)
router.post('/', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), async (req, res) => {
  try {
    const {
      title,
      description,
      locationId,
      slug,
      questions,
      formType,
      googleReviewUrl,
      collegeFieldsConfig,
      allowAnonymous
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Form title is required' });
    }

    const businessId = req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ error: 'No business linked to your account' });
    }

    // Verify locationId belongs to user's business
    if (locationId) {
      const loc = await db.getLocationById(locationId);
      if (!loc || loc.businessId.toString() !== businessId.toString()) {
        return res.status(400).json({ error: 'Specified location does not belong to your business' });
      }
    }

    const slugCandidate = (slug || title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'form';

    let cleanSlug = `${slugCandidate}-${Math.random().toString(36).substring(2, 6)}`;
    let existingForm = await db.getFormBySlug(cleanSlug);
    let attempts = 0;
    while (existingForm && attempts < 5) {
      cleanSlug = `${slugCandidate}-${Math.random().toString(36).substring(2, 8)}`;
      existingForm = await db.getFormBySlug(cleanSlug);
      attempts++;
    }

    // Validate and sanitize questions (with full cycle and conditional checks)
    const qValidation = validateQuestionGraph(questions);
    if (qValidation.error) {
      return res.status(400).json({ error: qValidation.error });
    }

    // PRIORITY 7: New forms are ALWAYS created in 'draft' status regardless of request body payload
    const initialStatus = 'draft';

    const newForm = await db.createForm({
      businessId,
      locationId: locationId || null,
      slug: cleanSlug,
      title: title.trim(),
      description: description ? description.trim() : '',
      formType: formType || 'general',
      status: initialStatus,
      googleReviewUrl: googleReviewUrl ? googleReviewUrl.trim() : '',
      allowAnonymous: allowAnonymous !== false,
      collegeFieldsConfig: collegeFieldsConfig || {},
      questions: qValidation.questions
    });

    await db.logAudit(
      'Form Created',
      req.user.name,
      `Created form "${newForm.title}" (${newForm.slug}) in draft status`,
      businessId,
      req.ip
    );

    return res.status(201).json({
      form: {
        ...newForm.toObject ? newForm.toObject() : newForm,
        id: newForm._id ? newForm._id.toString() : newForm.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Create Form Error]:', err);
    return res.status(500).json({ error: 'Failed to create new form' });
  }
});

// Defined legal state machine transitions (Priority 3)
const LEGAL_TRANSITIONS = {
  draft: ['published', 'archived'],
  published: ['paused', 'archived'],
  paused: ['published', 'archived'],
  archived: ['draft']
};

// PUT /api/forms/:id (Authenticated - Multi-Tenant Protected)
router.put('/:id', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), async (req, res) => {
  try {
    const form = await db.getFormById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const formBizId = form.businessId ? form.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && formBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to update this form. Cross-tenant access is prohibited.' });
    }

    const {
      title,
      description,
      locationId,
      status,
      formType,
      googleReviewUrl,
      questions,
      collegeFieldsConfig,
      allowAnonymous
    } = req.body;

    // UNBYPASSABLE LIFECYCLE: Reject status mutation via general update
    if (status !== undefined && status !== form.status) {
      return res.status(400).json({
        error: 'Form status cannot be modified via general update. Please use explicit lifecycle transition endpoints (/publish, /pause, /resume, /archive).'
      });
    }

    const updates = {};
    if (title !== undefined) {
      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Form title cannot be empty' });
      }
      updates.title = title.trim();
    }
    if (description !== undefined) updates.description = description.trim();
    if (locationId !== undefined) {
      if (locationId) {
        const loc = await db.getLocationById(locationId);
        if (!loc || loc.businessId.toString() !== form.businessId.toString()) {
          return res.status(400).json({ error: 'Specified location does not belong to this business' });
        }
        updates.locationId = locationId;
      } else {
        updates.locationId = null;
      }
    }
    if (formType) updates.formType = formType;
    if (googleReviewUrl !== undefined) updates.googleReviewUrl = googleReviewUrl.trim();
    if (allowAnonymous !== undefined) updates.allowAnonymous = Boolean(allowAnonymous);
    if (collegeFieldsConfig !== undefined) updates.collegeFieldsConfig = collegeFieldsConfig;

    if (questions !== undefined) {
      const qValidation = validateAndSanitizeQuestions(questions);
      if (qValidation.error) {
        return res.status(400).json({ error: qValidation.error });
      }
      updates.questions = qValidation.questions;
    }

    const updated = await db.updateForm(req.params.id, updates);
    await db.logAudit(
      'Form Updated',
      req.user.name,
      `Updated form "${updated.title}" (${updated.slug})`,
      form.businessId,
      req.ip
    );

    return res.json({
      form: {
        ...updated.toObject ? updated.toObject() : updated,
        id: updated._id ? updated._id.toString() : updated.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Update Form Error]:', err);
    return res.status(500).json({ error: 'Failed to update form' });
  }
});

// State transition helper with state machine and full definition validation
async function handleStateTransition(req, res, targetStatus, actionName) {
  try {
    const form = await db.getFormById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const formBizId = form.businessId ? form.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && formBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to update this form. Cross-tenant access is prohibited.' });
    }

    const previousStatus = form.status;

    // Enforce legal lifecycle transitions
    const allowedTargets = LEGAL_TRANSITIONS[previousStatus] || [];
    if (!allowedTargets.includes(targetStatus)) {
      return res.status(400).json({
        error: `Invalid status transition from "${previousStatus}" to "${targetStatus}". Allowed transitions: ${allowedTargets.join(', ') || 'none'}.`
      });
    }

    // Comprehensive validation prior to publication
    if (targetStatus === 'published') {
      if (!form.title || !form.title.trim()) {
        return res.status(400).json({ error: 'Cannot publish form: Form title is missing or empty' });
      }
      if (!Array.isArray(form.questions) || form.questions.length === 0) {
        return res.status(400).json({ error: 'Cannot publish form: A form must contain at least one question' });
      }
      const qValidation = validateQuestionGraph(form.questions);
      if (qValidation.error) {
        return res.status(400).json({ error: `Cannot publish form: ${qValidation.error}` });
      }
    }

    const updated = await db.updateForm(req.params.id, { status: targetStatus });
    await db.logAudit(
      actionName,
      req.user.name,
      `Transitioned form "${updated.title}" (${updated.slug}) from ${previousStatus} to ${targetStatus}`,
      form.businessId,
      req.ip
    );

    return res.json({
      form: {
        ...updated.toObject ? updated.toObject() : updated,
        id: updated._id ? updated._id.toString() : updated.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error(`[${actionName} Error]:`, err);
    return res.status(500).json({ error: `Failed to transition form to ${targetStatus}` });
  }
}

// Explicit State Transition Endpoints (Priority 3 & Priority 2 Protected)
// PUT /api/forms/:id/publish
router.put('/:id/publish', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), (req, res) => {
  return handleStateTransition(req, res, 'published', 'Form Published');
});

// PUT /api/forms/:id/pause
router.put('/:id/pause', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), (req, res) => {
  return handleStateTransition(req, res, 'paused', 'Form Paused');
});

// PUT /api/forms/:id/resume
router.put('/:id/resume', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), (req, res) => {
  return handleStateTransition(req, res, 'published', 'Form Resumed');
});

// PUT /api/forms/:id/archive
router.put('/:id/archive', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), (req, res) => {
  return handleStateTransition(req, res, 'archived', 'Form Archived');
});

// PUT /api/forms/:id/draft
router.put('/:id/draft', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), (req, res) => {
  return handleStateTransition(req, res, 'draft', 'Form Moved to Draft');
});

// DELETE /api/forms/:id (Authenticated - Multi-Tenant Protected)
router.delete('/:id', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), async (req, res) => {
  try {
    const form = await db.getFormById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const formBizId = form.businessId ? form.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && formBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to delete this form. Cross-tenant access is prohibited.' });
    }

    await db.deleteForm(req.params.id);
    await db.logAudit('Form Deleted', req.user.name, `Deleted form "${form.title}"`, form.businessId, req.ip);

    return res.json({ success: true, message: 'Form deleted successfully' });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Delete Form Error]:', err);
    return res.status(500).json({ error: 'Failed to delete form' });
  }
});

module.exports = router;
