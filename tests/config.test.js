const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTokenBucketConfig,
  normalizeSlidingWindowConfig,
} = require('../strategies/config');

test('token bucket config clamps invalid values to safe defaults', () => {
  assert.deepStrictEqual(normalizeTokenBucketConfig({ capacity: 0, refillRate: 0 }), {
    capacity: 1,
    refillRate: 0.001,
  });

  assert.deepStrictEqual(normalizeTokenBucketConfig({ capacity: 'abc', refillRate: 'xyz' }), {
    capacity: 10,
    refillRate: 2,
  });
});

test('sliding window config clamps invalid values to safe defaults', () => {
  assert.deepStrictEqual(normalizeSlidingWindowConfig({ maxRequests: 0, windowMs: 0 }), {
    maxRequests: 1,
    windowMs: 1,
  });

  assert.deepStrictEqual(normalizeSlidingWindowConfig({ maxRequests: 'abc', windowMs: 'xyz' }), {
    maxRequests: 10,
    windowMs: 10000,
  });
});
