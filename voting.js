/**
 * Voting System Module
 * Handles all democratic voting features: gong, vote-to-play, vote-immune, flush-vote
 * 
 * @module voting
 */

const fs = require('fs');

// ==========================================
// STATE
// ==========================================

// Gong system state
let gongCounter = 0;
let gongScore = {};
const gongLimitPerUser = 1;
let gongTrack = ''; // Track key a GONG was called on (title+artist when available)
const gongBannedTracks = {}; // key -> { title, artist }

// Vote immune state
let voteImmuneCounter = 0;
const voteImmuneLimitPerUser = 1;
let voteImmuneUsers = {}; // Track users who have voted for each track for vote immune
let voteImmuneScore = {};

// Vote-to-play state
let voteCounter = 0;
const voteLimitPerUser = 4;
let voteScore = {};
let trackVoteCount = {}; // Vote count per track (keyed by track key: URI or title+artist)
let trackVoteUsers = {}; // Track users who have voted for each track (keyed by track key)

// Flush vote state
let flushVoteCounter = 0;
const flushVoteLimitPerUser = 1;
let flushVoteScore = {};
let voteTimer = null;

// ==========================================
// DEPENDENCIES (injected)
// ==========================================

let logger = null;
let sendMessage = async () => {};
let sonos = null;
let getCurrentTrackTitle = async () => null;
let logUserAction = async () => {};

// Config values (will be updated by setConfig)
let gongLimit = 3;
let voteLimit = 3;
let voteImmuneLimit = 3;
let flushVoteLimit = 6;
let voteTimeLimitMinutes = 5;

// Random messages
let gongMessages = ['GONG!'];
let voteMessages = ['Voted!'];

/**
 * Initialize the voting module with dependencies
 * @param {Object} deps - Dependencies
 */
function initialize(deps) {
  if (!deps.logger) {
    throw new Error('Voting module requires a logger to be injected');
  }

  logger = deps.logger;
  sendMessage = deps.sendMessage || (async () => {});
  sonos = deps.sonos || null;
  getCurrentTrackTitle = deps.getCurrentTrackTitle || (async () => null);
  logUserAction = deps.logUserAction || (async () => {});

  // Load random messages
  if (deps.gongMessages) gongMessages = deps.gongMessages;
  if (deps.voteMessages) voteMessages = deps.voteMessages;

  logger.info('✅ Voting module initialized');
}

/**
 * Update config values (called when config changes)
 * @param {Object} config - Config values
 */
function setConfig(config) {
  if (config.gongLimit !== undefined) gongLimit = config.gongLimit;
  if (config.voteLimit !== undefined) voteLimit = config.voteLimit;
  if (config.voteImmuneLimit !== undefined) voteImmuneLimit = config.voteImmuneLimit;
  if (config.flushVoteLimit !== undefined) flushVoteLimit = config.flushVoteLimit;
  if (config.voteTimeLimitMinutes !== undefined) voteTimeLimitMinutes = config.voteTimeLimitMinutes;
}

/**
 * Get current config values (for display)
 */
function getConfig() {
  return {
    gongLimit,
    voteLimit,
    voteImmuneLimit,
    flushVoteLimit,
    voteTimeLimitMinutes
  };
}

// ==========================================
// GONG SYSTEM
// ==========================================

/**
 * Check if a track is gong banned (immune)
 * @param {string} trackName - Track name to check
 * @returns {boolean}
 */
function _normalizeStr(s) {
  return String(s || '').trim();
}

function _trackKey(title, artist, uri) {
  const u = _normalizeStr(uri);
  if (u) return `uri|||${u}`.toLowerCase();

  const t = _normalizeStr(title);
  const a = _normalizeStr(artist);
  // Fallback: title+artist (can still collide for duplicates of the same song)
  return (a ? `${t}|||${a}` : t).toLowerCase();
}

function _normalizeTrackRef(trackRef, artist) {
  // Handle null/undefined (no track playing)
  if (!trackRef) {
    return { title: '', artist: '', uri: '' };
  }
  // Handle object (track info)
  if (typeof trackRef === 'object') {
    return { title: _normalizeStr(trackRef.title), artist: _normalizeStr(trackRef.artist), uri: _normalizeStr(trackRef.uri) };
  }
  // Handle string (legacy format or track name only)
  return { title: _normalizeStr(trackRef), artist: _normalizeStr(artist), uri: '' };
}

function isTrackGongBanned(trackRef, artist) {
  const t = _normalizeTrackRef(trackRef, artist);
  const key = _trackKey(t.title, t.artist, t.uri);
  return Boolean(gongBannedTracks[key]);
}

/**
 * Ban a track from being gonged
 * @param {string} trackName - Track name to ban
 */
function banTrackFromGong(trackRef, artist) {
  const t = _normalizeTrackRef(trackRef, artist);
  const key = _trackKey(t.title, t.artist, t.uri);
  gongBannedTracks[key] = { title: t.title, artist: t.artist, uri: t.uri };
}

/**
 * Get list of immune tracks
 * @returns {string[]}
 */
function getImmuneTracks() {
  return Object.values(gongBannedTracks);
}

/**
 * Process a gong vote
 * @param {string} channel - Channel ID
 * @param {string} userName - User who gonged
 * @param {Function} onGongSuccess - Callback when gong limit reached
 */
async function gong(channel, userName, onGongSuccess) {
  await logUserAction(userName, 'gong');
  logger.info('_gong...');
  
  try {
    const trackRef = await getCurrentTrackTitle();
    const current = _normalizeTrackRef(trackRef);
    if (!current.title) {
      await sendMessage('🤷 Nothing is currently playing to gong!', channel);
      return;
    }
    
    logger.info('_gong > track: ' + current.title);
    
    // Reset gong state if track changed
    const currentKey = _trackKey(current.title, current.artist);
    if (currentKey !== gongTrack) {
      logger.info('Track changed from "' + gongTrack + '" to "' + currentKey + '", resetting gong state');
      gongCounter = 0;
      gongScore = {};
      gongTrack = currentKey;
    }

    if (isTrackGongBanned(current)) {
      logger.info('Track is gongBanned: ' + current.title);
      await sendMessage('🔒 Sorry ' + userName + ', this track has diplomatic immunity! The people have voted to protect it from your gong. 🛡️', channel);
      return;
    }

    const randomMessage = gongMessages[Math.floor(Math.random() * gongMessages.length)];
    logger.info('gongMessage: ' + randomMessage);

    if (!(userName in gongScore)) {
      gongScore[userName] = 0;
    }

    if (gongScore[userName] >= gongLimitPerUser) {
      await sendMessage('🚫 Hold up, ' + userName + '! You\'ve already gonged this track. One gong per person! 🔔', channel);
    } else {
      if (userName in voteImmuneScore) {
        await sendMessage("💭 Having regrets, " + userName + "? We're glad you came to your senses... Crisis averted! 😅", channel);
      }

      gongScore[userName] += 1;
      gongCounter++;
      await sendMessage(
        randomMessage + ' This is GONG ' + gongCounter + '/' + gongLimit + ' for ' + '*' + current.title + '*',
        channel
      );
      
      if (gongCounter >= gongLimit) {
        await sendMessage('🔔💥 *THE PEOPLE HAVE SPOKEN!* This track has been GONGED into oblivion! ☠️', channel);
        
        // Ban the track and reset
        banTrackFromGong(current);
        gongCounter = 0;
        gongScore = {};
        
        // Callback to handle playback (skip to next)
        if (onGongSuccess) {
          await onGongSuccess(current.title);
        }
      }
    }
  } catch (err) {
    logger.error('Error in gong: ' + err);
  }
}

/**
 * Check current gong status
 * @param {string} channel - Channel ID
 */
async function gongcheck(channel) {
  logger.info('_gongcheck...');
  
  try {
    const trackRef = await getCurrentTrackTitle();
    const current = _normalizeTrackRef(trackRef);
    if (!current.title) {
      await sendMessage('🤷 Nothing is currently playing.', channel);
      return;
    }
    
    const gongLeft = gongLimit - gongCounter;
    let message = 'Currently ' + gongLeft + ' more votes are needed to GONG ' + '*' + current.title + '*';
    if (isTrackGongBanned(current)) {
      message = 'This track is immune to GONG. The people have spoken...';
    }
    await sendMessage(message, channel);
  } catch (err) {
    logger.error('Error in gongcheck: ' + err);
  }
}

/**
 * Reset gong state (called when track changes)
 */
function resetGongState() {
  gongCounter = 0;
  gongScore = {};
  gongTrack = '';
}

/**
 * Clear vote count for a track when it starts playing
 * @param {string} trackUri - Track URI (optional)
 * @param {string} trackTitle - Track title (optional)
 * @param {string} trackArtist - Track artist (optional)
 */
function clearVoteCountForTrack(trackRef, artist) {
  const t = _normalizeTrackRef(trackRef, artist);
  const trackKey = _trackKey(t.title, t.artist, t.uri);
  if (trackKey in trackVoteCount) {
    delete trackVoteCount[trackKey];
  }
  if (trackKey in trackVoteUsers) {
    trackVoteUsers[trackKey].clear();
  }
}

// ==========================================
// VOTE-TO-PLAY SYSTEM
// ==========================================

/**
 * Vote for a track to be played next
 * @param {Array} input - Command input array [command, trackNb, ...]
 * @param {string} channel - Channel ID
 * @param {string} userName - User who voted
 */
async function vote(input, channel, userName) {
  await logUserAction(userName, 'vote');

  const trackNb = Number(input[1]);
  const randomMessage = voteMessages[Math.floor(Math.random() * voteMessages.length)];

  try {
    const result = await sonos.getQueue();

    // The UI uses 0-based array index (#0, #1, #2, etc.)
    const item = result.items && result.items[trackNb];
    if (!item) {
      await sendMessage('🤷 That track number isn\'t in the queue. Use `list` to see available tracks! 📋', channel);
      return;
    }

    const voteTrackName = item.title;
    const voteTrackArtist = item.artist;
    const voteTrackUri = item.uri;

    // Use track key (URI or title+artist) instead of array index
    const trackKey = _trackKey(voteTrackName, voteTrackArtist, voteTrackUri);

    // Check if user has already voted for this specific track
    if (!(trackKey in trackVoteUsers)) {
      trackVoteUsers[trackKey] = new Set();
    }

    if (trackVoteUsers[trackKey].has(userName)) {
      await sendMessage('🗳️ You already voted for this track, ' + userName + '! One vote per person! 🎯', channel);
      return;
    }

    // Track vote count for this track (keyed by track key, not array index)
    if (!(trackKey in trackVoteCount)) {
      trackVoteCount[trackKey] = 0;
    }
    trackVoteCount[trackKey] += 1;
    trackVoteUsers[trackKey].add(userName);

    await sendMessage('🗳️ This is VOTE *' + trackVoteCount[trackKey] + '/' + voteLimit + '* for *' + voteTrackName + '* - Almost there! 🎵', channel);

    if (trackVoteCount[trackKey] >= voteLimit) {
      logger.info('Track ' + voteTrackName + ' has reached the vote limit.');
      await sendMessage(randomMessage, channel);

      // Reset vote tracking for this track (keyed by track key, not array index)
      // NOTE: We do NOT reset trackVoteCount here - we keep it so :star: can be displayed
      // The vote count will be cleared when the track actually starts playing
      trackVoteUsers[trackKey].clear();

      // Move track to play next in the queue
      try {
        const track = await sonos.currentTrack();
        const currentTrackPosition = Number(track.queuePosition || 0); // 1-based

        // Sonos reorderTracksInQueue uses 1-based positions
        const startingIndex = trackNb + 1; // Convert 0-based UI index to 1-based
        const numberOfTracks = 1;
        const insertBefore = currentTrackPosition > 0 ? (currentTrackPosition + 1) : 1; // Play next
        const updateId = 0;

        await sonos.reorderTracksInQueue(startingIndex, numberOfTracks, insertBefore, updateId);
        logger.info('Moved track "' + voteTrackName + '" from position ' + startingIndex + ' to play next (insertBefore: ' + insertBefore + ')');

        await sendMessage(`⭐ *${voteTrackName}* will play next!`, channel);
      } catch (err) {
        logger.error('Error moving track: ' + (err && err.message ? err.message : err));
        await sendMessage('⚠️ Vote succeeded, but I couldn\'t move the track in the queue. (This usually happens if the current playback source isn\'t the Sonos queue.)', channel);
      }
    }
  } catch (err) {
    logger.error('Error in vote: ' + err);
  }
}

/**
 * Check current vote status
 * @param {string} channel - Channel ID
 */
async function votecheck(channel) {
  logger.info('_votecheck...');
  
  if (Object.keys(trackVoteCount).length === 0) {
    await sendMessage('🤷 No tracks have been voted on yet. Be the first! Use `vote <track#>` 🎵', channel);
    return;
  }
  
  // Get current queue to match track keys to track numbers
  try {
    const result = await sonos.getQueue();
    let voteInfo = '';
    let foundAny = false;
    
    for (const trackKey in trackVoteCount) {
      const votes = trackVoteCount[trackKey];
      if (votes > 0) {
        // Try to find the track in the queue by matching URI or title+artist
        let trackInfo = '';
        for (let i = 0; i < result.items.length; i++) {
          const item = result.items[i];
          const itemKey = _trackKey(item.title, item.artist, item.uri);
          if (itemKey === trackKey) {
            trackInfo = `Track #${i}: ${item.title} by ${item.artist}`;
            break;
          }
        }
        if (!trackInfo) {
          trackInfo = `Track (key: ${trackKey.substring(0, 20)}...)`;
        }
        voteInfo += `${trackInfo}: ${votes}/${voteLimit} votes\n`;
        foundAny = true;
      }
    }
    
    if (foundAny) {
      await sendMessage(`Current vote counts:\n${voteInfo}`, channel);
    } else {
      await sendMessage('🤷 No tracks have active votes right now. Use `vote <track#>` to vote! 🎵', channel);
    }
  } catch (err) {
    logger.error('Error in votecheck: ' + err);
    await sendMessage('⚠️ Error checking vote status. Try again!', channel);
  }
}

/**
 * Check if a track has active votes
 * @param {number} trackIndex - 0-based array index of the track (for backward compatibility, but not used)
 * @param {string} trackUri - Track URI (optional)
 * @param {string} trackTitle - Track title (optional)
 * @param {string} trackArtist - Track artist (optional)
 * @returns {boolean} True if track has active votes (> 0)
 */
function hasActiveVotes(trackIndex, trackUri, trackTitle, trackArtist) {
  // Use track key (URI or title+artist) instead of array index
  const trackKey = _trackKey(trackTitle || '', trackArtist || '', trackUri || '');
  const count = trackVoteCount[trackKey] || 0;
  return count > 0;
}

// ==========================================
// VOTE IMMUNE SYSTEM
// ==========================================

/**
 * Vote to make a track immune from gong
 * @param {Array} input - Command input array [command, trackNb, ...]
 * @param {string} channel - Channel ID
 * @param {string} userName - User who voted
 */
async function voteImmune(input, channel, userName) {
  const trackNb = Number(input[1]);
  logger.info('voteImmune for track: ' + trackNb);

  try {
    const result = await sonos.getQueue();
    let trackFound = false;
    let voteTrackName = null;
    let voteTrackArtist = null;
    let voteTrackUri = null;

    const item = result.items && result.items[trackNb];
    if (item) {
      voteTrackName = item.title;
      voteTrackArtist = item.artist;
      voteTrackUri = item.uri;
      trackFound = true;
    }

    if (!trackFound) {
      await sendMessage('🤔 Track not found in the queue. Check `list` to see what\'s playing! 📋', channel);
      return;
    }

    if (!(userName in voteImmuneScore)) {
      voteImmuneScore[userName] = 0;
    }

    if (voteImmuneScore[userName] >= voteImmuneLimitPerUser) {
      await sendMessage('🚫 Stop right there, ' + userName + '! You\'ve already voted for immunity. One vote per person! 🛡️', channel);
      return;
    }

    if (!(trackNb in voteImmuneUsers)) {
      voteImmuneUsers[trackNb] = new Set();
    }

    if (voteImmuneUsers[trackNb].has(userName)) {
      await sendMessage('🗳️ You\'ve already cast your immunity vote for this track, ' + userName + '! 🛡️', channel);
      return;
    }

    voteImmuneScore[userName] += 1;
    voteImmuneCounter++;
    voteImmuneUsers[trackNb].add(userName);

    await sendMessage('🛡️ This is IMMUNITY VOTE *' + voteImmuneCounter + '/' + voteImmuneLimit + '* for *' + voteTrackName + '* - Keep voting for immunity! 🛡️', channel);
    
    if (voteImmuneCounter >= voteImmuneLimit) {
      await sendMessage('🛡️ *IMMUNITY GRANTED!* This track is now protected from the gong hammer... for this playthrough! 🔨❌', channel);
      voteImmuneCounter = 0;
      voteImmuneScore = {};
      voteImmuneUsers[trackNb].clear();
      banTrackFromGong({ title: voteTrackName, artist: voteTrackArtist, uri: voteTrackUri });
    }
  } catch (err) {
    logger.error('Error in voteImmune: ' + err);
  }
}

/**
 * Check vote immune status
 * @param {string} channel - Channel ID
 */
async function voteImmunecheck(channel) {
  logger.info('_voteImmunecheck...');
  await sendMessage('🛡️ Currently there are *' + voteImmuneCounter + ' votes* of *' + voteImmuneLimit + '* needed to grant a song immunity from GONG! 🔔', channel);
  await listImmune(channel);
}

/**
 * List all immune tracks
 * @param {string} channel - Channel ID
 */
async function listImmune(channel) {
  const immuneTracks = getImmuneTracks();
  if (immuneTracks.length === 0) {
    await sendMessage('🤷 No tracks are currently immune. Everything is fair game for the gong! 🔔', channel);
  } else {
    const lines = immuneTracks.map(t => {
      const title = t && t.title ? t.title : '(unknown)';
      const artist = t && t.artist ? t.artist : '';
      return artist ? `${title} — ${artist}` : title;
    });
    const message = 'Immune Tracks:\n' + lines.join('\n');
    await sendMessage(message, channel);
  }
}

// ==========================================
// FLUSH VOTE SYSTEM
// ==========================================

/**
 * Vote to flush the entire queue
 * @param {string} channel - Channel ID
 * @param {string} userName - User who voted
 */
async function flushvote(channel, userName) {
  await logUserAction(userName, 'flushvote');
  logger.info('_flushvote...');

  if (!(userName in flushVoteScore)) {
    flushVoteScore[userName] = 0;
  }

  if (flushVoteScore[userName] >= flushVoteLimitPerUser) {
    await sendMessage('🚫 Whoa there, ' + userName + '! You\'ve already cast your flush vote. No cheating! 😏', channel);
    return;
  }

  flushVoteScore[userName] += 1;
  flushVoteCounter++;
  logger.info('flushVoteCounter: ' + flushVoteCounter);

  if (flushVoteCounter === 1) {
    // Start the timer on the first vote
    const currentVoteTimeLimit = voteTimeLimitMinutes * 60 * 1000;
    voteTimer = setTimeout(() => {
      flushVoteCounter = 0;
      flushVoteScore = {};
      sendMessage('⏰ Voting period for flush has ended. Votes reset! Start fresh if you want to flush. 🔄', channel);
      logger.info('Voting period ended... Guess the playlist isn´t that bad after all!!');
    }, currentVoteTimeLimit);
    
    await sendMessage(
      "Voting period started for a flush of the queue... You have *" +
      voteTimeLimitMinutes +
      " minutes* to gather *" +
      flushVoteLimit +
      " votes*!!",
      channel
    );
    logger.info('Voting period started!!');
  }

  await sendMessage(
    'This is VOTE ' + '*' + flushVoteCounter + '*' + '/' + flushVoteLimit + ' for a full flush of the playlist!!',
    channel
  );

  if (flushVoteCounter >= flushVoteLimit) {
    clearTimeout(voteTimer);
    await sendMessage('🚽🚽🚽 *DEMOCRACY IN ACTION!* The votes have spoken - flushing the queue! 🚽🎵', channel);
    
    try {
      await sonos.flush();
    } catch (error) {
      logger.error('Error flushing the queue: ' + error);
    }
    
    flushVoteCounter = 0;
    flushVoteScore = {};
  }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Initialization
  initialize,
  setConfig,
  getConfig,
  
  // Gong system
  gong,
  gongcheck,
  isTrackGongBanned,
  banTrackFromGong,
  getImmuneTracks,
  resetGongState,
  
  // Vote-to-play
  vote,
  votecheck,
  hasActiveVotes,
  clearVoteCountForTrack,
  
  // Vote immune
  voteImmune,
  voteImmunecheck,
  listImmune,
  
  // Flush vote
  flushvote
};
