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
    let message = `*📋 Current Queue* (${result.items.length} tracks):\n`;

    result.items.forEach((item, index) => {
      const position = index + 1;
      const isCurrentTrack = isFromQueue && track && track.queuePosition === position;
      const prefix = isCurrentTrack ? '▶️ ' : `${position}. `;
      message += `${prefix}*${item.title}* by _${item.artist}_\n`;
    });

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error showing queue: ' + err);
    sendMessage('🚨 Error getting the queue. Try again! 🔄', channel);
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
      sendMessage('🎵 No more tracks coming up! Add some with `add <song>` 🎶', channel);
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
 * Get the size of the queue
 */
async function queueSize(channel) {
  try {
    const result = await sonos.getQueue();
    const size = (result && result.total) ? result.total : 0;

    if (size === 0) {
      sendMessage('🦗 The queue is empty! Add some tracks with `add <song>` 🎵', channel);
    } else {
      sendMessage(`📊 There ${size === 1 ? 'is' : 'are'} *${size}* ${size === 1 ? 'track' : 'tracks'} in the queue! 🎶`, channel);
    }
  } catch (err) {
    logger.error('Error getting queue size: ' + err);
    sendMessage('🚨 Error getting queue size. Try again! 🔄', channel);
  }
}

// ==========================================
// VOLUME COMMANDS
// ==========================================

/**
 * Get or set the volume
 */
async function volume(input, channel, userName) {
  if (!input || input.length < 2) {
    // Get current volume
    try {
      const vol = await sonos.getVolume();
      sendMessage(`🔊 Current volume: *${vol}%* 🎵`, channel);
    } catch (err) {
      logger.error('Error getting volume: ' + err);
      sendMessage('🚨 Error getting volume. Try again! 🔄', channel);
    }
    return;
  }

  // Set volume
  logUserAction(userName, 'volume');
  const newVolume = parseInt(input[1]);
  if (isNaN(newVolume) || newVolume < 0 || newVolume > 100) {
    sendMessage('🔢 Volume must be a number between 0 and 100! 🎯', channel);
    return;
  }

  const config = getConfig();
  const maxVolume = parseInt((config.get ? config.get('maxVolume') : config.maxVolume) || 100);

  if (newVolume > maxVolume) {
    sendMessage(`🔊 Max volume is *${maxVolume}%*! I'm keeping it at that. 🎵`, channel);
    try {
      await sonos.setVolume(maxVolume);
    } catch (err) {
      logger.error('Error setting volume: ' + err);
    }
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
 * Show what's currently playing
 */
async function current(channel) {
  try {
    const [track, state] = await Promise.all([
      sonos.currentTrack(),
      sonos.getCurrentState()
    ]);

    if (!track || !track.title) {
      sendMessage('🦗 Nothing is playing right now! Try `add <song>` to get started! 🎵', channel);
      return;
    }

    const stateEmoji = state === 'playing' ? '▶️' : state === 'paused' ? '⏸️' : '⏹️';
    let message = `${stateEmoji} *Now Playing:*\n`;
    message += `🎵 *${track.title}*\n`;
    message += `👤 _${track.artist}_\n`;

    if (track.duration && track.position) {
      const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };
      message += `⏱️ ${formatTime(track.position)} / ${formatTime(track.duration)}`;
    }

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error getting current track: ' + err);
    sendMessage('🚨 Error getting current track info. Try again! 🔄', channel);
  }
}

/**
 * Get the current playback status
 */
async function status(channel) {
  try {
    const state = await sonos.getCurrentState();
    const stateMessages = {
      'playing': '▶️ *Playing* — Music is flowing! 🎶',
      'paused': '⏸️ *Paused* — Taking a breather. 💨',
      'stopped': '⏹️ *Stopped* — Silence reigns. 🔇',
      'transitioning': '⏳ *Transitioning* — Hold on... 🔄'
    };
    const message = stateMessages[state] || `❓ *Status:* ${state}`;
    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error getting status: ' + err);
    sendMessage('🚨 Error getting playback status. Try again! 🔄', channel);
  }
}

// ==========================================
// SEARCH COMMANDS
// ==========================================

/**
 * Search for tracks on Spotify
 */
async function search(input, channel) {
  if (!input || input.length < 2) {
    sendMessage('🔍 You gotta tell me what to search for! Use `search <song name>` 🎵', channel);
    return;
  }

  if (!spotify) {
    sendMessage('🚫 Spotify is not configured. Cannot search! 🎵', channel);
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

    let message = `*🔍 Search results for "${query}":*\n`;
    tracks.forEach((track, index) => {
      message += `${index + 1}. *${track.name}* by _${track.artist}_\n`;
    });
    message += '\n_Use `add <song name>` to add a track to the queue!_';

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching tracks: ' + err);
    sendMessage('🚨 Error searching Spotify. Try again! 🔄', channel);
  }
}

/**
 * Search for albums on Spotify
 */
async function searchAlbum(input, channel) {
  if (!input || input.length < 2) {
    sendMessage('🔍 You gotta tell me what album to search for! Use `searchalbum <album name>` 🎵', channel);
    return;
  }

  if (!spotify) {
    sendMessage('🚫 Spotify is not configured. Cannot search! 🎵', channel);
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

    let message = `*🔍 Album search results for "${query}":*\n`;
    albums.forEach((album, index) => {
      message += `${index + 1}. *${album.name}* by _${album.artist}_\n`;
    });
    message += '\n_Use `addalbum <album name>` to add an album to the queue!_';

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching albums: ' + err);
    sendMessage('🚨 Error searching Spotify. Try again! 🔄', channel);
  }
}

/**
 * Search for playlists on Spotify
 */
async function searchPlaylist(input, channel) {
  if (!input || input.length < 2) {
    sendMessage('🔍 You gotta tell me what playlist to search for! Use `searchplaylist <playlist name>` 🎵', channel);
    return;
  }

  if (!spotify) {
    sendMessage('🚫 Spotify is not configured. Cannot search! 🎵', channel);
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

    let message = `*🔍 Playlist search results for "${query}":*\n`;
    playlists.forEach((playlist, index) => {
      message += `${index + 1}. *${playlist.name}* by _${playlist.owner}_\n`;
    });
    message += '\n_Use `addplaylist <playlist name>` to add a playlist to the queue!_';

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching playlists: ' + err);
    sendMessage('🚨 Error searching Spotify. Try again! 🔄', channel);
  }
}

// ==========================================
// SOUNDCRAFT COMMANDS
// ==========================================

/**
 * Get or set Soundcraft mixer volume
 */
async function soundcraftVolume(input, channel, userName) {
  if (!soundcraft || !soundcraft.isEnabled()) {
    sendMessage('🚫 Soundcraft mixer is not enabled or configured.', channel);
    return;
  }

  if (!input || input.length < 2) {
    // Show all channel volumes
    try {
      const volumes = await soundcraft.getAllVolumes();
      const channelNames = soundcraft.getChannelNames();
      let message = '*🎚️ Soundcraft Mixer Volumes:*\n';
      channelNames.forEach((name, index) => {
        const vol = volumes[index] !== undefined ? volumes[index] : 'N/A';
        message += `${name}: *${vol}*\n`;
      });
      sendMessage(message, channel);
    } catch (err) {
      logger.error('Error getting Soundcraft volumes: ' + err);
      sendMessage('🚨 Error getting mixer volumes. Try again! 🔄', channel);
    }
    return;
  }

  // Set volume for a channel
  logUserAction(userName, 'soundcraft-volume');
  const channelName = input[1];
  const newVolume = parseFloat(input[2]);

  if (isNaN(newVolume)) {
    sendMessage('🔢 Volume must be a number! Use `soundcraft <channel> <volume>` 🎯', channel);
    return;
  }

  try {
    const success = await soundcraft.setVolume(channelName, newVolume);
    if (success) {
      sendMessage(`🎚️ Soundcraft channel *${channelName}* set to *${newVolume}*! 🎵`, channel);
    } else {
      sendMessage(`🚫 Could not find channel *${channelName}* on the mixer.`, channel);
    }
  } catch (err) {
    logger.error('Error setting Soundcraft volume: ' + err);
    sendMessage('🚨 Error setting mixer volume. Try again! 🔄', channel);
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
  clear: flush,  // SLAC-10: 'clear' is an alias for 'flush' — same function reference
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
  // Volume
  volume,
  // Info
  current,
  status,
  // Search
  search,
  searchAlbum,
  searchPlaylist,
  // Soundcraft
  soundcraftVolume,
};
