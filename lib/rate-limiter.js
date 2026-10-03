'use strict';

/**
 * Small in-memory sliding-window rate limiter, keyed per user.
 *
 * Used by the command router to stop a single chat user from flooding the
 * queue or burning OpenAI/Spotify quota (security review O-009).
 *
 * @module rate-limiter
 */

const DEFAULT_MAX_KEYS = 10000;

/**
 * @param {object} options
 * @param {number|function(): number} options.limit - Max hits per window. A
 *   function is re-read on every hit so config changes apply live. A value
 *   <= 0 disables the limiter.
 * @param {number} options.windowMs - Window length in milliseconds.
 * @param {number} [options.maxKeys] - Cap on tracked keys, so a stream of
 *   unique user names can't grow the map without bound.
 * @param {function(): number} [options.now] - Clock, injectable for tests.
 */
function createRateLimiter({ limit, windowMs, maxKeys = DEFAULT_MAX_KEYS, now = Date.now }) {
  // key -> { hits: number[] (timestamps, oldest first), warned: boolean }
  const buckets = new Map();

  function currentLimit() {
    const value = typeof limit === 'function' ? limit() : limit;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Record a hit for `key`.
   * @returns {{allowed: boolean, retryAfterMs: number, firstBlock: boolean}}
   *   `firstBlock` is true only for the first rejected hit in a window, so
   *   callers can tell the user once instead of replying to every message.
   */
  function hit(key) {
    const max = currentLimit();
    if (max <= 0) return { allowed: true, retryAfterMs: 0, firstBlock: false };

    const t = now();
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= maxKeys) {
        // Drop the oldest tracked key (Map preserves insertion order).
        buckets.delete(buckets.keys().next().value);
      }
      bucket = { hits: [], warned: false };
      buckets.set(key, bucket);
    }

    while (bucket.hits.length && bucket.hits[0] <= t - windowMs) {
      bucket.hits.shift();
    }
    if (bucket.hits.length === 0) bucket.warned = false;

    if (bucket.hits.length >= max) {
      const firstBlock = !bucket.warned;
      bucket.warned = true;
      return { allowed: false, retryAfterMs: bucket.hits[0] + windowMs - t, firstBlock };
    }

    bucket.hits.push(t);
    return { allowed: true, retryAfterMs: 0, firstBlock: false };
  }

  function reset(key) {
    if (key === undefined) buckets.clear();
    else buckets.delete(key);
  }

  return { hit, reset, size: () => buckets.size };
}

module.exports = { createRateLimiter };
