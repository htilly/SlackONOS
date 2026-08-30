'use strict';

/**
 * Guards against prototype-pollution when a string of unknown/attacker
 * influence (a chat username, display name, etc.) is used as a plain-object
 * key, e.g. `store[key] = {}`. If `key` is one of the special names below,
 * that assignment does not create an own property — it reaches through the
 * prototype chain and mutates the shared object/function it names instead.
 *
 * See: security-review finding O-001 (index.js `_logUserAction`) and the
 * related defense-in-depth hardening in lib/ai-handler.js `buildContextKey`.
 *
 * @module safe-object-key
 */

// The three property names that resolve through the prototype chain instead
// of creating a normal own property on a plain object.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * @param {string} key - The candidate object key.
 * @returns {boolean} true if using `key` as a plain-object key would reach
 *   the prototype chain rather than creating a normal own property.
 */
function isUnsafeObjectKey(key) {
  return typeof key === 'string' && UNSAFE_KEYS.has(key);
}

module.exports = { isUnsafeObjectKey, UNSAFE_KEYS };
