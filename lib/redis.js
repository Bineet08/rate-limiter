const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, {
  // Reconnect aggressively but don't block the process
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy(times) {
    // Exponential backoff: 50ms, 100ms, 200ms, ... capped at 2s
    return Math.min(times * 50, 2000);
  },
  lazyConnect: false,
});

redis.on('connect', () => {
  console.log('[Redis] Connected to', REDIS_URL);
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

module.exports = redis;
