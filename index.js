const fs = require('fs');
const os = require('os');
const mp3Duration = require('mp3-duration');
const path = require('path');
const googleTTS = require('@sefinek/google-tts-api');
const config = require('nconf');
const winston = require('winston');
const Spotify = require('./spotify-async');
const utils = require('./utils');
const process = require('process');
const parseString = require('xml2js').parseString;
const http = require('http');
const AIHandler = require('./ai-handler');
const gongMessage = fs.readFileSync('gong.txt', 'utf8').split('\n').filter(Boolean);
const voteMessage = fs.readFileSync('vote.txt', 'utf8').split('\n').filter(Boolean);
const ttsMessage = fs.readFileSync('tts.txt', 'utf8').split('\n').filter(Boolean);
const buildNumber = Number(fs.readFileSync('build.txt', 'utf8').split('\n').filter(Boolean)[0]);
const { execSync } = require('child_process');
const gongBannedTracks = {};
const SLACK_API_URL_LIST = 'https://slack.com/api/conversations.list';
const userActionsFile = path.join(__dirname, 'config/userActions.json');
const blacklistFile = path.join(__dirname, 'config/blacklist.json');
const aiUnparsedFile = path.join(__dirname, 'config/ai-unparsed.log');
const WinstonWrapper = require('./logger');

// Helper to load blacklist
function loadBlacklist() {
  try {
    if (fs.existsSync(blacklistFile)) {
      const data = fs.readFileSync(blacklistFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading blacklist:', err);
  }
  return [];
}

// Helper to save blacklist
function saveBlacklist(list) {
  try {
    fs.writeFileSync(blacklistFile, JSON.stringify(list, null, 2));
  } catch (err) {
    logger.error('Error saving blacklist:', err);
  }
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
    webPort: 8181,
    logLevel: 'info'
  });

// Application Config Values (let for runtime changes)
let gongLimit = config.get('gongLimit');
let voteImmuneLimit = config.get('voteImmuneLimit');
let voteLimit = config.get('voteLimit');
let flushVoteLimit = config.get('flushVoteLimit');
let maxVolume = config.get('maxVolume');
let voteTimeLimitMinutes = config.get('voteTimeLimitMinutes') || 5;
const logLevel = config.get('logLevel');

//Spotify Config Values
const market = config.get('market');
const clientId = config.get('spotifyClientId');
const clientSecret = config.get('spotifyClientSecret');
let searchLimit = config.get('searchLimit');

//Sonos Config Values
const sonosIp = config.get('sonos');
const webPort = config.get('webPort');
let ipAddress = config.get('ipAddress');

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

/* Initialize Logger
We have to wrap the Winston logger in this thin layer to satiate the SocketModeClient */
const logger = new WinstonWrapper({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Add timestamp
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Add timestamp to console logs
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
      ),
    }),
  ],
});

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
});

/* Initialize AI Handler */
(async () => {
  await AIHandler.initialize(logger);
})();

let gongCounter = 0;
let gongScore = {};
const gongLimitPerUser = 1;

let voteImmuneCounter = 0;
const voteImmuneLimitPerUser = 1;
let voteImmuneUsers = {}; // Track users who have voted for each track for vote immune

let voteImmuneScore = {};
let gongBanned = false;
let gongTrack = ''; // What track was a GONG called on

let voteCounter = 0;
const voteLimitPerUser = 4;
let voteScore = {};

let flushVoteCounter = 0;
const flushVoteLimitPerUser = 1;
let flushVoteScore = {};

let trackVoteCount = {}; // Initialize vote count object
let trackVoteUsers = {}; // Track users who have voted for each track

const SlackSystem = require('./slack');
const DiscordSystem = require('./discord');

// Command router stub - will be properly defined after commandRegistry
// This allows us to pass it to Slack/Discord initialization
let routeCommand = async (text, channel, userName, platform = 'slack', isAdmin = false, isMention = false) => {
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

// Helper function wrapper for backward compatibility (Slack)
async function _slackMessage(message, channel_id, options = {}) {
  const platform = currentPlatform;
  const targetChannel = channel_id || currentChannel;

  // If current context is Discord: never try Slack first.
  if (platform === 'discord') {
    try {
      await DiscordSystem.sendDiscordMessage(targetChannel, message, options);
      return;
    } catch (e) {
      logger.warn(`Discord send failed: ${e.message || e}. Message not delivered.`);
      return; // DO NOT fall back to Slack; channel IDs incompatible
    }
  }

  // Slack context normal path
  try {
    if (slack) {
      await slack.sendMessage(message, targetChannel, options);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to fetch the channel IDs
async function _lookupChannelID() {
  let allChannels = [];
  let nextCursor;
  let retryAfter = 0;
  let backoff = 1; // Exponential backoff starts at 1 second

  try {
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

    logger.info('Fetched channels: ' + allChannels.map((channel) => channel.name).join(', '));

    // Fetch Admin and Standard channel IDs
    const adminChannelName = config.get('adminChannel').replace('#', '');
    const standardChannelName = config.get('standardChannel').replace('#', '');

    logger.info('Admin channel (in config): ' + adminChannelName);
    logger.info('Standard channel (in config): ' + standardChannelName);

    const adminChannelInfo = allChannels.find((channel) => channel.name === adminChannelName);
    if (!adminChannelInfo) throw new Error(`Admin channel "${adminChannelName}" not found`);

    const standardChannelInfo = allChannels.find((channel) => channel.name === standardChannelName);
    if (!standardChannelInfo) throw new Error(`Standard channel "${standardChannelName}" not found`);

    // Set the global variables
    global.adminChannel = adminChannelInfo.id;
    global.standardChannel = standardChannelInfo.id;

    logger.info('Admin channelID: ' + global.adminChannel);
    logger.info('Standard channelID: ' + global.standardChannel);
  } catch (error) {
    logger.error(`Error fetching channels: ${error.message}`);
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
    // AI summary style
    aiPrompt: 'You are a funny, upbeat DJ for a Slack music bot controlling Sonos. Reply with a super short, playful one-liner that confirms what you\'ll do, using casual humor and emojis when appropriate.'
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

  // Determine overall status
  if (report.checks.some(c => c.status === 'error')) {
    report.status = 'error';
  }

  return report;
}

// Coordinated Startup Sequence
(async () => {
  try {
    logger.info('Starting SlackONOS...');

    // Check that at least one platform is configured
    const hasSlack = slackBotToken && slackAppToken;
    const hasDiscord = config.get('discordToken');
    
    if (!hasSlack && !hasDiscord) {
      throw new Error('No platform configured! Provide either Slack tokens (slackAppToken + token) or Discord token (discordToken)');
    }

    // 2. Initialize Slack (if configured)
    if (hasSlack) {
      try {
        await slack.init();
        logger.info('✅ Slack connection established.');
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
              // We'll get the queue and find the track by name, then call _vote with its position
              try {
                const queue = await sonos.getQueue();
                if (queue && queue.items) {
                  // Find the track by name (case-insensitive, partial match)
                  const trackIndex = queue.items.findIndex(item => 
                    item.title.toLowerCase().includes(trackName.toLowerCase())
                  );
                  
                  if (trackIndex >= 0) {
                    // Convert to queue position (0-based index matches Sonos internal)
                    await _vote(['vote', trackIndex.toString()], channelId, userName);
                  } else {
                    logger.warn(`Track "${trackName}" not found in queue for reaction vote`);
                  }
                }
              } catch (err) {
                logger.error(`Error processing vote reaction: ${err.message}`);
              }
            } else if (action === 'gong') {
              // Gong always targets the currently playing track
              await _gong(channelId, userName);
            }
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
      const lines = appliedDefaults.map(a => `• ${a.key} → \`${String(a.value).slice(0,80)}\``).join('\n');
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
    }

    logger.info('🚀 System startup complete.');
  } catch (err) {
    logger.error('⛔️ STARTUP FAILED: ' + err.message);
    process.exit(1);
  }
})();

// ==========================================
// SIMPLE HTTP SERVER FOR TTS
// ==========================================
const httpServer = http.createServer((req, res) => {
  // Parse URL to ignore query params (used for cache-busting)
  const urlPath = req.url.split('?')[0];
  
  if (urlPath === '/tts.mp3') {
    const ttsFilePath = path.join(os.tmpdir(), 'sonos-tts.mp3');
    
    if (fs.existsSync(ttsFilePath)) {
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      const stream = fs.createReadStream(ttsFilePath);
      stream.pipe(res);
      logger.info('Serving TTS file to Sonos');
    } else {
      res.writeHead(404);
      res.end('TTS file not found');
    }
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SlackONOS TTS Server');
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

httpServer.listen(webPort, () => {
  logger.info(`📻 HTTP server for TTS listening on port ${webPort}`);
});

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

const commandRegistry = new Map([
  // Common commands
  ['add', { fn: _add, admin: false }],
  ['addalbum', { fn: _addalbum, admin: false }],
  ['addplaylist', { fn: _addplaylist, admin: false }],
  ['search', { fn: _search, admin: false }],
  ['searchalbum', { fn: (args, ch, u) => _searchalbum(args, ch), admin: false }],
  ['searchplaylist', { fn: _searchplaylist, admin: false }],
  ['current', { fn: (args, ch, u) => _currentTrack(ch), admin: false, aliases: ['wtf'] }],
  ['gong', { fn: (args, ch, u) => _gong(ch, u), admin: false, aliases: ['dong', ':gong:', ':gun:'] }],
  ['gongcheck', { fn: (args, ch, u) => _gongcheck(ch, u), admin: false }],
  ['voteimmune', { fn: _voteImmune, admin: false }],
  ['vote', { fn: _vote, admin: false, aliases: [':star:'] }],
  ['voteimmunecheck', { fn: (args, ch, u) => _voteImmunecheck(ch, u), admin: false }],
  ['votecheck', { fn: (args, ch, u) => _votecheck(ch, u), admin: false }],
  ['list', { fn: (args, ch, u) => _showQueue(ch), admin: false, aliases: ['ls', 'playlist'] }],
  ['upnext', { fn: (args, ch, u) => _upNext(ch), admin: false }],
  ['volume', { fn: (args, ch) => _getVolume(ch), admin: false }],
  ['flushvote', { fn: (args, ch, u) => _flushvote(ch, u), admin: false }],
  ['size', { fn: (args, ch, u) => _countQueue(ch), admin: false, aliases: ['count', 'count(list)'] }],
  ['status', { fn: (args, ch, u) => _status(ch), admin: false }],
  ['help', { fn: (args, ch, u) => _help(args, ch), admin: false }],
  ['bestof', { fn: _bestof, admin: false }],
  ['append', { fn: _append, admin: false }],

  // Admin-only commands
  ['debug', { fn: (args, ch, u) => _debug(ch, u), admin: true }],
  ['next', { fn: (args, ch, u) => _nextTrack(ch, u), admin: true }],
  ['stop', { fn: _stop, admin: true }],
  ['flush', { fn: _flush, admin: true }],
  ['play', { fn: _play, admin: true }],
  ['pause', { fn: _pause, admin: true }],
  ['resume', { fn: _resume, admin: true, aliases: ['playpause'] }],
  ['previous', { fn: _previous, admin: true }],
  ['shuffle', { fn: _shuffle, admin: true }],
  ['normal', { fn: _normal, admin: true }],
  ['setvolume', { fn: _setVolume, admin: true }],
  ['setconfig', { fn: _setconfig, admin: true, aliases: ['getconfig', 'config'] }],
  ['blacklist', { fn: _blacklist, admin: true }],
  ['remove', { fn: (args, ch, u) => _removeTrack(args, ch), admin: true }],
  ['thanos', { fn: (args, ch, u) => _purgeHalfQueue(args, ch), admin: true, aliases: ['snap'] }],
  ['listimmune', { fn: (args, ch, u) => _listImmune(ch), admin: true }],
  ['tts', { fn: (args, ch, u) => _tts(args, ch), admin: true, aliases: ['say'] }],
  ['move', { fn: _moveTrackAdmin, admin: true, aliases: ['mv'] }],
  ['stats', { fn: _stats, admin: true }],
  ['configdump', { fn: _configdump, admin: true, aliases: ['cfgdump', 'confdump'] }],
  ['aiunparsed', { fn: _aiUnparsed, admin: true, aliases: ['aiun', 'aiunknown'] }],
  ['test', { fn: (args, ch, u) => _addToSpotifyPlaylist(args, ch), admin: true }]
]);

// Build alias map for quick lookup
const aliasMap = new Map();
for (const [cmd, meta] of commandRegistry) {
  const aliases = meta.aliases || [];
  aliases.forEach(a => aliasMap.set(a.toLowerCase(), cmd));
}

function _appendAIUnparsed(entry) {
  try {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(aiUnparsedFile, line, { encoding: 'utf8' });
  } catch (e) {
    logger.warn('Failed to write ai-unparsed log: ' + e.message);
  }
}

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
    const lines = entries.map(([k, v]) => {
      let val = typeof v === 'string' ? v : JSON.stringify(v);
      if (k.toLowerCase().includes('token') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('apikey') || k.toLowerCase().includes('clientid')) {
        val = (val || '').toString();
        if (val.length > 6) val = val.slice(0, 3) + '…' + val.slice(-3);
      }
      return `${k}: ${val}`;
    });
    const msg = '```' + lines.join('\n') + '```';
    _slackMessage(msg, channel);
  } catch (e) {
    logger.error('Failed to dump config: ' + e.message);
    _slackMessage('❌ Failed to dump config: ' + e.message, channel);
  }
}

/**
 * Handle natural language @mention messages with AI parsing
 * Falls back to standard command processing if AI is disabled or parsing fails
 */
async function handleNaturalLanguage(text, channel, userName, platform = 'slack', isAdmin = false) {
  logger.info(`>>> handleNaturalLanguage called with: "${text}"`);
  
  // Set platform context for message routing (needed for _slackMessage to work correctly)
  currentPlatform = platform;
  currentChannel = channel;
  currentIsAdmin = isAdmin;
  
  // Remove @bot mention
  const cleanText = text.replace(/<@[^>]+>/g, '').trim();
  logger.info(`>>> cleanText after stripping mention: "${cleanText}"`);
  
  // If it starts with a known command, check if it looks like natural language
  const firstWord = cleanText.split(/\s+/)[0].toLowerCase();
  const restOfText = cleanText.slice(firstWord.length).trim().toLowerCase();
  
  // Natural language indicators that should go through AI even if starting with a command
  const naturalLangPattern = /\b(some|couple|few|several|good|best|nice|great|top|tunes|songs|music|tracks|for a|for the)\b/i;
  const looksLikeNaturalLang = naturalLangPattern.test(restOfText);
  logger.info(`>>> firstWord="${firstWord}", looksLikeNaturalLang=${looksLikeNaturalLang}`);
  
  if ((commandRegistry.has(firstWord) || aliasMap.has(firstWord)) && !looksLikeNaturalLang) {
    logger.info(`>>> Skipping AI - known command "${firstWord}" without natural language`);
    return processInput(cleanText, channel, userName, platform, isAdmin);
  }
  
  // Log if we're proceeding to AI despite starting with a command
  if (commandRegistry.has(firstWord) || aliasMap.has(firstWord)) {
    logger.info(`>>> Proceeding to AI despite command "${firstWord}" because it looks like natural language`);
  }
  
  // Try AI parsing
  if (!AIHandler.isAIEnabled()) {
    logger.debug('AI disabled, falling back to standard processing');
    _slackMessage('🤔 I didn\'t understand that. Try: `add <song>`, `bestof <artist>`, `gong`, `current`, or `help`', channel);
    _appendAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, reason: 'ai_disabled' });
    return;
  }
  
  try {
    const parsed = await AIHandler.parseNaturalLanguage(cleanText, userName);
    
    if (!parsed) {
      logger.warn(`AI parsing returned null for: "${cleanText}"`);
      _slackMessage('🤖 Sorry, I couldn\'t understand that. Try `help` to see available commands!', channel);
      _appendAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, reasoning: 'none', reason: 'parse_null' });
      return;
    }
    
    // Check confidence threshold
    if (parsed.confidence < 0.5) {
      logger.info(`Low confidence (${parsed.confidence}) for: "${cleanText}" → ${parsed.command}`);
      _slackMessage(`🤔 Not sure I understood. Did you mean: \`${parsed.command} ${parsed.args.join(' ')}\`?\nTry \`help\` for available commands.`, channel);
      _appendAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, parsed, reasoning: parsed.reasoning, reason: 'low_confidence' });
      return;
    }
    
    // Log successful AI parse
    logger.info(`✨ AI parsed: "${cleanText}" → ${parsed.command} [${parsed.args.join(', ')}] (${(parsed.confidence * 100).toFixed(0)}%)`);
    // Send short DJ-style summary before executing
    if (parsed.summary) {
      _slackMessage(parsed.summary, channel);
    }
    
    // Sanitize arguments for better Spotify matching
    let finalArgs = parsed.args;
    if (parsed.command === 'add' && finalArgs.length > 0) {
      let term = finalArgs[0];
      // Normalize common natural language patterns: "<song> med <artist>" (svenska), "<song> by <artist>"
      term = term.replace(/\s+med\s+/i, ' ');
      term = term.replace(/\s+by\s+/i, ' ');
      term = term.replace(/[!]+$/, '');
      finalArgs[0] = term.trim();
      logger.info(`Track to add: ${finalArgs[0]}`);
    }
    
    // Construct command text and process it
    // If AI gave a single arg, try to extract a leading number (e.g., "5 good tunes ...")
    if (parsed.command === 'add' && finalArgs.length === 1) {
      const m = finalArgs[0].match(/^\s*(\d{1,2})\s+(.+)$/);
      if (m) {
        finalArgs = [m[2].replace(/[!]+$/, '').trim(), m[1]];
        logger.info(`AI add: extracted leading count ${m[1]} and query "${finalArgs[0]}"`);
      } else {
        const qtyHint = /(some|couple|few|several)/i;
        if (qtyHint.test(cleanText)) {
          finalArgs.push('5');
          logger.info('AI add: vague quantity detected → defaulting to count 5');
        }
      }
    }

    // If AI indicates a count for add (e.g., "add <query> 5"), batch-add top N tracks
    if (parsed.command === 'add' && finalArgs.length >= 2) {
      const maybeCount = parseInt(finalArgs[finalArgs.length - 1], 10);
      if (!isNaN(maybeCount) && maybeCount > 1 && maybeCount <= 20) {
        let query = finalArgs.slice(0, -1).join(' ');
        // Simple mood/theme boosters
        const qLower = query.toLowerCase();
        const boosters = [
          { match: /(xmas|christmas|jul)/, add: ' christmas holiday' },
          { match: /(party|fest|dansband)/, add: ' party upbeat' },
          { match: /(chill|relax|lugn|mysig)/, add: ' chill mellow' },
          { match: /(workout|gym|träning)/, add: ' workout energetic' },
          { match: /(sommar|summer|beach)/, add: ' summer beach hits' },
          { match: /(80s|80-tal|eighties)/, add: ' 80s classic hits' },
          { match: /(90s|90-tal|nineties)/, add: ' 90s classic hits' },
          { match: /(rock|metal)/, add: ' rock classic' },
          { match: /(pop|hits)/, add: ' pop hits' },
          { match: /(disco|funk)/, add: ' disco dance funk' },
          { match: /(ballad|kärleks|love|romantic)/, add: ' ballad love romantic' },
          { match: /(hip.?hop|rap|hiphop)/, add: ' hip hop rap hits' },
          { match: /(country|nashville)/, add: ' country hits' },
          { match: /(jazz|blues)/, add: ' jazz blues classic' },
          { match: /(klassisk|classical|opera)/, add: ' classical orchestra' },
          { match: /(reggae|ska|caribbean)/, add: ' reggae caribbean' },
          { match: /(indie|alternative)/, add: ' indie alternative' },
          { match: /(edm|electro|house|techno)/, add: ' electronic dance' },
          { match: /(latin|salsa|bachata|reggaeton)/, add: ' latin dance' },
          { match: /(svensk|swedish)/, add: ' swedish svenska' },
          { match: /(barnlåt|kids|children|barn)/, add: ' children kids' }
        ];
        let appliedBoosts = [];
        boosters.forEach(b => { if (b.match.test(qLower)) { query += b.add; appliedBoosts.push(b.add.trim()); } });
        if (appliedBoosts.length) {
          logger.info(`AI add: applied boosters [${appliedBoosts.join(', ')}] → query "${query}"`);
        } else {
          logger.info(`AI add: no boosters applied → query "${query}"`);
        }
        try {
          const results = await spotify.searchTrackList(query, 50);
          logger.info(`AI add: search returned ${results ? results.length : 0} results for "${query}"`);
          
          // Deduplicate by normalized track name (remove suffixes like "- Single Edit", "Remaster", etc.)
          const normalize = (name) => name.toLowerCase()
            .replace(/\s*[-–]\s*(single|edit|remaster|remix|radio|version|mix|live|acoustic|cover).*$/i, '')
            .replace(/\s*\(.*\)$/i, '')  // Remove parenthetical suffixes
            .trim();
          
          const seen = new Set();
          const unique = (results || [])
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .filter(t => {
              const key = normalize(t.name);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          
          const top = unique.slice(0, maybeCount);
          logger.info(`AI add: deduplicated ${results?.length || 0} → ${unique.length} unique, selecting top ${maybeCount} → queuing ${top.length}`);
          if (!top.length) {
            _slackMessage(`🤷 I couldn't find tracks for "${query}". Try a different search!`, channel);
            return;
          }
          
          // Check current state - if stopped, flush queue first
          let wasPlaying = false;
          try {
            const state = await sonos.getCurrentState();
            logger.info(`AI add: current state = ${state}`);
            wasPlaying = (state === 'playing' || state === 'transitioning');
            if (!wasPlaying) {
              logger.info('AI add: player stopped - flushing queue first');
              await sonos.flush();
            }
          } catch (stateErr) {
            logger.warn('AI add: could not check state: ' + stateErr.message);
          }
          
          let added = 0;
          for (const t of top) {
            try {
              await sonos.queue(t.uri);
              added++;
            } catch (e) {
              logger.warn('Queue failed: ' + e.message);
            }
          }
          
          // If wasn't playing, start playback
          if (!wasPlaying && added > 0) {
            try {
              await new Promise(resolve => setTimeout(resolve, 500));
              await sonos.play();
              logger.info('AI add: started playback');
            } catch (playErr) {
              logger.warn('AI add: could not start playback: ' + playErr.message);
            }
          }
          
          const actionMsg = wasPlaying ? 'Added' : 'Started fresh with';
          _slackMessage(`🎵 ${actionMsg} ${added} tracks for "${query}" 🎄`, channel);
          return;
        } catch (e) {
          logger.error('Multi-add failed: ' + e.message);
          _slackMessage('❌ Sorry, failed to add multiple tracks.', channel);
          return;
        }
      }
        logger.info(`AI add: count argument not valid → ${finalArgs[finalArgs.length - 1]}`);
    }

    const commandText = finalArgs.length > 0
      ? `${parsed.command} ${finalArgs.join(' ')}`
      : parsed.command;
    await processInput(commandText, channel, userName, platform, isAdmin);
    
  } catch (err) {
    logger.error(`Error in AI natural language handler: ${err.message}`);
    _slackMessage('❌ Oops, something went wrong processing your request. Try using a command directly!', channel);
    _appendAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, error: err.message, reason: 'handler_error' });
  }
}

/**
 * Command router - detects if message needs AI parsing or standard processing
 * Routes @mentions and natural language to AI, commands directly to processInput
 * Replaces the stub defined earlier
 */
routeCommand = async function(text, channel, userName, platform = 'slack', isAdmin = false, isMention = false) {
  logger.info(`>>> routeCommand: text="${text}", isMention=${isMention}`);
  
  // Check if this looks like a natural language request (not starting with a command)
  const trimmed = text.replace(/<@[^>]+>/g, '').trim();
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  
  // If it's a mention, ALWAYS go through AI (even if it starts with a command like "add")
  if (isMention) {
    logger.info(`>>> Mention detected, routing to handleNaturalLanguage`);
    return handleNaturalLanguage(text, channel, userName, platform, isAdmin);
  }
  
  // For non-mentions: if it starts with a known command, process normally
  if (commandRegistry.has(firstWord) || aliasMap.has(firstWord)) {
    return processInput(text, channel, userName, platform, isAdmin);
  }
  
  // Unknown command for non-mention - ignore
  logger.debug(`Ignoring unknown command from non-mention: "${firstWord}"`);
};

logger.info('✅ Command router initialized with AI support');

async function processInput(text, channel, userName, platform = 'slack', isAdmin = false) {
  // Set platform context for message routing
  currentPlatform = platform;
  currentChannel = channel;
  currentIsAdmin = isAdmin;
  
  if (!text || typeof text !== 'string') {
    logger.warn('processInput called without text');
    return;
  }

  // Trim and strip surrounding bot mention if present (for app_mention)
  text = text.trim();
  // Remove leading @bot mentions like "<@U123> add song" -> "add song"
  text = text.replace(/^<@[^>]+>\s*/, '').trim();

  // Extract args robustly
  const args = parseArgs(text);
  if (args.length === 0) return;

  const rawTerm = args[0].toLowerCase();
  // Resolve alias to main command
  const cmdKey = commandRegistry.has(rawTerm) ? rawTerm : aliasMap.get(rawTerm);

  if (!cmdKey) {
    // Unknown command — ignore or optionally respond
    logger.info(`Unknown command "${rawTerm}" from ${userName} in ${channel} [${platform}]`);
    return;
  }

  const cmdMeta = commandRegistry.get(cmdKey);
  if (!cmdMeta) {
    logger.error(`Command metadata missing for ${cmdKey}`);
    return;
  }

  // Admin check - platform aware
  const isAdminCmd = Boolean(cmdMeta.admin);
  if (isAdminCmd) {
    let authorized = false;
    if (platform === 'discord') {
      // Discord uses role-based permissions
      authorized = isAdmin;
    } else {
      // Slack uses channel-based permissions
      authorized = (channel === global.adminChannel);
    }
    
    if (!authorized) {
      logger.info(`Unauthorized admin cmd attempt: ${cmdKey} by ${userName} in ${channel} (platform: ${platform})`);
      _slackMessage('🚫 Nice try! That\'s an admin-only command. This incident will be reported to... well, nobody cares. 😏', channel);
      return;
    }
  }

  // Prepare sanitized user identifier (string maybe <@U123>)
  const normalizedUser = normalizeUser(userName);

  // Check if user is blacklisted
  if (blacklist.includes(normalizedUser)) {
    logger.info(`Blocked command from blacklisted user: ${userName}`);
    _slackMessage(`🚫 You are blacklisted and cannot use this bot.`, channel);
    return;
  }

  // Call handler safely
  try {
    // Pass args slice (excluding command itself)
    const handlerArgs = args.slice(1);

    // Construct legacy input array [command, arg1, arg2...] to match old function signatures
    // Most old functions expect input[0] to be the command
    const legacyInput = [rawTerm, ...handlerArgs];

    const result = cmdMeta.fn(legacyInput, channel, `<@${normalizedUser}>`);

    // Await if returns a promise
    if (result && typeof result.then === 'function') {
      await result;
    }
  } catch (err) {
    logger.error(`Error running command ${cmdKey}: ${err.stack || err.message || err}`);
    try {
      _slackMessage('🚨 Whoops! Something went wrong handling your command. The error has been logged! 📋', channel);
    } catch (e) {
      /* best effort */
    }
  }
}

// Removed duplicate _slackMessage definition (platform-aware version earlier in file is authoritative)

const userCache = {};

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
    if (userCache[userId]) {
      return userCache[userId];
    }

    // Fetch user info from Slack API
    const result = await web.users.info({ user: userId });
    if (result.ok && result.user) {
      userCache[userId] = result.user.name; // Cache the user info
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

function _getVolume(channel) {
  sonos
    .getVolume()
    .then((vol) => {
      logger.info('The volume is: ' + vol);
      _slackMessage('🔊 Currently blasting at *' + vol + '* out of ' + maxVolume + ' (your ears\' limits, not ours)', channel);
    })
    .catch((err) => {
      logger.error('Error occurred: ' + err);
    });
}

function _setVolume(input, channel, userName) {
  _logUserAction(userName, 'setVolume');
  // Admin check now handled in processInput (platform-aware)

  const vol = Number(input[1]);

  if (isNaN(vol)) {
    _slackMessage('🤔 That\'s not a number, that\'s... I don\'t even know what that is. Try again with actual digits!', channel);
    return;
  }

  logger.info('Volume is: ' + vol);
  if (vol > maxVolume) {
    _slackMessage('🚨 Whoa there, ' + userName + '! That\'s louder than a metal concert in a phone booth. Max is *' + maxVolume + '*. Try again! 🎸', channel);
    return;
  }

  setTimeout(() => {
    sonos
      .setVolume(vol)
      .then(() => {
        logger.info('The volume is set to: ' + vol);
        _getVolume(channel);
      })
      .catch((err) => {
        logger.error('Error occurred while setting volume: ' + err);
      });
  }, 1000);
}

function _countQueue(channel, cb) {
  sonos
    .getQueue()
    .then((result) => {
      if (cb) {
        return cb(result.total);
      }
      _slackMessage(`🎵 We've got *${result.total}* ${result.total === 1 ? 'track' : 'tracks'} queued up and ready to rock! 🎸`, channel);
    })
    .catch((err) => {
      logger.error(err);
      if (cb) {
        return cb(null, err);
      }
      _slackMessage('🤷 Error getting queue length. Try again in a moment! 🔄', channel);
    });
}

async function _showQueue(channel) {
  try {
    const result = await sonos.getQueue();
    // logger.info('Current queue: ' + JSON.stringify(result, null, 2))
    _status(channel, function (state) {
      logger.info('_showQueue, got state = ' + state);
    });
    _currentTrack(channel, function (err, track) {
      if (!result || !result.items || result.items.length === 0) {
        logger.debug('Queue is empty');
        _slackMessage('🦗 *Crickets...* The queue is empty! Try `add <song>` to get started! 🎵', channel);
        return;
      }
      if (err) {
        logger.error(err);
      }
      var message = 'Total tracks in queue: ' + result.total + '\n====================\n';
      logger.info('Total tracks in queue: ' + result.total);
      const tracks = [];

      result.items.map(function (item, i) {
        let trackTitle = item.title;
        let prefix = '';
        
        // Check if this is the currently playing track
        const isCurrentTrack = track && (i + 1) === track.queuePosition;
        
        // Check if track is gong banned (immune)
        if (_isTrackGongBanned(item.title)) {
          prefix = ':lock: ';
          trackTitle = item.title;
        } else if (track && item.title === track.title) {
          trackTitle = '*' + trackTitle + '*';
        } else {
          trackTitle = '_' + trackTitle + '_';
        }

        if (isCurrentTrack) {
          tracks.push(':notes: ' + '_#' + i + '_ ' + trackTitle + ' by ' + item.artist);
        } else {
          tracks.push(prefix + '>_#' + i + '_ ' + trackTitle + ' by ' + item.artist);
        }
      });
      for (var i in tracks) {
        message += tracks[i] + '\n';
        if (i > 0 && Math.floor(i % 100) === 0) {
          _slackMessage(message, channel);
          message = '';
        }
      }
      if (message) {
        _slackMessage(message, channel);
      }
    });
  } catch (err) {
    logger.error('Error fetching queue: ' + err);
  }
}

function _upNext(channel) {
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

// Vote section. All function related to voting.

let voteTimer = null;

function _flushvote(channel, userName) {
  _logUserAction(userName, 'flushvote');
  logger.info('_flushvote...');

  if (!(userName in flushVoteScore)) {
    flushVoteScore[userName] = 0;
  }

  if (flushVoteScore[userName] >= flushVoteLimitPerUser) {
    _slackMessage('🚫 Whoa there, ' + userName + '! You\'ve already cast your flush vote. No cheating! 😏', channel);
  } else {
    flushVoteScore[userName] += 1;
    flushVoteCounter++;
    logger.info('flushVoteCounter: ' + flushVoteCounter);

    if (flushVoteCounter === 1) {
      // Start the timer on the first vote
      const currentVoteTimeLimit = voteTimeLimitMinutes * 60 * 1000;
      voteTimer = setTimeout(() => {
        flushVoteCounter = 0;
        flushVoteScore = {};
        _slackMessage('⏰ Voting period for flush has ended. Votes reset! Start fresh if you want to flush. 🔄', channel);
        logger.info('Voting period ended... Guess the playlist isn´t that bad after all!!');
      }, currentVoteTimeLimit);
      _slackMessage(
        "Voting period started for a flush of the queue... You have " +
        voteTimeLimitMinutes +
        " minutes to gather " +
        flushVoteLimit +
        " votes !!",
        channel
      );
      logger.info('Voting period started!!');
    }

    _slackMessage(
      'This is VOTE ' + '*' + flushVoteCounter + '*' + '/' + flushVoteLimit + ' for a full flush of the playlist!!',
      channel
    );

    if (flushVoteCounter >= flushVoteLimit) {
      clearTimeout(voteTimer); // Clear the timer if the vote limit is reached
      _slackMessage('🚨🚨🚨 *DEMOCRACY IN ACTION!* The votes have spoken - flushing the queue! 🚽🎵', channel);
      try {
        sonos.flush();
      } catch (error) {
        logger.error('Error flushing the queue: ' + error);
      }
      flushVoteCounter = 0;
      flushVoteScore = {};
    }
  }
}

function _gong(channel, userName) {
  _logUserAction(userName, 'gong');
  logger.info('_gong...');
  _currentTrackTitle(channel, function (err, track) {
    if (err) {
      logger.error(err);
    }
    logger.info('_gong > track: ' + track);
    gongTrack = track; // Store current track name

    if (_isTrackGongBanned(track)) {
      logger.info('Track is gongBanned: ' + track);
      _slackMessage('🔒 Sorry ' + userName + ', this track has diplomatic immunity! The people have voted to protect it from your gong. 🛡️', channel);
      return;
    }

    var randomMessage = gongMessage[Math.floor(Math.random() * gongMessage.length)];
    logger.info('gongMessage: ' + randomMessage);

    if (!(userName in gongScore)) {
      gongScore[userName] = 0;
    }

    if (gongScore[userName] >= gongLimitPerUser) {
      _slackMessage('🚫 Hold up, ' + userName + '! You\'ve already gonged this track. One gong per person! 🔔', channel);
    } else {
      if (userName in voteImmuneScore) {
        _slackMessage("💭 Having regrets, " + userName + "? We're glad you came to your senses... Crisis averted! 😅", channel);
      }

      gongScore[userName] += 1;
      gongCounter++;
      _slackMessage(
        randomMessage + ' This is GONG ' + gongCounter + '/' + gongLimit + ' for ' + '*' + track + '*',
        channel
      );
      if (gongCounter >= gongLimit) {
        _slackMessage('🔔💥 *THE PEOPLE HAVE SPOKEN!* This track has been GONGED into oblivion! ☠️', channel);
        _gongplay('play', channel);
        gongCounter = 0;
        gongScore = {};
      }
    }
  });
}

function _voteImmune(input, channel, userName) {
  var voteNb = Number(input[1]); // Use the input number directly
  logger.info('voteNb: ' + voteNb);

  sonos
    .getQueue()
    .then((result) => {
      logger.info('Current queue: ' + JSON.stringify(result, null, 2));
      let trackFound = false;
      let voteTrackName = null;

      for (var i in result.items) {
        var queueTrack = parseInt(result.items[i].id.split('/')[1]) - 1; // Adjust for 0-based index
        if (voteNb === queueTrack) {
          voteTrackName = result.items[i].title;
          trackFound = true;
          break;
        }
      }

      if (trackFound) {
        if (!(userName in voteImmuneScore)) {
          voteImmuneScore[userName] = 0;
        }

        if (voteImmuneScore[userName] >= voteImmuneLimitPerUser) {
          _slackMessage('🚫 Stop right there, ' + userName + '! You\'ve already voted for immunity. One vote per person! 🛡️', channel);
        } else {
          if (!(voteNb in voteImmuneUsers)) {
            voteImmuneUsers[voteNb] = new Set();
          }

          if (voteImmuneUsers[voteNb].has(userName)) {
            _slackMessage('🗳️ You\'ve already cast your immunity vote for this track, ' + userName + '! 🛡️', channel);
          } else {
            voteImmuneScore[userName] += 1;
            voteImmuneCounter++;
            voteImmuneUsers[voteNb].add(userName);

            _slackMessage('🗳️ This is VOTE *' + voteImmuneCounter + '/' + voteImmuneLimit + '* for *' + voteTrackName + '* - Keep voting for immunity! 🛡️', channel);
            if (voteImmuneCounter >= voteImmuneLimit) {
              _slackMessage('🛡️ *IMMUNITY GRANTED!* This track is now protected from the gong hammer... for this playthrough! 🔨❌', channel);
              voteImmuneCounter = 0;
              voteImmuneScore = {};
              voteImmuneUsers[voteNb].clear(); // Clear the users who voted for this track
              gongBannedTracks[voteTrackName] = true; // Mark the track as gongBanned
            }
          }
        }
      } else {
        _slackMessage('🤔 Track not found in the queue. Check `list` to see what\'s playing! 📋', channel);
      }
    })
    .catch((err) => {
      logger.error('Error occurred while fetching the queue: ' + err);
    });
}

function _isTrackGongBanned(trackName) {
  return gongBannedTracks[trackName] === true;
}



async function _bestof(input, channel, userName) {
  _logUserAction(userName, 'bestof');

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
  logger.info(`BESTOF request for artist: ${artistName}`);

  try {
    //
    // STEP 1: Search for tracks containing the artist
    //
    const searchResults = await spotify.searchTrackList(artistName, 20);

    if (!searchResults || searchResults.length === 0) {
      _slackMessage(`🤷 No tracks found for *${artistName}*. Try checking the spelling or a different artist! 🎸`, channel);
      return;
    }

    //
    // STEP 2: Infer the artist identity
    //
    // Pick the most common artist among the search results
    const counts = {};
    for (const t of searchResults) {
      const a = t.artists[0].name;
      counts[a] = (counts[a] || 0) + 1;
    }

    const bestArtist = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])[0][0];

    logger.info(`Inferred artist: ${bestArtist}`);

    //
    // STEP 3: Filter tracks by that artist & sort by popularity
    //
    const tracksByArtist = searchResults
      .filter(t => t.artists[0].name.toLowerCase() === bestArtist.toLowerCase())
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, desiredCount); // top N tracks

    if (tracksByArtist.length === 0) {
      _slackMessage(`🤔 Couldn't determine top tracks for *${bestArtist}*. Try being more specific! 🎵`, channel);
      return;
    }

    //
    // STEP 4: Queue tracks
    //
    let addedCount = 0;
    for (const track of tracksByArtist) {
      try {
        await sonos.queue(track.uri);
        logger.info(`Queued BESTOF track: ${track.name}`);
        addedCount++;
      } catch (err) {
        logger.warn(`Could not queue track ${track.name}: ${err.message}`);
      }
    }

    //
    // STEP 5: Check if we need to start playback
    //
    try {
      const state = await sonos.getCurrentState();
      logger.info('Current state after bestof: ' + state);

      if (state !== 'playing' && state !== 'transitioning') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sonos.play();
        logger.info('Started playback after bestof.');
      }
    } catch (stateErr) {
      logger.warn('Could not check/start playback: ' + stateErr.message);
    }

    //
    // STEP 6: Notify
    //
    let msg = `🎼 *Best of ${bestArtist}*\nAdded ${addedCount} tracks:\n`;
    tracksByArtist.forEach((t, i) => {
      msg += `> ${i + 1}. *${t.name}*\n`;
    });

    _slackMessage(msg, channel, {
      trackName: tracksByArtist[0]?.name || bestArtist,
      addReactions: currentPlatform === 'discord'
    });

  } catch (err) {
    logger.error(`BESTOF error: ${err.stack || err}`);
    _slackMessage(`🚨 Error fetching BESTOF for *${artistName}*. Try again in a moment! 🔄`, channel);
  }
}






function _listImmune(channel) {
  const gongBannedTracksList = Object.keys(gongBannedTracks);
  if (gongBannedTracksList.length === 0) {
    _slackMessage('🤷 No tracks are currently immune. Everything is fair game for the gong! 🔔', channel);
  } else {
    const message = 'Immune Tracks:\n' + gongBannedTracksList.join('\n');
    _slackMessage(message, channel);
  }
}

function _vote(input, channel, userName) {
  _logUserAction(userName, 'vote');

  var randomMessage = voteMessage[Math.floor(Math.random() * voteMessage.length)];
  var voteNb = Number(input[1]); // Use the input number directly

  sonos
    .getQueue()
    .then((result) => {
      let trackFound = false;
      let voteTrackName = null;

      for (var i in result.items) {
        var queueTrack = parseInt(result.items[i].id.split('/')[1]) - 1; // Adjust for 0-based index
        if (voteNb === queueTrack) {
          voteTrackName = result.items[i].title;
          trackFound = true;
          break;
        }
      }

      if (trackFound) {
        if (!(userName in voteScore)) {
          voteScore[userName] = 0;
        }

        if (voteScore[userName] >= voteLimitPerUser) {
          _slackMessage('🚫 Nice try, ' + userName + '! You\'ve already voted for this track. Patience! 🎵', channel);
        } else {
          if (!(voteNb in trackVoteUsers)) {
            trackVoteUsers[voteNb] = new Set();
          }

          if (trackVoteUsers[voteNb].has(userName)) {
            _slackMessage('🗳️ You already voted for this track, ' + userName + '! One vote per person! 🎯', channel);
          } else {
            voteScore[userName] += 1;
            voteCounter++;
            trackVoteUsers[voteNb].add(userName);

            if (!(voteNb in trackVoteCount)) {
              trackVoteCount[voteNb] = 0;
            }
            trackVoteCount[voteNb] += 1;

            _slackMessage('🗳️ This is VOTE *' + trackVoteCount[voteNb] + '/' + voteLimit + '* for *' + voteTrackName + '* - Almost there! 🎵', channel);
            if (trackVoteCount[voteNb] >= voteLimit) {
              logger.info('Track ' + voteTrackName + ' has reached the vote limit.');
              _slackMessage(randomMessage, channel);

              voteCounter = 0;
              voteScore = {};
              trackVoteUsers[voteNb].clear(); // Clear the users who voted for this track

              sonos
                .currentTrack()
                .then((track) => {
                  var currentTrackPosition = track.queuePosition;
                  var trackPosition = voteNb;

                  const startingIndex = trackPosition; // No need to adjust for 0-based index here
                  const numberOfTracks = 1;
                  const insertBefore = currentTrackPosition + 1;
                  const updateId = 0;

                  sonos
                    .reorderTracksInQueue(startingIndex, numberOfTracks, insertBefore, updateId)
                    .then((success) => {
                      logger.info('Moved track to position: ' + insertBefore);
                    })
                    .catch((err) => {
                      logger.error('Error occurred: ' + err);
                    });
                })
                .catch((err) => {
                  logger.error('Error occurred: ' + err);
                });
            }
          }
        }
      } else {
        _slackMessage('🤷 That track number isn\'t in the queue. Use `list` to see available tracks! 📋', channel);
      }
    })
    .catch((err) => {
      logger.error('Error occurred while fetching the queue: ' + err);
    });
}

function _votecheck(channel) {
  logger.info('_votecheck...');
  let voteInfo = '';
  if (Object.keys(trackVoteCount).length === 0) {
    _slackMessage('🤷 No tracks have been voted on yet. Be the first! Use `vote <track#>` 🎵', channel);
    return;
  }
  for (const trackNb in trackVoteCount) {
    const votes = trackVoteCount[trackNb];
    voteInfo += `Track #${trackNb}: ${votes}/${voteLimit} votes\n`;
  }
  _slackMessage(`Current vote counts:\n${voteInfo}`, channel);
}

function _voteImmunecheck(channel) {
  logger.info('_voteImmunecheck...');
  _slackMessage('🛡️ Currently there are *' + voteImmuneCounter + ' votes* of *' + voteImmuneLimit + '* needed to grant a song immunity from GONG! 🔔', channel);
  _listImmune(channel);
}

function _gongcheck(channel, userName) {
  logger.info('_gongcheck...');
  _currentTrackTitle(channel, (err, track) => {
    if (err) {
      logger.error(err);
      return;
    }
    const gongLeft = gongLimit - gongCounter;
    let message = 'Currently ' + gongLeft + ' more votes are needed to GONG ' + '*' + track + '*';
    if (_isTrackGongBanned(track)) {
      message = 'This track is immune to GONG. The people have spoken...';
    }
    _slackMessage(message, channel);
  });
}

// Queue for user action logging to prevent file locking issues
let userActionQueue = Promise.resolve();

// Function to log user actions to a file
async function _logUserAction(userName, action) {
  // Normalize userName by stripping angle brackets
  const normalizedUser = userName.replace(/[<@>]/g, '');

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
      if (!data[normalizedUser][action]) {
        data[normalizedUser][action] = [];
      }

      data[normalizedUser][action].push(timestamp);

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
    const sensitiveKeys = ['token', 'slackAppToken', 'slackBotToken', 'spotifyClientId', 'spotifyClientSecret'];
    const configKeys = Object.keys(config.stores.file.store);
    const configValues = configKeys
      .map(key => {
        const value = config.get(key);
        const displayValue = sensitiveKeys.includes(key) ? '[REDACTED]' : JSON.stringify(value);
        return `> \`${key}\`: ${displayValue}`;
      })
      .join('\n');

    const message =
      `*🛠️ System Debug Report*\n` +
      `------------------------------------------\n` +
      `*📊 System Info:*\n` +
      `> *Build:* ${buildNumber}\n` +
      `> *Node:* ${process.version}\n` +
      `> *Host:* ${process.env.HOSTNAME || 'unknown'}\n` +
      `> *IP:* ${ipAddress || 'unknown'}\n\n` +

      `*🏥 Health Check:*\n` +
      `${healthStatus}\n\n` +

      `*⚙️ Configuration:*\n` +
      `${configValues}\n\n` +

      `*🤖 OpenAI:*\n` +
      (() => {
        const ai = AIHandler.getAIDebugInfo();
        return (
          `> Enabled: ${ai.enabled ? 'true' : 'false'}\n` +
          `> Key Present: ${config.get('openaiApiKey') ? 'true' : 'false'}\n` +
          `> Model: ${ai.model}\n` +
          `> Last Success: ${ai.lastSuccessTS || 'n/a'}\n` +
          `> Last Error: ${ai.lastErrorTS || 'n/a'}\n` +
          (ai.lastErrorMessage ? `> Last Error Msg: ${ai.lastErrorMessage}\n` : '')
        );
      })();

    _slackMessage(message, channel);
  } catch (err) {
    logger.error('Error in debug: ' + err.message);
    _slackMessage('🚨 Failed to generate debug report: ' + err.message + ' 🔧', channel);
  }
}

// This function needs to be a little smarter
async function _add(input, channel, userName) {
  _logUserAction(userName, 'add');
  // Add a track to the queue
  // If stopped: flush queue and start fresh
  // If playing: just add to existing queue
  if (!input || input.length < 2) {
    _slackMessage('🎵 You gotta tell me what to add! Use `add <song name or artist>` 🎶', channel);
    return;
  }
  const track = input.slice(1).join(' ');
  logger.info('Track to add: ' + track);

  try {
    const result = await spotify.getTrack(track);

    // Get current player state
    const state = await sonos.getCurrentState();
    logger.info('Current state for add: ' + state);

    // If stopped, flush the queue to start fresh
    if (state === 'stopped') {
      logger.info('Player stopped - flushing queue and starting fresh');
      try {
        await sonos.flush();
        logger.info('Queue flushed');
      } catch (flushErr) {
        logger.warn('Could not flush queue: ' + flushErr.message);
      }

      await sonos.queue(result.uri);
      logger.info('Added track: ' + result.name);

      // Wait a moment before starting playback
      await new Promise(resolve => setTimeout(resolve, 1000));
      await sonos.play();

      _slackMessage(
        'Started fresh! Added ' + '*' + result.name + '*' + ' by ' + result.artist + ' and began playback. :notes:',
        channel,
        { trackName: result.name, addReactions: currentPlatform === 'discord' }
      );
      return;
    }

    // For playing/paused/transitioning states, check for duplicates
    try {
      const queue = await sonos.getQueue();
      if (queue && queue.items) {
        let duplicatePosition = -1;
        const isDuplicate = queue.items.some((item, index) => {
          if (item.uri === result.uri || (item.title === result.name && item.artist === result.artist)) {
            duplicatePosition = index;
            return true;
          }
          return false;
        });

        if (isDuplicate) {
          _slackMessage(
            `*${result.name}* by _${result.artist}_ is already in the queue at position #${duplicatePosition}! :musical_note:\nWant it to play sooner? Use \`vote ${duplicatePosition}\` to move it up! :arrow_up:`,
            channel
          );
          return;
        }
      }
    } catch (queueErr) {
      // If we can't get the queue, just log and continue with adding
      logger.warn('Could not check queue for duplicates: ' + queueErr.message);
    }

    await sonos.queue(result.uri);
    logger.info('Added track: ' + result.name);

    let msg = 'Added ' + '*' + result.name + '*' + ' by ' + result.artist + ' to the queue.';

    // Auto-play if player was paused or in another non-playing state
    if (state !== 'playing' && state !== 'transitioning') {
      try {
        await sonos.play();
        logger.info('Player was not playing, started playback.');
        msg += ' Playback started! :notes:';
      } catch (playErr) {
        logger.warn('Failed to auto-play: ' + playErr.message);
      }
    }

    _slackMessage(msg, channel, { 
      trackName: result.name, 
      addReactions: currentPlatform === 'discord' 
    });
  } catch (err) {
    logger.error('Error adding track: ' + err.message);
    _slackMessage('🤷 Couldn\'t find that track or hit an error adding it. Try being more specific with the song name! 🎵', channel);
  }
}

async function _addalbum(input, channel, userName) {
  _logUserAction(userName, 'addalbum');
  // Add an album to the queue, support Spotify URI or search
  if (!input || input.length < 2) {
    _slackMessage('💿 You gotta tell me which album to add! Try `addalbum <album name>` 🎶', channel);
    return;
  }
  const album = input.slice(1).join(' ');
  logger.info('Album to add: ' + album);

  try {
    const result = await spotify.getAlbum(album);

    // Get current player state
    const state = await sonos.getCurrentState();
    logger.info('Current state for addalbum: ' + state);

    // If stopped, flush the queue to start fresh
    if (state === 'stopped') {
      logger.info('Player stopped - flushing queue and starting fresh');
      try {
        await sonos.flush();
        logger.info('Queue flushed');
      } catch (flushErr) {
        logger.warn('Could not flush queue: ' + flushErr.message);
      }

      await sonos.queue(result.uri);
      logger.info('Added album: ' + result.name);

      // Wait a moment before starting playback
      await new Promise(resolve => setTimeout(resolve, 1000));
      await sonos.play();

      let text = 'Started fresh! Added album ' + '*' + result.name + '*' + ' by ' + result.artist + ' and began playback. :notes:';

      if (result.coverUrl) {
        _slackMessage(text, channel, {
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: text
              },
              accessory: {
                type: "image",
                image_url: result.coverUrl,
                alt_text: result.name + " cover"
              }
            }
          ]
        });
      } else {
        _slackMessage(text, channel);
      }
      return;
    }

    // For playing/paused/transitioning states, just add to queue
    await sonos.queue(result.uri);
    logger.info('Added album: ' + result.name);

    let text = 'Added album ' + '*' + result.name + '*' + ' by ' + result.artist + ' to the queue.';

    // Auto-play if player was paused or in another non-playing state
    if (state !== 'playing' && state !== 'transitioning') {
      try {
        await sonos.play();
        logger.info('Player was not playing, started playback.');
        text += ' Playback started! :notes:';
      } catch (playErr) {
        logger.warn('Failed to auto-play: ' + playErr.message);
      }
    }

    if (result.coverUrl) {
      _slackMessage(text, channel, {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: text
            },
            accessory: {
              type: "image",
              image_url: result.coverUrl,
              alt_text: result.name + " cover"
            }
          }
        ]
      });
    } else {
      _slackMessage(text, channel);
    }
  } catch (err) {
    logger.error('Error adding album: ' + err.message);
    _slackMessage('🔎 Couldn\'t find that album. Double-check the spelling or try including the artist name! 🎶', channel);
  }
}

async function _searchplaylist(input, channel, userName) {
  _logUserAction(userName, 'searchplaylist');
  // Search for a playlist on Spotify
  if (!input || input.length < 2) {
    _slackMessage('🔍 Tell me which playlist to search for! `searchplaylist <name>` 🎶', channel);
    return;
  }
  const playlist = input.slice(1).join(' ');
  logger.info('Playlist to search for: ' + playlist);

  try {
    const playlists = await spotify.searchPlaylistList(playlist, 10); // Fetch 10 to handle null results

    if (!playlists || playlists.length === 0) {
      _slackMessage('🤷 Couldn\'t find that playlist. Check the spelling or try a different search! 🎶', channel);
      return;
    }

    // Show top 5 results
    const topFive = playlists.slice(0, 5);
    let message = `Found ${playlists.length} playlists:\n`;
    topFive.forEach((result, index) => {
      message += `>${index}: *${result.name}* by _${result.owner}_ (${result.tracks} tracks)\n`;
    });

    _slackMessage(message, channel);
  } catch (err) {
    logger.error('Error searching for playlist: ' + err.message);
    _slackMessage('🚨 Couldn\'t search for playlists. Error: ' + err.message + ' 🔄', channel);
  }
}

async function _addplaylist(input, channel, userName) {
  _logUserAction(userName, 'addplaylist');
  // Add a playlist to the queue, support Spotify URI or search
  if (!input || input.length < 2) {
    _slackMessage('📋 You need to tell me which playlist to add! Use `addplaylist <playlist name>` 🎵', channel);
    return;
  }
  const playlist = input.slice(1).join(' ');
  logger.info('Playlist to add: ' + playlist);

  try {
    const result = await spotify.getPlaylist(playlist);

    // Get current player state
    const state = await sonos.getCurrentState();
    logger.info('Current state for addplaylist: ' + state);

    // If stopped, flush the queue to start fresh
    if (state === 'stopped') {
      logger.info('Player stopped - flushing queue and starting fresh');
      try {
        await sonos.flush();
        logger.info('Queue flushed');
      } catch (flushErr) {
        logger.warn('Could not flush queue: ' + flushErr.message);
      }

      await sonos.queue(result.uri);
      logger.info('Added playlist: ' + result.name);

      // Wait a moment before starting playback
      await new Promise(resolve => setTimeout(resolve, 1000));
      await sonos.play();

      _slackMessage(
        'Started fresh! Added playlist ' + '*' + result.name + '*' + ' by ' + result.owner + ' and began playback. :notes:',
        channel
      );
      return;
    }

    // For playing/paused/transitioning states, just add to queue
    await sonos.queue(result.uri);
    logger.info('Added playlist: ' + result.name);

    let msg = 'Added playlist ' + '*' + result.name + '*' + ' by ' + result.owner + ' to the queue.';

    // Auto-play if player was paused or in another non-playing state
    if (state !== 'playing' && state !== 'transitioning') {
      try {
        await sonos.play();
        logger.info('Player was not playing, started playback.');
        msg += ' Playback started! :notes:';
      } catch (playErr) {
        logger.warn('Failed to auto-play: ' + playErr.message);
      }
    }

    _slackMessage(msg, channel);
  } catch (err) {
    logger.error('Error adding playlist: ' + err.message);
    _slackMessage('🔎 Couldn\'t find that playlist. Try a Spotify link or check the spelling! 🎵', channel);
  }
}

async function _search(input, channel, userName) {
  _logUserAction(userName, 'search');
  // Search for a track on Spotify
  if (!input || input.length < 2) {
    _slackMessage('🔍 What should I search for? Try `search <song or artist>` 🎵', channel);
    return;
  }

  const term = input.slice(1).join(' ');
  logger.info('Track to search for: ' + term);

  try {
    const tracks = await spotify.searchTrackList(term, searchLimit);

    if (!tracks || tracks.length === 0) {
      _slackMessage("🤷 Couldn't find anything matching that. Try different keywords or check the spelling! 🎵", channel);
      return;
    }

    let message = `🎵 Found *${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}*:\n`;
    tracks.forEach((track, index) => {
      message += `>${index + 1}. *${track.name}* by _${track.artists[0].name}_\n`;
    });
    _slackMessage(message, channel);
  } catch (err) {
    logger.error('Error searching for track: ' + err.message);
    _slackMessage('🚨 Couldn\'t search for tracks. Error: ' + err.message + ' Try again! 🔄', channel);
  }
}

async function _searchalbum(input, channel) {
  // Search for an album on Spotify
  if (!input || input.length < 2) {
    _slackMessage('🔍 You gotta tell me what album to search for! Try `searchalbum <album name>` 🎶', channel);
    return;
  }
  const album = input.slice(1).join(' ');
  logger.info('Album to search for: ' + album);

  try {
    const albums = await spotify.searchAlbumList(album, searchLimit);

    if (!albums || albums.length === 0) {
      _slackMessage('🤔 Couldn\'t find that album. Try including the artist name or checking the spelling! 🎶', channel);
      return;
    }

    let message = `Found ${albums.length} albums:\n`;
    albums.forEach((album) => {
      message += `> *${album.name}* by _${album.artist}_\n`;
    });
    _slackMessage(message, channel);
  } catch (err) {
    logger.error('Error searching for album: ' + err.message);
    _slackMessage('🚨 Couldn\'t search for albums. Error: ' + err.message + ' 🔄', channel);
  }
}

function _currentTrackTitle(channel, cb) {
  sonos
    .currentTrack()
    .then((track) => {
      if (track) {
        cb(null, track.title);
      } else {
        cb(null, 'nothing');
      }
    })
    .catch((err) => {
      cb(err);
    });
}

function _currentTrack(channel, cb) {
  sonos
    .currentTrack()
    .then((track) => {
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
        
        if (_isTrackGongBanned(track.title)) {
          message += ' :lock: (Immune to GONG)';
        }
        _slackMessage(message, channel);
        if (cb) cb(null, track);
      } else {
        _slackMessage('🔇 *Silence...* Nothing is currently playing. Use `add` to get started! 🎵', channel);
        if (cb) cb(null, null);
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
    // Ban the track that was gonged
    if (gongTrack) {
      gongBannedTracks[gongTrack] = true;
      logger.info('Banned track from re-queue: ' + gongTrack);
    }
    
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
          let gongIndex = -1;
          
          for (let i = 0; i < queue.items.length; i++) {
            if (queue.items[i].title === 'Gong 1' || queue.items[i].uri.includes('1FzsAo5gX5oEJD9PFVH5FO')) {
              gongIndex = i;
              break;
            }
          }
          
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

function _nextTrack(channel, userName) {
  _logUserAction(userName, 'next');
  // Admin check now handled in processInput (platform-aware)
  sonos
    .next()
    .then(() => {
      _slackMessage('⏭️ Skipped! On to the next banger... 🎵', channel);
    })
    .catch((err) => {
      logger.error('Error skipping to next track: ' + err);
    });
}

function _previous(input, channel, userName) {
  _logUserAction(userName, 'previous');
  // Admin check now handled in processInput (platform-aware)
  sonos
    .previous()
    .then(() => {
      _slackMessage('⏮️ Going back in time! Previous track loading... 🕙', channel);
    })
    .catch((err) => {
      logger.error('Error going to previous track: ' + err);
    });
}

function _stop(input, channel, userName) {
  _logUserAction(userName, 'stop');
  // Admin check now handled in processInput (platform-aware)
  sonos
    .stop()
    .then(() => {
      _slackMessage('⏹️ *Silence falls...* Playback stopped. 🔇', channel);
    })
    .catch((err) => {
      logger.error('Error stopping playback: ' + err);
    });
}

function _play(input, channel, userName) {
  _logUserAction(userName, 'play');
  // Admin check now handled in processInput (platform-aware)
  sonos
    .play()
    .then(() => {
      _slackMessage('▶️ Let\'s gooo! Music is flowing! 🎶', channel);
    })
    .catch((err) => {
      logger.error('Error starting playback: ' + err);
    });
}

function _pause(input, channel, userName) {
  _logUserAction(userName, 'pause');
  // Admin check now handled in processInput (platform-aware)
  sonos
    .pause()
    .then(() => {
      _slackMessage('⏸️ Taking a breather... Paused! 💨', channel);
    })
    .catch((err) => {
      logger.error('Error pausing playback: ' + err);
    });
}

function _resume(input, channel, userName) {
  _logUserAction(userName, 'resume');
  // Admin check now handled in processInput (platform-aware)
  sonos
    .play()
    .then(() => {
      _slackMessage('▶️ Back to the groove! Resuming playback... 🎵', channel);
    })
    .catch((err) => {
      logger.error('Error resuming playback: ' + err);
    });
}

function _flush(input, channel, userName) {
  _logUserAction(userName, 'flush');
  // Admin check now handled in processInput (platform-aware)
  sonos
    .flush()
    .then(() => {
      _slackMessage('🚽 *FLUSHED!* The queue has been wiped clean. Time to start fresh! 🎶', channel);
    })
    .catch((err) => {
      logger.error('Error flushing queue: ' + err);
    });
}

function _shuffle(input, channel, userName) {
  _logUserAction(userName, 'shuffle');
  // Admin check now handled in processInput (platform-aware)
  sonos
    .setPlayMode('SHUFFLE')
    .then(() => {
      _slackMessage('🎲 *Shuffle mode activated!* Queue randomized - let chaos reign! 🎵🔀', channel);
    })
    .catch((err) => {
      logger.error('Error setting play mode to shuffle: ' + err);
    });
}

function _normal(input, channel, userName) {
  _logUserAction(userName, 'normal');
  // Admin check now handled in processInput (platform-aware)
  sonos
    .setPlayMode('NORMAL')
    .then(() => {
      _slackMessage('📋 Back to normal! Queue is now in the order you actually wanted. ✅', channel);
    })
    .catch((err) => {
      logger.error('Error setting play mode to normal: ' + err);
    });
}

function _removeTrack(input, channel) {
  // Admin check now handled in processInput (platform-aware)
  if (!input || input.length < 2) {
    _slackMessage('🔢 You must provide the track number to remove! Use `remove <number>` 🎯', channel);
    return;
  }
  const trackNb = parseInt(input[1]) + 1;  // +1 because Sonos uses 1-based indexing
  if (isNaN(trackNb)) {
    _slackMessage('🤔 That\'s not a valid track number. Check the queue with `list`! 📋', channel);
    return;
  }
  sonos
    .removeTracksFromQueue(trackNb, 1)  // Remove 1 track starting at trackNb
    .then(() => {
      logger.info('Removed track with index: ' + trackNb);
      _slackMessage(`🗑️ Track #${input[1]} has been yeeted from the queue! 🚀`, channel);
    })
    .catch((err) => {
      logger.error('Error removing track from queue: ' + err);
      _slackMessage('🚨 Error removing track from queue. Try again! 🔄', channel);
    });
}

function _purgeHalfQueue(input, channel) {
  // Admin check now handled in processInput (platform-aware)
  sonos
    .getQueue()
    .then((result) => {
      const halfQueue = Math.floor(result.total / 2);
      if (halfQueue === 0) {
        _slackMessage('🤷 The queue is too tiny to snap! Thanos needs at least 2 tracks to work his magic. 👏', channel);
        return;
      }
      sonos
        .removeTracksFromQueue(halfQueue, halfQueue)
        .then(() => {
          _slackMessage(`👏 *SNAP!* Perfectly balanced, as all things should be. ${halfQueue} tracks turned to dust. ✨💨`, channel);
        })
        .catch((err) => {
          logger.error('Error removing tracks from queue: ' + err);
          _slackMessage('💥 Error executing the snap. Even Thanos has off days... Try again! 🔄', channel);
        });
    })
    .catch((err) => {
      logger.error('Error getting queue for snap: ' + err);
      _slackMessage('🚨 Error getting queue for the snap. Try again! 🔄', channel);
    });
}

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

function _help(input, channel) {
  try {
    // Determine admin status platform-aware
    const isAdminUser = currentPlatform === 'discord' ? currentIsAdmin : (channel === global.adminChannel);
    
    let messages = [];
    
    // AI help section (only shown if OpenAI is enabled)
    let aiHelpSection = '';
    if (AIHandler.isAIEnabled()) {
      aiHelpSection = `*🤖 AI Natural Language (just @mention me!)*
> Talk to me naturally! Examples:
> • \`@SlackONOS play some christmas music\` → Adds holiday tracks
> • \`@SlackONOS add a few 80s hits\` → Queues 80s classics
> • \`@SlackONOS what's playing?\` → Shows current track
> • \`@SlackONOS skip this\` → Votes to gong
> 
> _Quantity words: "a couple" (2), "a few" (3-4), "some" (5), "many" (8)_
> _Themes: christmas, party, chill, workout, summer, 80s, 90s, rock, pop, disco, hip-hop, latin, swedish..._

━━━━━━━━━━━━━━━━━━━━━

`;
    }
    
    // For Discord admins, show both regular + admin help (split into multiple messages due to 2000 char limit)
    if (currentPlatform === 'discord' && isAdminUser) {
      const regularHelp = fs.readFileSync('helpText.txt', 'utf8');
      const adminHelp = fs.readFileSync('helpTextAdmin.txt', 'utf8');
      
      messages.push(aiHelpSection + regularHelp);
      messages.push('━━━━━━━━━━━━━━━━━━━━━\n**🎛️ ADMIN COMMANDS** (DJ/Admin role)\n━━━━━━━━━━━━━━━━━━━━━\n\n' + adminHelp);
    } else {
      // Slack or non-admin: show appropriate single help file
      const helpFile = isAdminUser ? 'helpTextAdmin.txt' : 'helpText.txt';
      messages.push(aiHelpSection + fs.readFileSync(helpFile, 'utf8'));
    }

    // Generate config values list for admin help
    let configList = '';
    if (isAdminUser) {
      configList = `
        • \`gongLimit\`: ${gongLimit}
        • \`voteLimit\`: ${voteLimit}
        • \`voteImmuneLimit\`: ${voteImmuneLimit}
        • \`flushVoteLimit\`: ${flushVoteLimit}
        • \`maxVolume\`: ${maxVolume}
        • \`searchLimit\`: ${searchLimit}
        • \`voteTimeLimitMinutes\`: ${voteTimeLimitMinutes}`;
    }

    // Replace template variables in all messages
    messages = messages.map(msg => msg
      .replace(/{{gongLimit}}/g, gongLimit)
      .replace(/{{voteImmuneLimit}}/g, voteImmuneLimit)
      .replace(/{{voteLimit}}/g, voteLimit)
      .replace(/{{flushVoteLimit}}/g, flushVoteLimit)
      .replace(/{{searchLimit}}/g, searchLimit)
      .replace(/{{configValues}}/g, configList));

    // Send messages (Discord: multiple if needed; Slack: single combined)
    if (currentPlatform === 'discord') {
      // Send each message separately for Discord to avoid 2000 char limit
      for (const msg of messages) {
        _slackMessage(msg, channel);
      }
    } else {
      // Slack can handle longer messages - disable link previews
      _slackMessage(messages.join('\n\n'), channel, { unfurl_links: false, unfurl_media: false });
    }
  } catch (err) {
    logger.error('Error reading help file: ' + err.message);
    _slackMessage('🚨 Error loading help text. Please contact an admin! 📞', channel);
  }
}

function _blacklist(input, channel, userName) {
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

  saveBlacklist(blacklist);
}

function _setconfig(input, channel, userName) {
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
> \`aiModel\`: ${config.get('aiModel') || 'gpt-4o'}
> \`aiPrompt\`: ${(config.get('aiPrompt') || '').slice(0,80)}${(config.get('aiPrompt')||'').length>80?'…':''}

*Usage:* \`setconfig <key> <value>\`
*Example:* \`setconfig gongLimit 5\`
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
    aiModel: { type: 'string', minLen: 1, maxLen: 50, allowed: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
    aiPrompt: { type: 'string', minLen: 1, maxLen: 500 }
  };

  if (!allowedConfigs[key]) {
    _slackMessage(`❌ Invalid config key "${key}". Use \`setconfig\` without arguments to see available options! ⚙️`, channel);
    return;
  }

  const configDef = allowedConfigs[key];

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

    const oldValue = config.get(key);

    // Update runtime variable
    switch (key) {
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

    // Persist to config file
    config.set(key, numValue);
    config.save(function (err) {
      if (err) {
        logger.error('Error saving config: ' + err);
        _slackMessage(`⚠️ Updated \`${key}\` to \`${numValue}\` in memory, but failed to save to disk! Changes won't persist after restart. 🚨`, channel);
        return;
      }
      _slackMessage(`✅ Successfully updated \`${key}\` from \`${oldValue}\` to \`${numValue}\` and saved to config.`, channel);
    });
  } else if (configDef.type === 'string') {
    const newValue = input.slice(2).join(' ').trim();
    if (newValue.length < (configDef.minLen || 1) || newValue.length > (configDef.maxLen || 500)) {
      _slackMessage(`📝 Value length for \`${key}\` must be between ${configDef.minLen} and ${configDef.maxLen} characters.`, channel);
      return;
    }
    // Check allowed values if specified
    if (configDef.allowed && !configDef.allowed.includes(newValue)) {
      _slackMessage(`📝 Invalid value for \`${key}\`. Allowed values: ${configDef.allowed.join(', ')}`, channel);
      return;
    }
    const oldValue = config.get(key) || '';
    config.set(key, newValue);
    config.save(function (err) {
      if (err) {
        logger.error('Error saving config: ' + err);
        _slackMessage(`⚠️ Updated \`${key}\` in memory, but failed to save to disk!`, channel);
        return;
      }
      _slackMessage(`✅ Successfully updated \`${key}\` and saved to config.\nOld: \`${oldValue.slice(0,80)}${oldValue.length>80?'…':''}\`\nNew: \`${newValue.slice(0,80)}${newValue.length>80?'…':''}\``, channel);
    });
  }
}


async function _append(input, channel, userName) {
  _logUserAction(userName, 'append');

  // Append a track to the queue (never flushes existing queue)
  // Start playing if not already playing
  if (!input || input.length < 2) {
    _slackMessage('🎶 Tell me what song to append! Use `append <song name>` 🎵', channel);
    return;
  }

  const track = input.slice(1).join(' ');
  logger.info('Track to append: ' + track);

  try {
    const result = await spotify.getTrack(track);

    // Check if track is already in queue
    try {
      const queue = await sonos.getQueue();
      if (queue && queue.items) {
        let duplicatePosition = -1;
        const isDuplicate = queue.items.some((item, index) => {
          if (item.uri === result.uri || (item.title === result.name && item.artist === result.artist)) {
            duplicatePosition = index;
            return true;
          }
          return false;
        });

        if (isDuplicate) {
          _slackMessage(
            `*${result.name}* by _${result.artist}_ is already in the queue at position #${duplicatePosition}! :musical_note:\nWant it to play sooner? Use \`vote ${duplicatePosition}\` to move it up! :arrow_up:`,
            channel
          );
          return;
        }
      }
    } catch (queueErr) {
      // If we can't get the queue, just log and continue with adding
      logger.warn('Could not check queue for duplicates: ' + queueErr.message);
    }

    // Always add to queue (preserving existing tracks)
    await sonos.queue(result.uri);
    logger.info('Appended track: ' + result.name);

    let msg = '✅ Added *' + result.name + '* by _' + result.artist + '_ to the queue!';

    // Check if we need to start playback
    try {
      const state = await sonos.getCurrentState();
      logger.info('Current state after append: ' + state);

      if (state !== 'playing' && state !== 'transitioning') {
        // Wait a moment before starting playback
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sonos.play();
        logger.info('Started playback after append.');
        msg += ' Playback started! :notes:';
      }
    } catch (stateErr) {
      logger.warn('Could not check/start playback: ' + stateErr.message);
    }

    _slackMessage(msg, channel);
  } catch (err) {
    logger.error('Error appending track: ' + err.message);
    _slackMessage('🤷 Couldn\'t find that track or something went wrong. Try a different search! 🎶', channel);
  }
}

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
    
    // Write the combined audio to file
    fs.writeFileSync(ttsFilePath, combinedBuffer);
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

    // Get current track position
    const currentTrack = await sonos.currentTrack();
    const currentPosition = currentTrack ? currentTrack.queuePosition : 1;
    const ttsPosition = currentPosition + 1;

    // Use HTTP server to serve the TTS file (with cache-busting timestamp)
    const uri = `http://${ipAddress}:${webPort}/tts.mp3?t=${Date.now()}`;
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
    .reorderTracksInQueue(from, 1, to, 0)
    .then(() => {
      _slackMessage(`📍 Successfully moved track from position *${from}* to *${to}*! Queue reshuffled! 🔀`, channel);
    })
    .catch((err) => {
      logger.error('Error moving track: ' + err);
      _slackMessage('🚨 Error moving track. Check that both positions exist in the queue! 🔄', channel);
    });
}



if (process.env.NODE_ENV === 'test') {
  module.exports = function numFormatter(num) {
    if (num === null || num === undefined) return '';
    return Number(num).toLocaleString('en-US');
  };
}
