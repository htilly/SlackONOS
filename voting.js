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
let gongTrack = ''; // What track was a GONG called on
const gongBannedTracks = {};

// Vote immune state
let voteImmuneCounter = 0;
const voteImmuneLimitPerUser = 1;
let voteImmuneUsers = {}; // Track users who have voted for each track for vote immune
let voteImmuneScore = {};

// Vote-to-play state
let voteCounter = 0;
const voteLimitPerUser = 4;
let voteScore = {};
let trackVoteCount = {}; // Vote count per track
let trackVoteUsers = {}; // Track users who have voted for each track

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
function isTrackGongBanned(trackName) {
  return gongBannedTracks[trackName] === true;
}

/**
 * Ban a track from being gonged
 * @param {string} trackName - Track name to ban
 */
function banTrackFromGong(trackName) {
  gongBannedTracks[trackName] = true;
}

/**
 * Get list of immune tracks
 * @returns {string[]}
 */
function getImmuneTracks() {
  return Object.keys(gongBannedTracks);
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
    const track = await getCurrentTrackTitle();
    if (!track) {
      await sendMessage('🤷 Nothing is currently playing to gong!', channel);
      return;
    }
    
    logger.info('_gong > track: ' + track);
    
    // Reset gong state if track changed
    if (track !== gongTrack) {
      logger.info('Track changed from "' + gongTrack + '" to "' + track + '", resetting gong state');
      gongCounter = 0;
      gongScore = {};
      gongTrack = track;
    }

    if (isTrackGongBanned(track)) {
      logger.info('Track is gongBanned: ' + track);
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
        randomMessage + ' This is GONG ' + gongCounter + '/' + gongLimit + ' for ' + '*' + track + '*',
        channel
      );
      
      if (gongCounter >= gongLimit) {
        await sendMessage('🔔💥 *THE PEOPLE HAVE SPOKEN!* This track has been GONGED into oblivion! ☠️', channel);
        
        // Ban the track and reset
        banTrackFromGong(track);
        gongCounter = 0;
        gongScore = {};
        
        // Callback to handle playback (skip to next)
        if (onGongSuccess) {
          await onGongSuccess(track);
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
    const track = await getCurrentTrackTitle();
    if (!track) {
      await sendMessage('🤷 Nothing is currently playing.', channel);
      return;
    }
    
    const gongLeft = gongLimit - gongCounter;
    let message = 'Currently ' + gongLeft + ' more votes are needed to GONG ' + '*' + track + '*';
    if (isTrackGongBanned(track)) {
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
    let trackFound = false;
    let voteTrackName = null;

    for (const item of result.items) {
      const queueTrack = parseInt(item.id.split('/')[1]) - 1;
      if (trackNb === queueTrack) {
        voteTrackName = item.title;
        trackFound = true;
        break;
      }
    }

    if (!trackFound) {
      await sendMessage('🤷 That track number isn\'t in the queue. Use `list` to see available tracks! 📋', channel);
      return;
    }

    if (!(userName in voteScore)) {
      voteScore[userName] = 0;
    }

    if (voteScore[userName] >= voteLimitPerUser) {
      await sendMessage('🚫 Nice try, ' + userName + '! You\'ve already voted for this track. Patience! 🎵', channel);
      return;
    }

    if (!(trackNb in trackVoteUsers)) {
      trackVoteUsers[trackNb] = new Set();
    }

    if (trackVoteUsers[trackNb].has(userName)) {
      await sendMessage('🗳️ You already voted for this track, ' + userName + '! One vote per person! 🎯', channel);
      return;
    }

    voteScore[userName] += 1;
    voteCounter++;
    trackVoteUsers[trackNb].add(userName);

    if (!(trackNb in trackVoteCount)) {
      trackVoteCount[trackNb] = 0;
    }
    trackVoteCount[trackNb] += 1;

    await sendMessage('🗳️ This is VOTE *' + trackVoteCount[trackNb] + '/' + voteLimit + '* for *' + voteTrackName + '* - Almost there! 🎵', channel);
    
    if (trackVoteCount[trackNb] >= voteLimit) {
      logger.info('Track ' + voteTrackName + ' has reached the vote limit.');
      await sendMessage(randomMessage, channel);

      voteCounter = 0;
      voteScore = {};
      trackVoteUsers[trackNb].clear();

      // Move track to next position
      try {
        const track = await sonos.currentTrack();
        const currentTrackPosition = track.queuePosition;
        const startingIndex = trackNb;
        const numberOfTracks = 1;
        const insertBefore = currentTrackPosition + 1;
        const updateId = 0;

        await sonos.reorderTracksInQueue(startingIndex, numberOfTracks, insertBefore, updateId);
        logger.info('Moved track to position: ' + insertBefore);
        
        // Grant immunity to the voted track
        banTrackFromGong(voteTrackName);
      } catch (err) {
        logger.error('Error moving track: ' + err);
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
  
  let voteInfo = '';
  for (const trackNb in trackVoteCount) {
    const votes = trackVoteCount[trackNb];
    voteInfo += `Track #${trackNb}: ${votes}/${voteLimit} votes\n`;
  }
  await sendMessage(`Current vote counts:\n${voteInfo}`, channel);
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

    for (const item of result.items) {
      const queueTrack = parseInt(item.id.split('/')[1]) - 1;
      if (trackNb === queueTrack) {
        voteTrackName = item.title;
        trackFound = true;
        break;
      }
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

    await sendMessage('🗳️ This is VOTE *' + voteImmuneCounter + '/' + voteImmuneLimit + '* for *' + voteTrackName + '* - Keep voting for immunity! 🛡️', channel);
    
    if (voteImmuneCounter >= voteImmuneLimit) {
      await sendMessage('🛡️ *IMMUNITY GRANTED!* This track is now protected from the gong hammer... for this playthrough! 🔨❌', channel);
      voteImmuneCounter = 0;
      voteImmuneScore = {};
      voteImmuneUsers[trackNb].clear();
      banTrackFromGong(voteTrackName);
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
    const message = 'Immune Tracks:\n' + immuneTracks.join('\n');
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
  
  // Vote immune
  voteImmune,
  voteImmunecheck,
  listImmune,
  
  // Flush vote
  flushvote
};
