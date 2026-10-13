const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/locations (Authenticated - Multi-Tenant Scoped)
router.get('/', requireAuth, async (req, res) => {
  try {
    const businessId = req.user.role === 'superadmin' && req.query.businessId
      ? req.query.businessId
      : req.user.businessId;

    if (!businessId) {
      return res.json({ locations: [] });
    }

    const locations = await db.getLocations(businessId);
    return res.json({
      locations: locations.map(l => {
        const obj = l.toObject ? l.toObject() : l;
        return {
          ...obj,
          id: l._id ? l._id.toString() : l.id
        };
      })
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Get Locations Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve locations' });
  }
});

// POST /api/locations (Authenticated - Multi-Tenant Scoped)
router.post('/', requireAuth, requireRole('owner', 'college_admin', 'manager', 'superadmin'), async (req, res) => {
  try {
    const { name, code, address, phone, manager } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Location name is required' });
    }
    if (!address || !address.trim()) {
      return res.status(400).json({ error: 'Physical address is required' });
    }

    const businessId = req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ error: 'No business linked to your account' });
    }

    const newLoc = await db.createLocation({
      businessId,
      name: name.trim(),
      code: code ? code.trim() : '',
      address: address.trim(),
      phone: phone ? phone.trim() : '',
      manager: manager ? manager.trim() : req.user.name,
      active: true
    });

    await db.logAudit('Location Created', req.user.name, `Added location "${newLoc.name}"`, businessId, req.ip);

    const obj = newLoc.toObject ? newLoc.toObject() : newLoc;
    return res.status(201).json({
      location: {
        ...obj,
        id: newLoc._id ? newLoc._id.toString() : newLoc.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Create Location Error]:', err);
    return res.status(500).json({ error: 'Failed to add new location' });
  }
});

// PUT /api/locations/:id (Authenticated - Multi-Tenant Protected)
router.put('/:id', requireAuth, requireRole('owner', 'college_admin', 'manager', 'superadmin'), async (req, res) => {
  try {
    const loc = await db.getLocationById(req.params.id);
    if (!loc) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const locBizId = loc.businessId ? loc.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && locBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to update this location. Cross-tenant access is prohibited.' });
    }

    const { name, code, address, phone, manager, active } = req.body;
    const updates = {};
    if (name) updates.name = name.trim();
    if (code !== undefined) updates.code = code.trim();
    if (address) updates.address = address.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (manager !== undefined) updates.manager = manager.trim();
    if (active !== undefined) updates.active = Boolean(active);

    const updated = await db.updateLocation(req.params.id, updates);
    await db.logAudit('Location Updated', req.user.name, `Updated location "${updated.name}"`, loc.businessId, req.ip);

    const obj = updated.toObject ? updated.toObject() : updated;
    return res.json({
      location: {
        ...obj,
        id: updated._id ? updated._id.toString() : updated.id
      }
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Update Location Error]:', err);
    return res.status(500).json({ error: 'Failed to update location' });
  }
});

// DELETE /api/locations/:id (Authenticated - Multi-Tenant Protected)
router.delete('/:id', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), async (req, res) => {
  try {
    const loc = await db.getLocationById(req.params.id);
    if (!loc) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // STRICT MULTI-TENANT CHECK
    const locBizId = loc.businessId ? loc.businessId.toString() : '';
    const userBizId = req.user.businessId ? req.user.businessId.toString() : '';

    if (req.user.role !== 'superadmin' && locBizId !== userBizId) {
      return res.status(403).json({ error: 'Unauthorized to delete this location. Cross-tenant access is prohibited.' });
    }

    await db.deleteLocation(req.params.id);
    await db.logAudit('Location Deleted', req.user.name, `Deleted location "${loc.name}"`, loc.businessId, req.ip);

    return res.json({ success: true, message: 'Location deleted successfully' });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Delete Location Error]:', err);
    return res.status(500).json({ error: 'Failed to delete location' });
  }
});

module.exports = router;
