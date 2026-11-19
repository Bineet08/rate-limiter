const fs = require('fs');
const path = require('path');
const redis = require('../lib/redis');
const { normalizeTokenBucketConfig } = require('./config');

// Load the Lua script once at startup
const luaScript = fs.readFileSync(
  path.join(__dirname, '..', 'lua', 'tokenBucket.lua'),
  'utf-8'
);

// Register as a custom command — ioredis will use EVALSHA (sending only the
// script hash) and automatically fall back to EVAL if the script isn't cached.
// This saves ~2KB of network payload per request vs raw EVAL.
redis.defineCommand('tokenBucket', {
  numberOfKeys: 1,
  lua: luaScript,
});

/**
 * Token Bucket rate-limit check.
 *
 * @param {string} clientId  — unique client identifier (from identifyClient middleware)
 * @param {object} config    — { capacity, refillRate }
 *   capacity:   max tokens the bucket holds
 *   refillRate: tokens added per second
 *
 * @returns {object} { allowed, remaining, limit, retryAfterMs }
 */
async function checkTokenBucket(clientId, config) {
  const { capacity, refillRate } = normalizeTokenBucketConfig(config);
  const key = `bucket:${clientId}`;
  const now = Date.now();

  const result = await redis.tokenBucket(
    key,        // KEYS[1]
    capacity,   // ARGV[1]
    refillRate, // ARGV[2]
    now         // ARGV[3]
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

module.exports = checkTokenBucket;
module.exports.normalizeTokenBucketConfig = normalizeTokenBucketConfig;
