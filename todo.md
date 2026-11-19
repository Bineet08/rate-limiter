# Distributed API Gateway with Algorithmic Rate Limiting

A standalone Node.js proxy server that intercepts, authenticates, and rate-limits traffic before forwarding it to backend services — using Redis + Lua scripting for atomic, distributed rate-limit state shared across multiple gateway instances.

---

## Constraints

- **Timeline**: demoable before placements — get the baseline gateway + one algorithm working before chasing extra features
- **Correctness under concurrency is non-negotiable** — race conditions in rate-limit counting defeat the entire point of the project; this is why Lua scripting in Redis is required, not optional
- **Must degrade gracefully** — a Redis outage should never take down legitimate traffic (fail-open)
- **Must be load-tested with real numbers** — a resume claim like "handles 5,000 req/s at sub-10ms" needs actual `ab`/`wrk` output backing it, not a guess
- **Solo project, free-tier friendly** — local Redis or a free-tier hosted Redis (e.g. Upstash) is fine

---

## Tech Stack

- Gateway: Node.js, Express, `http-proxy-middleware`
- State store: Redis, accessed via `ioredis`
- Atomicity: Redis Lua scripting (`EVAL`/`EVALSHA`) for both rate-limit algorithms
- Load testing: Apache Benchmark (`ab`) or `wrk`
- Backend under test: a dummy Express service (e.g. fake `/api/products` route)

---

## Phase 1 — Baseline gateway (no rate limiting yet)

- [x] Set up Express server with `http-proxy-middleware` routing all traffic to a dummy backend
- [x] Build the dummy backend service (separate port) with a sample route like `GET /api/products` returning fake data
- [x] Write a custom interceptor middleware that parses API key (header), IP address, and/or JWT from incoming requests — attach identified client ID to the request object
- [x] Confirm gateway forwards requests correctly and returns backend responses unmodified

**Definition of done**: hitting the gateway's `/api/products` correctly proxies to and returns data from the dummy backend, and the client identifier (API key/IP/JWT) is correctly extracted and logged per request.

---

## Phase 2 — Redis integration

- [x] Set up Redis (local via Docker, or free-tier hosted like Upstash)
- [x] Connect via `ioredis` from the gateway
- [x] Verify basic read/write to Redis works from the Node.js process (simple `SET`/`GET` test)

**Definition of done**: gateway can read and write arbitrary keys to Redis reliably.

---

## Phase 3 — Token Bucket algorithm (Redis + Lua)

- [x] Design bucket state as a Redis `HASH` per client: fields `tokens` and `last_refill`
- [x] Write a Lua script that atomically: reads current tokens + last_refill, computes refill based on elapsed time, deducts a token if available, writes updated state back — all in one atomic `EVAL` call
- [x] Wire this into the gateway as a middleware: reject with `429` if bucket is empty, allow otherwise
- [x] Add standard headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

**Definition of done**: burst traffic within bucket capacity passes; sustained traffic above refill rate gets throttled with correct `429` + headers; concurrent requests don't cause incorrect token counts (test with parallel requests).

---

## Phase 4 — Sliding Window Log algorithm (Redis + Lua)

- [x] Design state as a Redis `SORTED SET` per client: timestamps as scores
- [x] Write a Lua script that atomically: prunes old entries via `ZREMRANGEBYSCORE`, counts remaining via `ZCARD`, adds new timestamp if under limit — all in one atomic `EVAL` call
- [x] Make the algorithm choice swappable via config (strategy pattern — same middleware interface, different backend implementation)
- [x] Same standard headers as Phase 3

**Definition of done**: same correctness test as Phase 3, but using Sliding Window Log; can switch between Token Bucket and Sliding Window via config without changing gateway code elsewhere.

---

## Phase 5 — Resilience: fail-open logic

- [x] Wrap all Redis calls with error handling
- [x] If Redis is unreachable/times out, bypass rate limiting entirely for that request (fail open) rather than blocking or crashing
- [x] Log fail-open events clearly (so it's visible this safety mechanism exists and works)

**Definition of done**: manually kill the Redis instance mid-traffic and confirm the gateway keeps serving requests without rate limiting, then recovers rate limiting once Redis is back.

---

## Phase 6 — Observability + config

- [ ] Config for per-route limits (different limits for different backend routes)
- [x] Simple `/stats` endpoint showing allowed vs rejected counts per client
- [x] Logging of throttling decisions (which client, which algorithm, allowed/denied)

**Definition of done**: `/stats` accurately reflects real traffic patterns during a manual test.

---

## Phase 7 — Load testing (required for the resume claim)

- [ ] Install and run `ab` or `wrk` against the gateway under realistic concurrent load
- [ ] Measure and record: requests/sec sustained, proxy latency (p50/p95/p99), correctness (no incorrect throttling or leaks) under load
- [ ] Test both algorithms under identical synthetic traffic and compare memory usage + accuracy tradeoffs
- [ ] Write up real numbers — do not estimate or round up in the resume bullet; use actual benchmark output

**Definition of done**: a documented benchmark run with real numbers you can defend if asked in an interview.

---

## Phase 8 — Polish and deploy

- [ ] README with architecture diagram, algorithm explanations, and benchmark comparison table
- [ ] Deploy gateway + dummy backend (Render/Railway) with hosted Redis (Upstash free tier)
- [ ] Optional: Sliding Window Counter (hybrid) as a bonus third algorithm if time allows
- [ ] Record a short demo (script firing burst + sustained traffic, showing live 429s and headers)

---

## Things to be ready to explain in interviews

- Why Lua scripting is required for correctness (atomicity — prevents race conditions when concurrent requests hit the same client's rate-limit state)
- Token Bucket vs Sliding Window Log: memory usage, accuracy, and burst-handling tradeoffs
- Why fail-open instead of fail-closed (availability vs strict enforcement tradeoff)
- How this would scale further (Redis Cluster, consistent hashing across gateway instances)
- Real benchmark numbers and what they mean (latency under load, why it matters)

---

## Open decisions (fill in as you go)

- [ ] Project name
- [ ] Local Redis (Docker) vs hosted (Upstash) for development
- [ ] Which client identifier to prioritize first: API key, IP, or JWT (can support all three, but pick one to build first)
- [ ] Whether to add Sliding Window Counter as a third algorithm