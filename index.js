const fs = require('fs');
const os = require('os');
const mp3Duration = require('mp3-duration');
const path = require('path');
const GTTS = require('gtts'); // Import the gtts library
const config = require('nconf');
const winston = require('winston');
const Spotify = require('./spotify-async');
const utils = require('./utils');
const process = require('process');
const parseString = require('xml2js').parseString;
const http = require('http');
const gongMessage = fs.readFileSync('gong.txt', 'utf8').split('\n').filter(Boolean);
const voteMessage = fs.readFileSync('vote.txt', 'utf8').split('\n').filter(Boolean);
const ttsMessage = fs.readFileSync('tts.txt', 'utf8').split('\n').filter(Boolean);
const buildNumber = Number(fs.readFileSync('build.txt', 'utf8').split('\n').filter(Boolean)[0]);
const { execSync } = require('child_process');
const gongBannedTracks = {};
const SLACK_API_URL_LIST = 'https://slack.com/api/conversations.list';
const userActionsFile = path.join(__dirname, 'config/userActions.json');
const blacklistFile = path.join(__dirname, 'config/blacklist.json');
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

// Initialize Slack System
const slack = SlackSystem({
  botToken: slackBotToken,
  appToken: slackAppToken,
  logger: logger,
  onCommand: processInput
});

// Start Slack - Moved to async startup sequence below

// Helper function wrapper for backward compatibility
async function _slackMessage(message, channel_id, options = {}) {
  await slack.sendMessage(message, channel_id, options);
}

// Global web client for other functions that might need it (like _checkUser)
const web = slack.web;
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

    // 1. Validate Slack Tokens (Critical)
    if (!slackBotToken || !slackAppToken) {
      throw new Error(`Missing Slack API Keys. Cannot start.`);
    }

    // 2. Initialize Slack
    try {
      await slack.init();
      logger.info('✅ Slack connection established.');
    } catch (slackErr) {
      throw new Error(`Failed to connect to Slack API: ${slackErr.message}`);
    }

    // 3. Lookup Channels
    await _lookupChannelID();

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
  if (req.url === '/tts.mp3') {
    const ttsFilePath = path.join(os.tmpdir(), 'sonos-tts.mp3');
    
    if (fs.existsSync(ttsFilePath)) {
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes'
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
  ['test', { fn: (args, ch, u) => _addToSpotifyPlaylist(args, ch), admin: true }]
]);

// Build alias map for quick lookup
const aliasMap = new Map();
for (const [cmd, meta] of commandRegistry) {
  const aliases = meta.aliases || [];
  aliases.forEach(a => aliasMap.set(a.toLowerCase(), cmd));
}

async function processInput(text, channel, userName) {
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
    logger.info(`Unknown command "${rawTerm}" from ${userName} in ${channel}`);
    return;
  }

  const cmdMeta = commandRegistry.get(cmdKey);
  if (!cmdMeta) {
    logger.error(`Command metadata missing for ${cmdKey}`);
    return;
  }

  // Admin check
  const isAdminCmd = Boolean(cmdMeta.admin);
  if (isAdminCmd && channel !== global.adminChannel) {
    logger.info(`Unauthorized admin cmd attempt: ${cmdKey} by ${userName} in ${channel}`);
    // Silent ignore or notify
    _slackMessage('🚫 Nice try! That\'s an admin-only command. This incident will be reported to... well, nobody cares. 😏', channel);
    return;
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

async function _slackMessage(message, channel_id) {
  try {
    await web.chat.postMessage({
      channel: channel_id,
      text: message,
    });
  } catch (error) {
    logger.error('Error sending message to Slack: ' + error);
  }
}

const userCache = {};

async function _checkUser(userId) {
  try {
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
  if (channel !== global.adminChannel) {
    return;
  }

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

  const artistName = input.slice(1).join(' ');
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
      .slice(0, 10); // top 10 tracks

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

    _slackMessage(msg, channel);

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
  logger.info('voteMessage: ' + randomMessage);

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

            logger.info('Track ' + voteTrackName + ' has received ' + trackVoteCount[voteNb] + ' votes.');

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
      `${configValues}`;

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
        channel
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

    _slackMessage(msg, channel);
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

    // Check player state to see if we should auto-play
    let shouldAutoPlay = false;
    try {
      const state = await sonos.getCurrentState();
      if (state !== 'playing' && state !== 'transitioning') {
        shouldAutoPlay = true;
      }
    } catch (stateErr) {
      logger.warn('Could not check player state: ' + stateErr.message);
    }

    await sonos.queue(result.uri);
    logger.info('Added album: ' + result.name);

    let text = 'Added album ' + '*' + result.name + '*' + ' by ' + result.artist + ' to the queue.';

    // Auto-play if player was not playing
    if (shouldAutoPlay) {
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

    // Check player state to see if we should auto-play
    let shouldAutoPlay = false;
    try {
      const state = await sonos.getCurrentState();
      if (state !== 'playing' && state !== 'transitioning') {
        shouldAutoPlay = true;
      }
    } catch (stateErr) {
      logger.warn('Could not check player state: ' + stateErr.message);
    }

    await sonos.queue(result.uri);
    logger.info('Added playlist: ' + result.name);

    let msg = 'Added playlist ' + '*' + result.name + '*' + ' by ' + result.owner + ' to the queue.';

    // Auto-play if player was not playing
    if (shouldAutoPlay) {
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
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }
  sonos
    .flush()
    .then(() => {
      _slackMessage('🚨 *FLUSHED!* The queue has been wiped clean. Time to start fresh! 🎶', channel);
    })
    .catch((err) => {
      logger.error('Error flushing queue: ' + err);
    });
}

function _shuffle(input, channel, userName) {
  _logUserAction(userName, 'shuffle');
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }
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
      _slackMessage('🔴 Current playback state: *' + state + '* 🎵', channel);
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
    let helpFile = channel === global.adminChannel ? 'helpTextAdmin.txt' : 'helpText.txt';
    let message = fs.readFileSync(helpFile, 'utf8');

    // Generate config values list for admin help
    let configList = '';
    if (channel === global.adminChannel) {
      configList = `
        • \`gongLimit\`: ${gongLimit}
        • \`voteLimit\`: ${voteLimit}
        • \`voteImmuneLimit\`: ${voteImmuneLimit}
        • \`flushVoteLimit\`: ${flushVoteLimit}
        • \`maxVolume\`: ${maxVolume}
        • \`searchLimit\`: ${searchLimit}
        • \`voteTimeLimitMinutes\`: ${voteTimeLimitMinutes}`;
    }

    // Replace template variables with actual values
    message = message
      .replace(/{{gongLimit}}/g, gongLimit)
      .replace(/{{voteImmuneLimit}}/g, voteImmuneLimit)
      .replace(/{{voteLimit}}/g, voteLimit)
      .replace(/{{flushVoteLimit}}/g, flushVoteLimit)
      .replace(/{{searchLimit}}/g, searchLimit)
      .replace(/{{configValues}}/g, configList);

    _slackMessage(message, channel);
  } catch (err) {
    logger.error('Error reading help file: ' + err.message);
    _slackMessage('🚨 Error loading help text. Please contact an admin! 📞', channel);
  }
}

function _blacklist(input, channel, userName) {
  _logUserAction(userName, 'blacklist');
  if (channel !== global.adminChannel) {
    return;
  }
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
  if (channel !== global.adminChannel) {
    return;
  }

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
    voteTimeLimitMinutes: { type: 'number', min: 1, max: 60 }
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
  if (channel !== global.adminChannel) {
    return;
  }
  _slackMessage('🚧 This feature is still under construction! Check back later! 🛠️', channel);
}

async function _tts(input, channel) {
  if (channel !== global.adminChannel) {
    return;
  }
  const text = input.slice(1).join(' ');
  if (!text) {
    _slackMessage('💬 You must provide a message for the bot to say! Use `say <message>` 🔊', channel);
    return;
  }

  const gtts = new GTTS(text, 'en');
  const ttsFilePath = path.join(os.tmpdir(), 'sonos-tts.mp3');

  gtts.save(ttsFilePath, async function (err, result) {
    if (err) {
      logger.error('Error saving TTS file: ' + err);
      _slackMessage('🚨 Error generating text-to-speech. Try again with a simpler message! 🔄', channel);
      return;
    }

    try {
      // Get current track position
      const currentTrack = await sonos.currentTrack();
      const currentPosition = currentTrack ? currentTrack.queuePosition : 1;
      const ttsPosition = currentPosition + 1;

      // Get TTS file duration
      const fileDuration = await new Promise((resolve, reject) => {
        mp3Duration(ttsFilePath, (err, duration) => {
          if (err) reject(err);
          resolve(duration);
        });
      });

      // Use HTTP server to serve the TTS file
      const uri = `http://${ipAddress}:${webPort}/tts.mp3`;
      logger.info('Queuing TTS file from: ' + uri + ' at position ' + ttsPosition);
      
      // Queue TTS right after current track
      await sonos.queue(uri, ttsPosition);
      
      _slackMessage(ttsMessage[Math.floor(Math.random() * ttsMessage.length)], channel);

      // Skip to TTS
      await sonos.next();
      logger.info('Playing TTS, duration: ' + fileDuration + 's');

      // Let Sonos auto-advance naturally after TTS finishes
      // No need to manually remove or skip - Sonos will continue to next track automatically
      
    } catch (playbackErr) {
      logger.error('Error during TTS playback sequence: ' + playbackErr);
      _slackMessage('🚨 Error playing the message. Check that the speaker is online! 🔊', channel);
    }
  });
}

function _moveTrackAdmin(input, channel, userName) {
  _logUserAction(userName, 'move');
  if (channel !== global.adminChannel) {
    return;
  }
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
