const checkTokenBucket = require('../strategies/tokenBucket');
const checkSlidingWindowLog = require('../strategies/slidingWindowLog');
const { normalizeTokenBucketConfig, normalizeSlidingWindowConfig } = require('../strategies/config');
const stats = require('../lib/stats');

// Strategy selection via environment variable
const STRATEGY = process.env.RATE_LIMIT_STRATEGY || 'token_bucket';

// Configuration for each strategy — can be overridden via environment variables
const TOKEN_BUCKET_CONFIG = normalizeTokenBucketConfig({
  capacity: process.env.RATE_LIMIT_CAPACITY,
  refillRate: process.env.RATE_LIMIT_REFILL_RATE,
});

const SLIDING_WINDOW_CONFIG = normalizeSlidingWindowConfig({
  maxRequests: process.env.RATE_LIMIT_MAX_REQUESTS,
  windowMs: process.env.RATE_LIMIT_WINDOW_MS,
});

/**
 * Calls the configured rate-limit strategy and returns a uniform result object.
 * Both strategies return: { allowed, remaining, limit, retryAfterMs }
 */
async function checkRateLimit(clientId) {
  switch (STRATEGY) {
    case 'sliding_window_log':
      return checkSlidingWindowLog(clientId, SLIDING_WINDOW_CONFIG);
    case 'token_bucket':
    default:
      return checkTokenBucket(clientId, TOKEN_BUCKET_CONFIG);
  }
}

console.log(`[RateLimiter] Strategy: ${STRATEGY}`);

/**
 * Rate-limiting middleware — strategy-agnostic.
 *
 * Must be mounted AFTER identifyClient middleware (depends on req.clientId).
 * Sets standard rate-limit headers on every response (both allowed and denied).
 */
async function rateLimiter(req, res, next) {
  const clientId = req.clientId;

  if (!clientId) {
    // Safety check — identifyClient should always set this
    console.error('[RateLimiter] No clientId on request — skipping rate limit');
    return next();
  }

  let result;

  try {
    result = await checkRateLimit(clientId);
  } catch (err) {
    // ── FAIL-OPEN ──────────────────────────────────────────────────────
    // Redis is unreachable or the Lua script timed out. Rather than
    // blocking legitimate traffic or crashing the gateway, we allow the
    // request through without rate limiting.
    //
    // This is a deliberate availability-over-enforcement tradeoff:
    // temporary over-admission is preferable to a full outage.
    // ───────────────────────────────────────────────────────────────────
    console.warn(
      `[RateLimiter] ⚠️  FAIL-OPEN — Redis error, allowing request through without rate limiting. ` +
      `client=${clientId} method=${req.method} url=${req.url} error="${err.message}"`
    );
    stats.recordLocalFailOpen();
    return next();
  }

  // Set rate-limit headers on every response
  res.set('X-RateLimit-Limit', String(result.limit));
  res.set('X-RateLimit-Remaining', String(result.remaining));

  // Reset = seconds until capacity is freed
  const resetSeconds = result.allowed
    ? (STRATEGY === 'token_bucket'
        ? Math.ceil(1 / TOKEN_BUCKET_CONFIG.refillRate)
        : Math.ceil(SLIDING_WINDOW_CONFIG.windowMs / 1000))
    : Math.ceil(result.retryAfterMs / 1000) || 1;
  res.set('X-RateLimit-Reset', String(resetSeconds));

  if (!result.allowed) {
    // Also set Retry-After (standard HTTP header for 429)
    res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000) || 1));

    console.log(
      `[RateLimiter] DENIED ${req.method} ${req.url} — client=${clientId} strategy=${STRATEGY} remaining=${result.remaining}`
    );

    stats.record(clientId, false);

    return res.status(429).json({
      error: 'Too Many Requests',
      retryAfterMs: result.retryAfterMs,
      limit: result.limit,
    });
  }

  console.log(
    `[RateLimiter] ALLOWED ${req.method} ${req.url} — client=${clientId} strategy=${STRATEGY} remaining=${result.remaining}`
  );

  stats.record(clientId, true);

  next();
}

module.exports = rateLimiter;
