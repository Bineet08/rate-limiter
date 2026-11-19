--[[
  Sliding Window Log rate limiter — atomic Lua script for Redis EVAL.

  Uses a Redis SORTED SET per client where each request is stored as a member
  with its timestamp as the score. Older entries are pruned on every check.

  Key:    KEYS[1]  = "slidingwindow:<clientId>" (a Redis SORTED SET)
  Args:   ARGV[1]  = max_requests   (max allowed requests within the window)
          ARGV[2]  = window_ms      (window duration in milliseconds)
          ARGV[3]  = now            (current time in milliseconds, from the caller)

  Returns: { allowed (0/1), remaining_requests, limit, retry_after_ms }
    allowed         = 1 if the request may proceed, 0 if throttled
    remaining       = requests remaining in the current window (0 if denied)
    limit           = max_requests (echoed back for the response header)
    retry_after_ms  = milliseconds until the oldest entry expires from the
                      window, freeing up a slot (0 if allowed)
]]

local key          = KEYS[1]
local max_requests = tonumber(ARGV[1])
local window_ms    = tonumber(ARGV[2])
local now          = tonumber(ARGV[3])

if max_requests == nil or max_requests <= 0 then
  max_requests = 10
end

if window_ms == nil or window_ms <= 0 then
  window_ms = 10000
end

if now == nil or now < 0 then
  now = 0
end

-- Prune all entries older than the sliding window
local window_start = now - window_ms
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Guard against clock drift (system clock moving backwards) by pruning future entries
redis.call('ZREMRANGEBYSCORE', key, now + 1, '+inf')

-- Count how many requests remain in the window
local count = redis.call('ZCARD', key)

local allowed        = 0
local remaining      = max_requests - count
local retry_after_ms = 0

if count < max_requests then
  -- Under the limit — record this request.
  -- Member must be unique: since this script is atomic (Redis is single-threaded),
  -- `count` is unique per execution for the same key at the same millisecond,
  -- so using `now:count` guarantees a unique member.
  redis.call('ZADD', key, now, tostring(now) .. ':' .. tostring(count))
  allowed   = 1
  remaining = remaining - 1
else
  -- Over the limit — compute when the oldest entry exits the window
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if #oldest >= 2 then
    local oldest_time = tonumber(oldest[2])
    retry_after_ms = math.max(0, (oldest_time + window_ms) - now)
  end
end

-- Auto-expire the sorted set slightly after the window to prevent stale keys
local ttl = math.max(5, math.ceil(window_ms / 1000) + 5)
redis.call('EXPIRE', key, ttl)

return { allowed, math.max(0, remaining), max_requests, retry_after_ms }
