import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isValidIPv4, isSafeSonosTarget } = require('../lib/sonos-target-safety.js');

// Shared IPv4/target-safety checks used by both the setup wizard's
// connect-by-IP validator (lib/setup-handler.js) and SSDP auto-discovery's
// SSRF gate (lib/sonos-discovery.js, security-review finding O-005).
describe('sonos-target-safety', function() {
  describe('#isValidIPv4', function() {
    it('accepts a well-formed dotted-quad', function() {
      expect(isValidIPv4('192.168.1.100')).to.be.true;
    });

    it('rejects out-of-range octets', function() {
      expect(isValidIPv4('999.999.999.999')).to.be.false;
      expect(isValidIPv4('192.168.1.256')).to.be.false;
    });

    it('rejects non-IP strings', function() {
      expect(isValidIPv4('not-an-ip')).to.be.false;
      expect(isValidIPv4('')).to.be.false;
      expect(isValidIPv4(undefined)).to.be.false;
    });

    it('rejects a hostname masquerading as an IP-ish string', function() {
      expect(isValidIPv4('evil.example.com')).to.be.false;
    });
  });

  describe('#isSafeSonosTarget', function() {
    it('allows ordinary RFC1918 private and public addresses', function() {
      expect(isSafeSonosTarget('192.168.1.50')).to.be.true;
      expect(isSafeSonosTarget('10.0.0.5')).to.be.true;
      expect(isSafeSonosTarget('8.8.8.8')).to.be.true;
    });

    it('rejects loopback (127.0.0.0/8)', function() {
      expect(isSafeSonosTarget('127.0.0.1')).to.be.false;
      expect(isSafeSonosTarget('127.255.255.255')).to.be.false;
    });

    it('rejects link-local, including the cloud metadata address', function() {
      expect(isSafeSonosTarget('169.254.169.254')).to.be.false;
      expect(isSafeSonosTarget('169.254.1.1')).to.be.false;
    });

    it('rejects "this host" (0.0.0.0/8)', function() {
      expect(isSafeSonosTarget('0.0.0.0')).to.be.false;
    });

    it('rejects multicast/reserved/broadcast (>=224)', function() {
      expect(isSafeSonosTarget('224.0.0.1')).to.be.false;
      expect(isSafeSonosTarget('255.255.255.255')).to.be.false;
    });
  });
});
