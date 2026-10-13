const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/forms/slug/:slug (PUBLIC)
router.get('/slug/:slug', (req, res) => {
  const form = db.getFormBySlug(req.params.slug);
  if (!form) {
    return res.status(404).json({ error: 'Feedback form not found' });
  }

  const business = db.getBusinessById(form.businessId);
  const location = form.locationId ? db.getLocationById(form.locationId) : null;

  return res.json({
    form,
    business: business ? {
      name: business.name,
      category: business.category,
      logo: business.logo,
      address: business.address
    } : null,
    location: location ? {
      name: location.name,
      address: location.address
    } : null
  });
});

// GET /api/forms (Authenticated)
router.get('/', requireAuth, (req, res) => {
  const businessId = req.user.role === 'superadmin' && req.query.businessId
    ? req.query.businessId
    : req.user.businessId;

  const forms = db.getForms(businessId);
  const formsWithMeta = forms.map(f => {
    const loc = f.locationId ? db.getLocationById(f.locationId) : null;
    const feedbacks = db.getFeedbacks({ formId: f.id });
    const avgRating = feedbacks.length > 0
      ? (feedbacks.reduce((sum, item) => sum + item.rating, 0) / feedbacks.length).toFixed(1)
      : null;

    return {
      ...f,
      locationName: loc ? loc.name : 'All Locations',
      responseCount: feedbacks.length,
      averageRating: avgRating
    };
  });

  res.json({ forms: formsWithMeta });
});

// GET /api/forms/:id
router.get('/:id', requireAuth, (req, res) => {
  const form = db.getFormById(req.params.id);
  if (!form) {
    return res.status(404).json({ error: 'Form not found' });
  }
  if (req.user.role !== 'superadmin' && form.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized to view this form' });
  }

  const loc = form.locationId ? db.getLocationById(form.locationId) : null;
  res.json({ form: { ...form, locationName: loc ? loc.name : 'All Locations' } });
});

// POST /api/forms
router.post('/', requireAuth, (req, res) => {
  const { title, description, locationId, slug, questions, status, googleReviewUrl } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Form title is required' });
  }

  const cleanSlug = (slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    + '-' + Math.random().toString(36).substring(2, 5);

  const newForm = db.createForm({
    businessId: req.user.businessId,
    locationId: locationId || null,
    slug: cleanSlug,
    title,
    description: description || '',
    status: status || 'published',
    googleReviewUrl: googleReviewUrl || '',
    questions: questions || [
      {
        id: 'q_' + Date.now(),
        type: 'rating',
        text: 'How would you rate your overall experience today?',
        required: true,
        min: 1,
        max: 5
      }
    ]
  });

  db.logAudit('Form Created', req.user.name, `Created form ${title} (${newForm.slug})`);
  res.status(201).json({ form: newForm });
});

// PUT /api/forms/:id
router.put('/:id', requireAuth, (req, res) => {
  const form = db.getFormById(req.params.id);
  if (!form) {
    return res.status(404).json({ error: 'Form not found' });
  }
  if (req.user.role !== 'superadmin' && form.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized to update this form' });
  }

  const updated = db.updateForm(req.params.id, req.body);
  db.logAudit('Form Updated', req.user.name, `Updated form ${updated.title}`);
  res.json({ form: updated });
});

// DELETE /api/forms/:id
router.delete('/:id', requireAuth, (req, res) => {
  const form = db.getFormById(req.params.id);
  if (!form) {
    return res.status(404).json({ error: 'Form not found' });
  }
  if (req.user.role !== 'superadmin' && form.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized to delete this form' });
  }

  db.deleteForm(req.params.id);
  db.logAudit('Form Deleted', req.user.name, `Deleted form ${form.title}`);
  res.json({ success: true, message: 'Form deleted' });
});

module.exports = router;
