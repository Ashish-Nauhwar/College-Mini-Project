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
 * Supports either the designated primary NPS metric (default) or a specific questionId.
 * Never silently mixes multiple distinct NPS questions into a single score.
 * 
 * @param {Array<Object>} feedbacks - List of feedback items
 * @param {string|null} [questionId=null] - Optional specific question ID for targeted NPS metric
 * @returns {Object} { npsScore: number | 'N/A', promoters: number, passives: number, detractors: number, total: number }
 */
function calculateNps(feedbacks, questionId = null) {
  if (!Array.isArray(feedbacks) || feedbacks.length === 0) {
    return { npsScore: 'N/A', promoters: 0, passives: 0, detractors: 0, total: 0 };
  }

  const scores = [];
  for (const f of feedbacks) {
    if (!f || typeof f !== 'object') continue;
    let val;
    if (questionId) {
      if (f.npsAnswers && typeof f.npsAnswers.get === 'function') {
        val = f.npsAnswers.get(questionId);
      } else if (f.npsAnswers && f.npsAnswers[questionId] !== undefined) {
        val = f.npsAnswers[questionId];
      } else if (f.answers && typeof f.answers.get === 'function') {
        val = f.answers.get(questionId);
      } else if (f.answers && f.answers[questionId] !== undefined) {
        val = f.answers[questionId];
      }
    } else {
      val = f.nps;
    }

    if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 10) {
      scores.push(val);
    }
  }

  if (scores.length === 0) {
    return { npsScore: 'N/A', promoters: 0, passives: 0, detractors: 0, total: 0 };
  }

  const promoters = scores.filter(s => s >= 9).length;
  const passives = scores.filter(s => s >= 7 && s <= 8).length;
  const detractors = scores.filter(s => s <= 6).length;
  const total = scores.length;

  const score = Math.round(((promoters - detractors) / total) * 100);

  return {
    npsScore: score,
    promoters,
    passives,
    detractors,
    total
  };
}

/**
 * Unified, deterministic policy for evaluating sentiment, priority, and complaint status.
 * Ensures complaint classification, sentiment, and priority never contradict each other.
 * 
 * Rules:
 * 1. Detractor/Negative indicators:
 *    - Star rating of 1 or 2
 *    - NPS score of 0 through 6 (detractor)
 *    - Explicitly negative sentiment
 *    If ANY negative indicator is present:
 *    - sentiment: 'negative' (positive star rating CANNOT override negative NPS or negative sentiment)
 *    - priority: 'critical' if (rating === 1 || (nps !== null && nps <= 3)), otherwise 'urgent'
 *    - isComplaint: true
 * 2. Positive indicators (only when NO negative indicators are present):
 *    - Star rating >= 4
 *    - NPS score >= 9 (promoter)
 *    - Explicitly positive sentiment
 *    If present:
 *    - sentiment: 'positive'
 *    - priority: 'low'
 *    - isComplaint: false
 * 3. Neutral / unrated (neither negative nor positive indicators):
 *    - Star rating === 3 -> sentiment: 'neutral', priority: 'medium'
 *    - NPS in 7..8 (passive) -> sentiment: 'neutral', priority: 'low'
 *    - Unrated / no data -> sentiment: 'neutral', priority: 'low'
 *    - isComplaint: false
 * 
 * @param {number|null} rating - Star rating (1-5 or null)
 * @param {number|null} nps - NPS score (0-10 or null)
 * @param {string|null} [explicitSentiment=null] - Optional sentiment ('positive', 'neutral', 'negative')
 * @returns {{ sentiment: string, priority: string, isComplaint: boolean }}
 */
function determineSentimentAndPriority(rating, nps, explicitSentiment = null) {
  const hasLowRating = typeof rating === 'number' && Number.isFinite(rating) && rating >= 1 && rating <= 2;
  const hasLowNps = typeof nps === 'number' && Number.isFinite(nps) && nps >= 0 && nps <= 6;
  const isExplicitNegative = explicitSentiment === 'negative';

  if (hasLowRating || hasLowNps || isExplicitNegative) {
    const isCritical = (rating === 1) || (typeof nps === 'number' && Number.isFinite(nps) && nps >= 0 && nps <= 3);
    return {
      sentiment: 'negative',
      priority: isCritical ? 'critical' : 'urgent',
      isComplaint: true
    };
  }

  const isPositiveRating = typeof rating === 'number' && Number.isFinite(rating) && rating >= 4;
  const isPositiveNps = typeof nps === 'number' && Number.isFinite(nps) && nps >= 9;
  const isExplicitPositive = explicitSentiment === 'positive';

  if (isPositiveRating || isPositiveNps || isExplicitPositive) {
    return {
      sentiment: 'positive',
      priority: 'low',
      isComplaint: false
    };
  }

  const isRatingThree = rating === 3;
  return {
    sentiment: 'neutral',
    priority: isRatingThree ? 'medium' : 'low',
    isComplaint: false
  };
}

module.exports = {
  isComplaint,
  calculateAverageRating,
  calculateNps,
  determineSentimentAndPriority
};

