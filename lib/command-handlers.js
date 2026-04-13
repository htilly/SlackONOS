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

    logger.debug('Queue result: ' + JSON.stringify(result));

    let message = `📋 *Current Queue* (${result.items.length} tracks):\n`;

    // Mark the currently playing track
    result.items.forEach((item, index) => {
      const position = index + 1;
      const isCurrentTrack = isFromQueue && track && track.queuePosition === position;
      const prefix = isCurrentTrack ? '▶️ ' : `${position}. `;
      message += `${prefix}*${item.title}* by _${item.artist}_\n`;
    });

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error getting queue: ' + err);
    sendMessage('🚨 Error getting queue. Try again! 🔄', channel);
  }
}

/**
 * Show the next N tracks in the queue
 */
async function upNext(channel) {
  try {
    const [result, track] = await Promise.all([
      sonos.getQueue(),
      sonos.currentTrack().catch(() => null)
    ]);

    if (!result || !result.items || result.items.length === 0) {
      sendMessage('🦗 *Crickets...* The queue is empty! Try `add <song>` to get started! 🎵', channel);
      return;
    }

    const currentPosition = (track && track.queuePosition) ? track.queuePosition : 0;
    const nextTracks = result.items.slice(currentPosition, currentPosition + 5);

    if (nextTracks.length === 0) {
      sendMessage('🎵 No more tracks coming up! Add some with `add <song>`! 🎶', channel);
      return;
    }

    let message = '⏭️ *Up Next:*\n';
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
 * Move a track in the queue
 */
async function moveTrack(input, channel) {
  if (!input || input.length < 3) {
    sendMessage('📍 Usage: `move <from> <to>` — Move a track from one position to another! 🎯', channel);
    return;
  }

  const from = parseInt(input[1]);
  const to = parseInt(input[2]);

  if (isNaN(from) || isNaN(to)) {
    sendMessage('🤔 Both positions must be numbers! Check the queue with `list`! 📋', channel);
    return;
  }

  try {
    const queue = await sonos.getQueue();
    if (!queue || !queue.items) {
      sendMessage('🦗 The queue is empty! Nothing to move. 🎵', channel);
      return;
    }

    const queueLength = queue.items.length;
    if (from < 1 || from > queueLength || to < 1 || to > queueLength) {
      sendMessage(`🔢 Position must be between 1 and ${queueLength}! Check the queue with \`list\`! 📋`, channel);
      return;
    }

    const trackToMove = queue.items[from - 1];

    // Sonos reorderTracksInQueue uses 1-based indexing
    await sonos.reorderTracksInQueue(from, 1, to);

    sendMessage(`🔀 Moved *${trackToMove.title}* from position ${from} to ${to}! 🎵`, channel);
  } catch (err) {
    logger.error('Error moving track: ' + err);
    sendMessage('🚨 Error moving track. Try again! 🔄', channel);
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
    sendMessage(`🔊 Current volume: *${volume}*`, channel);
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

  // Check if soundcraft is enabled and handle channel-specific volume
  if (soundcraft && soundcraft.isEnabled()) {
    // Check if this is a channel-specific volume command: setvolume <channel> <volume>
    if (input.length >= 3) {
      const channelName = input[1];
      const volumeValue = parseInt(input[2]);

      if (!isNaN(volumeValue)) {
        try {
          const success = await soundcraft.setVolume(channelName, volumeValue);
          if (success) {
            sendMessage(`🎚️ Set *${channelName}* channel volume to *${volumeValue}*! 🎵`, channel);
          } else {
            sendMessage(`🤔 Channel *${channelName}* not found. Use \`list\` to see available channels! 📋`, channel);
          }
          return;
        } catch (err) {
          logger.error('Error setting soundcraft volume: ' + err);
          sendMessage('🚨 Error setting channel volume. Try again! 🔄', channel);
          return;
        }
      }
    }
  }

  if (!input || input.length < 2) {
    sendMessage('🔊 You must provide a volume level! Use `setvolume <0-100>` 🎯', channel);
    return;
  }

  const volume = parseInt(input[1]);
  if (isNaN(volume) || volume < 0 || volume > 100) {
    sendMessage('🤔 Volume must be between 0 and 100! 🔊', channel);
    return;
  }

  const config = getConfig();
  const maxVolume = parseInt((config.get ? config.get('maxVolume') : config.maxVolume) || 100);

  if (volume > maxVolume) {
    sendMessage(`🔊 Max volume is *${maxVolume}*! Can't go higher than that. 🎵`, channel);
    return;
  }

  try {
    await sonos.setVolume(volume);
    sendMessage(`🔊 Volume set to *${volume}*! 🎵`, channel);
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
      sendMessage('🤷 Nothing is playing right now! Use `add <song>` to get started! 🎵', channel);
      return;
    }

    const stateEmoji = state === 'playing' ? '▶️' : state === 'paused' ? '⏸️' : '⏹️';
    const duration = track.duration ? formatDuration(track.duration) : 'Unknown';
    const position = track.position ? formatDuration(track.position) : '0:00';

    let message = `${stateEmoji} *Now Playing:*\n`;
    message += `🎵 *${track.title}*\n`;
    message += `👤 _${track.artist}_\n`;
    message += `💿 ${track.album || 'Unknown Album'}\n`;
    message += `⏱️ ${position} / ${duration}`;

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error getting current track: ' + err);
    sendMessage('🚨 Error getting current track info. Try again! 🔄', channel);
  }
}

/**
 * Format duration in seconds to MM:SS
 */
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get queue size
 */
async function queueSize(channel) {
  try {
    const result = await sonos.getQueue();
    const count = result && result.total ? result.total : 0;
    if (count === 0) {
      sendMessage('🦗 The queue is empty! Add some tracks with `add <song>`! 🎵', channel);
    } else {
      sendMessage(`📊 There ${count === 1 ? 'is' : 'are'} *${count}* track${count === 1 ? '' : 's'} in the queue! 🎵`, channel);
    }
  } catch (err) {
    logger.error('Error getting queue size: ' + err);
    sendMessage('🚨 Error getting queue size. Try again! 🔄', channel);
  }
}

/**
 * Get playback status
 */
async function getStatus(channel) {
  try {
    const state = await sonos.getCurrentState();
    const stateEmoji = state === 'playing' ? '▶️' : state === 'paused' ? '⏸️' : '⏹️';
    const stateText = state === 'playing' ? 'Playing' : state === 'paused' ? 'Paused' : 'Stopped';
    sendMessage(`${stateEmoji} Status: *${stateText}*`, channel);
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
async function searchTrack(input, channel) {
  if (!input || input.length < 2) {
    sendMessage('🔍 You must provide a search term! Use `search <song name>` 🎵', channel);
    return;
  }

  if (!spotify) {
    sendMessage('🤷 Spotify is not configured! Ask your admin to set it up. 🎵', channel);
    return;
  }

  const query = input.slice(1).join(' ');
  const config = getConfig();
  const searchLimit = parseInt((config.get ? config.get('searchLimit') : config.searchLimit) || 7);

  try {
    const tracks = await spotify.searchTrackList(query, searchLimit);
    if (!tracks || tracks.length === 0) {
      sendMessage("🤷 Couldn't find anything matching that. Try different keywords! 🎵", channel);
      return;
    }

    let message = `🔍 *Search results for "${query}":*\n`;
    tracks.forEach((track, index) => {
      message += `${index + 1}. *${track.name}* by _${track.artist}_\n`;
    });
    message += '\nUse `add <song name>` to add a track! 🎵';

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
    sendMessage('🔍 You must provide a search term! Use `searchalbum <album name>` 🎵', channel);
    return;
  }

  if (!spotify) {
    sendMessage('🤷 Spotify is not configured! Ask your admin to set it up. 🎵', channel);
    return;
  }

  const query = input.slice(1).join(' ');
  const config = getConfig();
  const searchLimit = parseInt((config.get ? config.get('searchLimit') : config.searchLimit) || 7);

  try {
    const albums = await spotify.searchAlbumList(query, searchLimit);
    if (!albums || albums.length === 0) {
      sendMessage("🤷 Couldn't find any albums matching that. Try different keywords! 🎵", channel);
      return;
    }

    let message = `🔍 *Album search results for "${query}":*\n`;
    albums.forEach((album, index) => {
      message += `${index + 1}. *${album.name}* by _${album.artist}_\n`;
    });
    message += '\nUse `addalbum <album name>` to add an album! 🎵';

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
    sendMessage('🔍 You must provide a search term! Use `searchplaylist <playlist name>` 🎵', channel);
    return;
  }

  if (!spotify) {
    sendMessage('🤷 Spotify is not configured! Ask your admin to set it up. 🎵', channel);
    return;
  }

  const query = input.slice(1).join(' ');
  const config = getConfig();
  const searchLimit = parseInt((config.get ? config.get('searchLimit') : config.searchLimit) || 7);

  try {
    const playlists = await spotify.searchPlaylistList(query, searchLimit);
    if (!playlists || playlists.length === 0) {
      sendMessage("🤷 Couldn't find any playlists matching that. Try different keywords! 🎵", channel);
      return;
    }

    let message = `🔍 *Playlist search results for "${query}":*\n`;
    playlists.forEach((playlist, index) => {
      message += `${index + 1}. *${playlist.name}* by _${playlist.owner}_\n`;
    });
    message += '\nUse `addplaylist <playlist name>` to add a playlist! 🎵';

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching playlists: ' + err);
    sendMessage('🚨 Error searching playlists. Try again! 🔄', channel);
  }
}

// ==========================================
// MODULE EXPORTS
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
  moveTrack,
  // Volume
  getVolume,
  setVolume,
  // Info
  currentTrack,
  queueSize,
  getStatus,
  // Search
  searchTrack,
  searchAlbum,
  searchPlaylist,
};
