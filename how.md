# Distributed API Gateway — Build Specification for Antigravity

## How to build this

**Build and verify one part at a time. Do not generate the full codebase in one pass.**
After each part, stop, show what was built, and wait for confirmation before moving to the next part. This makes bugs easy to isolate — if something breaks, we know exactly which part introduced it.

Order of parts is fixed — do not skip ahead or combine parts, even if it seems efficient. Correctness under concurrency matters more than speed of delivery for this project — do not take shortcuts on the Lua scripting atomicity requirement in Parts 4 and 5.

---

## Project Overview

A standalone Node.js reverse-proxy/API gateway that intercepts incoming traffic, identifies the client (API key, IP, or JWT), and enforces rate limits using two algorithms implemented from scratch with Redis + Lua scripting for atomicity: **Token Bucket** and **Sliding Window Log**. Rate-limit state lives in Redis so it can be shared across multiple gateway instances (distributed rate limiting). The gateway must fail open if Redis goes down, expose standard rate-limit headers, and be load-tested with real numbers.

## Tech Stack

- **Gateway**: Node.js, Express, `http-proxy-middleware`
- **State store**: Redis via `ioredis`
- **Atomicity**: Redis Lua scripting (`EVAL`)
- **Load testing**: Apache Benchmark (`ab`) or `wrk`
- **Dummy backend**: separate small Express service for the gateway to proxy to

## UI Constraints

This is primarily a backend/infra project — no significant UI required. If a `/stats` dashboard is built (Part 6), keep it minimal: flat layout, no gradients, no decorative styling. Plain tables/numbers are fine.

---

## Part 1 — Dummy backend service

Build only this, then stop:
- A minimal Express app on its own port (e.g. 4000) with a route `GET /api/products` returning a small hardcoded JSON array
- No auth, no rate limiting here — this simulates the real backend the gateway will protect

**Verify**: `curl localhost:4000/api/products` returns the JSON array directly.

---

## Part 2 — Baseline proxy (no auth, no rate limiting)

Build only this, then stop:
- A second Express app on a different port (e.g. 3000) — this is the gateway
- Use `http-proxy-middleware` to forward all requests to the Part 1 backend
- No client identification, no rate limiting yet — just pure passthrough

**Verify**: `curl localhost:3000/api/products` returns the same data as hitting the backend directly, proving the proxy forwards correctly.

---

## Part 3 — Client identification middleware

Build only this, then stop:
- Custom Express middleware (runs before the proxy) that extracts a client identifier from the incoming request, in this priority order: JWT (if `Authorization: Bearer <token>` present, decode and use a claim like `sub` or `userId`), else API key (if `X-API-Key` header present, use it directly), else fall back to client IP
- Attach the resolved identifier to `req.clientId`
- Log each request's resolved `clientId` to console for now (no rate limiting yet)

**Verify**: send requests with a JWT, with an API key header, and with neither — confirm the correct `clientId` is logged for each case, in the right priority order.

---

## Part 4 — Redis connection + Token Bucket algorithm

Build only this, then stop:
- Connect to Redis via `ioredis` (local Redis via Docker, or a hosted free-tier instance)
- Implement Token Bucket state as a Redis `HASH` per client (key like `bucket:<clientId>`), with fields `tokens` and `last_refill`
- Write a Lua script (loaded via `EVAL`) that atomically: reads current `tokens`/`last_refill`, computes how many tokens to add based on elapsed time and refill rate, caps at bucket capacity, deducts 1 token if available, writes the updated hash back, and returns whether the request is allowed plus remaining tokens
- Wire this as Express middleware after Part 3: call the Lua script with the client's bucket key, capacity, and refill rate; if not allowed, respond `429 Too Many Requests`; if allowed, proceed to the proxy
- Add response headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

**Verify**:
- Send a burst of requests within bucket capacity — all succeed
- Send sustained requests above the refill rate — later ones get `429` with correct headers
- Send many concurrent requests from the same client simultaneously (e.g. using a small script firing 50 requests in parallel) and confirm the token count never goes negative and never over-allows — this specifically tests that the Lua script is atomic

---

## Part 5 — Sliding Window Log algorithm

Build only this, then stop:
- Implement as a second, independent strategy alongside Token Bucket (do not replace Part 4 — both should coexist)
- State as a Redis `SORTED SET` per client (key like `slidingwindow:<clientId>`), storing request timestamps as scores
- Write a Lua script that atomically: prunes entries older than the window using `ZREMRANGEBYSCORE`, counts remaining entries with `ZCARD`, and if under the limit adds the new timestamp and allows the request, otherwise denies it
- Make the active algorithm selectable via an environment variable or config value (e.g. `RATE_LIMIT_STRATEGY=token_bucket` or `sliding_window_log`), with the middleware from Part 4 calling whichever strategy is configured, sharing the same request/response interface (headers, 429 behavior)

**Verify**:
- With `RATE_LIMIT_STRATEGY=sliding_window_log`, repeat the same burst/sustained/concurrency tests from Part 4 and confirm correct throttling behavior
- Confirm switching the env var between the two strategies changes behavior without any other code changes

---

## Part 6 — Fail-open resilience

Build only this, then stop:
- Wrap the Redis calls (both Lua script invocations) in error handling
- If Redis is unreachable or the call times out, log a clear "fail-open" warning and allow the request through without rate limiting, rather than blocking or crashing the gateway
- Do not silently fail — the fail-open event must be visibly logged each time it happens

**Verify**: stop the Redis instance while sending traffic through the gateway — confirm requests continue to succeed (no 500s, no hangs) and fail-open warnings appear in the logs. Restart Redis and confirm rate limiting resumes normally.

---

## Part 7 — Observability

Build only this, then stop:
- A `GET /stats` route on the gateway (not proxied — handled directly) showing, per client: total requests, allowed count, denied count
- Track these counts in Redis (simple counters) or in-memory if simpler, as long as it's clearly documented which approach was used and why
- Keep the output as plain JSON or a minimal flat HTML table — no styling beyond basic readability

**Verify**: generate mixed allowed/denied traffic, then confirm `/stats` accurately reflects the real counts.

---

## Part 8 — Load testing

Build only this, then stop:
- Do not write new gateway code in this part — this is a testing/documentation part
- Run `ab` or `wrk` against the gateway with realistic concurrency (e.g. `ab -n 10000 -c 100 http://localhost:3000/api/products`)
- Capture real output: requests/sec, latency percentiles (p50/p95/p99), error rate
- Repeat for both rate-limiting strategies under identical load parameters
- Save raw benchmark output to a `benchmarks/` folder in the repo as plain text files, plus a short summary table in the README comparing the two algorithms

**Verify**: benchmark output files exist and the README summary table accurately reflects them — no invented or rounded-up numbers.

---

## Part 9 — Documentation and deploy (only after Parts 1–8 are confirmed working)

- Deploy the gateway + dummy backend (Render/Railway), with hosted Redis (e.g. Upstash free tier)
- Write a full README: architecture diagram (text-based ASCII or a simple image is fine), explanation of both algorithms, the fail-open design decision, and the load test results table from Part 8
- Confirm the deployed version behaves the same as local (spot-check rate limiting and fail-open manually)

---

## Explicitly out of scope for this build (do not add unless asked)

- A frontend/UI beyond the minimal `/stats` route from Part 7
- Additional rate-limiting algorithms beyond Token Bucket and Sliding Window Log (Sliding Window Counter can be discussed later, not built by default)
- User authentication/account system beyond parsing an existing JWT/API key — this gateway does not issue credentials, it only reads them
- Multi-region or Redis Cluster setup — single Redis instance is sufficient for this build
- Any AI-generated visual styling (gradients, glow effects, glassmorphism) anywhere in the project