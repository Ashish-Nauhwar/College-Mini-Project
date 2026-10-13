const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// POST /api/feedback/submit (PUBLIC ENDPOINT)
router.post('/submit', (req, res) => {
  const { formId, rating, nps, customerName, customerEmail, customerPhone, comments, answers, source } = req.body;

  if (!formId) {
    return res.status(400).json({ error: 'Form identifier is required' });
  }

  const form = db.getFormById(formId);
  if (!form) {
    return res.status(404).json({ error: 'Form not found' });
  }

  if (form.status === 'paused') {
    return res.status(403).json({ error: 'This feedback form is currently paused and not accepting responses.' });
  }

  // Validate required questions
  const parsedRating = parseInt(rating, 10);
  if (!parsedRating || parsedRating < 1 || parsedRating > 5) {
    return res.status(400).json({ error: 'Please provide a valid rating between 1 and 5 stars' });
  }

  // Save new feedback
  const newFeedback = db.createFeedback({
    businessId: form.businessId,
    locationId: form.locationId,
    formId: form.id,
    rating: parsedRating,
    nps: nps !== undefined && nps !== null && nps !== '' ? parseInt(nps, 10) : null,
    customerName: customerName ? customerName.trim() : 'Anonymous Customer',
    customerEmail: customerEmail ? customerEmail.trim() : '',
    customerPhone: customerPhone ? customerPhone.trim() : '',
    comments: comments ? comments.trim() : '',
    answers: answers || {},
    source: source || 'QR Code Scan'
  });

  const business = db.getBusinessById(form.businessId);

  // Determine post-submission recommendation
  const isPositive = parsedRating >= 4;
  const showGoogleReview = isPositive && Boolean(form.googleReviewUrl);

  return res.status(201).json({
    success: true,
    message: isPositive
      ? 'Thank you for your fantastic feedback! We are thrilled to hear about your experience.'
      : 'Thank you for your feedback. We take your concerns seriously, and our team will review this promptly.',
    feedbackId: newFeedback.id,
    isPositive,
    showGoogleReview,
    googleReviewUrl: form.googleReviewUrl || null,
    businessName: business?.name || 'our team'
  });
});

// GET /api/feedback (Authenticated)
router.get('/', requireAuth, (req, res) => {
  const businessId = req.user.role === 'superadmin' && req.query.businessId
    ? req.query.businessId
    : req.user.businessId;

  const filter = {
    businessId,
    locationId: req.query.locationId,
    rating: req.query.rating,
    status: req.query.status,
    priority: req.query.priority,
    sentiment: req.query.sentiment,
    search: req.query.search
  };

  const list = db.getFeedbacks(filter);

  // Enrich with location names and form titles
  const enriched = list.map(fb => {
    const loc = fb.locationId ? db.getLocationById(fb.locationId) : null;
    const form = fb.formId ? db.getFormById(fb.formId) : null;
    return {
      ...fb,
      locationName: loc ? loc.name : 'All Locations',
      formTitle: form ? form.title : 'General Feedback'
    };
  });

  res.json({ feedbacks: enriched, total: enriched.length });
});

// GET /api/feedback/:id (Authenticated)
router.get('/:id', requireAuth, (req, res) => {
  const fb = db.getFeedbackById(req.params.id);
  if (!fb) {
    return res.status(404).json({ error: 'Feedback not found' });
  }

  if (req.user.role !== 'superadmin' && fb.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized to view this feedback' });
  }

  const loc = fb.locationId ? db.getLocationById(fb.locationId) : null;
  const form = fb.formId ? db.getFormById(fb.formId) : null;

  res.json({
    feedback: {
      ...fb,
      locationName: loc ? loc.name : 'All Locations',
      formTitle: form ? form.title : 'General Feedback',
      formQuestions: form ? form.questions : []
    }
  });
});

// PATCH /api/feedback/:id/status
router.patch('/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['new', 'in_review', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  const fb = db.getFeedbackById(req.params.id);
  if (!fb) return res.status(404).json({ error: 'Feedback not found' });
  if (req.user.role !== 'superadmin' && fb.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const updated = db.updateFeedback(req.params.id, { status });
  db.logAudit('Feedback Status Updated', req.user.name, `Updated feedback ${req.params.id} to ${status}`);
  res.json({ feedback: updated });
});

// PATCH /api/feedback/:id/priority
router.patch('/:id/priority', requireAuth, (req, res) => {
  const { priority } = req.body;
  if (!['low', 'medium', 'urgent', 'critical'].includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority value' });
  }

  const fb = db.getFeedbackById(req.params.id);
  if (!fb) return res.status(404).json({ error: 'Feedback not found' });
  if (req.user.role !== 'superadmin' && fb.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const updated = db.updateFeedback(req.params.id, { priority });
  db.logAudit('Feedback Priority Updated', req.user.name, `Updated priority for ${req.params.id} to ${priority}`);
  res.json({ feedback: updated });
});

// PATCH /api/feedback/:id/assign
router.patch('/:id/assign', requireAuth, (req, res) => {
  const { assignedTo } = req.body;
  const fb = db.getFeedbackById(req.params.id);
  if (!fb) return res.status(404).json({ error: 'Feedback not found' });
  if (req.user.role !== 'superadmin' && fb.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const updated = db.updateFeedback(req.params.id, { assignedTo: assignedTo || null });
  db.logAudit('Feedback Assigned', req.user.name, `Assigned feedback ${req.params.id} to ${assignedTo || 'Unassigned'}`);
  res.json({ feedback: updated });
});

// POST /api/feedback/:id/notes
router.post('/:id/notes', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Note text is required' });
  }

  const fb = db.getFeedbackById(req.params.id);
  if (!fb) return res.status(404).json({ error: 'Feedback not found' });
  if (req.user.role !== 'superadmin' && fb.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const note = db.addFeedbackNote(req.params.id, {
    author: req.user.name,
    text: text.trim()
  });

  db.logAudit('Internal Note Added', req.user.name, `Added internal note to feedback ${req.params.id}`);
  res.status(201).json({ note });
});

// POST /api/feedback/:id/resolve
router.post('/:id/resolve', requireAuth, (req, res) => {
  const { resolutionNote } = req.body;
  const fb = db.getFeedbackById(req.params.id);
  if (!fb) return res.status(404).json({ error: 'Feedback not found' });
  if (req.user.role !== 'superadmin' && fb.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const resolved = db.resolveFeedback(req.params.id, {
    resolvedBy: req.user.name,
    resolutionNote: resolutionNote ? resolutionNote.trim() : 'Complaint addressed and resolved.'
  });

  db.logAudit('Complaint Resolved', req.user.name, `Marked feedback ${req.params.id} as resolved`);
  res.json({ feedback: resolved });
});

module.exports = router;
