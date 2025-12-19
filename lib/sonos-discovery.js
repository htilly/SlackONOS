/**
 * Sonos Device Discovery
 * Uses SSDP/UPnP to discover Sonos devices on the local network
 */

const dgram = require('dgram');
const { parseString } = require('xml2js');

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SONOS_SEARCH_TARGET = 'urn:schemas-upnp-org:device:ZonePlayer:1';
const DISCOVERY_TIMEOUT = 3000; // 3 seconds

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
  try {
    const http = require('http');
    const url = require('url');
    const parsedUrl = url.parse(location);
    
    return new Promise((resolve) => {
      const req = http.get(location, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          parseString(data, (err, result) => {
            if (err) {
              resolve({ ip, name: `Sonos Device (${ip})`, model: 'Unknown' });
              return;
            }
            
            try {
              const device = result.root?.device?.[0];
              const friendlyName = device?.['friendlyName']?.[0] || `Sonos (${ip})`;
              const modelName = device?.['modelName']?.[0] || 'Unknown';
              
              resolve({
                ip,
                name: friendlyName,
                model: modelName
              });
            } catch (e) {
              resolve({ ip, name: `Sonos Device (${ip})`, model: 'Unknown' });
            }
          });
        });
      });
      
      req.on('error', () => {
        resolve({ ip, name: `Sonos Device (${ip})`, model: 'Unknown' });
      });
      
      req.setTimeout(2000, () => {
        req.destroy();
        resolve({ ip, name: `Sonos Device (${ip})`, model: 'Unknown' });
      });
    });
  } catch (err) {
    return { ip, name: `Sonos Device (${ip})`, model: 'Unknown' };
  }
}

module.exports = {
  discoverSonosDevices
};













