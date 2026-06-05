const fs = require('fs');
// --- MIGRATION: Move legacy message/help files to /app/templates/ if found ---
// Note: Uses console.log since this runs before logger is initialized
const legacyFiles = [
  { old: 'config/gong.txt', new: 'templates/messages/gong.txt' },
  { old: 'config/vote.txt', new: 'templates/messages/vote.txt' },
  { old: 'config/tts.txt', new: 'templates/messages/tts.txt' },
  { old: 'config/helpText.txt', new: 'templates/help/helpText.txt' },
  { old: 'config/helpTextAdmin.txt', new: 'templates/help/helpTextAdmin.txt' },
  { old: 'gong.txt', new: 'templates/messages/gong.txt' },
  { old: 'vote.txt', new: 'templates/messages/vote.txt' },
  { old: 'tts.txt', new: 'templates/messages/tts.txt' },
  { old: 'helpText.txt', new: 'templates/help/helpText.txt' },
  { old: 'helpTextAdmin.txt', new: 'templates/help/helpTextAdmin.txt' },
];
const migrationLogs = [];
for (const file of legacyFiles) {
  try {
    if (fs.existsSync(file.old)) {
      // Ensure target directory exists
      const targetDir = file.new.substring(0, file.new.lastIndexOf('/'));
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.renameSync(file.old, file.new);
      migrationLogs.push({ level: 'info', msg: `Moved ${file.old} → ${file.new}` });
    }
  } catch (err) {
    migrationLogs.push({ level: 'error', msg: `Failed to move ${file.old}: ${err.message}` });
  }
}
const os = require('os');
const mp3Duration = require('mp3-duration');
const path = require('path');
const googleTTS = require('@sefinek/google-tts-api');
const config = require('nconf');
const winston = require('winston');
const Spotify = require('./lib/spotify');
// const utils = require('./lib/utils'); // Currently unused
const process = require('process');
const parseString = require('xml2js').parseString;
const AIHandler = require('./lib/ai-handler');
const voting = require('./lib/voting');
const musicHelper = require('./lib/music-helper');
const commandHandlers = require('./lib/command-handlers');
const addHandlers = require('./lib/add-handlers');
const githubApp = require('./lib/github-app');
const createAdminApi = require('./lib/admin-api');
const { createWebServer } = require('./lib/web-server');
const { createCommandRouter } = require('./lib/command-router');
const { createCommandRegistry } = require('./lib/command-registry');
const gongMessage = fs.readFileSync('templates/messages/gong.txt', 'utf8').split('\n').filter(Boolean);
const voteMessage = fs.readFileSync('templates/messages/vote.txt', 'utf8').split('\n').filter(Boolean);
const ttsMessage = fs.readFileSync('templates/messages/tts.txt', 'utf8').split('\n').filter(Boolean);
const { execSync } = require('child_process');

// Try to get release tag from GitHub Actions (e.g., GITHUB_REF=refs/tags/v1.2.3)
const getReleaseVersion = () => {
  // 1. GitHub release tag (from GitHub Actions or Docker build)
  const githubRef = process.env.GITHUB_REF || '';
  
  // Check for refs/tags/vX.Y.Z format
  const tagMatch = githubRef.match(/refs\/tags\/(.+)$/);
  if (tagMatch) {
    return tagMatch[1]; // e.g., "v1.2.3"
  }
  
  // Also check if GITHUB_REF is just the tag name (without refs/tags/ prefix)
  // This can happen if set directly as environment variable
  if (githubRef && githubRef.startsWith('v') && /^v\d+\.\d+\.\d+/.test(githubRef)) {
    return githubRef; // e.g., "v2.1.0"
  }
  
  // 2. Git commit SHA (for native/local development)
  try {
    const gitExecOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    const sha = execSync('git rev-parse --short HEAD', gitExecOptions).trim();
    // Try to get tag from git if available
    try {
      const tag = execSync('git describe --tags --exact-match HEAD', gitExecOptions).trim();
      if (tag) {
        return tag; // Return exact tag if on tagged commit
      }
    } catch (e) {
      // No exact tag, continue with SHA
    }
    return `dev-${sha}`; // e.g., "dev-a3f2b1c"
  } catch (e) {
    // 3. Fallback for Docker/no git (use package.json version)
    const pkgVersion = require('./package.json').version;
    // If GITHUB_REF is empty or not set, assume dev build
    if (!githubRef || githubRef === '') {
      return `${pkgVersion}-dev`; // e.g., "2.1.0-dev"
    }
    // If GITHUB_REF is set but doesn't match expected patterns, 
    // return package version without -dev (might be a release build with wrong format)
    return pkgVersion; // e.g., "2.1.0"
  }
};
const releaseVersion = getReleaseVersion();

const SLACK_API_URL_LIST = 'https://slack.com/api/conversations.list';
const userActionsFile = path.join(__dirname, 'config/userActions.json');
const blacklistFile = path.join(__dirname, 'config/blacklist.json');
const trackBlacklistFile = path.join(__dirname, 'config/track-blacklist.json');
const aiUnparsedFile = path.join(__dirname, 'config/ai-unparsed.log');
const WinstonWrapper = require('./lib/logger');
const Telemetry = require('./lib/telemetry');

// Helper to load user blacklist
function loadBlacklist() {
  try {
    if (fs.existsSync(blacklistFile)) {
      const data = fs.readFileSync(blacklistFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    // Logger may not be initialized yet during early startup, use console as fallback
    if (typeof logger !== 'undefined') {
      logger.error('Error loading blacklist:', err);
    } else {
      console.error('Error loading blacklist:', err);
    }
  }
  return [];
}

// Helper to save user blacklist
async function saveBlacklist(list) {
  try {
    await fs.promises.writeFile(blacklistFile, JSON.stringify(list, null, 2));
  } catch (err) {
    logger.error('Error saving blacklist:', err);
  }
}

// Helper to load track blacklist
function loadTrackBlacklist() {
  try {
    if (fs.existsSync(trackBlacklistFile)) {
      const data = fs.readFileSync(trackBlacklistFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    // Logger may not be initialized yet during early startup, use console as fallback
    if (typeof logger !== 'undefined') {
      logger.error('Error loading track blacklist:', err);
    } else {
      console.error('Error loading track blacklist:', err);
    }
  }
  return [];
}

// Helper to save track blacklist
async function saveTrackBlacklist(list) {
  try {
    await fs.promises.writeFile(trackBlacklistFile, JSON.stringify(list, null, 2));
  } catch (err) {
    logger.error('Error saving track blacklist:', err);
  }
}

// Helper to check if track is blacklisted (case-insensitive partial match)
function isTrackBlacklisted(trackName, artistName) {
  const trackBlacklist = loadTrackBlacklist();
  const fullTrackName = `${trackName} ${artistName}`.toLowerCase();
  
  return trackBlacklist.some(banned => {
    const bannedLower = banned.toLowerCase();
    return fullTrackName.includes(bannedLower) || trackName.toLowerCase().includes(bannedLower);
  });
}


config.argv()
  .env()
  .file({
    file: 'config/config.json',
  })
  .defaults({
    adminChannel: 'music-admin',
    standardChannel: 'music',
    gongLimit: 3,
    voteImmuneLimit: 3,
    voteLimit: 3,
    flushVoteLimit: 6,
    maxVolume: '75',
    market: 'US',
    blacklist: [],
    searchLimit: 7,
    webPort: 8080,
    logLevel: 'info',
    telemetryEnabled: true,
    telemetryApiKey: 'phc_dkh7jm9oxMh7lLKr8TRBY0eKQ5Jn708pXk9McRC0qlO',
    telemetryHost: 'https://us.i.posthog.com'
  });

// JSON config files cannot contain real comments, so historically we used "_comment_*" keys.
// These should never be persisted in the real runtime config because they clutter it.
// If a user copied config.json.example → config.json, strip them automatically.
function stripCommentKeysFromConfigFile() {
  try {
    const cfgPath = path.join(__dirname, 'config', 'config.json');
    if (!fs.existsSync(cfgPath)) return;
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;

    let changed = false;
    for (const k of Object.keys(obj)) {
      if (k && typeof k === 'string' && k.startsWith('_comment_')) {
        delete obj[k];
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8' });
      if (typeof logger !== 'undefined' && logger && logger.info) {
        logger.info('Removed _comment_* keys from config/config.json');
      }
    }
  } catch (e) {
    // Best-effort only. Avoid logging sensitive config contents.
  }
}

// Strip any "_comment_*" keys that may have been copied into the real config file
stripCommentKeysFromConfigFile();

// Application Config Values (let for runtime changes)
let gongLimit = config.get('gongLimit');
let voteImmuneLimit = config.get('voteImmuneLimit');
let voteLimit = config.get('voteLimit');
let flushVoteLimit = config.get('flushVoteLimit');

// Global telemetry instance (for shutdown handler access)
let telemetry = null;
let maxVolume = config.get('maxVolume');
let voteTimeLimitMinutes = config.get('voteTimeLimitMinutes') || 5;
const logLevel = config.get('logLevel');

/* Initialize Logger Early
We have to wrap the Winston logger in this thin layer to satiate the SocketModeClient.
Initialize early so it's available for all startup code. */
// In-memory log buffer for real-time log viewing (last 1000 entries)
const logBuffer = [];
const MAX_LOG_BUFFER_SIZE = 1000;
let adminApi = null;


// Custom transport to capture logs in memory
class MemoryLogTransport extends winston.transports.Console {
  log(info, callback) {
    // Format log entry
    const level = info.level ? info.level.replace(/\u001b\[[0-9;]*m/g, '') : 'info';
    const logEntry = {
      timestamp: info.timestamp || new Date().toISOString(),
      level: level,
      message: info.message || String(info)
    };
    
    // Add to buffer (will be handled by broadcastLog, but keep for initial buffer)
    logBuffer.push(logEntry);
    
    // Keep buffer size limited
    if (logBuffer.length > MAX_LOG_BUFFER_SIZE) {
      logBuffer.shift(); // Remove oldest entry
    }
    
    // Call parent to still output to console
    super.log(info, callback);
  }
}

const logger = new WinstonWrapper({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), // Add timestamp
    winston.format.json()
  ),
  transports: [
    new MemoryLogTransport({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), // Add timestamp to console logs
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
      ),
    }),
  ],
});

function elapsedMs(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1000000);
}

// Helper function to check if a log level should be broadcast based on current logger level
function shouldBroadcastLog(level) {
  const currentLevel = logger.getLevel ? logger.getLevel() : 'info';
  const levelPriority = { error: 0, warn: 1, info: 2, debug: 3 };
  const currentPriority = levelPriority[currentLevel] !== undefined ? levelPriority[currentLevel] : 2; // Default to 'info'
  const logPriority = levelPriority[level] !== undefined ? levelPriority[level] : 2;
  return logPriority <= currentPriority;
}

function broadcastLog(logEntry) {
  if (adminApi && typeof adminApi.broadcastLog === 'function') {
    adminApi.broadcastLog(logEntry);
    return;
  }

  logBuffer.push(logEntry);
  if (logBuffer.length > MAX_LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }
}

// Override logger methods to broadcast to SSE clients (respecting log level)
const originalDebug = logger.debug.bind(logger);
const originalInfo = logger.info.bind(logger);
const originalWarn = logger.warn.bind(logger);
const originalError = logger.error.bind(logger);

logger.debug = function(msg) {
  originalDebug(msg);
  if (shouldBroadcastLog('debug')) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: 'debug',
    message: msg
  };
  broadcastLog(logEntry);
  }
};

logger.info = function(msg) {
  originalInfo(msg);
  if (shouldBroadcastLog('info')) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    message: msg
  };
  broadcastLog(logEntry);
  }
};

logger.warn = function(msg) {
  originalWarn(msg);
  if (shouldBroadcastLog('warn')) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    message: msg
  };
  broadcastLog(logEntry);
  }
};

logger.error = function(msg) {
  originalError(msg);
  if (shouldBroadcastLog('error')) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    message: msg
  };
  broadcastLog(logEntry);
  }
};

// Log any file migrations that occurred during startup
migrationLogs.forEach(log => {
  if (log.level === 'error') {
    logger.error(`[MIGRATION] ${log.msg}`);
  } else {
    logger.info(`[MIGRATION] ${log.msg}`);
  }
});

//Spotify Config Values
const market = config.get('market');
const clientId = config.get('spotifyClientId');
const clientSecret = config.get('spotifyClientSecret');
let searchLimit = config.get('searchLimit');

//Sonos Config Values
const sonosIp = config.get('sonos');
const webPort = config.get('webPort');
let ipAddress = config.get('ipAddress');

// Ensure ipAddress exists in config (set to empty string if missing)
if (ipAddress === undefined || ipAddress === null) {
  ipAddress = '';
  config.set('ipAddress', '');
  config.save((err) => {
    if (err) {
      logger.warn(`Failed to save ipAddress to config: ${err.message}`);
    }
  });
}

// Auto-detect IP address if not configured or set to placeholder
if (!ipAddress || ipAddress === 'IP_HOST' || ipAddress === '') {
  // First, check for HOST_IP environment variable (Docker best practice)
  if (process.env.HOST_IP) {
    ipAddress = process.env.HOST_IP;
    logger.info(`Using HOST_IP from environment: ${ipAddress}`);
  } else {
    // Try to auto-detect from network interfaces
    const networkInterfaces = os.networkInterfaces();
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      for (const iface of interfaces) {
        // Skip internal (loopback) and non-IPv4 addresses
        // Also skip Docker bridge interfaces (172.17.x.x, 172.18.x.x, etc.)
        if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('172.')) {
          ipAddress = iface.address;
          logger.info(`Auto-detected IP address: ${ipAddress}`);
          break;
        }
      }
      if (ipAddress && ipAddress !== 'IP_HOST' && ipAddress !== '') break;
    }

    // Don't set fallback to 127.0.0.1 - leave empty if not found
    // This will cause TTS validation to fail with proper error message
    if (!ipAddress || ipAddress === 'IP_HOST') {
      ipAddress = '';
      logger.warn('⚠️  Could not auto-detect IP address. Configure ipAddress in config.json or set HOST_IP environment variable for TTS to work.');
    }
  }
}

//Slack Config
const slackAppToken = config.get('slackAppToken');
const slackBotToken = config.get('token');

let blacklist = loadBlacklist();
// Migration: If empty, check config just in case (optional, can be removed later)
if (blacklist.length === 0) {
  const configBlacklist = config.get('blacklist');
  if (Array.isArray(configBlacklist) && configBlacklist.length > 0) {
    blacklist = configBlacklist;
    saveBlacklist(blacklist); // Save to new file
  }
}

/* Initialize Sonos */
const SONOS = require('sonos');
const Sonos = SONOS.Sonos;
const sonos = new Sonos(sonosIp);

// Function to check Sonos connection
async function checkSonosConnection() {
  try {
    const deviceInfo = await sonos.deviceDescription();
    logger.info('Successfully connected to Sonos speaker:');
    logger.info(`- Model: ${deviceInfo.modelDescription}`);
    logger.info(`- Room: ${deviceInfo.roomName}`);
    logger.info(`- IP: ${sonosIp}`);
    return true;
  } catch (error) {
    logger.error('Failed to connect to Sonos speaker:');
    logger.error(`- IP: ${sonosIp}`);
    logger.error(`- Error: ${error.message}`);
    return false;
  }
}

// Check Sonos connection on startup
// Sonos connection check moved to startup sequence

if (market !== 'US') {
  sonos.setSpotifyRegion(SONOS.SpotifyRegion.EU);
  logger.info('Setting Spotify region to EU...');
  logger.info('Market is: ' + market);
}

/* Initialize Spotify instance */
const spotify = Spotify({
  clientId: clientId,
  clientSecret: clientSecret,
  market: market,
  logger: logger,
}, logger);

/* Initialize Soundcraft Handler */
const SoundcraftHandler = require('./lib/soundcraft-handler');

// Parse soundcraftChannels if it's a string (from config file)
let soundcraftChannels = config.get('soundcraftChannels') || [];
if (typeof soundcraftChannels === 'string') {
  try {
    soundcraftChannels = JSON.parse(soundcraftChannels);
  } catch (e) {
    logger.error('Failed to parse soundcraftChannels config: ' + e.message);
    soundcraftChannels = [];
  }
}

const soundcraft = new SoundcraftHandler({
  soundcraftEnabled: config.get('soundcraftEnabled') || false,
  soundcraftIp: config.get('soundcraftIp'),
  soundcraftChannels: soundcraftChannels
}, logger);

// Connect to Soundcraft mixer if enabled
if (config.get('soundcraftEnabled')) {
  (async () => {
    await soundcraft.connect();
  })();
}

/* Initialize AI Handler */
(async () => {
  await AIHandler.initialize(logger);
})();

/* Initialize Music Helper with blacklist checker */
musicHelper.initialize(spotify, logger, isTrackBlacklisted);

const SlackSystem = require('./lib/slack');
const DiscordSystem = require('./lib/discord');

// Command router stub - will be properly defined after commandRegistry
// This allows us to pass it to Slack/Discord initialization
let routeCommand = async (text, channel, userName, platform = 'slack', isAdmin = false, isMention = false, messageTs = null) => {
  // Temporary stub - will be replaced after commandRegistry is defined
  logger.warn('routeCommand called before initialization');
};

// Initialize Slack System (optional - only if tokens configured)
let slack = null;
if (slackBotToken && slackAppToken) {
  slack = SlackSystem({
    botToken: slackBotToken,
    appToken: slackAppToken,
    logger: logger,
    onCommand: (...args) => routeCommand(...args)  // Closure ensures we get updated function
  });
}

// Initialize Discord (optional - only if token configured)
let discord = null;

// Thread-local context for tracking current platform
let currentPlatform = 'slack';
let currentChannel = null;
let currentIsAdmin = false;
// Map to store message timestamps for thread replies: channel -> ts
const messageTimestamps = new Map();

// Helper function wrapper for backward compatibility (Slack)
async function _slackMessage(message, channel_id, options = {}) {
  const platform = currentPlatform;
  const targetChannel = channel_id || currentChannel;

  // If current context is Discord: never try Slack first.
  if (platform === 'discord') {
    try {
      const sendStart = process.hrtime.bigint();
      await DiscordSystem.sendDiscordMessage(targetChannel, message, options);
      logger.info(`[TIMING] discord_send channel=${targetChannel} chars=${String(message || '').length} ms=${elapsedMs(sendStart)}`);
      return;
    } catch (e) {
      logger.warn(`Discord send failed: ${e.message || e}. Message not delivered.`);
      return; // DO NOT fall back to Slack; channel IDs incompatible
    }
  }

  // Slack context normal path
  try {
    if (slack) {
      // Check if we should use threads
      const slackAlwaysThread = config.get('slackAlwaysThread') === true;
      const shouldUseThread = options.forceThread || (slackAlwaysThread && messageTimestamps.has(targetChannel));
      
      if (shouldUseThread) {
        const threadTs = options.thread_ts || messageTimestamps.get(targetChannel);
        if (threadTs) {
          options.thread_ts = threadTs;
          logger.debug(`Using thread_ts ${threadTs} for channel ${targetChannel}`);
        }
      }
      
      const sendStart = process.hrtime.bigint();
      await slack.sendMessage(message, targetChannel, options);
      logger.info(`[TIMING] slack_send channel=${targetChannel} chars=${String(message || '').length} ms=${elapsedMs(sendStart)}`);
    } else {
      logger.warn('Slack not initialized - cannot send message');
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    logger.error(`Error sending Slack message: ${msg}`);
  }
}

// Helper function for Discord messages
async function _discordMessage(message, channel_id) {
  if (discord) {
    await DiscordSystem.sendDiscordMessage(channel_id, message);
  }
}

// Unified message sender - works for both platforms
async function _sendMessage(message, channel_id, platform = 'slack') {
  if (platform === 'discord') {
    await _discordMessage(message, channel_id);
  } else if (slack) {
    await slack.sendMessage(message, channel_id);
  }
}

// Global web client for other functions that might need it (like _checkUser)
const web = slack ? slack.web : null;
let botUserId; // This is handled internally in slack.js now, but kept if referenced elsewhere (though it shouldn't be)

function setRuntimeConfigValue(key, value) {
  switch (key) {
    case 'gongLimit':
      gongLimit = value;
      break;
    case 'voteLimit':
      voteLimit = value;
      break;
    case 'voteImmuneLimit':
      voteImmuneLimit = value;
      break;
    case 'flushVoteLimit':
      flushVoteLimit = value;
      break;
    case 'voteTimeLimitMinutes':
      voteTimeLimitMinutes = value;
      break;
    case 'maxVolume':
      maxVolume = value;
      break;
  }
}

function getVotingConfigSnapshot() {
  return {
    gongLimit,
    voteLimit,
    voteImmuneLimit,
    flushVoteLimit,
    voteTimeLimitMinutes,
  };
}

function syncVotingConfig() {
  voting.setConfig(getVotingConfigSnapshot());
}

adminApi = createAdminApi({
  config,
  logger,
  sonos,
  spotify,
  soundcraft,
  slack,
  slackAppToken,
  slackBotToken,
  DiscordSystem,
  logBuffer,
  maxLogBufferSize: MAX_LOG_BUFFER_SIZE,
  setRuntimeConfigValue,
  syncVotingConfig
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper: Check if a string is a Slack channel ID (format: C or G followed by alphanumeric)
// C = public channel, G = private channel/group
function isChannelId(str) {
  return /^[CG][A-Z0-9]{8,}$/i.test(str);
}

// Function to fetch the channel IDs - optimized to avoid full workspace scan
async function _lookupChannelID() {
  try {
    const adminChannelConfig = config.get('adminChannel').replace('#', '');
    const standardChannelConfig = config.get('standardChannel').replace('#', '');

    logger.info('Admin channel (in config): ' + adminChannelConfig);
    logger.info('Standard channel (in config): ' + standardChannelConfig);

    // Check if both are already IDs - no API call needed!
    if (isChannelId(adminChannelConfig) && isChannelId(standardChannelConfig)) {
      global.adminChannel = adminChannelConfig;
      global.standardChannel = standardChannelConfig;
      logger.info('Using channel IDs directly from config (no lookup needed)');
      logger.info('Admin channelID: ' + global.adminChannel);
      logger.info('Standard channelID: ' + global.standardChannel);
      return;
    }

    // Otherwise, we need to lookup by name (inefficient for large workspaces)
    logger.warn('Channel names detected in config - performing lookup (slow in large workspaces)');
    logger.warn('Consider using channel IDs directly in config to avoid rate limits');

    let allChannels = [];
    let nextCursor;
    let retryAfter = 0;
    let backoff = 1; // Exponential backoff starts at 1 second

    do {
      // Wait if rate limited
      if (retryAfter > 0) {
        logger.warn(`Rate limit hit! Retrying after ${retryAfter} seconds...`);
        logger.info(`Wait start: ${new Date().toISOString()}`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        retryAfter = 0; // Reset retryAfter
      }

      // Fetch channels
      const url = `${SLACK_API_URL_LIST}?limit=1000&types=public_channel,private_channel${nextCursor ? `&cursor=${nextCursor}` : ''
        }`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${slackBotToken}`,
          'Content-Type': 'application/json',
        },
      });

      logger.info(`Response status for fetching channels: ${response.status}`);

      if (response.status === 429) {
        retryAfter = parseInt(response.headers.get('retry-after')) || backoff;
        backoff = Math.min(backoff * 2, 60); // Exponential backoff up to 60s
        continue;
      }

      const data = await response.json();
      if (!data.ok) throw new Error(`Slack API Error: ${data.error}`);

      // Extract and add channels
      if (data.channels) allChannels = allChannels.concat(data.channels);

      nextCursor = data.response_metadata?.next_cursor;

      // Reset backoff after successful response
      backoff = 1;
    } while (nextCursor);

    logger.info(`Fetched ${allChannels.length} channels total`);

    const adminChannelInfo = allChannels.find((channel) => channel.name === adminChannelConfig);
    if (!adminChannelInfo) throw new Error(`Admin channel "${adminChannelConfig}" not found`);

    const standardChannelInfo = allChannels.find((channel) => channel.name === standardChannelConfig);
    if (!standardChannelInfo) throw new Error(`Standard channel "${standardChannelConfig}" not found`);

    // Set the global variables
    global.adminChannel = adminChannelInfo.id;
    global.standardChannel = standardChannelInfo.id;

    logger.info('Admin channelID: ' + global.adminChannel);
    logger.info('Standard channelID: ' + global.standardChannel);

    // Auto-save IDs back to config to avoid future lookups
    await _saveChannelIDsToConfig(adminChannelInfo.id, standardChannelInfo.id);
  } catch (error) {
    logger.error(`Error fetching channels: ${error.message}`);
    throw error;
  }
}

// Save channel IDs back to config.json to avoid future lookups
async function _saveChannelIDsToConfig(adminChannelId, standardChannelId) {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');

    const configPath = path.join(process.cwd(), 'config', 'config.json');

    // Read current config file
    const configData = await fs.readFile(configPath, 'utf8');
    const configObj = JSON.parse(configData);

    // Update with IDs
    const oldAdminChannel = configObj.adminChannel;
    const oldStandardChannel = configObj.standardChannel;

    configObj.adminChannel = adminChannelId;
    configObj.standardChannel = standardChannelId;

    // Write back to file with pretty formatting
    await fs.writeFile(configPath, JSON.stringify(configObj, null, 4) + '\n', 'utf8');

    // Also update nconf in-memory so we don't need restart
    config.set('adminChannel', adminChannelId);
    config.set('standardChannel', standardChannelId);

    logger.info('✅ Auto-saved channel IDs to config.json for faster future startups');
    logger.info(`   Updated: "${oldAdminChannel}" → "${adminChannelId}"`);
    logger.info(`   Updated: "${oldStandardChannel}" → "${standardChannelId}"`);
    logger.info('   Next restart will be instant (no channel lookup needed)');
  } catch (error) {
    logger.warn(`Could not auto-save channel IDs to config: ${error.message}`);
    logger.warn('Manual update recommended for faster startups');
  }
}

// Ensure required configuration keys exist; write defaults if missing
function ensureConfigDefaults() {
  const defaults = {
    // Core behavior
    gongLimit: 3,
    voteLimit: 6,
    voteImmuneLimit: 6,
    flushVoteLimit: 6,
    searchLimit: 10,
    voteTimeLimitMinutes: 2,
    maxVolume: 75,
    market: 'US',
    useLegacyBot: false,
    logLevel: 'info',
    // AI features
    defaultTheme: '',
    themePercentage: 0,
    aiModel: 'gpt-4o-mini',
    aiPrompt: 'You are a funny, upbeat DJ for a Slack music bot controlling Sonos. Reply with a super short, playful one-liner that confirms what you\'ll do, using casual humor and emojis when appropriate.',
    aiMoodMirrorEnabled: false,
    // Soundcraft mixer integration
    soundcraftEnabled: false,
    soundcraftIp: '',
    soundcraftChannels: [],
    // Slack settings
    slackAlwaysThread: false,
    // Crossfade settings
    crossfadeEnabled: true
  };
  const applied = [];
  for (const [key, val] of Object.entries(defaults)) {
    if (typeof config.get(key) === 'undefined') {
      config.set(key, val);
      applied.push({ key, value: val });
    }
  }
  if (applied.length > 0) {
    try {
      config.save((err) => {
        if (err) {
          logger.error('Failed to write default config values: ' + err.message);
        } else {
          logger.info('Wrote missing config defaults: ' + applied.map(a => a.key).join(', '));
        }
      });
    } catch (e) {
      logger.error('Error saving defaults: ' + e.message);
    }
  }
  return applied;
}

// Validate critical configuration and report to Admin channel
// Check system health and return a report
async function _checkSystemHealth() {
  const report = {
    status: 'ok',
    checks: []
  };

  // 1. Check Spotify
  const spotifyCheck = { name: 'Spotify API', status: 'ok', message: 'Connected' };
  if (!clientId || !clientSecret) {
    spotifyCheck.status = 'error';
    spotifyCheck.message = 'Missing Client ID or Secret';
  } else {
    try {
      await spotify.searchTrackList('test', 1);
    } catch (err) {
      spotifyCheck.status = 'error';
      spotifyCheck.message = `Connection failed: ${err.message}`;
    }
  }
  report.checks.push(spotifyCheck);

  // 2. Check Sonos
  const sonosCheck = { name: 'Sonos Speaker', status: 'ok', message: `Connected at ${sonosIp}` };
  if (!sonosIp) {
    sonosCheck.status = 'error';
    sonosCheck.message = 'Missing IP address in config';
  } else {
    const isConnected = await checkSonosConnection();
    if (!isConnected) {
      sonosCheck.status = 'error';
      sonosCheck.message = `Unreachable at ${sonosIp}`;
    }
  }
  report.checks.push(sonosCheck);

  // 3. Check Soundcraft (if enabled)
  if (config.get('soundcraftEnabled')) {
    const soundcraftCheck = {
      name: 'Soundcraft Ui24R',
      status: 'ok',
      message: `Connected at ${config.get('soundcraftIp')}`
    };

    if (!config.get('soundcraftIp')) {
      soundcraftCheck.status = 'error';
      soundcraftCheck.message = 'Missing IP address in config';
    } else if (!soundcraft.isEnabled()) {
      soundcraftCheck.status = 'error';
      soundcraftCheck.message = `Not connected to ${config.get('soundcraftIp')}`;
    } else {
      const channels = soundcraft.getChannelNames();
      soundcraftCheck.message = `Connected at ${config.get('soundcraftIp')} (${channels.length} channels: ${channels.join(', ')})`;
    }

    report.checks.push(soundcraftCheck);
  }

  // Determine overall status
  if (report.checks.some(c => c.status === 'error')) {
    report.status = 'error';
  }

  return report;
}

// Load setup handler early so it's available for startup checks
let setupHandler;
try {
  setupHandler = require('./lib/setup-handler');
} catch (err) {
  setupHandler = null;
  if (typeof logger !== 'undefined') {
    logger.warn('Setup handler not available:', err.message);
  }
}

// Load auth handler
let authHandler;
try {
  authHandler = require('./lib/auth-handler');
} catch (err) {
  authHandler = null;
  if (typeof logger !== 'undefined') {
    logger.warn('Auth handler not available:', err.message);
  }
}

let webServer = null;
let httpServer = null;

webServer = createWebServer({
  config,
  logger,
  rootDir: __dirname,
  ipAddress,
  webPort,
  authHandler,
  setupHandler,
  adminApi,
  slack,
  slackBotToken,
  slackAppToken,
  DiscordSystem
});
httpServer = webServer.httpServer;

// Coordinated Startup Sequence
(async () => {
  try {
    logger.info('Starting SlackONOS...');

    // Check if setup is needed before initializing platforms
    let setupStatus = { needed: false };
    if (setupHandler) {
      try {
        setupStatus = await setupHandler.isSetupNeeded();
      } catch (err) {
        logger.warn('Could not check setup status:', err.message);
        // Fallback: check config directly
        const hasSlack = !!(config.get('slackAppToken') && config.get('token'));
        const hasDiscord = !!config.get('discordToken');
        const hasSpotify = !!(config.get('spotifyClientId') && config.get('spotifyClientSecret'));
        const hasSonos = !!(config.get('sonos') && config.get('sonos') !== 'IP_TO_SONOS');
        setupStatus = { needed: !((hasSlack || hasDiscord) && hasSpotify && hasSonos) };
      }
    } else {
      // Fallback: check config directly if setupHandler not available
      const hasSlack = !!(config.get('slackAppToken') && config.get('token'));
      const hasDiscord = !!config.get('discordToken');
      const hasSpotify = !!(config.get('spotifyClientId') && config.get('spotifyClientSecret'));
      const hasSonos = !!(config.get('sonos') && config.get('sonos') !== 'IP_TO_SONOS');
      setupStatus = { needed: !((hasSlack || hasDiscord) && hasSpotify && hasSonos) };
    }
    const hasSlack = slackBotToken && slackAppToken;
    const hasDiscord = config.get('discordToken');

    // If setup is needed and no platforms configured, start server only for setup wizard
    if (setupStatus.needed && !hasSlack && !hasDiscord) {
      logger.warn('⚠️  Configuration incomplete - starting in setup mode');
      const httpsPort = config.get('httpsPort') || 8443;
      const useHttps = config.get('useHttps') !== false && (config.get('sslAutoGenerate') !== false || (config.get('sslCertPath') && config.get('sslKeyPath')));
      if (useHttps) {
        logger.info(`📝 Please complete setup at: https://${ipAddress}:${httpsPort}/setup`);
      } else {
      logger.info(`📝 Please complete setup at: http://${ipAddress}:${webPort}/setup`);
      }
      logger.info('   The bot will start normally once configuration is complete.');
      // HTTP server is already started above, so we can exit gracefully here
      // Don't throw error, just log and let server run for setup wizard
      return; // Exit startup sequence but keep HTTP server running
    }

    // Initialize Voting Module
    voting.initialize({
      logger: logger,
      sendMessage: (msg, ch, opts) => _slackMessage(msg, ch, opts),
      sonos: sonos,
      getCurrentTrackTitle: (ch) => new Promise((resolve, reject) => {
        _currentTrackTitle(ch, (err, track) => {
          if (err) reject(err);
          else resolve(track);
        });
      }),
      logUserAction: _logUserAction,
      gongMessages: gongMessage,
      voteMessages: voteMessage,
    });

    // Update voting config
    voting.setConfig(getVotingConfigSnapshot());

    // Initialize Command Handlers
    commandHandlers.initialize({
      logger: logger,
      sonos: sonos,
      spotify: spotify,
      sendMessage: (msg, ch, opts) => _slackMessage(msg, ch, opts),
      logUserAction: _logUserAction,
      getConfig: () => ({
        maxVolume,
        searchLimit,
      }),
      voting: voting,
      soundcraft: soundcraft,
    });

    // Initialize Add Handlers
    addHandlers.initialize({
      logger: logger,
      sonos: sonos,
      spotify: spotify,
      sendMessage: (msg, ch, opts) => _slackMessage(msg, ch, opts),
      logUserAction: _logUserAction,
      isTrackBlacklisted: isTrackBlacklisted,
      musicHelper: musicHelper,
      getConfig: () => config,
      getAdminChannel: () => global.adminChannel,
      getCurrentPlatform: () => currentPlatform,
    });

    // Check that at least one platform is configured
    if (!hasSlack && !hasDiscord) {
      throw new Error('No platform configured! Provide either Slack tokens (slackAppToken + token) or Discord token (discordToken). Visit /setup to configure.');
    }

    // 2. Initialize Slack (if configured)
    if (hasSlack) {
      try {
        await slack.init();
        logger.info('✅ Slack connection established.');

        // Set up reaction handler for Slack
        slack.setReactionHandler(async (action, trackName, channelId, userName, platform) => {
          logger.info(`[SLACK] Reaction ${action} from ${userName} for track: ${trackName}`);

          // Set platform context
          currentPlatform = platform;
          currentChannel = channelId;

          // For reactions, we vote/gong the track that was just added (most recent in queue)
          // This is more intuitive than requiring a queue position number

          if (action === 'vote') {
            // Reaction vote is for making the track play sooner
            // We'll get the queue and find the track by name, then call voting.vote with its position
            try {
              const queue = await sonos.getQueue();
              if (queue && queue.items) {
                // Find the track by name (case-insensitive, partial match)
                const trackIndex = queue.items.findIndex(item =>
                  item.title.toLowerCase().includes(trackName.toLowerCase())
                );

                if (trackIndex >= 0) {
                  // voting.vote expects the same 0-based index shown by `list` (#0..)
                  await voting.vote(['vote', trackIndex.toString()], channelId, userName);
                } else {
                  logger.warn(`Track "${trackName}" not found in queue for reaction vote`);
                }
              }
            } catch (err) {
              logger.error(`Error processing vote reaction: ${err.message}`);
            }
          }
          // Note: Gong reactions removed - gong only works via command on currently playing track
        });
      } catch (slackErr) {
        logger.error(`Failed to connect to Slack API: ${slackErr.message}`);
        if (!hasDiscord) {
          throw new Error('Slack initialization failed and no Discord fallback configured');
        }
        logger.warn('Continuing with Discord-only mode...');
      }
    } else {
      logger.info('ℹ️  Slack tokens not configured - running in Discord-only mode');
    }

    // 2b. Initialize Discord (if configured)
    if (hasDiscord) {
      try {
        discord = await DiscordSystem.initializeDiscord({
          discordToken: config.get('discordToken'),
          discordChannels: config.get('discordChannels') || [],
          discordAdminRoles: config.get('discordAdminRoles') || [],
          logLevel: config.get('logLevel') || 'info'
        }, (...args) => routeCommand(...args), logger);  // Use closure for AI parsing support
        if (discord) {
          logger.info('✅ Discord connection established.');

          // Set up reaction handler for Discord
          DiscordSystem.setReactionHandler(async (action, trackName, channelId, userName, platform) => {
            logger.info(`[DISCORD] Reaction ${action} from ${userName} for track: ${trackName}`);

            // Set platform context
            currentPlatform = platform;
            currentChannel = channelId;

            // For reactions, we vote/gong the track that was just added (most recent in queue)
            // This is more intuitive than requiring a queue position number

            if (action === 'vote') {
              // Reaction vote is for making the track play sooner
              // We'll get the queue and find the track by name, then call voting.vote with its position
              try {
                const queue = await sonos.getQueue();
                if (queue && queue.items) {
                  // Find the track by name (case-insensitive, partial match)
                  const trackIndex = queue.items.findIndex(item =>
                    item.title.toLowerCase().includes(trackName.toLowerCase())
                  );

                  if (trackIndex >= 0) {
                    // voting.vote expects the same 0-based index shown by `list` (#0..)
                    await voting.vote(['vote', trackIndex.toString()], channelId, userName);
                  } else {
                    logger.warn(`Track "${trackName}" not found in queue for reaction vote`);
                  }
                }
              } catch (err) {
                logger.error(`Error processing vote reaction: ${err.message}`);
              }
            }
            // Note: Gong reactions removed - gong only works via command on currently playing track
          });
        } else {
          logger.warn('Discord returned null (token maybe invalid). Running Slack-only.');
        }
      } catch (discordErr) {
        logger.warn(`Discord initialization failed: ${discordErr.message}. Continuing with Slack only.`);
      }
    } else {
      logger.info('ℹ️  Discord token not configured');
    }

    // 3. Lookup Slack Channels (only if Slack is initialized)
    if (slack) {
      await _lookupChannelID();
    } else {
      logger.info('Skipping Slack channel lookup (Discord-only mode)');
      // Set dummy globals for Discord-only mode
      global.adminChannel = null;
      global.standardChannel = null;
    }

    // 3.5 Apply config defaults and announce
    const appliedDefaults = ensureConfigDefaults();
    if (appliedDefaults.length && global.adminChannel) {
      const lines = appliedDefaults.map(a => `• ${a.key} → \`${String(a.value).slice(0, 80)}\``).join('\n');
      const msg = `*🔧 Missing config values were added with defaults:*\n${lines}\n\nYou can change these via \`setconfig\`. Type \`help\` for more information.`;
      await _slackMessage(msg, global.adminChannel);
    }

    // 4. Validate System Health
    const health = await _checkSystemHealth();

    if (health.status === 'error') {
      const errors = health.checks
        .filter(c => c.status === 'error')
        .map(c => `❌ *${c.name}:* ${c.message}`);

      const msg = "*🚨 Critical Startup Issues Detected:*\n" + errors.join("\n") + "\n\n_The bot may not function correctly until these are fixed._";
      logger.error('Startup health check failed: ' + JSON.stringify(health));

      if (global.adminChannel) {
        await _slackMessage(msg, global.adminChannel);
      }
    } else {
      logger.info('✅ System health check passed.');

      // Initialize and send telemetry
      telemetry = new Telemetry({
        get: (key) => config.get(key), // Pass config getter for runtime lookups
        telemetryEnabled: config.get('telemetryEnabled'),
        telemetryEndpoint: config.get('telemetryEndpoint'),
        telemetryDomain: config.get('telemetryDomain'),
        logger: logger
      });
      await telemetry.trackStartup(require('./package.json').version, releaseVersion);
      
      // Start heartbeat (24-hour interval)
      telemetry.startHeartbeat(require('./package.json').version, releaseVersion);

      // Log Soundcraft status if enabled
      if (config.get('soundcraftEnabled')) {
        if (soundcraft.isEnabled()) {
          const channels = soundcraft.getChannelNames();
          logger.info(`🎛️ Soundcraft Ui24R connected at ${config.get('soundcraftIp')}`);
          logger.info(`   Channels: ${channels.join(', ')}`);
        } else {
          logger.warn(`⚠️ Soundcraft enabled but not connected (IP: ${config.get('soundcraftIp')})`);
        }
      }

      // Apply crossfade setting if configured
      const crossfadeEnabled = config.get('crossfadeEnabled');
      if (crossfadeEnabled) {
        try {
          await sonos.avTransportService().SetCrossfadeMode({
            InstanceID: 0,
            CrossfadeMode: '1'
          });
          logger.info('🎵✨ Crossfade enabled on startup');
        } catch (err) {
          logger.warn('⚠️ Could not enable crossfade on startup: ' + err.message);
        }
      }
    }

    logger.info('🚀 System startup complete.');
    
    // Start polling for track changes to broadcast to admin UI
    adminApi.startStatusPolling();
    
    // Register shutdown handlers for graceful telemetry tracking
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received. Sending shutdown telemetry...`);
      
      // Stop status polling
      adminApi.stopStatusPolling();
      
      if (telemetry) {
        await telemetry.trackShutdown(require('./package.json').version, releaseVersion);
        await telemetry.shutdown(); // Flush pending events
      }
      
      logger.info('Shutdown complete.');
      process.exit(0);
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
  } catch (err) {
    logger.error('⛔️ STARTUP FAILED: ' + err.message);
    // If HTTP server is running, keep it alive for setup wizard access
    // Check if server was started (it's created after this async block)
    setTimeout(() => {
      if (httpServer && httpServer.listening) {
        logger.warn('⚠️  HTTP server is still running - you can access the setup wizard to fix configuration');
        const httpsPort = config.get('httpsPort') || 8443;
        const useHttps = config.get('useHttps') !== false && (config.get('sslAutoGenerate') !== false || (config.get('sslCertPath') && config.get('sslKeyPath')));
        if (useHttps) {
          logger.info(`   Setup wizard: https://${ipAddress}:${httpsPort}/setup`);
        } else {
        logger.info(`   Setup wizard: http://${ipAddress}:${webPort}/setup`);
        }
        // Don't exit - keep server running for setup
      } else {
        process.exit(1);
      }
    }, 100); // Small delay to let HTTP server start
  }
})();

// ==========================================
// COMMAND REGISTRY & PARSING
// ==========================================

// Robust arg-parser: handles "quoted strings" and whitespace
function parseArgs(text) {
  // Trim and collapse multiple spaces at edges
  text = (text || '').trim();
  const args = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === '"' || ch === "'")) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = ch;
        continue;
      } else if (quoteChar === ch) {
        inQuotes = false;
        quoteChar = null;
        continue;
      }
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.length) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length) args.push(current);
  return args;
}

// Normalizes user string <@U123> -> U123
function normalizeUser(userString) {
  if (!userString) return userString;
  return userString.replace(/[<@>]/g, '');
}

const commandRegistry = createCommandRegistry({
  addHandlers,
  commandHandlers,
  voting,
  currentTrack: _currentTrack,
  showSource: _showSource,
  gongplay: _gongplay,
  status: _status,
  help: _help,
  bestof: _bestof,
  debug: _debug,
  telemetryStatus: _telemetryStatus,
  setCrossfade: _setCrossfade,
  setconfig: _setconfig,
  blacklist: _blacklist,
  trackblacklist: _trackblacklist,
  tts: _tts,
  moveTrackAdmin: _moveTrackAdmin,
  stats: _stats,
  configdump: _configdump,
  aiUnparsed: _aiUnparsed,
  featurerequest: _featurerequest,
  addToSpotifyPlaylist: _addToSpotifyPlaylist,
  diagnostics: _diagnostics,
});

async function _appendAIUnparsed(entry) {
  try {
    const line = JSON.stringify(entry) + "\n";
    await fs.promises.appendFile(aiUnparsedFile, line, { encoding: 'utf8' });
  } catch (e) {
    logger.warn('Failed to write ai-unparsed log: ' + e.message);
  }
}

async function _getUserMusicProfile(userName) {
  try {
    const normalizedUser = String(userName || '').replace(/[<@>]/g, '');
    if (!normalizedUser) return '';

    const fileContent = await fs.promises.readFile(userActionsFile, 'utf8').catch(() => '{}');
    const data = JSON.parse(fileContent || '{}');
    const history = Array.isArray(data[normalizedUser]?._history) ? data[normalizedUser]._history : [];
    if (history.length === 0) return '';

    const musicActions = new Set(['add', 'append', 'addalbum', 'addplaylist', 'search', 'searchalbum', 'searchplaylist', 'bestof']);
    const relevant = history
      .filter(entry => musicActions.has(entry.action) || (entry.action === 'ai_intent' && musicActions.has(entry.type)))
      .slice(-12);

    if (relevant.length === 0) return '';

    const lines = relevant.map(entry => {
      const action = entry.action === 'ai_intent' && entry.type ? `asked ${entry.type}` : (entry.action || 'used');
      const query = entry.query ? `query "${entry.query}"` : '';
      const resolved = entry.resolvedName
        ? `resolved "${entry.resolvedName}"${entry.resolvedArtist ? ` by ${entry.resolvedArtist}` : ''}`
        : '';
      const count = entry.addedCount ? `added ${entry.addedCount}` : '';
      return `- ${action}: ${[query, resolved, count].filter(Boolean).join(', ')}`;
    });

    return lines.join('\n').slice(0, 1200);
  } catch (err) {
    logger.debug('Could not read user music profile: ' + err.message);
    return '';
  }
}

async function _getUserInteractionProfile(userName) {
  try {
    const normalizedUser = String(userName || '').replace(/[<@>]/g, '');
    if (!normalizedUser) return '';

    const fileContent = await fs.promises.readFile(userActionsFile, 'utf8').catch(() => '{}');
    const data = JSON.parse(fileContent || '{}');
    const history = Array.isArray(data[normalizedUser]?._history) ? data[normalizedUser]._history : [];
    const toneHistory = history
      .filter(entry => entry.mood && typeof entry.kindnessScore === 'number')
      .slice(-20);

    if (toneHistory.length === 0) return '';

    const moodCounts = toneHistory.reduce((acc, entry) => {
      acc[entry.mood] = (acc[entry.mood] || 0) + 1;
      return acc;
    }, {});
    const dominantMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';
    const avgScore = toneHistory.reduce((sum, entry) => sum + entry.kindnessScore, 0) / toneHistory.length;
    const recentMoods = toneHistory.slice(-5).map(entry => entry.mood).join(', ');

    return [
      `Recent interaction tone: mostly ${dominantMood}`,
      `Average kindness score: ${avgScore.toFixed(1)} on a -5 to 5 scale`,
      `Last moods: ${recentMoods}`
    ].join('\n');
  } catch (err) {
    logger.debug('Could not read user interaction profile: ' + err.message);
    return '';
  }
}

const commandRouter = createCommandRouter({
  logger,
  commandRegistry,
  AIHandler,
  musicHelper,
  sonos,
  config,
  sendMessage: (msg, ch, opts) => _slackMessage(msg, ch, opts),
  appendAIUnparsed: _appendAIUnparsed,
  parseArgs,
  normalizeUser,
  isBlacklisted: (userId) => blacklist.includes(userId),
  logUserAction: _logUserAction,
  getUserMusicProfile: _getUserMusicProfile,
  getUserInteractionProfile: _getUserInteractionProfile,
  setContext: (platform, channel, isAdmin) => {
    currentPlatform = platform;
    currentChannel = channel;
    currentIsAdmin = isAdmin;
  },
  messageTimestamps,
  getAdminChannel: () => global.adminChannel,
});

routeCommand = commandRouter.routeCommand;
logger.info('✅ Command router initialized with AI support');

async function _aiUnparsed(input, channel, userName) {
  if (channel !== global.adminChannel) {
    _slackMessage("❌ Admin only. Use this in the admin channel.", channel);
    return;
  }
  const countArg = parseInt(input[1] || '20', 10);
  const count = isNaN(countArg) ? 20 : Math.max(1, Math.min(200, countArg));
  try {
    if (!fs.existsSync(aiUnparsedFile)) {
      _slackMessage('📄 No AI-unparsed log found yet.', channel);
      return;
    }
    const data = fs.readFileSync(aiUnparsedFile, 'utf8').split('\n').filter(Boolean);
    const slice = data.slice(-count);
    const rows = slice.map(l => {
      try {
        const o = JSON.parse(l);
        const ts = o.ts || new Date().toISOString();
        const reason = o.reason || 'unknown';
        const u = o.user || 'unknown';
        const text = (o.text || '').replace(/[`\n]/g, ' ').slice(0, 200);
        const conf = o.parsed && typeof o.parsed.confidence === 'number' ? o.parsed.confidence.toFixed(2) : '-';
        const cmd = o.parsed && o.parsed.command ? o.parsed.command : '-';
        return `• ${ts} | ${reason} | user:${u} | cmd:${cmd} | conf:${conf} | "${text}"`;
      } catch (e) {
        return `• (bad line) ${l.slice(0, 200)}`;
      }
    });
    const header = `AI Unparsed (last ${rows.length} entries)\n`;
    const body = rows.join('\n');
    _slackMessage('```' + header + body + '```', channel);
  } catch (e) {
    logger.error('Failed to read ai-unparsed log: ' + e.message);
    _slackMessage('❌ Failed to read ai-unparsed log: ' + e.message, channel);
  }
}

async function _configdump(input, channel, userName) {
  if (channel !== global.adminChannel) {
    _slackMessage("❌ Admin only. Use this in the admin channel.", channel);
    return;
  }
  try {
    const store = (config && config.stores && config.stores.file && config.stores.file.store) || {};
    const entries = Object.entries(store);
    if (!entries.length) {
      _slackMessage('📄 Config file appears empty or not loaded.', channel);
      return;
    }
    const sensitiveKeys = [
      'token', 'slackAppToken', 'slackBotToken', 
      'spotifyClientId', 'spotifyClientSecret',
      'openaiApiKey', 'telemetryInstanceId', 'adminPasswordHash'
    ];
    
    const lines = entries.map(([k, v]) => {
      let val = typeof v === 'string' ? v : JSON.stringify(v);
      // Check if key is in sensitive list or contains sensitive keywords
      if (sensitiveKeys.includes(k) || 
          k.toLowerCase().includes('token') || 
          k.toLowerCase().includes('secret') || 
          k.toLowerCase().includes('apikey') || 
          k.toLowerCase().includes('clientid') ||
          k.toLowerCase().includes('password')) {
        val = '[REDACTED]';
      }
      return `${k}: ${val}`;
    });

    // Add seasonal context info
    const seasonal = AIHandler.getSeasonalContext();
    const aiDebug = AIHandler.getAIDebugInfo();
    lines.push('');
    lines.push('--- AI Theme Context ---');
    lines.push(`season: ${seasonal.season}`);
    lines.push(`month: ${seasonal.month}`);
    lines.push(`themes: ${seasonal.themes.join(', ')}`);
    lines.push(`defaultTheme: ${aiDebug.defaultTheme}`);
    lines.push(`themePercentage: ${aiDebug.themePercentage}%`);

    const msg = '```' + lines.join('\n') + '```';
    _slackMessage(msg, channel);
  } catch (e) {
    logger.error('Failed to dump config: ' + e.message);
    _slackMessage('❌ Failed to dump config: ' + e.message, channel);
  }
}

// Simple LRU cache implementation for user data to prevent memory leak
const USER_CACHE_MAX_SIZE = 500; // Max users to cache
const userCache = new Map();

function addToUserCache(userId, userName) {
  // If cache is at max size, remove oldest entry (first in Map)
  if (userCache.size >= USER_CACHE_MAX_SIZE) {
    const firstKey = userCache.keys().next().value;
    userCache.delete(firstKey);
  }
  // Delete and re-add to move to end (most recent)
  userCache.delete(userId);
  userCache.set(userId, userName);
}

async function _checkUser(userId) {
  try {
    // Discord users come as plain usernames, Slack users as <@U123>
    if (!web) {
      // Discord-only mode: just return the username as-is
      return userId;
    }

    // Clean the userId if wrapped in <@...>
    userId = userId.replace(/[<@>]/g, '');

    // Check if user info is already in cache
    if (userCache.has(userId)) {
      const userName = userCache.get(userId);
      // Move to end (mark as recently used)
      addToUserCache(userId, userName);
      return userName;
    }

    // Fetch user info from Slack API
    const result = await web.users.info({ user: userId });
    if (result.ok && result.user) {
      addToUserCache(userId, result.user.name);
      return result.user.name;
    } else {
      logger.error('User not found: ' + userId);
      return null;
    }
  } catch (error) {
    if (error.data && error.data.error === 'user_not_found') {
      logger.error('User not found: ' + userId);
    } else {
      logger.error('Error fetching user info: ' + error);
    }
    return null;
  }
}

// Note: Volume commands (_getVolume, _setVolume), _countQueue, and _showQueue have been moved to lib/command-handlers.js

async function _showSource(channel) {
  try {
    const state = await sonos.getCurrentState();

    if (state !== 'playing') {
      _slackMessage(`⏸️ Playback is *${state}*. No source active.`, channel);
      return;
    }

    const track = await sonos.currentTrack();

    if (!track) {
      _slackMessage('🔇 No track information available.', channel);
      return;
    }

    let message = `🎵 Currently playing: *${track.title}* by _${track.artist}_\n\n`;

    // Simple check: track.queuePosition > 0 means playing from queue
    const isFromQueue = track.queuePosition > 0;

    if (isFromQueue) {
      message += `📋 **Source: Queue** (position #${track.queuePosition})\n`;
      message += `✅ Sonos is playing from the queue managed by SlackONOS.`;
    } else {
      message += `⚠️ **Source: External** (not from queue)\n`;
      message += `🔍 Sonos is playing from an external source, likely:\n`;
      message += `   • Spotify Connect (from Spotify app)\n`;
      message += `   • AirPlay (from iPhone/iPad/Mac)\n`;
      message += `   • Line-in (physical connection)\n`;
      message += `   • Another music service app\n\n`;
      message += `💡 **To switch to queue:**\n`;
      message += `   1. Run \`stop\` to stop current playback\n`;
      message += `   2. Run \`add <song>\` to add to queue\n`;
      message += `   3. Playback will start from queue automatically`;
    }

    _slackMessage(message, channel);
  } catch (err) {
    logger.error('Error getting source info: ' + err);
    _slackMessage('🚨 Error getting source information. Try again! 🔄', channel);
  }
}

// Note: _upNext has been moved to lib/command-handlers.js
function _upNextDeprecated(channel) {
  sonos
    .getQueue()
    .then((result) => {
      //     logger.debug('Current queue: ' + JSON.stringify(result, null, 2));

      _currentTrack(channel, function (err, track) {
        if (!result || !result.items || result.items.length === 0) {
          logger.debug('Queue is empty or undefined');
          _slackMessage('🎶 The queue is emptier than a broken jukebox! Add something with `add <song>`! 🎵', channel);
          return;
        }
        if (err) {
          logger.error('Error getting current track: ' + err);
          return;
        }
        if (!track) {
          logger.debug('Current track is undefined');
          _slackMessage('🎵 No track is currently playing. Start something with `add <song>`! 🎶', channel);
          return;
        }

        //       logger.info('Got current track: ' + JSON.stringify(track, null, 2));

        var message = 'Upcoming tracks\n====================\n';
        let tracks = [];
        let currentIndex = track.queuePosition;

        // Add current track and upcoming tracks to the tracks array
        result.items.forEach((item, i) => {
          if (i >= currentIndex && i <= currentIndex + 5) {
            tracks.push('_#' + i + '_ ' + '_' + item.title + '_' + ' by ' + item.artist);
          }
        });

        for (var i in tracks) {
          message += tracks[i] + '\n';
        }

        if (message) {
          _slackMessage(message, channel);
        }
      });
    })
    .catch((err) => {
      logger.error('Error fetching queue: ' + err);
    });
}

async function _bestof(input, channel, userName) {
  if (!input || input.length < 2) {
    _slackMessage('🎸 Usage: `bestof <artist name>` - I\'ll queue up their greatest hits! 🎵', channel);
    return;
  }

  const tokens = input.slice(1);
  const wordToNum = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
  };
  let desiredCount = 10;
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1].toLowerCase();
    const num = /^[0-9]+$/.test(last) ? parseInt(last, 10) : wordToNum[last];
    if (num && num > 0 && num <= 20) {
      desiredCount = num;
      tokens.pop();
    }
  }
  const artistName = tokens.join(' ');
  _logUserAction(userName, 'bestof', { query: artistName, type: 'artist' });
  logger.info(`BESTOF request for artist: ${artistName}`);

  try {
    const searchResults = await spotify.searchTrackList(artistName, 20);

    if (!searchResults || searchResults.length === 0) {
      _slackMessage(`🤷 No tracks found for *${artistName}*. Try checking the spelling or a different artist! 🎸`, channel);
      return;
    }

    // Pick the most common artist among the search results
    const counts = {};
    for (const t of searchResults) {
      const a = t.artists[0].name;
      counts[a] = (counts[a] || 0) + 1;
    }

    const bestArtist = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])[0][0];

    logger.info(`Inferred artist: ${bestArtist}`);

    const tracksByArtist = searchResults
      .filter(t => t.artists[0].name.toLowerCase() === bestArtist.toLowerCase())
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, desiredCount);

    if (tracksByArtist.length === 0) {
      _slackMessage(`🤔 Couldn't determine top tracks for *${bestArtist}*. Try being more specific! 🎵`, channel);
      return;
    }

    // Check state and flush if stopped (don't wait for this to complete before responding)
    const stateBefore = await sonos.getCurrentState().catch(err => {
      logger.warn('Could not determine player state before BESTOF: ' + err.message);
      return 'unknown';
    });

    logger.info('Current state before bestof queueing: ' + stateBefore);

    if (stateBefore === 'stopped') {
      logger.info('Player stopped - flushing queue before BESTOF');
      await sonos.flush().catch(flushErr => {
        logger.warn('Could not flush queue (BESTOF): ' + flushErr.message);
      });
    }

    // Respond to user immediately with what we're about to queue
    let msg = `🎼 *Best of ${bestArtist}*\nQueueing ${tracksByArtist.length} tracks:\n`;
    tracksByArtist.forEach((t, i) => {
      msg += `> ${i + 1}. *${t.name}*\n`;
    });

    _slackMessage(msg, channel, {
      trackName: tracksByArtist[0]?.name || bestArtist,
      addReactions: currentPlatform === 'discord'
    });

    // Queue tracks in parallel (much faster!) - don't block user response
    (async () => {
      try {
        // Queue all tracks in parallel using Promise.allSettled (continues even if some fail)
        const queuePromises = tracksByArtist.map(track =>
          sonos.queue(track.uri)
            .then(() => {
              logger.info(`Queued BESTOF track: ${track.name}`);
              return { success: true, track: track.name };
            })
            .catch(err => {
              logger.warn(`Could not queue track ${track.name}: ${err.message}`);
              return { success: false, track: track.name, error: err.message };
            })
        );

        const results = await Promise.allSettled(queuePromises);
        const addedCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;

        logger.info(`BESTOF: Queued ${addedCount}/${tracksByArtist.length} tracks for ${bestArtist}`);

        // Auto-start playback if not playing
        if (stateBefore === 'stopped' || stateBefore === 'paused') {
          await new Promise(resolve => setTimeout(resolve, 300)); // Brief delay for queue
          await sonos.play().catch(err => {
            logger.warn('Could not start playback after BESTOF: ' + err.message);
          });
          logger.info('Started playback after bestof');
        }
      } catch (err) {
        logger.error(`Error in BESTOF background queueing: ${err.message}`);
      }
    })();

  } catch (err) {
    logger.error(`BESTOF error: ${err.stack || err}`);
    _slackMessage(`🚨 Error fetching BESTOF for *${artistName}*. Try again in a moment! 🔄`, channel);
  }
}

// Queue for user action logging to prevent file locking issues
let userActionQueue = Promise.resolve();

// Function to log user actions to a file
function _sanitizeActionDetails(details) {
  if (!details || typeof details !== 'object') return null;

  const allowedKeys = [
    'query',
    'resolvedName',
    'resolvedArtist',
    'type',
    'source',
    'requestedCount',
    'addedCount',
    'confidence',
    'mood',
    'kindnessScore'
  ];
  const sanitized = {};

  for (const key of allowedKeys) {
    if (typeof details[key] === 'undefined' || details[key] === null) continue;
    if (typeof details[key] === 'string') {
      sanitized[key] = details[key].replace(/[\r\n`]/g, ' ').slice(0, 160);
    } else if (typeof details[key] === 'number' && Number.isFinite(details[key])) {
      sanitized[key] = details[key];
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

async function _logUserAction(userName, action, details = null) {
  // Normalize userName by stripping angle brackets
  const normalizedUser = String(userName || 'unknown').replace(/[<@>]/g, '');
  const shouldCountStats = !(details && details.countStats === false);
  const sanitizedDetails = _sanitizeActionDetails(details);

  // Queue this write operation to prevent concurrent file access
  userActionQueue = userActionQueue.then(async () => {
    try {
      let data = {};

      // Try to read existing data, but don't fail if file doesn't exist
      try {
        const fileContent = await fs.promises.readFile(userActionsFile, 'utf8');
        data = JSON.parse(fileContent || '{}');
      } catch (readErr) {
        // File doesn't exist yet or can't be read, start with empty object
        if (readErr.code !== 'ENOENT') {
          logger.debug(`Could not read user actions file: ${readErr.message}`);
        }
        data = {}; // Start fresh
      }

      if (!data[normalizedUser]) {
        data[normalizedUser] = {};
      }

      const timestamp = new Date().toISOString();
      if (shouldCountStats) {
        if (!data[normalizedUser][action]) {
          data[normalizedUser][action] = [];
        }

        data[normalizedUser][action].push(timestamp);
      }
      if (sanitizedDetails) {
        if (!Array.isArray(data[normalizedUser]._history)) {
          data[normalizedUser]._history = [];
        }

        data[normalizedUser]._history.push({
          timestamp,
          action,
          ...sanitizedDetails
        });
        data[normalizedUser]._history = data[normalizedUser]._history.slice(-50);
      }

      // Try to write, but don't fail the whole operation if it doesn't work
      try {
        await fs.promises.writeFile(userActionsFile, JSON.stringify(data, null, 2), 'utf8');
      } catch (writeErr) {
        // Log but don't throw - user actions logging is not critical
        logger.debug(`Could not write user actions file: ${writeErr.message}`);
      }
    } catch (err) {
      // This should rarely happen now, but log if it does
      logger.debug(`Error in user action logging: ${err.message}`);
    }
  }).catch(err => {
    // Catch any errors in the promise chain to prevent unhandled rejections
    logger.debug(`Error in user action queue: ${err.message}`);
  });

  // Return the promise so callers can await if needed, but don't require it
  return userActionQueue;
}

// Stats related functions
async function _stats(input, channel, userName) {
  _logUserAction(userName, 'stats');
  try {
    const fileContent = await fs.promises.readFile(userActionsFile, 'utf8').catch(() => '{}');
    const data = JSON.parse(fileContent || '{}');

    if (input.length === 1) {
      // General stats - show command breakdown and top users
      const commandStats = {};
      const userTotals = {};

      // Aggregate command stats and user totals
      for (const user in data) {
        let userTotal = 0;
        for (const action in data[user]) {
          if (action.startsWith('_')) continue;
          const count = data[user][action].length;
          commandStats[action] = (commandStats[action] || 0) + count;
          userTotal += count;
        }
        userTotals[user] = userTotal;
      }

      const totalActions = Object.values(commandStats).reduce((sum, count) => sum + count, 0);

      // Build message
      let message = `📊 *SlackONOS Statistics*\n\n`;
      message += `*Total Actions:* ${totalActions}\n\n`;

      // Command breakdown
      message += `*Commands Used:*\n`;
      const sortedCommands = Object.entries(commandStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      for (const [cmd, count] of sortedCommands) {
        message += `  • ${cmd}: ${count} times\n`;
      }

      // Top 5 users
      message += `\n*Top 5 Users:*\n`;
      const topUsers = Object.entries(userTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      for (let i = 0; i < topUsers.length; i++) {
        const [user, total] = topUsers[i];
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
        message += `  ${medal} <@${user}>: ${total} actions\n`;
      }

      _slackMessage(message, channel);
    } else {
      let targetUser = input[1].replace(/[<@>]/g, '');
      let userStats = data[targetUser];

      // If not found directly, try to find by matching all users in data
      if (!userStats) {
        // Check if any key in data matches the target
        const matchingKey = Object.keys(data).find(key => {
          // Try exact match or case-insensitive match
          return key.toLowerCase() === targetUser.toLowerCase();
        });

        if (matchingKey) {
          targetUser = matchingKey;
          userStats = data[matchingKey];
        }
      }

      if (!userStats) {
        _slackMessage(`🤷 No stats found for user <@${targetUser}>. They haven't used the bot yet! 📊`, channel);
        return;
      }

      // Use targetUser here which now contains the actual key from data
      let message = `Stats for user <@${targetUser}>:\n`;
      for (const action in userStats) {
        if (action.startsWith('_')) continue;
        message += `  - ${action}: ${userStats[action].length} times\n`;
      }
      _slackMessage(message, channel);
    }
  } catch (err) {
    logger.error('Error reading stats file: ' + err);
    _slackMessage('📊 Oops! Error fetching stats. Try again in a moment! 🔄', channel);
  }
}

// Other functions
/**
 * Generate Discord bot invite URL with proper permissions
 * @param {string} clientId - Discord application client ID
 * @returns {string} Formatted invite URL
 */
function generateDiscordInviteUrl(clientId) {
  // Permissions calculated: 274878024768
  // - View Channels (1024)
  // - Send Messages (2048)
  // - Add Reactions (64)
  // - Read Message History (65536)
  // - Use External Emojis (262144)
  const permissions = '274878024768';
  const scopes = 'bot%20applications.commands';
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=${scopes}`;
}

async function _debug(channel, userName) {
  await _logUserAction(userName, 'debug');

  try {
    // Run health check
    const health = await _checkSystemHealth();

    // Build Health Section
    const healthStatus = health.checks.map(c => {
      const icon = c.status === 'ok' ? '✅' : '❌';
      return `${icon} *${c.name}:* ${c.message}`;
    }).join('\n');

    // Build Config Section
    const sensitiveKeys = [
      'token', 'slackAppToken', 'slackBotToken', 
      'spotifyClientId', 'spotifyClientSecret',
      'openaiApiKey', 'telemetryInstanceId', 'adminPasswordHash'
    ];
    const configKeys = Object.keys(config.stores.file.store);
    const configValues = configKeys
      .map(key => {
        const value = config.get(key);
        const displayValue = sensitiveKeys.includes(key) ? '[REDACTED]' : JSON.stringify(value);
        return `> ${key}: \`${displayValue}\``;
      })
      .join('\n');

    const webHost = ipAddress || 'localhost';
    const httpsPort = config.get('httpsPort') || 8443;
    const activeHttpsServer = webServer ? webServer.httpsServer : null;
    const currentUseHttps = Boolean(webServer && webServer.useHttps);
    const currentTtsEnabled = Boolean(webServer && webServer.ttsEnabled);
    const webServerListening = Boolean(
      (httpServer && httpServer.listening) ||
      (activeHttpsServer && activeHttpsServer.listening)
    );
    const adminProtocol = currentUseHttps && activeHttpsServer && activeHttpsServer.listening ? 'https' : 'http';
    const adminPort = adminProtocol === 'https' ? httpsPort : webPort;
    const adminUrl = `${adminProtocol}://${webHost}:${adminPort}/admin`;
    const setupUrl = `${adminProtocol}://${webHost}:${adminPort}/setup`;
    const ttsUrl = `http://${webHost}:${webPort}/tts.mp3`;

    const message =
      `*🛠️ System Debug Report*\n` +
      `------------------------------------------\n` +
      `*📊 System Info:*\n` +
      `> *Release:* \`${releaseVersion}\`\n` +
      `> *Node:* \`${process.version}\`\n` +
      `> *Host:* \`${process.env.HOSTNAME || 'unknown'}\`\n` +
      `> *IP:* \`${ipAddress || 'unknown'}\`\n\n` +

      `*🏥 Health Check:*\n` +
      `${healthStatus}\n\n` +

      `*⚙️ Configuration:*\n` +
      `${configValues}\n\n` +

      `*🤖 OpenAI:*\n` +
      (() => {
        const ai = AIHandler.getAIDebugInfo();
        return (
          `> Enabled: \`${ai.enabled ? 'true' : 'false'}\`\n` +
          `> Key Present: \`${config.get('openaiApiKey') ? 'true' : 'false'}\`\n` +
          `> Model: \`${ai.model}\`\n` +
          `> Last Success: \`${ai.lastSuccessTS || 'n/a'}\`\n` +
          `> Last Error: \`${ai.lastErrorTS || 'n/a'}\`\n` +
          (ai.lastErrorMessage ? `> Last Error Msg: \`${ai.lastErrorMessage}\`\n` : '')
        );
      })() +
      `\n` +
      `*🎮 Discord:*\n` +
      (() => {
        const token = config.get('discordToken');
        const channels = config.get('discordChannels');
        const adminRoles = config.get('discordAdminRoles');
        
        if (!token) {
          return `> Enabled: \`false\`\n`;
        }

        // Try to get client ID from Discord module
        let clientId = 'unknown';
        try {
          const discordModule = require('./lib/discord');
          const discordClient = discordModule.getDiscordClient();
          if (discordClient && discordClient.user) {
            clientId = discordClient.user.id;
          }
        } catch (e) {
          // Discord module not loaded
        }

        const inviteUrl = clientId !== 'unknown' ? generateDiscordInviteUrl(clientId) : 'N/A (bot not connected)';

        return (
          `> Enabled: \`true\`\n` +
          `> Bot User ID: \`${clientId}\`\n` +
          `> Channels: \`${Array.isArray(channels) && channels.length > 0 ? channels.join(', ') : 'all'}\`\n` +
          `> Admin Roles: \`${Array.isArray(adminRoles) && adminRoles.length > 0 ? adminRoles.join(', ') : 'none'}\`\n` +
          `> Invite URL: \`${inviteUrl}\`\n`
        );
      })() +
      `\n` +
      `*🎛️ Soundcraft Ui24R:*\n` +
      (() => {
        const enabled = config.get('soundcraftEnabled');
        const ip = config.get('soundcraftIp');
        const channelNames = soundcraft.getChannelNames();
        const connected = soundcraft.isEnabled();

        if (!enabled) {
          return `> Enabled: \`false\`\n`;
        }

        const channels = channelNames.length > 0 ? channelNames.map(n => `\`${n}\``).join(', ') : '\`none\`';

        return (
          `> Enabled: \`true\`\n` +
          `> IP Address: \`${ip || 'not configured'}\`\n` +
          `> Connected: \`${connected ? 'Yes' : 'No'}\`\n` +
          `> Configured Channels: ${channels}\n`
        );
      })() +
      `\n` +
      `*🌐 Web Server:*\n` +
      `> Listening: \`${webServerListening ? 'true' : 'false'}\`\n` +
      `> HTTP Port: \`${webPort}\`\n` +
      (currentUseHttps ? `> HTTPS Port: \`${httpsPort}\`\n` : '') +
      (webServerListening ?
        `> Web UI: <${adminUrl}|${adminUrl}>\n` +
        `> Setup Wizard: <${setupUrl}|${setupUrl}>\n`
        : '') +
      `> TTS Enabled: \`${currentTtsEnabled ? 'true' : 'false'}\`\n` +
      (currentTtsEnabled && webServerListening ?
        `> TTS Endpoint: \`${ttsUrl}\`\n`
        : '');

    _slackMessage(message, channel);
  } catch (err) {
    logger.error('Error in debug: ' + err.message);
    _slackMessage('🚨 Failed to generate debug report: ' + err.message + ' 🔧', channel);
  }
}

async function _telemetryStatus(channel) {
  try {
    const enabled = config.get('telemetryEnabled');
    const host = config.get('telemetryHost');
    const apiKey = config.get('telemetryApiKey');
    
    let message = '📊 *Telemetry & Privacy Status*\n\n';
    
    // Status
    message += `> Status: \`${enabled ? 'Enabled ✅' : 'Disabled ❌'}\`\n`;
    if (enabled) {
      message += `> Backend: \`PostHog (US)\`\n`;
      message += `> Host: \`${host}\`\n`;
    }
    
    message += '\n*What IS Collected:* ✅\n';
    message += '• Anonymous instance ID (hashed hostname - no IP address)\n';
    message += '• Operating system & Node.js version\n';
    message += '• App version and release identifier\n';
    message += '• Startup, heartbeat (every 24h), and shutdown events\n';
    message += '• Uptime duration (hours and days running)\n';
    
    message += '\n*What is NOT Collected:* ❌\n';
    message += '• No user names or Slack/Discord identities\n';
    message += '• No commands executed\n';
    message += '• No songs, artists, or playlists played\n';
    message += '• No IP addresses or location data\n';
    message += '• No personally identifiable information (PII)\n';
    
    message += '\n*Privacy Compliance:*\n';
    message += '• GDPR compliant - no personal data collected\n';
    message += '• CCPA compliant - anonymous metrics only\n';
    message += '• Fail-silent - never blocks bot operation\n';
    
    message += '\n*To Disable:*\n';
    message += '```\nsetconfig telemetryEnabled false\n```\n';
    message += 'Or set `TELEMETRY_ENABLED=false` in environment.\n\n';
    message += 'ℹ️ See `TELEMETRY.md` for complete documentation.';
    
    _slackMessage(message, channel);
  } catch (err) {
    logger.error('Error in telemetry status: ' + err.message);
    _slackMessage('🚨 Failed to generate telemetry status: ' + err.message, channel);
  }
}

// Note: _add, _addalbum, _queueAlbum, _addplaylist have been moved to lib/add-handlers.js
// Note: _searchplaylist, _search, _searchalbum have been moved to lib/command-handlers.js
// Note: _sortAlbumsByRelevance, _sortPlaylistsByRelevance, _sortTracksByRelevance have been moved to lib/queue-utils.js

function _currentTrackTitle(channel, cb) {
  sonos
    .currentTrack()
    .then((track) => {
      if (track) {
        cb(null, { title: track.title, artist: track.artist, uri: track.uri });
      } else {
        cb(null, null);
      }
    })
    .catch((err) => {
      cb(err);
    });
}

async function _getCurrentSource() {
  try {
    // Try to get transport URI to determine source
    // node-sonos might have getPositionInfo or similar
    const track = await sonos.currentTrack();
    if (!track) return null;
    
    // Log track info for debugging
    logger.debug(`Source check: currentTrack queuePosition=${track.queuePosition}, title="${track.title}", artist="${track.artist}"`);
    
    // Check if track has queuePosition - if yes, it's from queue
    // If no queuePosition, it might be from external source
    if (track.queuePosition !== undefined && track.queuePosition !== null && track.queuePosition > 0) {
      // Verify the track actually exists at that position
      try {
        const queue = await sonos.getQueue();
        if (queue && queue.items) {
          logger.debug(`Source check: queue has ${queue.items.length} items, total=${queue.total}`);

          // Check if queuePosition matches an item in the queue
          const queueIndex = track.queuePosition - 1; // Convert to 0-based index
          if (queueIndex >= 0 && queueIndex < queue.items.length) {
            const queueItem = queue.items[queueIndex];
            // Verify it's the same track
            if (queueItem.title === track.title && queueItem.artist === track.artist) {
              logger.debug(`Source check: confirmed queue match at position ${track.queuePosition}`);
              return { type: 'queue', queuePosition: track.queuePosition };
            } else {
              logger.warn(`Source check: queuePosition ${track.queuePosition} exists but track doesn't match. Queue has "${queueItem.title}" by "${queueItem.artist}", but playing "${track.title}" by "${track.artist}"`);
            }
          } else {
            logger.warn(`Source check: queuePosition ${track.queuePosition} is out of bounds (queue has ${queue.items.length} items)`);
          }

          // Try to find track by name/artist match - use findIndex to avoid double scan
          const foundIndex = queue.items.findIndex((item) =>
            item.title === track.title && item.artist === track.artist
          );
          if (foundIndex >= 0) {
            const foundPosition = foundIndex + 1;
            logger.debug(`Source check: found track in queue at position ${foundPosition} (but queuePosition was ${track.queuePosition})`);
            return { type: 'queue', queuePosition: foundPosition, note: 'position_mismatch' };
          }
        }
      } catch (queueErr) {
        logger.debug('Could not check queue for source: ' + queueErr.message);
      }

      // If queuePosition exists but doesn't match, might be stale or external
      logger.warn(`Source check: queuePosition ${track.queuePosition} exists but track not found in queue - might be external source`);
    } else {
      // No queuePosition - try to get queue and check if current track matches
      try {
        const queue = await sonos.getQueue();
        if (queue && queue.items) {
          const foundIndex = queue.items.findIndex((item) =>
            item.title === track.title && item.artist === track.artist
          );
          if (foundIndex >= 0) {
            const position = foundIndex + 1;
            logger.debug(`Source check: found track in queue at position ${position} (no queuePosition in track)`);
            return { type: 'queue', queuePosition: position };
          }
        }
      } catch (queueErr) {
        logger.debug('Could not check queue for source: ' + queueErr.message);
      }
    }
    
    // If track doesn't match queue, it's likely from external source
    logger.warn(`Source check: track "${track.title}" by "${track.artist}" not found in queue - likely external source`);
    return { type: 'external', track: { title: track.title, artist: track.artist } };
  } catch (err) {
    logger.warn('Error getting source info: ' + err.message);
    return null;
  }
}

/**
 * Admin diagnostic command - performs deep source checking by fetching and scanning the queue
 * This is the original _getCurrentSource logic kept as a diagnostic tool
 */
async function _diagnostics(input, channel, userName) {
  _logUserAction(userName, 'diagnostics');
  try {
    _slackMessage('🔍 Running diagnostic check...', channel);

    const track = await sonos.currentTrack();
    if (!track) {
      _slackMessage('⚠️ No track is currently playing.', channel);
      return;
    }

    const sourceInfo = await _getCurrentSource();

    let message = '📊 **Diagnostic Report**\n\n';
    message += `🎵 Current Track: *${track.title}* by _${track.artist}_\n`;
    message += `📍 Queue Position (API): ${track.queuePosition || 'null/undefined'}\n\n`;

    if (sourceInfo) {
      if (sourceInfo.type === 'queue') {
        message += `✅ **Source Type:** Queue\n`;
        message += `📋 **Queue Position (verified):** #${sourceInfo.queuePosition}\n`;
        if (sourceInfo.note === 'position_mismatch') {
          message += `⚠️ **Note:** Position mismatch detected - API position differs from queue scan\n`;
        }
      } else {
        message += `⚠️ **Source Type:** External\n`;
        message += `🔍 Track not found in queue - likely from:\n`;
        message += `   • Spotify Connect\n`;
        message += `   • AirPlay\n`;
        message += `   • Line-in\n`;
        message += `   • Other music service\n`;
      }
    } else {
      message += `❌ **Source Type:** Unknown (diagnostic failed)\n`;
    }

    message += `\n💡 **Note:** Regular commands now use fast queuePosition check instead of full queue scan for better performance.`;

    _slackMessage(message, channel);
  } catch (err) {
    logger.error('Error in diagnostics: ' + err);
    _slackMessage('🚨 Diagnostic check failed: ' + err.message, channel);
  }
}

function _currentTrack(channel, cb) {
  // First check the playback state
  sonos
    .getCurrentState()
    .then(async (state) => {
      if (state !== 'playing') {
        // Not playing - just show the state
        const stateEmoji = state === 'paused' ? '⏸️' : '⏹️';
        _slackMessage(`${stateEmoji} Playback is *${state}*`, channel);
        if (cb) cb(null, null);
        return;
      }
      
      // Playing - get track info and source
      try {
        const track = await sonos.currentTrack();
        if (track) {
          let message = `Currently playing: *${track.title}* by _${track.artist}_`;

          // Add time information if available
          if (track.duration && track.position) {
            const remaining = track.duration - track.position;
            const remainingMin = Math.floor(remaining / 60);
            const remainingSec = Math.floor(remaining % 60);
            const durationMin = Math.floor(track.duration / 60);
            const durationSec = Math.floor(track.duration % 60);

            message += `\n⏱️ ${remainingMin}:${remainingSec.toString().padStart(2, '0')} remaining (${durationMin}:${durationSec.toString().padStart(2, '0')} total)`;
          }

          // Check source - simple check using queuePosition
          const isFromQueue = track.queuePosition > 0;
          if (isFromQueue) {
            message += `\n📋 Source: *Queue* (position #${track.queuePosition})`;
          } else {
            message += `\n⚠️ Source: *External* (not from queue - Spotify Connect/AirPlay/Line-in?)`;
            message += `\n💡 Tip: Run \`flush\` and \`stop\`, then \`add <song>\` to use queue`;
          }

          if (voting.isTrackGongBanned({ title: track.title, artist: track.artist, uri: track.uri })) {
            message += '\n🔒 (Immune to GONG)';
          }
          _slackMessage(message, channel);
          if (cb) cb(null, track);
        } else {
          _slackMessage('🔇 *Silence...* Nothing is currently playing. Use `add` to get started! 🎵', channel);
          if (cb) cb(null, null);
        }
      } catch (trackErr) {
        throw trackErr;
      }
    })
    .catch((err) => {
      logger.error('Error getting current track: ' + err);
      _slackMessage('🚨 Error getting current track info. Try again! 🔄', channel);
      if (cb) cb(err);
    });
}

async function _gongplay(command, channel) {
  if (command === 'play') {
    // Track banning is now handled by voting module

    try {
      // Get current track position
      const currentTrack = await sonos.currentTrack();
      const currentPosition = currentTrack ? currentTrack.queuePosition : 1;
      const gongPosition = currentPosition + 1;

      // Queue the gong sound from Spotify right after current track (+1)
      const gongUri = 'spotify:track:1FzsAo5gX5oEJD9PFVH5FO';
      await sonos.queue(gongUri, gongPosition);
      logger.info('Queued gong sound at position ' + gongPosition);

      // Skip to the gong sound
      await sonos.next();
      logger.info('Playing gong sound, will auto-advance to next track');

      // Wait for gong to finish playing and advance to next song (it's about 10 seconds long)
      setTimeout(async () => {
        try {
          // Find and remove the gong sound from the queue
          const queue = await sonos.getQueue();

          // Use findIndex instead of manual loop for cleaner and potentially faster search
          const gongIndex = queue.items.findIndex(item =>
            item.title === 'Gong 1' || item.uri.includes('1FzsAo5gX5oEJD9PFVH5FO')
          );

          if (gongIndex >= 0) {
            // Sonos uses 1-based indexing for removeTracksFromQueue
            await sonos.removeTracksFromQueue(gongIndex + 1, 1);
            logger.info('Successfully removed gong sound from queue at index ' + gongIndex);
          } else {
            logger.info('Gong sound not found in queue (may have already been removed)');
          }
        } catch (removeErr) {
          logger.warn('Could not remove gong from queue: ' + removeErr.message);
        }
      }, 12000); // Wait 12 seconds for gong to finish and auto-advance

    } catch (err) {
      logger.error('Error playing GONG sound: ' + err);
      // Fallback: just skip if gong playback fails
      try {
        await sonos.next();
      } catch (skipErr) {
        logger.error('Error skipping to next track: ' + skipErr);
      }
    }
  }
}

// Note: Playback commands (_nextTrack, _previous, _stop, _play, _pause, _resume, _flush, _shuffle, _normal)
// have been moved to lib/command-handlers.js

async function _setCrossfade(input, channel, userName) {
  _logUserAction(userName, 'setCrossfade');
  // Admin check now handled in processInput (platform-aware)
  
  try {
    // If no argument, show current status
    if (!input || input.length < 2) {
      const result = await sonos.avTransportService().GetCrossfadeMode();
      const isEnabled = result.CrossfadeMode === '1' || result.CrossfadeMode === 1;
      const status = isEnabled ? 'enabled' : 'disabled';
      const emoji = isEnabled ? '🎵✨' : '🎵';
      _slackMessage(`${emoji} Crossfade is currently *${status}*. Use \`setcrossfade on\` or \`setcrossfade off\` to change it.`, channel);
      return;
    }

    const arg = input[1].toLowerCase();
    
    if (arg === 'on' || arg === 'enable' || arg === 'true' || arg === '1') {
      // Enable crossfade
      await sonos.avTransportService().SetCrossfadeMode({
        InstanceID: 0,
        CrossfadeMode: '1'
      });
      config.set('crossfadeEnabled', true);
      config.save((err) => {
        if (err) {
          logger.warn('Failed to save crossfadeEnabled config: ' + err.message);
        }
      });
      _slackMessage('🎵✨ *Crossfade enabled!* Tracks will now smoothly fade into each other. 🎶', channel);
      logger.info('Crossfade enabled by ' + userName);
    } else if (arg === 'off' || arg === 'disable' || arg === 'false' || arg === '0') {
      // Disable crossfade
      await sonos.avTransportService().SetCrossfadeMode({
        InstanceID: 0,
        CrossfadeMode: '0'
      });
      config.set('crossfadeEnabled', false);
      config.save((err) => {
        if (err) {
          logger.warn('Failed to save crossfadeEnabled config: ' + err.message);
        }
      });
      _slackMessage('🎵 Crossfade *disabled*. Tracks will play with normal transitions. ✅', channel);
      logger.info('Crossfade disabled by ' + userName);
    } else {
      _slackMessage('🤔 Usage: `setcrossfade [on|off]`\n\nExample: `setcrossfade on` to enable smooth transitions between tracks.', channel);
    }
  } catch (err) {
    logger.error('Error setting crossfade mode: ' + err);
    _slackMessage('🚨 Error setting crossfade mode. Make sure you\'re playing from the queue (not external source). Try again! 🔄', channel);
  }
}

// Note: Queue commands (_removeTrack, _purgeHalfQueue) have been moved to lib/command-handlers.js

function _status(channel, cb) {
  sonos
    .getCurrentState()
    .then((state) => {
      _slackMessage('🔊 Current playback state: *' + state + '* 🎵', channel);
      if (cb) cb(state);
    })
    .catch((err) => {
      logger.error('Error getting status: ' + err);
      _slackMessage('🚨 Error getting playback status. Try again! 🔄', channel);
      if (cb) cb(null);
    });
}

async function _help(input, channel, userName) {
  try {
    // Determine admin status platform-aware
    const isAdminUser = currentPlatform === 'discord' ? currentIsAdmin : (channel === global.adminChannel);

    // AI help section (only shown if OpenAI is enabled)
    let aiHelpSection = '';
    if (AIHandler.isAIEnabled()) {
      aiHelpSection = `*🤖 AI Natural Language*
> Talk to me naturally! _"play christmas music"_, _"skip this"_, etc.
> Quantity: couple (2), few (3-4), some (5), many (8)

━━━━━━━━━━━━━━━━━━━━━

`;
    }

    // For Discord admins, send regular help in channel and admin help via DM
    if (currentPlatform === 'discord' && isAdminUser) {
      const regularHelp = fs.readFileSync('templates/help/helpText.txt', 'utf8');
      const adminHelp = fs.readFileSync('templates/help/helpTextAdmin.txt', 'utf8');

      // Generate config values and admin URL for admin help
      const configList = `
        • \`gongLimit\`: ${gongLimit}
        • \`voteLimit\`: ${voteLimit}
        • \`voteImmuneLimit\`: ${voteImmuneLimit}
        • \`flushVoteLimit\`: ${flushVoteLimit}
        • \`maxVolume\`: ${maxVolume}
        • \`searchLimit\`: ${searchLimit}
        • \`voteTimeLimitMinutes\`: ${voteTimeLimitMinutes}`;
      
      const httpsPort = config.get('httpsPort') || 8443;
      const useHttps = config.get('useHttps') !== false && (config.get('sslAutoGenerate') !== false || (config.get('sslCertPath') && config.get('sslKeyPath')));
      let adminUrl = '';
      if (ipAddress && ipAddress !== '' && ipAddress !== 'IP_HOST') {
        adminUrl = useHttps ? `https://${ipAddress}:${httpsPort}/admin` : `http://${ipAddress}:${webPort}/admin`;
      } else {
        adminUrl = `http://localhost:${webPort}/admin`;
      }

      // Send admin help via DM first - extract username without <>@
      const cleanUserName = userName ? userName.replace(/[<@>]/g, '') : 'unknown';
      const adminMessage = ('━━━━━━━━━━━━━━━━━━━━━\n**🎛️ ADMIN COMMANDS** (DJ/Admin role)\n━━━━━━━━━━━━━━━━━━━━━\n\n' + adminHelp)
        .replace(/{{configValues}}/g, configList)
        .replace(/{{adminUrl}}/g, adminUrl);
      
      const dmSuccess = await _sendDirectMessage(cleanUserName, adminMessage);
      
      // Send regular help in channel with appropriate status message
      const dmStatusMessage = dmSuccess 
        ? '\n\n_✉️ Admin commands sent via DM!_'
        : '\n\n_⚠️ Could not send admin commands via DM. Make sure DMs are enabled!_';
      
      const regularMessage = (aiHelpSection + regularHelp + dmStatusMessage)
        .replace(/{{gongLimit}}/g, gongLimit)
        .replace(/{{voteImmuneLimit}}/g, voteImmuneLimit)
        .replace(/{{voteLimit}}/g, voteLimit)
        .replace(/{{flushVoteLimit}}/g, flushVoteLimit)
        .replace(/{{voteTimeLimitMinutes}}/g, voteTimeLimitMinutes)
        .replace(/{{searchLimit}}/g, searchLimit);
      
      _slackMessage(regularMessage, channel);
      
    } else {
      // Slack or non-admin: show appropriate single help file
      const helpFile = isAdminUser ? 'templates/help/helpTextAdmin.txt' : 'templates/help/helpText.txt';
      const helpText = fs.readFileSync(helpFile, 'utf8');
      
      let configList = '';
      let adminUrl = '';
      if (isAdminUser) {
        configList = `
        • \`gongLimit\`: ${gongLimit}
        • \`voteLimit\`: ${voteLimit}
        • \`voteImmuneLimit\`: ${voteImmuneLimit}
        • \`flushVoteLimit\`: ${flushVoteLimit}
        • \`maxVolume\`: ${maxVolume}
        • \`searchLimit\`: ${searchLimit}
        • \`voteTimeLimitMinutes\`: ${voteTimeLimitMinutes}`;
        
        const httpsPort = config.get('httpsPort') || 8443;
        const useHttps = config.get('useHttps') !== false && (config.get('sslAutoGenerate') !== false || (config.get('sslCertPath') && config.get('sslKeyPath')));
        if (ipAddress && ipAddress !== '' && ipAddress !== 'IP_HOST') {
          adminUrl = useHttps ? `https://${ipAddress}:${httpsPort}/admin` : `http://${ipAddress}:${webPort}/admin`;
        } else {
          adminUrl = `http://localhost:${webPort}/admin`;
        }
      }

      const finalMessage = (aiHelpSection + helpText)
        .replace(/{{gongLimit}}/g, gongLimit)
        .replace(/{{voteImmuneLimit}}/g, voteImmuneLimit)
        .replace(/{{voteLimit}}/g, voteLimit)
        .replace(/{{flushVoteLimit}}/g, flushVoteLimit)
        .replace(/{{voteTimeLimitMinutes}}/g, voteTimeLimitMinutes)
        .replace(/{{searchLimit}}/g, searchLimit)
        .replace(/{{configValues}}/g, configList)
        .replace(/{{adminUrl}}/g, adminUrl);

      _slackMessage(finalMessage, channel, { unfurl_links: false, unfurl_media: false });
    }
  } catch (err) {
    logger.error('Error reading help file: ' + err.message);
    _slackMessage('🚨 Error loading help text. Please contact an admin! 📞', channel);
  }
}

/**
 * Send Direct Message to Discord user
 * @param {string} userName - Discord username to send DM to
 * @param {string} text - Message text to send
 */
async function _sendDirectMessage(userName, text) {
  if (currentPlatform !== 'discord') {
    logger.warn('[DM] Direct messages only supported on Discord');
    return false;
  }
  
  try {
    const discordModule = require('./lib/discord');
    const discordClient = discordModule.getDiscordClient();
    
    if (!discordClient) {
      logger.warn('[DM] Discord client not available');
      return false;
    }
    
    // Find user by username in cache
    const user = discordClient.users.cache.find(u => u.username === userName);
    if (!user) {
      logger.warn(`[DM] Could not find Discord user: ${userName}`);
      return false;
    }
    
    // Convert Slack markdown to Discord markdown
    // Slack: <URL|text> -> Discord: [text](URL)
    let discordText = text.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '[$2]($1)');
    
    // Discord has a 2000 char limit, split into chunks if needed
    const maxLength = 1900; // Leave some margin
    if (discordText.length <= maxLength) {
      await user.send(discordText);
      logger.info(`[DM] Sent DM to ${userName} (${user.id})`);
      return true;
    } else {
      // Split on newlines to keep formatting intact
      const lines = discordText.split('\n');
      let currentChunk = '';
      let chunkCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if ((currentChunk + line + '\n').length > maxLength) {
          // Send current chunk
          if (currentChunk.trim().length > 0) {
            await user.send(currentChunk);
            chunkCount++;
            currentChunk = '';
            // Small delay between messages
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Handle oversized single lines by splitting them
          if (line.length > maxLength) {
            // Split the line into smaller chunks
            let remainingLine = line;
            while (remainingLine.length > 0) {
              const chunk = remainingLine.substring(0, maxLength);
              await user.send(chunk);
              chunkCount++;
              remainingLine = remainingLine.substring(maxLength);
              if (remainingLine.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }
            // Skip adding to currentChunk since we already sent it
            continue;
          }
        }
        
        currentChunk += line + '\n';
      }

      // Send remaining chunk
      if (currentChunk.trim().length > 0) {
        await user.send(currentChunk);
        chunkCount++;
      }

      logger.info(`[DM] Sent ${chunkCount} DM chunks to ${userName} (${user.id})`);
      return true;
    }
  } catch (err) {
    logger.error(`[DM] Failed to send DM to ${userName}: ${err.message}`);
    return false;
  }
}

async function _featurerequest(input, channel, userName) {
  _logUserAction(userName, 'featurerequest');
  logger.info(`[FEATUREREQUEST] Command called by ${userName} in ${channel} with input: ${JSON.stringify(input)}`);
  
  if (!input || input.length < 2) {
    _slackMessage('Usage: `featurerequest <feature description>`\nExample: `featurerequest add support for YouTube playlists`', channel);
    return;
  }
  
  const featureDescription = input.slice(1).join(' ');
  
  // Try GitHub App first, fallback to personal access token
  let authToken = null;
  let authMethod = null;
  
  try {
    const appToken = await githubApp.getGitHubAppToken();
    if (appToken) {
      authToken = appToken;
      authMethod = 'GitHub App';
      logger.info('[FEATUREREQUEST] Using GitHub App authentication');
    }
  } catch (error) {
    logger.warn(`[FEATUREREQUEST] GitHub App auth failed: ${error.message}, falling back to personal token`);
  }
  
  // Fallback to personal access token
  if (!authToken) {
    const githubToken = config.get('githubToken');
    if (!githubToken) {
      logger.warn('[FEATUREREQUEST] No GitHub authentication configured');
      _slackMessage(
        '❌ *Feature request not configured*\n\n' +
        'To enable this feature, configure either:\n\n' +
        '*Option 1: GitHub App (Recommended)*\n' +
        '1. Create GitHub App: https://github.com/settings/apps/new\n' +
        '2. Set permissions: Issues: Write\n' +
        '3. Install on repository\n' +
        '4. Configure via admin commands:\n' +
        '   `setconfig githubAppId 2741767`\n' +
        '   `setconfig githubAppPrivateKey /path/to/private-key.pem`\n' +
        '   `setconfig githubAppInstallationId 106479987`\n\n' +
        '*Option 2: Personal Access Token*\n' +
        '1. Go to: https://github.com/settings/tokens\n' +
        '2. Generate new token (classic) with `repo` scope\n' +
        '3. `setconfig githubToken ghp_xxxxxxxxxxxx`\n\n' +
        '📖 More info: https://github.com/htilly/SlackONOS#configuration',
        channel
      );
      return;
    }
    authToken = githubToken;
    authMethod = 'Personal Access Token';
  }
  
  try {
    logger.info(`[FEATUREREQUEST] Creating GitHub issue: ${featureDescription} (using ${authMethod})`);
    // Create GitHub issue with enhancement label
    const response = await fetch(`https://api.github.com/repos/htilly/SlackONOS/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: featureDescription,
        body: `**Requested by:** ${userName}\n**Channel:** ${channel}\n**Timestamp:** ${new Date().toISOString()}\n\n${featureDescription}`,
        labels: ['enhancement']
      })
    });
    
    if (response.ok) {
      const issue = await response.json();
      _slackMessage(`✅ Feature request created!\n*Issue:* #${issue.number}\n*Title:* ${featureDescription}\n🔗 ${issue.html_url}`, channel);
      logger.info(`[FEATUREREQUEST] Created issue #${issue.number} for: ${featureDescription} by ${userName}`);
    } else {
      const errorText = await response.text();
      logger.error(`[FEATUREREQUEST] GitHub API error: ${response.status} - ${errorText}`);
      
      // Handle specific error cases
      if (response.status === 401) {
        // Bad credentials - token is invalid or expired
        if (authMethod === 'GitHub App') {
          _slackMessage(
            '❌ *GitHub App authentication failed*\n\n' +
            'The GitHub App configuration is invalid. Please check:\n\n' +
            '1. App ID is correct\n' +
            '2. Private key file path is correct and readable\n' +
            '3. Installation ID is correct\n' +
            '4. App is installed on the repository\n\n' +
            'Or use a Personal Access Token as fallback.',
            channel
          );
        } else {
          _slackMessage(
            '❌ *GitHub token invalid or expired*\n\n' +
            'The configured GitHub token is not valid. Please:\n\n' +
            '1. Go to: https://github.com/settings/tokens\n' +
            '2. Generate a new token (classic) with `repo` scope\n' +
            '3. Update the token via admin command:\n' +
            '   `setconfig githubToken ghp_xxxxxxxxxxxx`\n\n' +
            '📖 More info: https://github.com/htilly/SlackONOS#configuration',
            channel
          );
        }
        return;
      }
      
      throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
    }
  } catch (err) {
    logger.error(`[FEATUREREQUEST] Failed to create issue: ${err.message}`, err);
    // Only show generic error if we haven't already handled it above
    if (err.message && !err.message.includes('401')) {
      _slackMessage(`❌ Failed to create feature request: ${err.message}`, channel);
    }
  }
}

async function _blacklist(input, channel, userName) {
  _logUserAction(userName, 'blacklist');
  // Admin check now handled in processInput (platform-aware)
  if (!input || input.length < 2) {
    if (blacklist.length === 0) {
      _slackMessage('The blacklist is currently empty. Everyone is behaving! 😇', channel);
    } else {
      const userList = blacklist.map(u => `<@${u}>`).join(', ');
      _slackMessage(`*🚫 Blacklisted Users:*\n${userList}\n\n_To remove a user, simply run \`blacklist @user\` again._`, channel);
    }
    return;
  }

  // Normalize user string (remove <@...>)
  let targetUser = normalizeUser(input[1]);

  if (!targetUser) {
    _slackMessage('🤔 Invalid user format. Make sure to mention them like @username! 👤', channel);
    return;
  }

  const index = blacklist.indexOf(targetUser);

  if (index > -1) {
    // Remove from blacklist
    blacklist.splice(index, 1);
    _slackMessage(`✅ User <@${targetUser}> has been removed from the blacklist! They can now use the bot again. 🎉`, channel);
  } else {
    // Add to blacklist
    blacklist.push(targetUser);
    _slackMessage(`User <@${targetUser}> has been added to the blacklist. They are now banned from using the bot. 🚫`, channel);
  }

  await saveBlacklist(blacklist);
}

async function _trackblacklist(input, channel, userName) {
  _logUserAction(userName, 'trackblacklist');
  // Admin check now handled in processInput (platform-aware)

  const trackBlacklist = loadTrackBlacklist();

  if (!input || input.length < 2) {
    if (trackBlacklist.length === 0) {
      _slackMessage('The track blacklist is currently empty. All songs are allowed! 🎵', channel);
    } else {
      const trackList = trackBlacklist.map((t, i) => `${i + 1}. ${t}`).join('\n');
      _slackMessage(`*🚫 Blacklisted Tracks/Artists:*\n${trackList}\n\n_To add/remove, use \`trackblacklist add <name>\` or \`trackblacklist remove <name>\`_`, channel);
    }
    return;
  }

  const action = input[1].toLowerCase();
  const trackName = input.slice(2).join(' ').trim();

  if (!trackName && (action === 'add' || action === 'remove')) {
    _slackMessage('🤔 Please specify a track or artist name! Example: `trackblacklist add Last Christmas`', channel);
    return;
  }

  if (action === 'add') {
    if (trackBlacklist.some(t => t.toLowerCase() === trackName.toLowerCase())) {
      _slackMessage(`"${trackName}" is already on the blacklist! 🚫`, channel);
      return;
    }
    trackBlacklist.push(trackName);
    await saveTrackBlacklist(trackBlacklist);
    _slackMessage(`✅ "${trackName}" has been added to the track blacklist! This track/artist can no longer be added. 🚫🎵`, channel);
  } else if (action === 'remove') {
    const index = trackBlacklist.findIndex(t => t.toLowerCase() === trackName.toLowerCase());
    if (index === -1) {
      _slackMessage(`"${trackName}" is not on the blacklist! 🤷`, channel);
      return;
    }
    trackBlacklist.splice(index, 1);
    await saveTrackBlacklist(trackBlacklist);
    _slackMessage(`✅ "${trackName}" has been removed from the track blacklist! This track/artist can now be added again. 🎉`, channel);
  } else {
    _slackMessage('Invalid action! Use `trackblacklist add <name>` or `trackblacklist remove <name>` 📝', channel);
  }
}

async function _setconfig(input, channel, userName) {
  _logUserAction(userName, 'setconfig');
  // Admin check now handled in processInput (platform-aware)

  // Usage: setconfig <key> <value>
  if (!input || input.length < 3) {
    const currentConfig = `
*Current Configurable Settings:*
> \`gongLimit\`: ${gongLimit}
> \`voteLimit\`: ${voteLimit}
> \`voteImmuneLimit\`: ${voteImmuneLimit}
> \`flushVoteLimit\`: ${flushVoteLimit}
> \`maxVolume\`: ${maxVolume}
> \`searchLimit\`: ${searchLimit}
> \`voteTimeLimitMinutes\`: ${voteTimeLimitMinutes}
> \`aiModel\`: ${config.get('aiModel') || 'gpt-4o-mini'}
> \`aiPrompt\`: ${(config.get('aiPrompt') || '').slice(0, 80)}${(config.get('aiPrompt') || '').length > 80 ? '…' : ''}
> \`aiMoodMirrorEnabled\`: ${config.get('aiMoodMirrorEnabled') === true}
> \`defaultTheme\`: ${config.get('defaultTheme') || '(not set)'}
> \`themePercentage\`: ${config.get('themePercentage') || 0}%
> \`telemetryEnabled\`: ${config.get('telemetryEnabled')}
> \`soundcraftEnabled\`: ${config.get('soundcraftEnabled') || false}
> \`soundcraftIp\`: ${config.get('soundcraftIp') || '(not set)'}
> \`crossfadeEnabled\`: ${config.get('crossfadeEnabled') || false}
> \`crossfadeDurationSeconds\`: ${Number(config.get('crossfadeDurationSeconds') || 6)}
> \`slackAlwaysThread\`: ${config.get('slackAlwaysThread') || false}
> \`logLevel\`: ${config.get('logLevel') || 'info'}

*Usage:* \`setconfig <key> <value>\`
*Example:* \`setconfig gongLimit 5\`
*Example:* \`setconfig defaultTheme lounge\`
*Example:* \`setconfig themePercentage 30\`
*Example:* \`setconfig aiMoodMirrorEnabled true\`
*Example:* \`setconfig telemetryEnabled false\`
*Example:* \`setconfig soundcraftEnabled true\`
*Example:* \`setconfig soundcraftIp 192.168.1.100\`
*Example:* \`setconfig crossfadeEnabled true\`
*Example:* \`setconfig crossfadeDurationSeconds 6\`
*Example:* \`setconfig slackAlwaysThread true\`
    `;
    _slackMessage(currentConfig.trim(), channel);
    return;
  }

  const key = input[1];
  const value = input[2];

  // Define allowed config keys and their validation
  const allowedConfigs = {
    gongLimit: { type: 'number', min: 1, max: 20 },
    voteLimit: { type: 'number', min: 1, max: 20 },
    voteImmuneLimit: { type: 'number', min: 1, max: 20 },
    flushVoteLimit: { type: 'number', min: 1, max: 20 },
    maxVolume: { type: 'number', min: 0, max: 100 },
    searchLimit: { type: 'number', min: 1, max: 50 },
    voteTimeLimitMinutes: { type: 'number', min: 1, max: 60 },
    themePercentage: { type: 'number', min: 0, max: 100 },
    crossfadeDurationSeconds: { type: 'number', min: 0, max: 30 },
    aiModel: { type: 'string', minLen: 1, maxLen: 50, allowed: ['gpt-4o-mini', 'gpt-4o'] },
    aiPrompt: { type: 'string', minLen: 1, maxLen: 500 },
    aiMoodMirrorEnabled: { type: 'boolean' },
    defaultTheme: { type: 'string', minLen: 0, maxLen: 100 },
    telemetryEnabled: { type: 'boolean' },
    soundcraftEnabled: { type: 'boolean' },
    soundcraftIp: { type: 'string', minLen: 0, maxLen: 50 },
    crossfadeEnabled: { type: 'boolean' },
    slackAlwaysThread: { type: 'boolean' },
    logLevel: { type: 'string', minLen: 4, maxLen: 5, allowed: ['error', 'warn', 'info', 'debug'] },
    githubToken: { type: 'string', minLen: 4, maxLen: 100, sensitive: true },
    githubAppId: { type: 'string', minLen: 1, maxLen: 20 },
    githubAppPrivateKey: { type: 'string', minLen: 50, maxLen: 5000, sensitive: true },
    githubAppInstallationId: { type: 'string', minLen: 1, maxLen: 20 }
  };

  // Make config key case-insensitive
  const normalizedKey = Object.keys(allowedConfigs).find(k => k.toLowerCase() === key.toLowerCase());
  if (!normalizedKey) {
    _slackMessage(`❌ Invalid config key "${key}". Use \`setconfig\` without arguments to see available options! ⚙️`, channel);
    return;
  }

  const configDef = allowedConfigs[normalizedKey];
  const actualKey = normalizedKey; // Use normalized key for all operations

  // Validate value
  if (configDef.type === 'number') {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      _slackMessage(`🔢 Value for "${key}" must be a number! Try again with digits. 🎯`, channel);
      return;
    }
    if (numValue < configDef.min || numValue > configDef.max) {
      _slackMessage(`📊 Value for "${key}" must be between *${configDef.min}* and *${configDef.max}*! 🎯`, channel);
      return;
    }

    const oldValue = config.get(actualKey);

    // Update runtime variable
    switch (actualKey) {
      case 'gongLimit':
        gongLimit = numValue;
        break;
      case 'voteLimit':
        voteLimit = numValue;
        break;
      case 'voteImmuneLimit':
        voteImmuneLimit = numValue;
        break;
      case 'flushVoteLimit':
        flushVoteLimit = numValue;
        break;
      case 'maxVolume':
        maxVolume = numValue;
        break;
      case 'searchLimit':
        searchLimit = numValue;
        break;
      case 'voteTimeLimitMinutes':
        voteTimeLimitMinutes = numValue;
        break;
    }

    // Sync voting module config
    voting.setConfig({
      gongLimit,
      voteLimit,
      voteImmuneLimit,
      flushVoteLimit,
      voteTimeLimitMinutes,
    });

    // Persist to config file
    config.set(actualKey, numValue);
    config.save(function (err) {
      if (err) {
        logger.error('Error saving config: ' + err);
        _slackMessage(`⚠️ Updated \`${actualKey}\` to \`${numValue}\` in memory, but failed to save to disk! Changes won't persist after restart. 🚨`, channel);
        return;
      }
      _slackMessage(`✅ Successfully updated \`${actualKey}\` from \`${oldValue}\` to \`${numValue}\` and saved to config.`, channel);
    });
  } else if (configDef.type === 'string') {
    const newValue = input.slice(2).join(' ').trim();
    if (newValue.length < (configDef.minLen || 1) || newValue.length > (configDef.maxLen || 500)) {
      _slackMessage(`📝 Value length for \`${actualKey}\` must be between ${configDef.minLen} and ${configDef.maxLen} characters.`, channel);
      return;
    }
    // Check allowed values if specified (case-insensitive)
    if (configDef.allowed) {
      const normalizedValue = newValue.toLowerCase();
      const matchedValue = configDef.allowed.find(a => a.toLowerCase() === normalizedValue);
      if (!matchedValue) {
        _slackMessage(`📝 Invalid value for \`${actualKey}\`. Allowed values: ${configDef.allowed.join(', ')}`, channel);
        return;
      }
      // Use the original case from allowed list
      const finalValue = matchedValue;
      const oldValue = config.get(actualKey) || '';
      config.set(actualKey, finalValue);
      
      config.save(function (err) {
        if (err) {
          logger.error('Error saving config: ' + err);
          _slackMessage(`⚠️ Updated \`${actualKey}\` in memory, but failed to save to disk!`, channel);
          return;
        }
        _slackMessage(`✅ Successfully updated \`${actualKey}\` and saved to config.\nOld: \`${oldValue.slice(0, 80)}${oldValue.length > 80 ? '…' : ''}\`\nNew: \`${finalValue.slice(0, 80)}${finalValue.length > 80 ? '…' : ''}\``, channel);
      });
      return;
    }
    
    const oldValue = config.get(actualKey) || '';
    config.set(actualKey, newValue);
    
    // Update Soundcraft IP if changed
    if (actualKey === 'soundcraftIp') {
      soundcraft.config.soundcraftIp = newValue;
      if (soundcraft.config.soundcraftEnabled && newValue) {
        // Reconnect with new IP
        soundcraft.disconnect();
        soundcraft.connect().then(success => {
          if (success) {
            logger.info(`Soundcraft reconnected to new IP: ${newValue}`);
          } else {
            logger.warn(`Failed to connect to Soundcraft at new IP: ${newValue}`);
          }
        });
      }
    }
    
    config.save(function (err) {
      if (err) {
        logger.error('Error saving config: ' + err);
        _slackMessage(`⚠️ Updated \`${actualKey}\` in memory, but failed to save to disk!`, channel);
        return;
      }
      // Mask sensitive values (like tokens)
      if (configDef.sensitive) {
        const maskedValue = newValue.slice(0, 4) + '****' + newValue.slice(-4);
        _slackMessage(`✅ Successfully updated \`${actualKey}\` and saved to config.\nNew: \`${maskedValue}\` (${newValue.length} chars)`, channel);
      } else {
        _slackMessage(`✅ Successfully updated \`${actualKey}\` and saved to config.\nOld: \`${oldValue.slice(0, 80)}${oldValue.length > 80 ? '…' : ''}\`\nNew: \`${newValue.slice(0, 80)}${newValue.length > 80 ? '…' : ''}\``, channel);
      }
    });
  } else if (configDef.type === 'boolean') {
    const lowerValue = value.toLowerCase();
    let boolValue;
    
    if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes' || lowerValue === 'on') {
      boolValue = true;
    } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no' || lowerValue === 'off') {
      boolValue = false;
    } else {
      _slackMessage(`🔘 Value for \`${key}\` must be a boolean (true/false, yes/no, on/off, 1/0)`, channel);
      return;
    }
    
    const oldValue = config.get(actualKey);
    // Special-case crossfade: apply via Sonos immediately and persist using the dedicated handler
    if (actualKey === 'crossfadeEnabled') {
      await _setCrossfade(['setcrossfade', boolValue ? 'on' : 'off'], channel, userName);
      return;
    }

    config.set(actualKey, boolValue);
    
    // Update Soundcraft connection if changing soundcraftEnabled
    if (actualKey === 'soundcraftEnabled') {
      if (boolValue && !soundcraft.isEnabled()) {
        // Enable and connect
        soundcraft.config.soundcraftEnabled = true;
        soundcraft.connect().then(success => {
          if (success) {
            logger.info('Soundcraft enabled and connected via setconfig');
          } else {
            logger.warn('Soundcraft enabled but connection failed');
          }
        });
      } else if (!boolValue && soundcraft.isEnabled()) {
        // Disable and disconnect
        soundcraft.config.soundcraftEnabled = false;
        soundcraft.disconnect();
        logger.info('Soundcraft disabled via setconfig');
      }
    }
    
    config.save(function (err) {
      if (err) {
        logger.error('Error saving config: ' + err);
        _slackMessage(`⚠️ Updated \`${actualKey}\` to \`${boolValue}\` in memory, but failed to save to disk!`, channel);
        return;
      }
      _slackMessage(`✅ Successfully updated \`${actualKey}\` from \`${oldValue}\` to \`${boolValue}\` and saved to config.`, channel);
    });
  }
}

// Note: _append has been moved to lib/add-handlers.js

function _addToSpotifyPlaylist(input, channel) {
  // Admin check now handled in processInput (platform-aware)
  _slackMessage('🚧 This feature is still under construction! Check back later! 🛠️', channel);
}

async function _tts(input, channel) {
  // Admin check now handled in processInput (platform-aware)
  const text = input.slice(1).join(' ');
  if (!text) {
    _slackMessage('💬 You must provide a message for the bot to say! Use `say <message>` 🔊', channel);
    return;
  }

  const ttsFilePath = path.join(os.tmpdir(), 'sonos-tts.mp3');

  // Pick a random intro message to use in both Slack and TTS
  const introMessage = ttsMessage[Math.floor(Math.random() * ttsMessage.length)];
  // Build full TTS text with intro, longer pause (...), and the actual message
  const fullTtsText = `${introMessage}... ... ${text}`;

  try {
    // Get audio as base64 using the new library (handles long text automatically)
    const audioResults = await googleTTS.getAllAudioBase64(fullTtsText, {
      lang: 'en',
      slow: false,
      host: 'https://translate.google.com',
      timeout: 10000,
      splitPunct: ',.?!;:',
    });

    // Combine all audio chunks into a single buffer
    const audioBuffers = audioResults.map(result => Buffer.from(result.base64, 'base64'));
    const combinedBuffer = Buffer.concat(audioBuffers);

    // Write the combined audio to file (async)
    await fs.promises.writeFile(ttsFilePath, combinedBuffer);
    logger.info('TTS audio saved to: ' + ttsFilePath);

    // Get TTS file duration
    const fileDuration = await new Promise((resolve, reject) => {
      mp3Duration(ttsFilePath, (err, duration) => {
        if (err) reject(err);
        resolve(duration);
      });
    });
    // Convert to milliseconds and add 2 sec buffer for Sonos to advance
    const waitTime = Math.ceil(fileDuration * 1000) + 2000;
    logger.info('TTS duration: ' + fileDuration.toFixed(2) + 's, will wait ' + waitTime + 'ms before cleanup');

    // Validate IP address for TTS (must be accessible from Sonos)
    if (!ipAddress || ipAddress === '' || ipAddress === 'IP_HOST' || ipAddress === '127.0.0.1' || ipAddress === 'localhost') {
      logger.error('❌ TTS failed: ipAddress is not configured or set to localhost/127.0.0.1. Sonos cannot access this address. Please set ipAddress in config.json to your server\'s network IP address (e.g., 192.168.1.100) or set HOST_IP environment variable.');
      _slackMessage('🚨 TTS failed: Server IP address not configured. Sonos cannot access localhost. Please configure ipAddress in config.json with your server\'s network IP address. 🔧', channel);
      return;
    }

    // Get current track position
    const currentTrack = await sonos.currentTrack();
    const currentPosition = currentTrack ? currentTrack.queuePosition : 1;
    const ttsPosition = currentPosition + 1;

    // Always use HTTP for TTS (Sonos doesn't trust self-signed certificates)
    // TTS is only used on local network, so HTTP is sufficient
    const protocol = 'http';
    const port = webPort;
    const uri = `${protocol}://${ipAddress}:${port}/tts.mp3?t=${Date.now()}`;
    logger.info('Queuing TTS file from: ' + uri + ' at position ' + ttsPosition);

    // Queue TTS right after current track
    await sonos.queue(uri, ttsPosition);

    _slackMessage(introMessage, channel);

    // Skip to TTS
    await sonos.next();
    logger.info('Playing TTS at queue position ' + ttsPosition);

    // Wait for TTS to finish + 3 sec buffer, then remove from queue and go back
    setTimeout(async () => {
      try {
        // Remove the TTS track from queue
        await sonos.removeTracksFromQueue([ttsPosition]);
        logger.info('Removed TTS track from queue at position ' + ttsPosition);

        // Go back to previous track (the one that was playing before TTS)
        await sonos.previous();
        logger.info('Returned to previous track after TTS cleanup');
      } catch (e) {
        logger.error('Error cleaning up after TTS: ' + e);
      }
    }, waitTime);

  } catch (err) {
    logger.error('Error during TTS: ' + err);
    _slackMessage('🚨 Error generating text-to-speech. Try again with a simpler message! 🔄', channel);
  }
}

function _moveTrackAdmin(input, channel, userName) {
  _logUserAction(userName, 'move');
  // Admin check now handled in processInput (platform-aware)
  if (input.length < 3) {
    _slackMessage('📍 Please provide both the source and destination track numbers! Use `move [from] [to]` 🎯', channel);
    return;
  }
  const from = Number(input[1]);
  const to = Number(input[2]);
  if (isNaN(from) || isNaN(to)) {
    _slackMessage('🔢 Invalid track numbers! Both source and destination must be numbers. Try `move 3 1` 🎯', channel);
    return;
  }

  sonos
    .reorderTracksInQueue(from + 1, 1, to + 1, 0)
    .then(() => {
      _slackMessage(`📍 Successfully moved track from position *${from}* to *${to}*! Queue reshuffled! 🔀`, channel);
    })
    .catch((err) => {
      logger.error('Error moving track: ' + err);
      _slackMessage('🚨 Error moving track. Check that both positions exist in the queue! 🔄', channel);
    });
}



if (process.env.NODE_ENV === 'test') {
  module.exports = require('./lib/num-formatter');
}
