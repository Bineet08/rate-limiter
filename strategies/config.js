function safeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTokenBucketConfig(config = {}) {
  const capacity = safeNumber(config.capacity, 10);
  const refillRate = safeNumber(config.refillRate, 2);

  return {
    capacity: Math.max(1, Math.floor(capacity)),
    refillRate: Math.max(0.001, refillRate),
  };
}

function normalizeSlidingWindowConfig(config = {}) {
  const maxRequests = safeNumber(config.maxRequests, 10);
  const windowMs = safeNumber(config.windowMs, 10000);

  return {
    maxRequests: Math.max(1, Math.floor(maxRequests)),
    windowMs: Math.max(1, windowMs),
  };
}

module.exports = {
  normalizeTokenBucketConfig,
  normalizeSlidingWindowConfig,
};
