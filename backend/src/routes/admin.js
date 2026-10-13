const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Protect all admin routes with superadmin role
router.use(requireAuth);
router.use(requireRole('superadmin'));

// GET /api/admin/overview
router.get('/overview', (req, res) => {
  const businesses = db.getBusinesses();
  const users = db.getUsers();
  const allFeedbacks = db.getFeedbacks();
  const auditLogs = db.getAuditLogs();

  const businessStats = businesses.map(b => {
    const bizFeedbacks = allFeedbacks.filter(f => f.businessId === b.id);
    const locations = db.getLocations(b.id);
    const forms = db.getForms(b.id);
    const avg = bizFeedbacks.length > 0
      ? (bizFeedbacks.reduce((s, f) => s + f.rating, 0) / bizFeedbacks.length).toFixed(1)
      : '0.0';

    return {
      ...b,
      locationCount: locations.length,
      formCount: forms.length,
      feedbackCount: bizFeedbacks.length,
      averageRating: avg
    };
  });

  res.json({
    stats: {
      totalBusinesses: businesses.length,
      activeBusinesses: businesses.filter(b => b.active).length,
      totalUsers: users.length,
      totalFeedbacks: allFeedbacks.length,
      systemHealth: '100% Operational',
      uptime: '99.98%'
    },
    businesses: businessStats,
    users: users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      businessId: u.businessId,
      createdAt: u.createdAt
    })),
    auditLogs
  });
});

// PATCH /api/admin/business/:id/toggle
router.patch('/business/:id/toggle', (req, res) => {
  const biz = db.getBusinessById(req.params.id);
  if (!biz) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const updated = db.updateBusiness(req.params.id, { active: !biz.active });
  db.logAudit(
    'Business Status Toggled',
    req.user.name,
    `${updated.active ? 'Activated' : 'Suspended'} business ${biz.name}`
  );

  res.json({ business: updated });
});

module.exports = router;
