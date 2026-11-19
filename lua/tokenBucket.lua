--[[
  Token Bucket rate limiter — atomic Lua script for Redis EVAL.

  Runs as a single atomic operation inside Redis. No race conditions possible
  because Redis is single-threaded and EVAL blocks until the script completes.

  Key:    KEYS[1]  = "bucket:<clientId>" (a Redis HASH)
  Args:   ARGV[1]  = capacity       (max tokens in the bucket)
          ARGV[2]  = refill_rate    (tokens added per second)
          ARGV[3]  = now            (current time in milliseconds, from the caller)

  Hash fields stored:
    tokens      — current token count (float, can be fractional after refill calc)
    last_refill — timestamp (ms) of the last refill computation

  Returns: { allowed (0/1), remaining_tokens, limit, retry_after_ms }
    allowed         = 1 if the request may proceed, 0 if throttled
    remaining       = tokens remaining after this request (0 if denied)
    limit           = bucket capacity (echoed back for the response header)
    retry_after_ms  = milliseconds until the next token arrives (0 if allowed)
]]

local key         = KEYS[1]
local capacity    = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now         = tonumber(ARGV[3])

if capacity == nil or capacity <= 0 then
  capacity = 10
end

if refill_rate == nil or refill_rate <= 0 then
  refill_rate = 2
end

if now == nil or now < 0 then
  now = 0
end

-- Read current state from the hash
local data        = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens      = tonumber(data[1])
local last_refill = tonumber(data[2])

-- First request for this client — initialise a full bucket
if tokens == nil or last_refill == nil then
  tokens      = capacity
  last_refill = now
end

-- Guard against clock drift (system clock moving backwards)
if now < last_refill then
  last_refill = now
end

-- Refill tokens based on elapsed time
local elapsed_ms  = now - last_refill
local elapsed_sec = elapsed_ms / 1000
local refill      = elapsed_sec * refill_rate

if refill > 0 then
  tokens      = math.min(capacity, tokens + refill)
  last_refill = now
end

-- Attempt to consume one token
local allowed        = 0
local retry_after_ms = 0

if tokens >= 1 then
  tokens  = tokens - 1
  allowed = 1
else
  -- Not enough tokens — compute how long until one token is available.
  -- `refill_rate` is always clamped to a positive value before this branch,
  -- but guard it anyway to keep the script resilient to malformed inputs.
  local deficit = 1 - tokens
  if refill_rate > 0 then
    retry_after_ms = math.ceil((deficit / refill_rate) * 1000)
  else
    retry_after_ms = 0
  end
end

-- Persist updated state
redis.call('HSET', key, 'tokens', tokens, 'last_refill', last_refill)

-- Auto-expire the key after 2× the full-refill duration to avoid stale keys
local ttl = math.ceil((capacity / refill_rate) * 2)
if ttl < 60 then ttl = 60 end
redis.call('EXPIRE', key, ttl)

return { allowed, math.floor(tokens), capacity, retry_after_ms }
