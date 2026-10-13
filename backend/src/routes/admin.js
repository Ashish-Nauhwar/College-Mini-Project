const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isDbConnected } = require('../config/db');
const { calculateAverageRating } = require('../utils/analyticsHelper');

// Protect all admin routes with superadmin role
router.use(requireAuth);
router.use(requireRole('superadmin'));

// GET /api/admin/overview
router.get('/overview', async (req, res) => {
  try {
    const businesses = await db.getBusinesses();
    const users = await db.getUsers();
    const allFeedbacks = await db.getFeedbacks();
    const auditLogs = await db.getAuditLogs({}, 50);

    const businessStats = await Promise.all(
      businesses.map(async b => {
        const bIdStr = b._id ? b._id.toString() : b.id;
        const bizFeedbacks = allFeedbacks.filter(f => {
          const fBiz = f.businessId ? (f.businessId._id ? f.businessId._id.toString() : f.businessId.toString()) : '';
          return fBiz === bIdStr;
        });

        const locations = await db.getLocations(b._id);
        const forms = await db.getForms(b._id);
        const avg = calculateAverageRating(bizFeedbacks);

        return {
          id: bIdStr,
          _id: b._id,
          name: b.name,
          type: b.type,
          category: b.category,
          logo: b.logo,
          email: b.email,
          phone: b.phone,
          active: b.active,
          createdAt: b.createdAt,
          locationCount: locations.length,
          formCount: forms.length,
          feedbackCount: bizFeedbacks.length,
          averageRating: avg
        };
      })
    );

    // REAL METRICS: Measure actual uptime & genuine system status
    const uptimeSecs = Math.floor(process.uptime());
    const uptimeHours = Math.floor(uptimeSecs / 3600);
    const uptimeMins = Math.floor((uptimeSecs % 3600) / 60);
    const measuredUptime = `${uptimeHours}h ${uptimeMins}m (Process active)`;
    const genuineHealth = isDbConnected() ? 'Online (MongoDB Connected)' : 'Online (Process Running)';

    return res.json({
      stats: {
        totalBusinesses: businesses.length,
        activeBusinesses: businesses.filter(b => b.active).length,
        totalUsers: users.length,
        totalFeedbacks: allFeedbacks.length,
        systemHealth: genuineHealth,
        uptime: measuredUptime
      },
      businesses: businessStats,
      users: users.map(u => ({
        id: u._id ? u._id.toString() : u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        businessId: u.businessId,
        createdAt: u.createdAt
      })),
      auditLogs
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Admin Overview Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve super-admin metrics' });
  }
});

// PATCH /api/admin/business/:id/toggle
router.patch('/business/:id/toggle', async (req, res) => {
  try {
    const biz = await db.getBusinessById(req.params.id);
    if (!biz) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const updated = await db.updateBusiness(req.params.id, { active: !biz.active });
    await db.logAudit(
      'Business Status Toggled',
      req.user.name,
      `${updated.active ? 'Activated' : 'Suspended'} business "${biz.name}"`,
      biz._id,
      req.ip
    );

    const obj = updated.toObject ? updated.toObject() : updated;
    return res.json({
      business: {
        ...obj,
        id: updated._id ? updated._id.toString() : updated.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Toggle Business Error]:', err);
    return res.status(500).json({ error: 'Failed to toggle business status' });
  }
});

module.exports = router;
