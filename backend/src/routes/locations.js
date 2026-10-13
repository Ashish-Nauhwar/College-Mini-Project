const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/locations
router.get('/', requireAuth, (req, res) => {
  const businessId = req.user.role === 'superadmin' && req.query.businessId
    ? req.query.businessId
    : req.user.businessId;

  const locations = db.getLocations(businessId);
  res.json({ locations });
});

// POST /api/locations
router.post('/', requireAuth, (req, res) => {
  const { name, code, address, phone, manager } = req.body;
  if (!name || !address) {
    return res.status(400).json({ error: 'Location name and address are required' });
  }

  const businessId = req.user.businessId;
  if (!businessId && req.user.role !== 'superadmin') {
    return res.status(400).json({ error: 'No associated business found' });
  }

  const newLocation = db.createLocation({
    businessId: businessId || req.body.businessId,
    name,
    code: code || ('LOC-' + Math.floor(10 + Math.random() * 90)),
    address,
    phone: phone || '',
    manager: manager || req.user.name
  });

  db.logAudit('Location Created', req.user.name, `Created location ${name}`);
  res.status(201).json({ location: newLocation });
});

// PUT /api/locations/:id
router.put('/:id', requireAuth, (req, res) => {
  const loc = db.getLocationById(req.params.id);
  if (!loc) {
    return res.status(404).json({ error: 'Location not found' });
  }
  if (req.user.role !== 'superadmin' && loc.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized to modify this location' });
  }

  const updated = db.updateLocation(req.params.id, req.body);
  db.logAudit('Location Updated', req.user.name, `Updated location ${updated.name}`);
  res.json({ location: updated });
});

// DELETE /api/locations/:id
router.delete('/:id', requireAuth, (req, res) => {
  const loc = db.getLocationById(req.params.id);
  if (!loc) {
    return res.status(404).json({ error: 'Location not found' });
  }
  if (req.user.role !== 'superadmin' && loc.businessId !== req.user.businessId) {
    return res.status(403).json({ error: 'Unauthorized to delete this location' });
  }

  db.deleteLocation(req.params.id);
  db.logAudit('Location Deleted', req.user.name, `Deleted location ${loc.name}`);
  res.json({ success: true, message: 'Location deleted' });
});

module.exports = router;
