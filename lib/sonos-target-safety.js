'use strict';

/**
 * Shared IPv4/target-safety checks for anything that connects to a Sonos
 * device by IP - used both by the setup wizard's manual "connect by IP"
 * validator (lib/setup-handler.js) and by SSDP auto-discovery
 * (lib/sonos-discovery.js), so a discovery response can't point the server
 * at loopback, link-local (cloud metadata), or multicast/reserved ranges any
 * more easily than typing the IP in by hand could. See security-review
 * finding O-005.
 *
 * @module sonos-target-safety
 */

function isValidIPv4(value) {
  if (!value || !/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return false;
  }

  return value.split('.').every(part => {
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255;
  });
}

/**
 * Reject IP ranges that should never host a Sonos device and that would make
 * a connection-by-IP path a useful SSRF/port-probe primitive: "this host"
 * (0/8), loopback (127/8), link-local incl. cloud metadata 169.254.169.254
 * (169.254/16), and multicast/reserved/broadcast (>=224). RFC1918 private
 * and normal LAN/public addresses are allowed.
 */
function isSafeSonosTarget(value) {
  const [a, b] = value.split('.').map(Number);
  if (a === 0) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a >= 224) return false;
  return true;
}

module.exports = { isValidIPv4, isSafeSonosTarget };
