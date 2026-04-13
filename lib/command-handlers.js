/**
 * Command Handlers Module
 * Handles playback, queue, volume, and search commands
 * 
 * Uses dependency injection for testability
 * @module command-handlers
 */

const queueUtils = require('./queue-utils');

// ==========================================
// DEPENDENCIES (injected via initialize)
// ==========================================

let sonos = null;
let spotify = null;
let logger = null;
let sendMessage = async () => {};
let logUserAction = async () => {};
let getConfig = () => ({});
let voting = null;
let soundcraft = null;

/**
 * Initialize the command handlers with dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Winston logger instance (required)
 * @param {Object} deps.sonos - Sonos device instance (required)
 * @param {Object} deps.spotify - Spotify API wrapper (optional)
 * @param {Function} deps.sendMessage - Message sending function (required)
 * @param {Function} deps.logUserAction - User action logging function (optional)
 * @param {Function} deps.getConfig - Config getter function (optional)
 * @param {Object} deps.voting - Voting module instance (optional)
 * @param {Object} deps.soundcraft - Soundcraft handler (optional)
 */
function initialize(deps) {
  if (!deps.logger) {
    throw new Error('Command handlers require a logger to be injected');
  }
  if (!deps.sonos) {
    throw new Error('Command handlers require sonos to be injected');
  }
  if (!deps.sendMessage) {
    throw new Error('Command handlers require sendMessage to be injected');
  }

  logger = deps.logger;
  sonos = deps.sonos;
  spotify = deps.spotify || null;
  sendMessage = deps.sendMessage;
  logUserAction = deps.logUserAction || (async () => {});
  getConfig = deps.getConfig || (() => ({}));
  voting = deps.voting || null;
  soundcraft = deps.soundcraft || { isEnabled: () => false };

  logger.info('✅ Command handlers initialized');
}

// ==========================================
// PLAYBACK COMMANDS
// ==========================================

/**
 * Stop playback
 */
function stop(input, channel, userName) {
  logUserAction(userName, 'stop');
  sonos
    .stop()
    .then(() => {
      sendMessage('⏹️ *Silence falls...* Playback stopped. 🔇', channel);
    })
    .catch((err) => {
      logger.error('Error stopping playback: ' + err);
    });
}

/**
 * Start playback
 */
function play(input, channel, userName) {
  logUserAction(userName, 'play');
  sonos
    .play()
    .then(() => {
      sendMessage('▶️ Let\'s gooo! Music is flowing! 🎶', channel);
    })
    .catch((err) => {
      logger.error('Error starting playback: ' + err);
    });
}

/**
 * Pause playback
 */
function pause(input, channel, userName) {
  logUserAction(userName, 'pause');
  sonos
    .pause()
    .then(() => {
      sendMessage('⏸️ Taking a breather... Paused! 💨', channel);
    })
    .catch((err) => {
      logger.error('Error pausing playback: ' + err);
    });
}

/**
 * Resume playback (alias for play)
 */
function resume(input, channel, userName) {
  logUserAction(userName, 'resume');
  sonos
    .play()
    .then(() => {
      sendMessage('▶️ Back to the groove! Resuming playback... 🎵', channel);
    })
    .catch((err) => {
      logger.error('Error resuming playback: ' + err);
    });
}

/**
 * Flush/clear the queue
 */
function flush(input, channel, userName) {
  logUserAction(userName, 'flush');
  sonos
    .flush()
    .then(() => {
      sendMessage('🚽 *FLUSHED!* The queue has been wiped clean. Time to start fresh! 🎶', channel);
    })
    .catch((err) => {
      logger.error('Error flushing queue: ' + err);
    });
}

/**
 * Enable shuffle mode
 */
function shuffle(input, channel, userName) {
  logUserAction(userName, 'shuffle');
  sonos
    .setPlayMode('SHUFFLE')
    .then(() => {
      sendMessage('🎲 *Shuffle mode activated!* Queue randomized - let chaos reign! 🎵🔀', channel);
    })
    .catch((err) => {
      logger.error('Error setting play mode to shuffle: ' + err);
    });
}

/**
 * Set normal (non-shuffle) play mode
 */
function normal(input, channel, userName) {
  logUserAction(userName, 'normal');
  sonos
    .setPlayMode('NORMAL')
    .then(() => {
      sendMessage('📋 Back to normal! Queue is now in the order you actually wanted. ✅', channel);
    })
    .catch((err) => {
      logger.error('Error setting play mode to normal: ' + err);
    });
}

/**
 * Skip to next track
 */
function nextTrack(channel, userName) {
  logUserAction(userName, 'next');
  sonos
    .next()
    .then(() => {
      sendMessage('⏭️ Skipped! On to the next banger... 🎵', channel);
    })
    .catch((err) => {
      logger.error('Error skipping to next track: ' + err);
    });
}

/**
 * Go to previous track
 */
function previous(input, channel, userName) {
  logUserAction(userName, 'previous');
  sonos
    .previous()
    .then(() => {
      sendMessage('⏮️ Going back in time! Previous track loading... 🕙', channel);
    })
    .catch((err) => {
      logger.error('Error going to previous track: ' + err);
    });
}

// ==========================================
// QUEUE COMMANDS
// ==========================================

/**
 * Remove a track from the queue
 */
function removeTrack(input, channel) {
  if (!input || input.length < 2) {
    sendMessage('🔢 You must provide the track number to remove! Use `remove <number>` 🎯', channel);
    return;
  }
  const trackNb = parseInt(input[1]) + 1;  // +1 because Sonos uses 1-based indexing
  if (isNaN(trackNb)) {
    sendMessage('🤔 That\'s not a valid track number. Check the queue with `list`! 📋', channel);
    return;
  }
  sonos
    .removeTracksFromQueue(trackNb, 1)
    .then(() => {
      logger.info('Removed track with index: ' + trackNb);
      sendMessage(`🗑️ Track #${input[1]} has been yeeted from the queue! 🚀`, channel);
    })
    .catch((err) => {
      logger.error('Error removing track from queue: ' + err);
      sendMessage('🚨 Error removing track from queue. Try again! 🔄', channel);
    });
}

/**
 * Remove half the queue (Thanos snap)
 */
function purgeHalfQueue(input, channel) {
  sonos
    .getQueue()
    .then((result) => {
      const halfQueue = Math.floor(result.total / 2);
      if (halfQueue === 0) {
        sendMessage('🤷 The queue is too tiny to snap! Thanos needs at least 2 tracks to work his magic. 👏', channel);
        return;
      }
      sonos
        .removeTracksFromQueue(halfQueue, halfQueue)
        .then(() => {
          sendMessage(`👏 *SNAP!* Perfectly balanced, as all things should be. ${halfQueue} tracks turned to dust. ✨💨`, channel);
        })
        .catch((err) => {
          logger.error('Error removing tracks from queue: ' + err);
          sendMessage('💥 Error executing the snap. Even Thanos has off days... Try again! 🔄', channel);
        });
    })
    .catch((err) => {
      logger.error('Error getting queue for snap: ' + err);
      sendMessage('🚨 Error getting queue for the snap. Try again! 🔄', channel);
    });
}

/**
 * Show the current queue
 */
async function showQueue(channel) {
  try {
    // Parallelize all Sonos API calls for better performance
    const [result, state] = await Promise.all([
      sonos.getQueue(),
      sonos.getCurrentState()
    ]);

    // Get current track if playing
    let track = null;

    if (state === 'playing') {
      track = await sonos.currentTrack().catch(trackErr => {
        logger.warn('Could not get current track: ' + trackErr.message);
        return null;
      });
    }

    // Simple check: track.queuePosition > 0 means playing from queue
    const isFromQueue = track && track.queuePosition > 0;

    if (!result || !result.items || result.items.length === 0) {
      logger.debug('Queue is empty');
      let emptyMsg = '🦗 *Crickets...* The queue is empty! Try `add <song>` to get started! 🎵';
      if (state === 'playing' && !isFromQueue) {
        emptyMsg += '\n⚠️ Note: Currently playing from external source (not queue). Run `stop` to switch to queue.';
      }

      sendMessage(emptyMsg, channel);
      return;
    }

    // Build queue list
    let message = `*📋 Current Queue (${result.items.length} tracks):*\n`;

    result.items.forEach((item, index) => {
      const position = index + 1;
      const isCurrentTrack = isFromQueue && track && track.queuePosition === position;
      const prefix = isCurrentTrack ? '▶️ ' : `${position}. `;
      message += `${prefix}*${item.title}* by _${item.artist}_\n`;
    });

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error showing queue: ' + err);
    sendMessage('🚨 Error getting queue. Try again! 🔄', channel);
  }
}

/**
 * Show the next N tracks in the queue
 */
async function upNext(channel) {
  try {
    const [result, state, track] = await Promise.all([
      sonos.getQueue(),
      sonos.getCurrentState(),
      sonos.currentTrack().catch(() => null)
    ]);

    if (!result || !result.items || result.items.length === 0) {
      sendMessage('🦗 *Crickets...* The queue is empty! Try `add <song>` to get started! 🎵', channel);
      return;
    }

    const currentPosition = (track && track.queuePosition > 0) ? track.queuePosition : 0;
    const nextTracks = result.items.slice(currentPosition, currentPosition + 5);

    if (nextTracks.length === 0) {
      sendMessage('🎵 No more tracks coming up! Add some with `add <song>`! 🎶', channel);
      return;
    }

    let message = '*⏭️ Up Next:*\n';
    nextTracks.forEach((item, index) => {
      message += `${index + 1}. *${item.title}* by _${item.artist}_\n`;
    });

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error getting up next: ' + err);
    sendMessage('🚨 Error getting upcoming tracks. Try again! 🔄', channel);
  }
}

/**
 * Get the queue size
 */
async function queueSize(channel) {
  try {
    const result = await sonos.getQueue();
    const size = result && result.items ? result.items.length : 0;
    sendMessage(`📊 There are *${size}* tracks in the queue! 🎵`, channel);
  } catch (err) {
    logger.error('Error getting queue size: ' + err);
    sendMessage('🚨 Error getting queue size. Try again! 🔄', channel);
  }
}

// ==========================================
// VOLUME COMMANDS
// ==========================================

/**
 * Get current volume
 */
async function getVolume(channel) {
  try {
    const volume = await sonos.getVolume();
    sendMessage(`🔊 Current volume: *${volume}%* 🎵`, channel);
  } catch (err) {
    logger.error('Error getting volume: ' + err);
    sendMessage('🚨 Error getting volume. Try again! 🔄', channel);
  }
}

/**
 * Set volume
 */
async function setVolume(input, channel, userName) {
  logUserAction(userName, 'setvolume');

  const config = getConfig();
  const maxVolume = config.maxVolume || 75;

  if (!input || input.length < 2) {
    sendMessage(`🔊 Current max volume is *${maxVolume}%*. Use \`setvolume <0-${maxVolume}>\` to change it! 🎵`, channel);
    return;
  }

  // Check if Soundcraft is enabled and handle channel-specific volume
  if (soundcraft && soundcraft.isEnabled()) {
    const channelNames = soundcraft.getChannelNames();

    // Check if second argument is a channel name (not a number)
    if (input.length >= 3 && isNaN(parseInt(input[1]))) {
      const channelName = input[1];
      const volumeValue = parseInt(input[2]);

      if (isNaN(volumeValue) || volumeValue < 0 || volumeValue > 100) {
        sendMessage('🔊 Please provide a valid volume (0-100)! 🎵', channel);
        return;
      }

      const success = await soundcraft.setVolume(channelName, volumeValue);
      if (success) {
        sendMessage(`🎛️ *${channelName}* channel volume set to *${volumeValue}%*! 🎵`, channel);
      } else {
        sendMessage(`🚨 Could not find channel *${channelName}*. Available channels: ${channelNames.join(', ')}`, channel);
      }
      return;
    }
  }

  const newVolume = parseInt(input[1]);

  if (isNaN(newVolume) || newVolume < 0) {
    sendMessage('🔊 Please provide a valid volume (0-' + maxVolume + ')! 🎵', channel);
    return;
  }

  if (newVolume > maxVolume) {
    sendMessage(`🔊 Max volume is *${maxVolume}%*! I can't go higher than that! 🎵`, channel);
    return;
  }

  try {
    await sonos.setVolume(newVolume);
    sendMessage(`🔊 Volume set to *${newVolume}%*! 🎵`, channel);
  } catch (err) {
    logger.error('Error setting volume: ' + err);
    sendMessage('🚨 Error setting volume. Try again! 🔄', channel);
  }
}

// ==========================================
// INFO COMMANDS
// ==========================================

/**
 * Show current track info
 */
async function currentTrack(channel) {
  try {
    const [track, state] = await Promise.all([
      sonos.currentTrack(),
      sonos.getCurrentState()
    ]);

    if (!track || !track.title) {
      sendMessage('🤷 Nothing is currently playing! Try `add <song>` to get started! 🎵', channel);
      return;
    }

    const stateEmoji = state === 'playing' ? '▶️' : state === 'paused' ? '⏸️' : '⏹️';
    let message = `${stateEmoji} *Now Playing:*\n`;
    message += `🎵 *${track.title}*\n`;
    if (track.artist) message += `👤 _${track.artist}_\n`;
    if (track.album) message += `💿 ${track.album}\n`;

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error getting current track: ' + err);
    sendMessage('🚨 Error getting current track info. Try again! 🔄', channel);
  }
}

/**
 * Show playback status
 */
async function status(channel) {
  try {
    const [state, volume] = await Promise.all([
      sonos.getCurrentState(),
      sonos.getVolume().catch(() => null)
    ]);

    const stateEmoji = state === 'playing' ? '▶️' : state === 'paused' ? '⏸️' : '⏹️';
    let message = `${stateEmoji} *Status:* ${state}`;
    if (volume !== null) message += ` | 🔊 Volume: *${volume}%*`;

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error getting status: ' + err);
    sendMessage('🚨 Error getting status. Try again! 🔄', channel);
  }
}

// ==========================================
// SEARCH COMMANDS
// ==========================================

/**
 * Search for tracks
 */
async function search(input, channel) {
  if (!input || input.length < 2) {
    sendMessage('🔍 You gotta tell me what to search for! Use `search <song name>` 🎵', channel);
    return;
  }

  if (!spotify) {
    sendMessage('🚨 Spotify is not configured! Cannot search. 🎵', channel);
    return;
  }

  const query = input.slice(1).join(' ');
  const config = getConfig();
  const searchLimit = config.searchLimit || 7;

  try {
    const tracks = await spotify.searchTrackList(query, searchLimit);

    if (!tracks || tracks.length === 0) {
      sendMessage("🤷 Couldn't find anything matching that. Try different keywords! 🎵", channel);
      return;
    }

    let message = `*🔍 Search results for "${query}":*\n`;
    tracks.slice(0, searchLimit).forEach((track, index) => {
      message += `${index + 1}. *${track.name}* by _${track.artist}_\n`;
    });
    message += '\n_Use `add <song name>` to add a track!_';

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching tracks: ' + err);
    sendMessage('🚨 Error searching. Try again! 🔄', channel);
  }
}

/**
 * Search for albums
 */
async function searchAlbum(input, channel) {
  if (!input || input.length < 2) {
    sendMessage('🔍 You gotta tell me what album to search for! Use `searchalbum <album name>` 🎵', channel);
    return;
  }

  if (!spotify) {
    sendMessage('🚨 Spotify is not configured! Cannot search. 🎵', channel);
    return;
  }

  const query = input.slice(1).join(' ');
  const config = getConfig();
  const searchLimit = config.searchLimit || 7;

  try {
    const albums = await spotify.searchAlbumList(query, searchLimit);

    if (!albums || albums.length === 0) {
      sendMessage("🤷 Couldn't find any albums matching that. Try different keywords! 🎵", channel);
      return;
    }

    let message = `*🔍 Album search results for "${query}":*\n`;
    albums.slice(0, searchLimit).forEach((album, index) => {
      message += `${index + 1}. *${album.name}* by _${album.artist}_\n`;
    });
    message += '\n_Use `addalbum <album name>` to add an album!_';

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching albums: ' + err);
    sendMessage('🚨 Error searching albums. Try again! 🔄', channel);
  }
}

/**
 * Search for playlists
 */
async function searchPlaylist(input, channel) {
  if (!input || input.length < 2) {
    sendMessage('🔍 You gotta tell me what playlist to search for! Use `searchplaylist <playlist name>` 🎵', channel);
    return;
  }

  if (!spotify) {
    sendMessage('🚨 Spotify is not configured! Cannot search. 🎵', channel);
    return;
  }

  const query = input.slice(1).join(' ');
  const config = getConfig();
  const searchLimit = config.searchLimit || 7;

  try {
    const playlists = await spotify.searchPlaylistList(query, searchLimit);

    if (!playlists || playlists.length === 0) {
      sendMessage("🤷 Couldn't find any playlists matching that. Try different keywords! 🎵", channel);
      return;
    }

    let message = `*🔍 Playlist search results for "${query}":*\n`;
    playlists.slice(0, searchLimit).forEach((playlist, index) => {
      message += `${index + 1}. *${playlist.name}* by _${playlist.owner}_\n`;
    });
    message += '\n_Use `addplaylist <playlist name>` to add a playlist!_';

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching playlists: ' + err);
    sendMessage('🚨 Error searching playlists. Try again! 🔄', channel);
  }
}

// ==========================================
// MOVE COMMAND
// ==========================================

/**
 * Move a track in the queue
 */
async function moveTrack(input, channel) {
  if (!input || input.length < 3) {
    sendMessage('🔢 Use `move <from> <to>` to move a track! 🎯', channel);
    return;
  }

  const from = parseInt(input[1]);
  const to = parseInt(input[2]);

  if (isNaN(from) || isNaN(to)) {
    sendMessage('🤔 Please provide valid track numbers! 📋', channel);
    return;
  }

  try {
    const result = await sonos.getQueue();
    if (!result || !result.items) {
      sendMessage('🦗 The queue is empty! 🎵', channel);
      return;
    }

    const queueLength = result.items.length;
    if (from < 1 || from > queueLength || to < 1 || to > queueLength) {
      sendMessage(`🔢 Track positions must be between 1 and ${queueLength}! 🎯`, channel);
      return;
    }

    // Sonos uses 1-based indexing for reorderTracksInQueue
    await sonos.reorderTracksInQueue(from, 1, to);
    sendMessage(`✅ Moved track from position *${from}* to *${to}*! 🎵`, channel);
  } catch (err) {
    logger.error('Error moving track: ' + err);
    sendMessage('🚨 Error moving track. Try again! 🔄', channel);
  }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  initialize,
  // Playback
  stop,
  play,
  pause,
  resume,
  flush,
  clear: flush,  // Alias for flush (SLAC-10)
  shuffle,
  normal,
  nextTrack,
  previous,
  // Queue
  removeTrack,
  purgeHalfQueue,
  showQueue,
  upNext,
  queueSize,
  moveTrack,
  // Volume
  getVolume,
  setVolume,
  // Info
  currentTrack,
  status,
  // Search
  search,
  searchAlbum,
  searchPlaylist,
};
