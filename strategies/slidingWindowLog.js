const fs = require('fs');
const path = require('path');
const redis = require('../lib/redis');
const { normalizeSlidingWindowConfig } = require('./config');

// Load the Lua script once at startup
const luaScript = fs.readFileSync(
  path.join(__dirname, '..', 'lua', 'slidingWindowLog.lua'),
  'utf-8'
);

// Register as a custom command — ioredis will use EVALSHA (sending only the
// script hash) and automatically fall back to EVAL if the script isn't cached.
redis.defineCommand('slidingWindowLog', {
  numberOfKeys: 1,
  lua: luaScript,
});

/**
 * Sliding Window Log rate-limit check.
 *
 * @param {string} clientId  — unique client identifier (from identifyClient middleware)
 * @param {object} config    — { maxRequests, windowMs }
 *   maxRequests: max requests allowed within the window
 *   windowMs:   window duration in milliseconds
 *
 * @returns {object} { allowed, remaining, limit, retryAfterMs }
 */
async function checkSlidingWindowLog(clientId, config) {
  const { maxRequests, windowMs } = normalizeSlidingWindowConfig(config);
  const key = `slidingwindow:${clientId}`;
  const now = Date.now();

  const result = await redis.slidingWindowLog(
    key,         // KEYS[1]
    maxRequests, // ARGV[1]
    windowMs,    // ARGV[2]
    now          // ARGV[3]
  );

  // Lua returns an array: [allowed, remaining, limit, retryAfterMs]
  const [allowed, remaining, limit, retryAfterMs] = result;

  return {
    allowed: allowed === 1,
    remaining,
    limit,
    retryAfterMs,
  };
}

module.exports = checkSlidingWindowLog;
module.exports.normalizeSlidingWindowConfig = normalizeSlidingWindowConfig;
