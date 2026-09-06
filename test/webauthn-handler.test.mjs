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

/**
 * Regression coverage for security-review finding O-007: getRPConfig()
 * previously honored X-Forwarded-Proto/-Host/-Port unconditionally, so the
 * rpId/origin WebAuthn binds credentials to could be steered by request
 * headers rather than the operator's actual deployment - degrading
 * WebAuthn's core phishing-resistance property. The fix gates those headers
 * behind `trustProxy`, mirroring auth-handler.js's getClientIp().
 *
 * As with the describe block above, lib/webauthn-handler.js can't be
 * `require()`'d in this test environment (hangs at require-time via
 * @simplewebauthn/server), so this mirrors getRPConfig's header-handling
 * logic exactly (see lib/webauthn-handler.js's getRPConfig, post-fix).
 */
describe('webauthn-handler - getRPConfig trustProxy gating (O-007)', function() {
  // Mirrors lib/webauthn-handler.js's getRPConfig, with `config.get(...)`
  // calls replaced by plain parameters (no nconf/file-system dependency).
  function getRPConfig({ webauthnRpId = null, webauthnOrigin = null, trustProxy = false, webPort = 8080 }, req) {
    const rpName = 'SlackONOS';
    let rpId = webauthnRpId || null;
    let origin = webauthnOrigin || null;

    if (req) {
      const xfProto = trustProxy ? (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : '';
      const xfHost = trustProxy ? (req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '';
      const xfPort = trustProxy ? (req.headers['x-forwarded-port'] || '').split(',')[0].trim() : '';

      const protocol = xfProto || (req.connection?.encrypted ? 'https' : 'http') || 'https';
      const hostHeader = xfHost || req.headers.host || '';
      let [hostname, hostPort] = hostHeader.split(':');
      hostPort = hostPort || xfPort || '';

      if (hostname === '127.0.0.1' || hostname === '0.0.0.0') {
        hostname = 'localhost';
      }

      if (!rpId) {
        rpId = hostname;
      }

      const originConfigured = Boolean(origin);

      let portSegment = '';
      if (hostPort) {
        const portNum = Number(hostPort);
        if (!Number.isNaN(portNum)) {
          const isDefault = (protocol === 'https' && portNum === 443) || (protocol === 'http' && portNum === 80);
          if (!isDefault) portSegment = `:${portNum}`;
        } else {
          const xfPortNum = Number(xfPort);
          if (!Number.isNaN(xfPortNum)) {
            const isDefault = (protocol === 'https' && xfPortNum === 443) || (protocol === 'http' && xfPortNum === 80);
            if (!isDefault) portSegment = `:${xfPortNum}`;
          }
        }
      } else if (xfPort) {
        const xfPortNum = Number(xfPort);
        if (!Number.isNaN(xfPortNum)) {
          const isDefault = (protocol === 'https' && xfPortNum === 443) || (protocol === 'http' && xfPortNum === 80);
          if (!isDefault) portSegment = `:${xfPortNum}`;
        }
      }

      if (!originConfigured) {
        origin = `${protocol}://${hostname}${portSegment}`;
      }
    }

    if (!origin) {
      const fallbackPort = webPort || 8080;
      origin = `https://${rpId || 'localhost'}${fallbackPort && fallbackPort !== 443 ? ':' + fallbackPort : ''}`;
      if (!rpId) rpId = origin.split('://')[1].split(':')[0];
    }

    while (origin.endsWith('/')) {
      origin = origin.slice(0, -1);
    }
    rpId = rpId.split(':')[0];

    return { rpName, rpId, origin };
  }

  const forgedReq = {
    headers: {
      host: 'real-admin.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'attacker.example.net',
      'x-forwarded-port': '443'
    },
    connection: { encrypted: false }
  };

  it('ignores X-Forwarded-* headers by default (trustProxy unset)', function() {
    const { rpId, origin } = getRPConfig({}, forgedReq);
    expect(rpId).to.equal('real-admin.example.com');
    expect(origin).to.equal('http://real-admin.example.com');
  });

  it('ignores X-Forwarded-* headers when trustProxy is explicitly false', function() {
    const { rpId, origin } = getRPConfig({ trustProxy: false }, forgedReq);
    expect(rpId).to.equal('real-admin.example.com');
    expect(origin).to.equal('http://real-admin.example.com');
  });

  it('honors X-Forwarded-* headers only when trustProxy is explicitly true', function() {
    const { rpId, origin } = getRPConfig({ trustProxy: true }, forgedReq);
    expect(rpId).to.equal('attacker.example.net');
    expect(origin).to.equal('https://attacker.example.net');
  });

  it('an explicitly configured webauthnOrigin always wins, regardless of trustProxy', function() {
    const { origin } = getRPConfig(
      { webauthnOrigin: 'https://configured.example.com', trustProxy: true },
      forgedReq
    );
    expect(origin).to.equal('https://configured.example.com');
  });

  it('falls back to the real Host header with no proxy headers present at all', function() {
    const plainReq = { headers: { host: 'localhost:8443' }, connection: { encrypted: true } };
    const { rpId, origin } = getRPConfig({}, plainReq);
    expect(rpId).to.equal('localhost');
    expect(origin).to.equal('https://localhost:8443');
  });
});
