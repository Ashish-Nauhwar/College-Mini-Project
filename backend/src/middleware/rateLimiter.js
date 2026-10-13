/**
 * Production Sliding Window Rate Limiter
 * Zero external dependencies.
 * Implements sliding window request tracking and RFC RateLimit / Retry-After headers.
 */

function createSlidingWindowLimiter({
  windowMs = 60000,
  max = 60,
  message = 'Too many requests. Please slow down and try again shortly.'
} = {}) {
  // Store request timestamps per IP: Map<ip, number[]>
  const hitMap = new Map();

  // Periodic cleanup
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of hitMap.entries()) {
      const valid = timestamps.filter(t => t > cutoff);
      if (valid.length === 0) {
        hitMap.delete(ip);
      } else {
        hitMap.set(ip, valid);
      }
    }
  }, Math.max(10000, windowMs));

  // Allow Node process to exit cleanly without waiting for this timer
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  return (req, res, next) => {
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = (forwarded ? String(forwarded).split(',')[0].trim() : '') ||
      req.ip ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = (hitMap.get(rawIp) || []).filter(t => t > windowStart);
    timestamps.push(now);
    hitMap.set(rawIp, timestamps);

    const currentHits = timestamps.length;
    const remaining = Math.max(0, max - currentHits);
    const oldest = timestamps[0] || now;
    const resetSec = Math.ceil((oldest + windowMs) / 1000);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSec);

    if (currentHits > max) {
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: message,
        retryAfter: retryAfterSec
      });
    }

    next();
  };
}

module.exports = { createSlidingWindowLimiter };
