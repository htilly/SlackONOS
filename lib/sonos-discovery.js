/**
 * Sonos Device Discovery
 * Uses SSDP/UPnP to discover Sonos devices on the local network
 */

const dgram = require('dgram');
const { parseString } = require('xml2js');
const { isValidIPv4, isSafeSonosTarget } = require('./sonos-target-safety');

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SONOS_SEARCH_TARGET = 'urn:schemas-upnp-org:device:ZonePlayer:1';
const DISCOVERY_TIMEOUT = 3000; // 3 seconds

// Real Sonos devices serve their device-description XML from this fixed port.
const SONOS_DEVICE_DESCRIPTION_PORT = 1400;
// A real description.xml is a few KB; cap well above that so a malicious
// responder can't use an unbounded body to exhaust memory.
const MAX_DEVICE_DESCRIPTION_BYTES = 65536;
// friendlyName/modelName are attacker-controlled LAN data (see O-004); the
// UI already escapes them, but cap their length here too as defense in depth
// against a giant string being carried around and rendered.
const MAX_DISPLAY_TEXT_LENGTH = 128;

function sanitizeDisplayText(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.slice(0, MAX_DISPLAY_TEXT_LENGTH);
}

/**
 * Discover Sonos devices on the local network
 * @returns {Promise<Array>} Array of discovered Sonos devices with {ip, name, model}
 */
function discoverSonosDevices() {
  return new Promise((resolve, reject) => {
    const devices = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (err) => {
      socket.close();
      reject(err);
    });

    socket.on('message', async (msg, rinfo) => {
      const message = msg.toString();
      
      // Check if this is a Sonos device response
      if (message.includes('Sonos') || message.includes('ZonePlayer')) {
        const locationMatch = message.match(/LOCATION:\s*(.+)/i);
        if (locationMatch) {
          const location = locationMatch[1].trim();
          try {
            // Fetch device description to get more info
            const deviceInfo = await fetchDeviceInfo(location, rinfo.address);
            if (deviceInfo) {
              devices.set(rinfo.address, deviceInfo);
            }
          } catch (err) {
            // If we can't fetch device info, still add the device with IP
            if (!devices.has(rinfo.address)) {
              devices.set(rinfo.address, {
                ip: rinfo.address,
                name: `Sonos Device (${rinfo.address})`,
                model: 'Unknown'
              });
            }
          }
        }
      }
    });

    // Send SSDP M-SEARCH request
    const searchMessage = [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      `ST: ${SONOS_SEARCH_TARGET}`,
      'MX: 3',
      ''
    ].join('\r\n');

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.setMulticastTTL(128);
      socket.send(searchMessage, 0, searchMessage.length, SSDP_PORT, SSDP_ADDRESS);
    });

    // Wait for responses, then resolve
    setTimeout(() => {
      socket.close();
      resolve(Array.from(devices.values()));
    }, DISCOVERY_TIMEOUT);
  });
}

/**
 * Fetch device description XML to get device name and model
 * @param {string} location - URL to device description
 * @param {string} ip - Device IP address
 * @returns {Promise<Object|null>} Device info or null
 */
async function fetchDeviceInfo(location, ip) {
  const fallback = { ip, name: `Sonos Device (${ip})`, model: 'Unknown' };
  try {
    const http = require('http');
    const url = require('url');
    const parsedUrl = url.parse(location);

    // `location` is the LOCATION header lifted straight out of an
    // unauthenticated UDP datagram - an attacker on the LAN chooses it
    // freely (see O-005). Never fetch it blind: require plain http, require
    // the host to be an IPv4 literal matching the actual UDP responder (not
    // a redirect to some other host), reject loopback/link-local/multicast,
    // and require the port a real Sonos serves its description from.
    const hostname = parsedUrl.hostname || '';
    const port = parsedUrl.port ? Number(parsedUrl.port) : 80;
    const isSafeTarget =
      parsedUrl.protocol === 'http:' &&
      hostname === ip &&
      isValidIPv4(hostname) &&
      isSafeSonosTarget(hostname) &&
      port === SONOS_DEVICE_DESCRIPTION_PORT;

    if (!isSafeTarget) {
      return fallback;
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const req = http.get(location, (res) => {
        let data = '';
        let bytesReceived = 0;
        res.on('data', (chunk) => {
          bytesReceived += chunk.length;
          if (bytesReceived > MAX_DEVICE_DESCRIPTION_BYTES) {
            req.destroy();
            settle(fallback);
            return;
          }
          data += chunk;
        });
        res.on('end', () => {
          parseString(data, (err, result) => {
            if (err) {
              settle(fallback);
              return;
            }

            try {
              const device = result.root?.device?.[0];
              const friendlyName = sanitizeDisplayText(device?.['friendlyName']?.[0], `Sonos (${ip})`);
              const modelName = sanitizeDisplayText(device?.['modelName']?.[0], 'Unknown');

              settle({
                ip,
                name: friendlyName,
                model: modelName
              });
            } catch (e) {
              settle(fallback);
            }
          });
        });
      });

      req.on('error', () => {
        settle(fallback);
      });

      req.setTimeout(2000, () => {
        req.destroy();
        settle(fallback);
      });
    });
  } catch (err) {
    return fallback;
  }
}

module.exports = {
  discoverSonosDevices,
  // Exported for unit testing the O-005 SSRF gating (test/sonos-discovery.test.mjs).
  fetchDeviceInfo
};
