/**
 * Setup API Handler
 * Handles API endpoints for the web-based setup wizard
 */

const fs = require('fs').promises;
const path = require('path');
const { discoverSonosDevices } = require('./sonos-discovery');
const { validateSlackTokens } = require('./slack-validator');
const { validateSpotifyCredentials } = require('./spotify-validator');
const { validateDiscordToken } = require('./discord-validator');
const {
  readRequestBody,
  setSameOriginCorsHeaders,
  handleCorsPreflight,
  isSameOriginRequest
} = require('./http-utils');
const SONOS = require('sonos');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');
const CONFIG_EXAMPLE_PATH = path.join(__dirname, '..', 'config', 'config.json.example');

// Keys the setup wizard is permitted to write. Anything else in a save-config
// payload (e.g. adminPasswordHash, __proto__, arbitrary injected keys) is dropped
// so a save-config request cannot tamper with security-sensitive or unknown state.
const SETUP_ALLOWED_KEYS = new Set([
  'adminChannel', 'standardChannel', 'gongLimit', 'voteImmuneLimit', 'voteLimit',
  'voteTimeLimitMinutes', 'flushVoteLimit', 'sonos', 'legacySlackToken', 'slackAppToken',
  'token', 'discordToken', 'discordChannels', 'discordAdminRoles', 'openaiApiKey',
  'ttsEnabled', 'ttsProvider', 'ttsFallbackProvider', 'openaiTtsModel', 'openaiTtsVoice',
  'openaiTtsSpeed', 'openaiTtsInstructions', 'webPort', 'httpsPort', 'sslAutoGenerate',
  'sslCertPath', 'sslKeyPath', 'setupBootstrapToken', 'aiPrompt', 'aiModel',
  'aiMoodMirrorEnabled', 'defaultTheme', 'themePercentage', 'ipAddress', 'market',
  'maxVolume', 'blacklist', 'spotifyClientId', 'spotifyClientSecret', 'logLevel',
  'queueThreadThreshold', 'useLegacyBot', 'soundcraftEnabled', 'soundcraftIp',
  'soundcraftChannels', 'crossfadeEnabled', 'slackAlwaysThread', 'trustProxy',
  'webauthnEnabled', 'webauthnRpName', 'webauthnRpId', 'webauthnOrigin',
  'webauthnRequireUserVerification', 'webauthnPreferPlatformOnly', 'webauthnTimeout',
  'webauthnResidentKey', 'webauthnChallengeExpiration', 'webauthnMaxCredentials',
  'githubToken'
]);

/**
 * Validate Sonos connection
 */
async function validateSonosConnection(ipAddress) {
  try {
    if (!isValidIPv4(ipAddress)) {
      return { valid: false, error: 'Ogiltig IP-adress' };
    }

    if (!isSafeSonosTarget(ipAddress)) {
      return { valid: false, error: 'IP-adressen är inte tillåten (loopback/link-local/multicast blockeras)' };
    }

    const Sonos = SONOS.Sonos;
    const sonos = new Sonos(ipAddress);
    
    // Try to get device description (this validates the connection)
    const deviceInfo = await sonos.deviceDescription();
    
    return {
      valid: true,
      deviceInfo: {
        model: deviceInfo.modelDescription || 'Unknown',
        roomName: deviceInfo.roomName || 'Unknown',
        ip: ipAddress
      }
    };
  } catch (error) {
    return {
      valid: false,
      error: `Kunde inte ansluta till Sonos-enheten: ${error.message}`
    };
  }
}

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
 * Reject IP ranges that should never host a Sonos device and that would make the
 * connection validator a useful SSRF/port-probe primitive: "this host" (0/8),
 * loopback (127/8), link-local incl. cloud metadata 169.254.169.254 (169.254/16),
 * and multicast/reserved/broadcast (>=224). RFC1918 private and normal LAN/public
 * addresses are allowed.
 */
function isSafeSonosTarget(value) {
  const [a, b] = value.split('.').map(Number);
  if (a === 0) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a >= 224) return false;
  return true;
}

function hasSlackConfig(config) {
  return typeof config.slackAppToken === 'string' &&
    config.slackAppToken.startsWith('xapp-') &&
    typeof config.token === 'string' &&
    config.token.startsWith('xoxb-');
}

function hasDiscordConfig(config) {
  return typeof config.discordToken === 'string' &&
    config.discordToken.trim().length > 0 &&
    config.discordToken !== 'DISCORD:BOT:TOKEN';
}

/**
 * Check if setup is needed (config missing or incomplete)
 */
async function isSetupNeeded() {
  try {
    const configExists = await fs.access(CONFIG_PATH).then(() => true).catch(() => false);
    if (!configExists) {
      // Create minimal config file if it doesn't exist
      try {
        const configDir = path.dirname(CONFIG_PATH);
        await fs.mkdir(configDir, { recursive: true });
        const minimalConfig = {
          adminChannel: 'music-admin',
          standardChannel: 'music',
          gongLimit: 3,
          voteLimit: 6,
          voteImmuneLimit: 6,
          flushVoteLimit: 6,
          maxVolume: 75,
          market: 'US',
          logLevel: 'info',
          ttsEnabled: true,
          ttsProvider: 'google',
          ttsFallbackProvider: 'google',
          openaiTtsModel: 'gpt-4o-mini-tts',
          openaiTtsVoice: 'alloy',
          openaiTtsSpeed: 1,
          openaiTtsInstructions: '',
          webPort: 8080
        };
        await fs.writeFile(CONFIG_PATH, JSON.stringify(minimalConfig, null, 2) + '\n', 'utf8');
        // Still return needed=true since essential config is missing
        return { needed: true, reason: 'Config file created but essential settings missing' };
      } catch (createErr) {
        return { needed: true, reason: 'Config file does not exist and could not be created' };
      }
    }

    const configContent = await fs.readFile(CONFIG_PATH, 'utf8');
    const config = JSON.parse(configContent);

    // Check for required fields
    const missing = [];

    // Validate platform: Slack, Discord, or both are supported.
    if (!hasSlackConfig(config) && !hasDiscordConfig(config)) {
      missing.push('Slack or Discord credentials');
    }

    // Validate Spotify
    if (!config.spotifyClientId || !config.spotifyClientSecret) {
      missing.push('Spotify credentials');
    }

    // Validate Sonos
    if (!config.sonos || config.sonos === 'IP_TO_SONOS') {
      missing.push('Sonos IP address');
    }

    if (missing.length > 0) {
      return { needed: true, reason: `Missing: ${missing.join(', ')}` };
    }

    return { needed: false };
  } catch (err) {
    return { needed: true, reason: `Error reading config: ${err.message}` };
  }
}

/**
 * Get current configuration status
 */
async function getConfigStatus() {
  try {
    const configExists = await fs.access(CONFIG_PATH).then(() => true).catch(() => false);
    if (!configExists) {
      return { exists: false, config: null };
    }

    const configContent = await fs.readFile(CONFIG_PATH, 'utf8');
    const config = JSON.parse(configContent);

    return {
      exists: true,
      config: {
        hasSlack: !!(config.slackAppToken && config.token),
        hasDiscord: !!config.discordToken,
        hasSpotify: !!(config.spotifyClientId && config.spotifyClientSecret),
        hasSonos: !!(config.sonos && config.sonos !== 'IP_TO_SONOS'),
        hasOpenAI: !!config.openaiApiKey
      }
    };
  } catch (err) {
    return { exists: false, config: null, error: err.message };
  }
}

/**
 * Mask a sensitive value (show first 8 chars + last 4 chars)
 */
function maskValue(value) {
  if (!value || value.length === 0) return '';
  if (value.length <= 12) return '***';
  const start = value.substring(0, 8);
  const end = value.substring(value.length - 4);
  return `${start}***...***${end}`;
}

/**
 * Get current configuration values (for populating forms)
 * Sensitive credentials are masked for security
 */
async function getConfigValues() {
  try {
    const configExists = await fs.access(CONFIG_PATH).then(() => true).catch(() => false);
    if (!configExists) {
      return { exists: false, values: null };
    }

    const configContent = await fs.readFile(CONFIG_PATH, 'utf8');
    const config = JSON.parse(configContent);

    return {
      exists: true,
      values: {
        slackAppToken: config.slackAppToken ? maskValue(config.slackAppToken) : '',
        slackBotToken: config.token ? maskValue(config.token) : '',
        adminChannel: config.adminChannel || 'music-admin',
        standardChannel: config.standardChannel || 'music',
        discordToken: config.discordToken ? maskValue(config.discordToken) : '',
        discordChannels: Array.isArray(config.discordChannels) ? config.discordChannels.join(', ') : (config.discordChannels || ''),
        discordAdminRoles: Array.isArray(config.discordAdminRoles) ? config.discordAdminRoles.join(', ') : (config.discordAdminRoles || ''),
        sonosIp: (config.sonos && config.sonos !== 'IP_TO_SONOS') ? config.sonos : '',
        spotifyClientId: config.spotifyClientId ? maskValue(config.spotifyClientId) : '',
        spotifyClientSecret: config.spotifyClientSecret ? maskValue(config.spotifyClientSecret) : '',
        market: config.market || 'US', // Spotify market/region
        openaiApiKey: config.openaiApiKey ? maskValue(config.openaiApiKey) : '',
        aiModel: config.aiModel || 'gpt-4o-mini',
        aiPrompt: config.aiPrompt || '',
        aiMoodMirrorEnabled: config.aiMoodMirrorEnabled === true
      }
    };
  } catch (err) {
    return { exists: false, values: null, error: err.message };
  }
}

/**
 * Save configuration
 */
async function saveConfig(configData) {
  try {
    // Load example config to get defaults
    let defaultConfig = {};
    try {
      const exampleContent = await fs.readFile(CONFIG_EXAMPLE_PATH, 'utf8');
      defaultConfig = JSON.parse(exampleContent);
    } catch (err) {
      // If example doesn't exist, use minimal defaults
      defaultConfig = {
        adminChannel: 'music-admin',
        standardChannel: 'music',
        gongLimit: 3,
        voteLimit: 6,
        voteImmuneLimit: 6,
        flushVoteLimit: 6,
        maxVolume: 75,
        market: 'US',
        logLevel: 'info',
        ttsEnabled: true,
        ttsProvider: 'google',
        ttsFallbackProvider: 'google',
        openaiTtsModel: 'gpt-4o-mini-tts',
        openaiTtsVoice: 'alloy',
        openaiTtsSpeed: 1,
        openaiTtsInstructions: '',
        webPort: 8080
      };
    }

    // Load existing config (to avoid overwriting tokens/values when saving partial data)
    let existingConfig = {};
    try {
      const existingContent = await fs.readFile(CONFIG_PATH, 'utf8');
      existingConfig = JSON.parse(existingContent);
    } catch (err) {
      // if file missing or unreadable, ignore
      existingConfig = {};
    }

    // Drop any keys not on the setup allowlist before merging, so a save-config
    // payload can only touch known configuration (never adminPasswordHash,
    // prototype-pollution keys, or arbitrary injected fields).
    const providedConfig = (configData && typeof configData === 'object') ? configData : {};
    const sanitizedConfig = {};
    const rejectedKeys = [];
    for (const key of Object.keys(providedConfig)) {
      if (SETUP_ALLOWED_KEYS.has(key)) {
        sanitizedConfig[key] = providedConfig[key];
      } else {
        rejectedKeys.push(key);
      }
    }
    if (rejectedKeys.length > 0 && global.logger && typeof global.logger.warn === 'function') {
      global.logger.warn(`Setup save-config ignored disallowed keys: ${rejectedKeys.join(', ')}`);
    }

    // Merge sanitized config on top of existing + defaults
    const finalConfig = { ...defaultConfig, ...existingConfig, ...sanitizedConfig };

    // Ensure config directory exists
    const configDir = path.dirname(CONFIG_PATH);
    await fs.mkdir(configDir, { recursive: true });

    // Write config file
    await fs.writeFile(CONFIG_PATH, JSON.stringify(finalConfig, null, 2) + '\n', 'utf8');

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Handle setup API requests
 */
async function handleSetupAPI(req, res, url) {
  const urlPath = url.pathname;

  setSameOriginCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    handleCorsPreflight(req, res);
    return;
  }

  if (!isSameOriginRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Cross-origin requests are not allowed' }));
    return;
  }

  // Parse request body for POST requests
  let body = '';
  if (req.method === 'POST') {
    body = await readRequestBody(req);
  }

  try {
    // Route API endpoints
    if (urlPath === '/api/setup/status') {
      const status = await isSetupNeeded();
      const configStatus = await getConfigStatus();
      
      // Check if password is set (require auth-handler)
      let passwordSet = false;
      try {
        const authHandler = require('./auth-handler');
        passwordSet = authHandler.isPasswordSet();
      } catch (err) {
        // Auth handler not available, assume no password
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...status, ...configStatus, passwordSet }));
      return;
    }

    if (urlPath === '/api/setup/config-values') {
      const values = await getConfigValues();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(values));
      return;
    }

    // Get actual (unmasked) credential values for validation
    if (urlPath === '/api/setup/actual-credentials') {
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        exists: false,
        values: null,
        error: 'Unmasked credentials are no longer exposed by the setup API'
      }));
      return;
    }

    if (urlPath === '/api/setup/discover-sonos') {
      const devices = await discoverSonosDevices();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, devices }));
      return;
    }

    if (urlPath === '/api/setup/validate-slack') {
      const data = JSON.parse(body);
      const result = await validateSlackTokens(data.appToken, data.botToken);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (urlPath === '/api/setup/validate-spotify') {
      const data = JSON.parse(body);
      const result = await validateSpotifyCredentials(data.clientId, data.clientSecret);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (urlPath === '/api/setup/validate-discord') {
      const data = JSON.parse(body);
      const result = await validateDiscordToken(data.token);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (urlPath === '/api/setup/validate-sonos') {
      const data = JSON.parse(body);
      const result = await validateSonosConnection(data.ipAddress);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (urlPath === '/api/setup/save-config') {
      const data = JSON.parse(body);
      const result = await saveConfig(data.config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (urlPath === '/api/setup/restart') {
      // Send response first, then restart
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Restarting...' }));
      
      // Give time for response to be sent, then exit gracefully
      // Process manager (Docker, PM2, systemd, etc.) will restart the app
      setTimeout(() => {
        process.exit(0);
      }, 1000);
      
      return;
    }

    // Unknown endpoint
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = {
  handleSetupAPI,
  isSetupNeeded,
  getConfigStatus,
  isValidIPv4
};
