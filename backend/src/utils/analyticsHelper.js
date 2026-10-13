/**
 * FeedbackHub Analytics & Complaints Helper
 * Centralized, tested metrics calculation functions.
 */

/**
 * Determines whether a feedback record is considered a complaint.
 * A feedback is a complaint if:
 * 1. Rating is 1 or 2 stars (low star rating)
 * 2. NPS score is 0 to 6 (detractor)
 * 3. Sentiment is explicitly marked as 'negative'
 * 
 * IMPORTANT: A positive star rating (e.g. 4 or 5) does NOT override a negative NPS or negative sentiment.
 * Any negative indicator qualifies the record as a complaint.
 * 
 * @param {Object} feedback - Feedback document or object
 * @returns {boolean}
 */
function isComplaint(feedback) {
  if (!feedback || typeof feedback !== 'object') return false;

  const hasLowRating = typeof feedback.rating === 'number' &&
    Number.isFinite(feedback.rating) &&
    feedback.rating >= 1 &&
    feedback.rating <= 2;

  const hasLowNps = typeof feedback.nps === 'number' &&
    Number.isFinite(feedback.nps) &&
    feedback.nps >= 0 &&
    feedback.nps <= 6;

  const hasNegativeSentiment = feedback.sentiment === 'negative';

  return Boolean(hasLowRating || hasLowNps || hasNegativeSentiment);
}

/**
 * Calculates strict average star rating (1 to 5 scale).
 * Excludes unrated submissions, NaNs, non-finite values, and ratings outside 1..5.
 * 
 * @param {Array<Object>} feedbacks - List of feedback items
 * @returns {string} Formatted number with 1 decimal place (e.g. "4.2") or "N/A"
 */
function calculateAverageRating(feedbacks) {
  if (!Array.isArray(feedbacks) || feedbacks.length === 0) return 'N/A';

  const rated = feedbacks.filter(f =>
    f &&
    typeof f.rating === 'number' &&
    Number.isFinite(f.rating) &&
    f.rating >= 1 &&
    f.rating <= 5
  );

  if (rated.length === 0) return 'N/A';

  const sum = rated.reduce((acc, cur) => acc + cur.rating, 0);
  return (sum / rated.length).toFixed(1);
}

/**
 * Standard Net Promoter Score (NPS) calculation.
 * 0-6: Detractors
 * 7-8: Passives
 * 9-10: Promoters
 * NPS = ((Promoters - Detractors) / Total Valid NPS Responses) * 100
 * 
 * @param {Array<Object>} feedbacks - List of feedback items
 * @returns {Object} { npsScore: number | 'N/A', promoters: number, passives: number, detractors: number, total: number }
 */
function calculateNps(feedbacks) {
  if (!Array.isArray(feedbacks) || feedbacks.length === 0) {
    return { npsScore: 'N/A', promoters: 0, passives: 0, detractors: 0, total: 0 };
  }

  const npsList = feedbacks.filter(f =>
    f &&
    typeof f.nps === 'number' &&
    Number.isFinite(f.nps) &&
    f.nps >= 0 &&
    f.nps <= 10
  );

  if (npsList.length === 0) {
    return { npsScore: 'N/A', promoters: 0, passives: 0, detractors: 0, total: 0 };
  }

  const promoters = npsList.filter(f => f.nps >= 9).length;
  const passives = npsList.filter(f => f.nps >= 7 && f.nps <= 8).length;
  const detractors = npsList.filter(f => f.nps <= 6).length;
  const total = npsList.length;

  const score = Math.round(((promoters - detractors) / total) * 100);

  return {
    npsScore: score,
    promoters,
    passives,
    detractors,
    total
  };
}

module.exports = {
  isComplaint,
  calculateAverageRating,
  calculateNps
};
