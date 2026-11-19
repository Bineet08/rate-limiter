# Future Improvements & Architectural Roadmap

This document outlines structural, security, and algorithmic enhancements to evolve this rate-limiting API gateway into an enterprise-ready system.

---

## 1. Absolute Clock Skew Resilience via Redis TIME
*   **Current Limit:** The application server computes `Date.now()` and passes it to the Lua script as the `now` argument. In a distributed multi-node gateway setup, clock drift between gateway servers can cause rate limit computation inconsistencies.
*   **Improvement:** Retrieve the timestamp directly inside Redis using:
    ```lua
    local redis_time = redis.call('TIME')
    local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
    ```
    This guarantees a single source of truth for time across all distributed gateway instances.

---

## 2. Local In-Memory Fallback (Defensive Fail-Open)
*   **Current Limit:** When Redis is offline, the gateway fails open completely, allowing unrestricted traffic. While this ensures availability, a severe outage could lead to backend starvation or a denial-of-service (DoS) on downstream microservices.
*   **Improvement:** Implement an in-memory backup rate limiter (e.g., using `lru-cache` or a simple JS map with token bucket logic). When Redis fails, fall back to locally tracking traffic per client. This enforces a secondary, localized rate limit to shield microservices until Redis recovers.

---

## 3. Dynamic Configurations & Route-Specific Rate Limits
*   **Current Limit:** Rate limit parameters (Capacity, Refill Rate, Window duration) are globally configured via environment variables. This prevents route-specific adjustments (e.g., `/api/checkout` should be more restricted than `/api/products`).
*   **Improvement:**
    1.  Implement a route-mapping layer matching routes to specific limit tiers (e.g., tier-based configs stored in Redis).
    2.  Support dynamic hot-reloading of configs so administrators can modify limit thresholds without restarting the gateway processes.

---

## 4. Algorithmic Upgrades: Sliding Window Counter
*   **Current Limit:** The system currently offers Token Bucket ($O(1)$ memory but allows bursts) and Sliding Window Log ($O(\log N)$ CPU/Memory).
*   **Improvement:** Implement **Sliding Window Counter**. By keeping track of request counts in the previous and current time segments (using Redis Hashes with automatic expiration), this algorithm yields:
    *   **Constant memory usage** ($O(1)$ complexity) unlike Sliding Window Log.
    *   **Protection against burst traffic at window boundaries** unlike Token Bucket.

---

## 5. Telemetry & Centralized Alerting
*   **Current Limit:** Local fail-open metrics and system logs are outputted to standard console logs on individual gateway instances.
*   **Improvement:**
    *   Integrate Winston or Pino for structured, JSON-formatted application logs.
    *   Expose a Prometheus metric endpoint (`/metrics`) exposing request rates, hit/miss ratios, fail-open event counts, and latency percentiles.
    *   Configure automated Slack/PagerDuty alerts triggered by sustained Redis connection errors.
