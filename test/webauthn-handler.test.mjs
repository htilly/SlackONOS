import { expect } from 'chai';

/**
 * lib/webauthn-handler.js's getRPConfig() reads config via a hardcoded
 * nconf.file(CONFIG_PATH) pointing at the real config/config.json on disk -
 * there is no dependency-injection seam to swap that out, so most of
 * getRPConfig's behavior is not hermetically testable without either
 * mutating the real config file (unsafe - other tests and the running app
 * share it) or a larger refactor (out of scope for this fix).
 *
 * IMPORTANT: this file deliberately does NOT `require('../lib/webauthn-handler.js')`.
 * Doing so transitively requires `@simplewebauthn/server`, which was found
 * (2026-08-30, investigating this exact test) to hang indefinitely at
 * require-time in this environment (Node v26.7.0) - reproduced with a
 * minimal standalone script, unrelated to this fix or to mocha. That is a
 * separate, pre-existing issue - see the security-review follow-up note -
 * and is out of scope here; this file works around it rather than making
 * the whole suite hang.
 *
 * This therefore covers, in isolation, the one thing that changed: the
 * trailing-slash stripping at the end of getRPConfig, which used to be
 * `origin.replace(/\/+$/, '')` (CodeQL js/polynomial-redos: an unbounded
 * quantifier operating on a string built partly from attacker-controllable
 * request headers, e.g. X-Forwarded-Host) and is now an explicit bounded
 * loop. The mirrored logic below is copy-identical to the real code (see
 * lib/webauthn-handler.js's getRPConfig) - the same pattern already used in
 * test/memory-management.test.mjs and test/safe-object-key.test.mjs for
 * logic that isn't independently reachable/mockable.
 */
describe('webauthn-handler - origin trailing-slash stripping (CodeQL js/polynomial-redos)', function() {
  // Mirrors lib/webauthn-handler.js's getRPConfig exactly:
  //   while (origin.endsWith('/')) { origin = origin.slice(0, -1); }
  function stripTrailingSlashes(origin) {
    while (origin.endsWith('/')) {
      origin = origin.slice(0, -1);
    }
    return origin;
  }

  // The regex this replaced, kept here only to prove behavioral equivalence.
  function oldRegexStrip(origin) {
    return origin.replace(/\/+$/, '');
  }

  it('leaves an origin with no trailing slash unchanged', function() {
    expect(stripTrailingSlashes('https://example.com')).to.equal('https://example.com');
  });

  it('strips a single trailing slash', function() {
    expect(stripTrailingSlashes('https://example.com/')).to.equal('https://example.com');
  });

  it('strips multiple trailing slashes (e.g. from a crafted X-Forwarded-Host)', function() {
    expect(stripTrailingSlashes('https://example.com////')).to.equal('https://example.com');
  });

  it('does not strip slashes that are not trailing', function() {
    expect(stripTrailingSlashes('https://example.com/a/b')).to.equal('https://example.com/a/b');
  });

  it('handles an all-slashes string down to empty', function() {
    expect(stripTrailingSlashes('////')).to.equal('');
  });

  it('produces the exact same result as the old regex for a battery of inputs', function() {
    const cases = [
      'https://example.com',
      'https://example.com/',
      'https://example.com//',
      'https://example.com///',
      'http://localhost:8443/',
      'https://evil.com/a/b/c/',
      '',
      '/',
      '//',
    ];
    for (const input of cases) {
      expect(stripTrailingSlashes(input)).to.equal(oldRegexStrip(input), `mismatch for input ${JSON.stringify(input)}`);
    }
  });
});
