import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isUnsafeObjectKey, UNSAFE_KEYS } = require('../lib/safe-object-key.js');

// Regression coverage for security-review finding O-001: an attacker-
// controlled string (e.g. a Discord display name) used as a plain-object key
// can pollute Object.prototype process-wide if it is '__proto__',
// 'constructor', or 'prototype'. index.js's `_logUserAction` and
// lib/ai-handler.js's `buildContextKey` both guard against this via
// isUnsafeObjectKey.
describe('safe-object-key', function() {
  describe('#isUnsafeObjectKey', function() {
    it('flags the three prototype-chain property names', function() {
      expect(isUnsafeObjectKey('__proto__')).to.be.true;
      expect(isUnsafeObjectKey('constructor')).to.be.true;
      expect(isUnsafeObjectKey('prototype')).to.be.true;
    });

    it('does not flag ordinary usernames', function() {
      expect(isUnsafeObjectKey('henrik')).to.be.false;
      expect(isUnsafeObjectKey('U123ABC')).to.be.false;
      expect(isUnsafeObjectKey('')).to.be.false;
    });

    it('does not flag a string that merely contains an unsafe name as a substring', function() {
      expect(isUnsafeObjectKey('my__proto__name')).to.be.false;
      expect(isUnsafeObjectKey('__proto__ ')).to.be.false; // trailing space - not an exact match
    });

    it('is exact-match / type-safe against non-string input', function() {
      expect(isUnsafeObjectKey(undefined)).to.be.false;
      expect(isUnsafeObjectKey(null)).to.be.false;
      expect(isUnsafeObjectKey(123)).to.be.false;
      expect(isUnsafeObjectKey({})).to.be.false;
    });

    it('exposes the exact set of names being guarded against', function() {
      expect(UNSAFE_KEYS).to.deep.equal(new Set(['__proto__', 'constructor', 'prototype']));
    });
  });

  // This reproduces index.js's `_logUserAction` write pattern exactly
  // (see index.js: `data[normalizedUser] = {}` / `data[normalizedUser][action] = []`)
  // to prove that gating on isUnsafeObjectKey neutralizes the pollution.
  // index.js itself starts the full application on require() and cannot be
  // unit-tested directly (see test/memory-management.test.mjs for the same
  // established pattern of testing index.js-only logic by mirroring it here).
  describe('guards the exact _logUserAction write pattern (index.js)', function() {
    afterEach(function() {
      // Safety net: if a test regresses and actually pollutes the prototype,
      // don't let it leak into other test files in the same process.
      delete Object.prototype.push;
      delete Object.prototype.action;
    });

    function simulateLogUserAction(data, normalizedUser, action) {
      if (isUnsafeObjectKey(normalizedUser)) {
        return; // matches the early-return guard added to index.js
      }
      if (!data[normalizedUser]) {
        data[normalizedUser] = {};
      }
      if (!data[normalizedUser][action]) {
        data[normalizedUser][action] = [];
      }
      data[normalizedUser][action].push(new Date().toISOString());
    }

    it('does not pollute Object.prototype when normalizedUser is "__proto__"', function() {
      const data = {};
      simulateLogUserAction(data, '__proto__', 'help');

      expect(Object.prototype).to.not.have.property('help');
      expect(data).to.deep.equal({}); // nothing was written at all
      expect(({}).help).to.equal(undefined); // a fresh plain object is unaffected
    });

    it('still logs normally for an ordinary username', function() {
      const data = {};
      simulateLogUserAction(data, 'henrik', 'add');

      expect(data.henrik.add).to.have.lengthOf(1);
    });

    it('does not pollute via "constructor" or "prototype" either', function() {
      const data = {};
      simulateLogUserAction(data, 'constructor', 'debug');
      simulateLogUserAction(data, 'prototype', 'debug');

      expect(Object.prototype).to.not.have.property('debug');
      expect(data).to.deep.equal({});
    });
  });
});
