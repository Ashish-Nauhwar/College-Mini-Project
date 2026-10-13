const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/analytics/dashboard
router.get('/dashboard', requireAuth, (req, res) => {
  const businessId = req.user.role === 'superadmin' && req.query.businessId
    ? req.query.businessId
    : req.user.businessId;

  const locationId = req.query.locationId;
  const timeRange = req.query.timeRange || 'all'; // 'today', '7d', '30d', 'all'

  let list = db.getFeedbacks({ businessId, locationId });

  // Filter by time range if specified
  const now = new Date();
  if (timeRange === 'today') {
    const todayStr = now.toISOString().split('T')[0];
    list = list.filter(fb => fb.createdAt.startsWith(todayStr));
  } else if (timeRange === '7d') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    list = list.filter(fb => new Date(fb.createdAt) >= sevenDaysAgo);
  } else if (timeRange === '30d') {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    list = list.filter(fb => new Date(fb.createdAt) >= thirtyDaysAgo);
  }

  const total = list.length;
  const avgRating = total > 0
    ? (list.reduce((acc, cur) => acc + cur.rating, 0) / total).toFixed(1)
    : '0.0';

  // NPS Calculation
  const npsResponses = list.filter(fb => fb.nps !== null && fb.nps !== undefined);
  let npsScore = 0;
  if (npsResponses.length > 0) {
    const promoters = npsResponses.filter(fb => fb.nps >= 9).length;
    const detractors = npsResponses.filter(fb => fb.nps <= 6).length;
    npsScore = Math.round(((promoters - detractors) / npsResponses.length) * 100);
  }

  // Sentiment Breakdown
  const sentimentCounts = {
    positive: list.filter(fb => fb.sentiment === 'positive').length,
    neutral: list.filter(fb => fb.sentiment === 'neutral').length,
    negative: list.filter(fb => fb.sentiment === 'negative').length
  };

  // Rating Breakdown (1 to 5 stars)
  const ratingCounts = {
    1: list.filter(fb => fb.rating === 1).length,
    2: list.filter(fb => fb.rating === 2).length,
    3: list.filter(fb => fb.rating === 3).length,
    4: list.filter(fb => fb.rating === 4).length,
    5: list.filter(fb => fb.rating === 5).length
  };

  // Resolution metrics
  const complaints = list.filter(fb => fb.rating <= 2);
  const resolvedComplaints = complaints.filter(fb => fb.status === 'resolved').length;
  const pendingComplaints = complaints.filter(fb => fb.status !== 'resolved').length;
  const resolutionRate = complaints.length > 0
    ? Math.round((resolvedComplaints / complaints.length) * 100)
    : 100;

  // Timeline (Last 7 days data points)
  const dateMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    dateMap[key] = { date: key, count: 0, totalRating: 0 };
  }

  list.forEach(fb => {
    const d = new Date(fb.createdAt);
    const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (dateMap[key]) {
      dateMap[key].count += 1;
      dateMap[key].totalRating += fb.rating;
    }
  });

  const timeline = Object.values(dateMap).map(item => ({
    date: item.date,
    count: item.count,
    avgRating: item.count > 0 ? (item.totalRating / item.count).toFixed(1) : 0
  }));

  // Location breakdown
  const locations = db.getLocations(businessId);
  const locationStats = locations.map(loc => {
    const locFeedbacks = list.filter(fb => fb.locationId === loc.id);
    const locAvg = locFeedbacks.length > 0
      ? (locFeedbacks.reduce((s, f) => s + f.rating, 0) / locFeedbacks.length).toFixed(1)
      : '0.0';
    return {
      id: loc.id,
      name: loc.name,
      total: locFeedbacks.length,
      avgRating: locAvg,
      pending: locFeedbacks.filter(f => f.status !== 'resolved' && f.rating <= 2).length
    };
  });

  res.json({
    summary: {
      total,
      avgRating,
      npsScore,
      pendingComplaints,
      resolutionRate,
      resolvedComplaints,
      totalComplaints: complaints.length
    },
    sentimentCounts,
    ratingCounts,
    timeline,
    locationStats
  });
});

module.exports = router;
