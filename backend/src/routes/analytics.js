const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/analytics/dashboard (Authenticated - Multi-Tenant Scoped)
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const businessId = req.user.role === 'superadmin' && req.query.businessId
      ? req.query.businessId
      : req.user.businessId;

    if (!businessId) {
      return res.json({
        summary: { total: 0, avgRating: 'N/A', npsScore: 'N/A', pendingComplaints: 0, resolutionRate: 100, resolvedComplaints: 0, totalComplaints: 0 },
        sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
        ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        timeline: [],
        locationStats: []
      });
    }

    const locationId = req.query.locationId;
    const timeRange = req.query.timeRange || 'all'; // 'today', '7d', '30d', 'all'

    const filter = { businessId };
    if (locationId && locationId !== 'all') {
      filter.locationId = locationId;
    }

    let list = await db.getFeedbacks(filter);

    // Filter by time range if specified
    const now = new Date();
    if (timeRange === 'today') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      list = list.filter(fb => new Date(fb.createdAt) >= startOfDay);
    } else if (timeRange === '7d') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      list = list.filter(fb => new Date(fb.createdAt) >= sevenDaysAgo);
    } else if (timeRange === '30d') {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      list = list.filter(fb => new Date(fb.createdAt) >= thirtyDaysAgo);
    }

    const total = list.length;

    // Average Star Rating: calculate ONLY from feedbacks that have a rating
    const ratedResponses = list.filter(fb => typeof fb.rating === 'number' && !isNaN(fb.rating));
    const avgRating = ratedResponses.length > 0
      ? (ratedResponses.reduce((acc, cur) => acc + cur.rating, 0) / ratedResponses.length).toFixed(1)
      : 'N/A';

    // Standard NPS Calculation (0-10 scale)
    // 0-6: detractors, 7-8: passives, 9-10: promoters
    // NPS = % promoters - % detractors
    const npsResponses = list.filter(fb => typeof fb.nps === 'number' && !isNaN(fb.nps) && fb.nps >= 0 && fb.nps <= 10);
    let npsScore = 'N/A';
    let npsPromoters = 0;
    let npsPassives = 0;
    let npsDetractors = 0;

    if (npsResponses.length > 0) {
      npsPromoters = npsResponses.filter(fb => fb.nps >= 9).length;
      npsPassives = npsResponses.filter(fb => fb.nps >= 7 && fb.nps <= 8).length;
      npsDetractors = npsResponses.filter(fb => fb.nps <= 6).length;
      npsScore = Math.round(((npsPromoters - npsDetractors) / npsResponses.length) * 100);
    }

    // Sentiment Breakdown
    const sentimentCounts = {
      positive: list.filter(fb => fb.sentiment === 'positive').length,
      neutral: list.filter(fb => fb.sentiment === 'neutral').length,
      negative: list.filter(fb => fb.sentiment === 'negative').length
    };

    // Rating Breakdown (1 to 5 stars only for rated submissions)
    const ratingCounts = {
      1: list.filter(fb => fb.rating === 1).length,
      2: list.filter(fb => fb.rating === 2).length,
      3: list.filter(fb => fb.rating === 3).length,
      4: list.filter(fb => fb.rating === 4).length,
      5: list.filter(fb => fb.rating === 5).length
    };

    // Resolution metrics: negative rating (<=2), or negative NPS (<=6), or negative sentiment
    const complaints = list.filter(fb =>
      typeof fb.rating === 'number'
        ? fb.rating <= 2
        : (typeof fb.nps === 'number' ? fb.nps <= 6 : fb.sentiment === 'negative')
    );
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
      dateMap[key] = { date: key, count: 0, ratedCount: 0, totalRating: 0 };
    }

    list.forEach(fb => {
      const d = new Date(fb.createdAt);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (dateMap[key]) {
        dateMap[key].count += 1;
        if (typeof fb.rating === 'number' && !isNaN(fb.rating)) {
          dateMap[key].ratedCount += 1;
          dateMap[key].totalRating += fb.rating;
        }
      }
    });

    const timeline = Object.values(dateMap).map(item => ({
      date: item.date,
      count: item.count,
      avgRating: item.ratedCount > 0 ? (item.totalRating / item.ratedCount).toFixed(1) : null
    }));

    // Location breakdown
    const locations = await db.getLocations(businessId);
    const locationStats = locations.map(loc => {
      const locIdStr = loc._id ? loc._id.toString() : loc.id;
      const locFeedbacks = list.filter(fb => {
        const fbLoc = fb.locationId ? (fb.locationId._id ? fb.locationId._id.toString() : fb.locationId.toString()) : '';
        return fbLoc === locIdStr;
      });

      const locRated = locFeedbacks.filter(f => typeof f.rating === 'number' && !isNaN(f.rating));
      const locAvg = locRated.length > 0
        ? (locRated.reduce((s, f) => s + f.rating, 0) / locRated.length).toFixed(1)
        : 'N/A';

      return {
        id: locIdStr,
        name: loc.name,
        total: locFeedbacks.length,
        avgRating: locAvg,
        pending: locFeedbacks.filter(f => f.status !== 'resolved' && (typeof f.rating === 'number' ? f.rating <= 2 : f.sentiment === 'negative')).length
      };
    });

    return res.json({
      summary: {
        total,
        avgRating,
        npsScore,
        npsDetails: {
          promoters: npsPromoters,
          passives: npsPassives,
          detractors: npsDetractors,
          total: npsResponses.length
        },
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
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Analytics Error]:', err);
    return res.status(500).json({ error: 'Failed to generate analytics data' });
  }
});

module.exports = router;
