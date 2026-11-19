const redis = require('../lib/redis');

let localFailOpenCount = 0;

/**
 * Stats tracker — records per-client request outcomes in Redis, and
 * tracks local fail-open bypasses in memory.
 *
 * Uses a Redis HASH per client at key `stats:<clientId>` with fields:
 *   total   — total requests seen
 *   allowed — requests that passed rate limiting
 *   denied  — requests that were throttled (429)
 *
 * Stats are stored in Redis (not in-memory) so they persist across gateway
 * restarts and are shared across multiple gateway instances.
 *
 * Stat recording is fire-and-forget (no await) so it never slows down
 * request handling, and errors are silently ignored (stats are best-effort).
 */
const stats = {
  /**
   * Record a request outcome for a client.
   * @param {string} clientId
   * @param {boolean} allowed
   */
  record(clientId, allowed) {
    const key = `stats:${clientId}`;
    const pipeline = redis.pipeline();
    pipeline.hincrby(key, 'total', 1);
    pipeline.hincrby(key, allowed ? 'allowed' : 'denied', 1);
    pipeline.exec().catch(() => {
      // Best-effort: if Redis is down, stats are lost.
    });
  },

  /**
   * Record a local fail-open event when Redis is offline.
   */
  recordLocalFailOpen() {
    localFailOpenCount++;
  },

  /**
   * Retrieve stats for all tracked clients.
   * Resilient to Redis outages — returns local fail-open stats even if Redis is down.
   */
  async getAll() {
    try {
      const keys = [];
      let cursor = '0';
      do {
        const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', 'stats:*', 'COUNT', 100);
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');

      if (keys.length === 0) {
        return {
          clients: {},
          strategy: process.env.RATE_LIMIT_STRATEGY || 'token_bucket',
          failOpenRequests: localFailOpenCount,
          redisConnected: true,
        };
      }

      const pipeline = redis.pipeline();
      for (const key of keys) {
        pipeline.hgetall(key);
      }
      const results = await pipeline.exec();

      const clients = {};
      for (let i = 0; i < keys.length; i++) {
        const clientId = keys[i].replace('stats:', '');
        const [err, data] = results[i];
        if (!err && data) {
          clients[clientId] = {
            total: parseInt(data.total, 10) || 0,
            allowed: parseInt(data.allowed, 10) || 0,
            denied: parseInt(data.denied, 10) || 0,
          };
        }
      }

      return {
        clients,
        strategy: process.env.RATE_LIMIT_STRATEGY || 'token_bucket',
        failOpenRequests: localFailOpenCount,
        redisConnected: true,
      };
    } catch (err) {
      // Fallback: If Redis is offline, still return local fail-open count
      return {
        clients: {},
        strategy: process.env.RATE_LIMIT_STRATEGY || 'token_bucket',
        failOpenRequests: localFailOpenCount,
        redisConnected: false,
        warning: 'Redis is offline. Showing local in-memory metrics only.',
      };
    }
  },
};

module.exports = stats;
