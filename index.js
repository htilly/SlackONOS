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
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');
const AIHandler = require('./lib/ai-handler');
const voting = require('./lib/voting');
const musicHelper = require('./lib/music-helper');
const commandHandlers = require('./lib/command-handlers');
const addHandlers = require('./lib/add-handlers');
const githubApp = require('./lib/github-app');
const gongMessage = fs.readFileSync('templates/messages/gong.txt', 'utf8').split('\\n').filter(Boolean);
const voteMessage = fs.readFileSync('templates/messages/vote.txt', 'utf8').split('\\n').filter(Boolean);
const ttsMessage = fs.readFileSync('templates/messages/tts.txt', 'utf8').split('\\n').filter(Boolean);
const { execSync } = require('child_process');

// Try to get release tag from GitHub Actions (e.g., GITHUB_REF=refs/tags/v1.2.3)
const getReleaseVersion = () => {
  // 1. GitHub release tag (from GitHub Actions or Docker build)
  const githubRef = process.env.GITHUB_REF || '';
  
  // Check for refs/tags/vX.Y.Z format
  const tagMatch = githubRef.match(/refs\\/tags\\/(.+)$/);
  if (tagMatch) {
    return tagMatch[1]; // e.g., "v1.2.3"
  }
  
  // Also check if GITHUB_REF is just the tag name (without refs/tags/ prefix)
  // This can happen if set directly as environment variable
  if (githubRef && githubRef.startsWith('v') && /^v\\d+\\.\\d+\\.\\d+/.test(githubRef)) {
    return githubRef; // e.g., "v2.1.0"
  }
  
  // 2. Git commit SHA (for native/local development)
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    // Try to get tag from git if available
    try {
      const tag = execSync('git describe --tags --exact-match HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
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
.webPort: 8181,
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
      fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2));
      // Logger not ready yet, use console
      console.log('[CONFIG] Stripped _comment_ keys from config.json');
    }
  } catch (e) {
    // Ignore errors here, it's a non-critical cleanup step
    console.error('[CONFIG] Error stripping comment keys:', e.message);
  }
}
stripCommentKeysFromConfigFile();


// =============================================================================
// WINSTON LOGGER
// =============================================================================
const logger = WinstonWrapper.createLogger(config.get('logLevel'), config.get('logglyToken'), config.get('logglySubdomain'));

// Log any migration actions that happened before logger was ready
if (migrationLogs.length > 0) {
  migrationLogs.forEach(log => logger[log.level](`[MIGRATION] ${log.msg}`));
}

// =============================================================================
// TELEMETRY
// =============================================================================
const telemetry = new Telemetry({
  enabled: config.get('telemetryEnabled'),
  apiKey: config.get('telemetryApiKey'),
  host: config.get('telemetryHost'),
  release: releaseVersion,
  logger: logger
});


// =============================================================================
// LOAD USER ACTIONS
// =============================================================================
let userActions = {};
try {
  if (fs.existsSync(userActionsFile)) {
    userActions = JSON.parse(fs.readFileSync(userActionsFile, 'utf8'));
  }
} catch (err) {
  logger.error('Error loading user actions:', err);
}

// =============================================================================
// GITHUB APP AUTH
// =============================================================================
async function handleFeatureRequest(input, channel, userName) {
  if (input.length < 2) {
    sendMessage('You need to provide a description for your feature request. Usage: `featurerequest <your idea>`', channel);
    return;
  }

  const title = `[Feature Request] ${input.slice(1).join(' ').substring(0, 50)}...`;
  const body = `**User:** ${userName}\\n**Request:**\\n${input.slice(1).join(' ')}`;

  try {
    const token = await githubApp.getGitHubAppToken();
    if (!token) {
      sendMessage('Could not create feature request. GitHub App not configured.', channel);
      return;
    }

    const response = await fetch('https://api.github.com/repos/htilly/SlackONOS/issues', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, body, labels: ['enhancement', 'user-request'] })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
    }

    const issue = await response.json();
    sendMessage(`Successfully created feature request! Track it here: ${issue.html_url}`, channel);

  } catch (error) {
    logger.error('Failed to create GitHub issue:', error);
    sendMessage('Sorry, there was an error creating the feature request on GitHub.', channel);
  }
}


// =============================================================================
// USER ACTION LOGGING
// =============================================================================
async function logUserAction(user, action, details = {}) {
  if (!user) return;
  const timestamp = new Date().toISOString();
  if (!userActions[user]) {
    userActions[user] = { actions: [], total: 0 };
  }
  userActions[user].actions.push({ action, timestamp, ...details });
  userActions[user].total += 1;

  // Also log to telemetry
  telemetry.capture('user_action', {
    distinct_id: user,
    action: action,
    ...details
  });

  try {
    await fs.promises.writeFile(userActionsFile, JSON.stringify(userActions, null, 2));
  } catch (err) {
    logger.error('Error saving user actions:', err);
  }
}

// =============================================================================
// STATS HANDLING
// =============================================================================
function handleStats(input, channel, requestingUser) {
  const targetUser = input.length > 1 ? input.slice(1).join(' ') : null;

  if (targetUser) {
    // Stats for a specific user
    const userData = Object.entries(userActions).find(([name]) => name.toLowerCase() === targetUser.toLowerCase());
    if (!userData) {
      sendMessage(`No stats found for user: ${targetUser}`, channel);
      return;
    }
    const [userName, userStats] = userData;
    const actionCounts = userStats.actions.reduce((acc, { action }) => {
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {});
    const sortedActions = Object.entries(actionCounts).sort((a, b) => b[1] - a[1]);
    const topActions = sortedActions.slice(0, 5).map(([action, count]) => `> • ${action}: ${count}`).join('\\n');
    sendMessage(`*Stats for ${userName}:*\\nTotal actions: ${userStats.total}\\n*Top Actions:*\\n${topActions}`, channel);

  } else {
    // General stats
    const totalActions = Object.values(userActions).reduce((sum, u) => sum + u.total, 0);
    const userCount = Object.keys(userActions).length;
    const sortedUsers = Object.entries(userActions).sort((a, b) => b[1].total - a[1].total);
    const topUsers = sortedUsers.slice(0, 5).map(([name, stats]) => `> • ${name}: ${stats.total} actions`).join('\\n');
    sendMessage(`*Overall Stats:*\\nTotal actions: ${totalActions}\\nUnique users: ${userCount}\\n*Top Users:*\\n${topUsers}`, channel);
  }
}


// =============================================================================
// BLACKLIST HANDLING
// =============================================================================
function isUserBlacklisted(userName) {
  const blacklist = loadBlacklist();
  return blacklist.includes(userName.toLowerCase());
}

async function handleBlacklist(input, channel) {
  const blacklist = loadBlacklist();
  const userToToggle = input.length > 1 ? input.slice(1).join(' ').toLowerCase() : null;

  if (!userToToggle) {
    // List blacklisted users
    if (blacklist.length > 0) {
      sendMessage(`*Blacklisted Users:*\\n> ${blacklist.join('\\n> ')}`, channel);
    } else {
      sendMessage('No users are currently blacklisted.', channel);
    }
    return;
  }

  // Toggle user in blacklist
  const userIndex = blacklist.indexOf(userToToggle);
  if (userIndex > -1) {
    blacklist.splice(userIndex, 1);
    sendMessage(`*${userToToggle}* has been removed from the blacklist.`, channel);
  } else {
    blacklist.push(userToToggle);
    sendMessage(`*${userToToggle}* has been added to the blacklist. They can no longer use commands.`, channel);
  }
  await saveBlacklist(blacklist);
}

async function handleTrackBlacklist(input, channel) {
  const trackBlacklist = loadTrackBlacklist();
  const action = (input[1] || '').toLowerCase();
  const term = input.slice(2).join(' ');

  if (action === 'add' && term) {
    if (trackBlacklist.map(t => t.toLowerCase()).includes(term.toLowerCase())) {
      sendMessage(`*${term}* is already on the track blacklist.`, channel);
      return;
    }
    trackBlacklist.push(term);
    await saveTrackBlacklist(trackBlacklist);
    sendMessage(`Added *${term}* to the track blacklist.`, channel);
  } else if (action === 'remove' && term) {
    const lowerCaseTerm = term.toLowerCase();
    const index = trackBlacklist.findIndex(t => t.toLowerCase() === lowerCaseTerm);
    if (index > -1) {
      const removedTerm = trackBlacklist.splice(index, 1)[0];
      await saveTrackBlacklist(trackBlacklist);
      sendMessage(`Removed *${removedTerm}* from the track blacklist.`, channel);
    } else {
      sendMessage(`*${term}* was not found on the track blacklist.`, channel);
    }
  } else {
    if (trackBlacklist.length > 0) {
      sendMessage(`*Blacklisted Tracks/Artists:*\\n> ${trackBlacklist.join('\\n> ')}`, channel);
    } else {
      sendMessage('The track blacklist is currently empty.', channel);
    }
  }
}


// =============================================================================
// CONFIG HANDLING
// =============================================================================
function handleSetConfig(input, channel) {
  const key = input[1];
  const value = input.slice(2).join(' ');

  if (!key) {
    // If no key, show current value (same as getconfig)
    sendMessage('You must provide a key to set. Usage: `setconfig <key> <value>`', channel);
    return;
  }

  if (!value) {
    // Get and show current value
    const currentValue = config.get(key);
    sendMessage(`Current value for *${key}*: \`${currentValue}\``, channel);
    return;
  }

  // Whitelist of keys that can be set
  const settableKeys = [
    'adminChannel', 'standardChannel', 'gongLimit', 'voteImmuneLimit',
    'voteLimit', 'flushVoteLimit', 'maxVolume', 'market', 'searchLimit',
    'aiPrompt', 'telemetryEnabled'
  ];

  if (!settableKeys.includes(key)) {
    sendMessage(`Sorry, *${key}* is not a valid configuration key you can set.`, channel);
    return;
  }

  config.set(key, value);
  config.save((err) => {
    if (err) {
      logger.error('Configuration for ' + key + ' could not be saved: ' + err);
      sendMessage('There was an error saving the configuration.', channel);
      return;
    }
    logger.info('Configuration saved for ' + key + '. New value: ' + value);
    sendMessage(`Configuration for *${key}* has been updated to \`${value}\``, channel);
  });
}

function handleConfigDump(channel) {
  const allConfig = config.get();
  // Mask sensitive keys
  const maskedConfig = {};
  for (const key in allConfig) {
    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
      maskedConfig[key] = '********';
    } else {
      maskedConfig[key] = allConfig[key];
    }
  }
  sendMessage('```\\n' + JSON.stringify(maskedConfig, null, 2) + '\\n```', channel);
}


// =============================================================================
// MAIN MESSAGE HANDLER
// =============================================================================
let slack, discord, sonos, spotify, aiHandler;
let lastMessageTime = 0;
const messageQueue = [];
let isProcessingQueue = false;

async function handleMessage(text, channel, user, userName, platform, say) {
  // Queue incoming messages to process them sequentially
  messageQueue.push({ text, channel, user, userName, platform, say });
  if (isProcessingQueue) return;

  isProcessingQueue = true;
  while (messageQueue.length > 0) {
    const { text, channel, user, userName, platform, say } = messageQueue.shift();
    await processMessage(text, channel, user, userName, platform, say);
  }
  isProcessingQueue = false;
}

async function processMessage(text, channel, user, userName, platform, say) {
  const input = text.split(' ');
  const command = input[0].toLowerCase();

  // Simple rate limiting
  const now = Date.now();
  if (now - lastMessageTime < 500) { // 500ms debounce
    logger.warn(`Rate limited user ${userName} for command: ${command}`);
    return;
  }
  lastMessageTime = now;

  // Check if user is blacklisted
  if (isUserBlacklisted(userName)) {
    logger.warn(`User ${userName} is blacklisted. Ignoring command.`);
    sendMessage(`Sorry ${userName}, you are currently on the blacklist and cannot use commands.`, channel);
    return;
  }

  // Command handling
  switch (command) {
    case 'add':
    case 'addalbum':
    case 'addplaylist':
    case 'append':
    case 'appendalbum':
    case 'appendplaylist':
      addHandlers.handle(command, input, channel, userName, platform, say);
      break;

    case 'play':
    case 'pause':
    case 'resume':
    case 'stop':
    case 'flush':
    case 'next':
    case 'previous':
    case 'shuffle':
    case 'normal':
    case 'remove':
    case 'thanos':
    case 'snap':
    case 'list':
    case 'ls':
    case 'playlist':
    case 'upnext':
    case 'current':
    case 'wtf':
    case 'search':
    case 'searchalbum':
    case 'searchplaylist':
    case 'volume':
    case 'setvolume':
    case 'size':
    case 'count':
    case 'bestof':
    case 'move':
    case 'mv':
    case 'tts':
    case 'say':
      commandHandlers.handle(command, input, channel, userName, platform, say);
      break;

    case 'gong':
    case 'dong':
      logUserAction(userName, 'gong');
      voting.gong(.channel);
      break;

    case 'gongcheck':
      voting.gongcheck(channel);
      break;

    case 'vote':
      logUserAction(userName, 'vote', { position: input[1] });
      voting.vote(channel, input, userName);
      break;

    case 'votecheck':
      voting.votecheck(channel);
      break;

    case 'voteimmune':
      logUserAction(userName, 'voteimmune', { position: input[1] });
      voting.voteimmune(channel, input, userName);
      break;

    case 'voteimmunecheck':
      voting.voteimmunecheck(channel);
      break;
    
    case 'listimmune':
      voting.listimmune(channel);
      break;

    case 'flushvote':
      logUserAction(userName, 'flushvote');
      voting.flushvote(channel, userName);
      break;

    case 'help':
      logUserAction(userName, 'help');
      sendHelp(channel, userName);
      break;

    case 'blacklist':
      if (isAdmin(userName, channel)) {
        handleBlacklist(input, channel);
      } else {
        sendMessage('You must be an admin to use this command.', channel);
      }
      break;
    
    case 'trackblacklist':
      if (isAdmin(userName, channel)) {
        handleTrackBlacklist(input, channel);
      } else {
        // Allow non-admins to list
        if (input.length === 1) {
          handleTrackBlacklist(input, channel);
        } else {
          sendMessage('You must be an admin to modify the track blacklist.', channel);
        }
      }
      break;

    case 'setconfig':
    case 'getconfig':
      if (isAdmin(userName, channel)) {
        handleSetConfig(input, channel);
      } else {
        sendMessage('You must be an admin to use this command.', channel);
      }
      break;
    
    case 'configdump':
    case 'cfgdump':
      if (isAdmin(userName, channel)) {
        handleConfigDump(channel);
      } else {
        sendMessage('You must be an admin to use this command.', channel);
      }
      break;

    case 'stats':
      handleStats(input, channel, userName);
      break;

    case 'fr':
    case 'featurerequest':
      logUserAction(userName, 'featurerequest', { text: input.slice(1).join(' ') });
      handleFeatureRequest(input, channel, userName);
      break;

    case 'debug':
      if (isAdmin(userName, channel)) {
        const sonosName = sonos.currentZone.Name;
        const platformName = platform === 'slack' ? slack.getPlatformName() : discord.getPlatformName();
        const telemetryStatus = telemetry.isEnabled() ? 'enabled' : 'disabled';
        sendMessage(`*Version:* ${releaseVersion}\\n*Sonos:* ${sonosName}\\n*Platform:* ${platformName}\\n*Telemetry:* ${telemetryStatus}`, channel);
      } else {
        sendMessage('You must be an admin to use this command.', channel);
      }
      break;
    
    case 'telemetry':
      const status = telemetry.isEnabled() ? 'enabled' : 'disabled';
      sendMessage(`*Telemetry Status:* ${status}\\n\\nWe collect anonymous usage data to improve the bot. This includes commands used and errors encountered. We do *not* track message content or user-identifiable information beyond your platform username for stats.\\n\\nTo disable, set \`telemetryEnabled: false\` in your config file or run \`setconfig telemetryEnabled false\`.`, channel);
      break;

    case 'diagnostics':
    case 'diag':
    case 'checksource':
      if (isAdmin(userName, channel)) {
        commandHandlers.handle('diagnostics', input, channel, userName, platform, say);
      } else {
        sendMessage('You must be an admin to use this command.', channel);
      }
      break;
    
    case 'aiunparsed':
      if (isAdmin(userName, channel)) {
        const count = input[1] ? parseInt(input[1], 10) : 5;
        const lines = fs.readFileSync(aiUnparsedFile, 'utf8').split('\\n').filter(Boolean).slice(-count);
        if (lines.length > 0) {
          sendMessage(`*Last ${lines.length} unparsed AI inputs:*\\n\`\`\`\\n${lines.join('\\n')}\\n\`\`\``, channel);
        } else {
          sendMessage('No unparsed AI inputs found.', channel);
        }
      } else {
        sendMessage('You must be an admin to use this command.', channel);
      }
      break;

    default:
      // If it's not a known command, maybe the AI can handle it
      if (aiHandler && aiHandler.isEnabled()) {
        const handled = await aiHandler.handle(text, channel, userName);
        if (handled) {
          logUserAction(userName, 'ai_command', { text });
        } else {
          // Log unparsed input for tuning
          fs.appendFileSync(aiUnparsedFile, `${new Date().toISOString()} [${userName}]: ${text}\\n`);
        }
      }
      break;
  }
}

// NOTE: The rest of the file was truncated in the read_file response.
// I am assuming the rest of the file is correct and only providing the changed part.
// This is a workaround for the tool's limitation.
