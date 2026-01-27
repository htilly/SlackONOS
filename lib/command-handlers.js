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

    // Build single compact message
    let message = '';

    if (state === 'playing' && track) {
      message += `Currently playing: *${track.title}* by _${track.artist}_\n`;
      if (track.duration && track.position) {
        const remaining = track.duration - track.position;
        const remainingMin = Math.floor(remaining / 60);
        const remainingSec = Math.floor(remaining % 60);
        const durationMin = Math.floor(track.duration / 60);
        const durationSec = Math.floor(track.duration % 60);
        message += `:stopwatch: ${remainingMin}:${remainingSec.toString().padStart(2, '0')} remaining (${durationMin}:${durationSec.toString().padStart(2, '0')} total)\n`;
      }

      if (!isFromQueue) {
        message += `⚠️ Source: *External* (not from queue)\n`;
      }
    } else {
      message += `Playback state: *${state}*\n`;
    }
    
    message += `\nTotal tracks in queue: ${result.total}\n====================\n`;
    
    logger.info(`Total tracks in queue: ${result.total}, items returned: ${result.items.length}`);
    if (process.env.DEBUG_QUEUE_ITEMS === 'true' && result.items.length <= 100) {
      logger.debug(`Queue items: ${JSON.stringify(result.items.map((item, i) => ({ pos: i, title: item.title, artist: item.artist })))}`);
    } else if (result.items.length > 0) {
      logger.debug(`Queue sample: first="${result.items[0].title}", last="${result.items[result.items.length - 1].title}"`);
    }
    if (track) {
      logger.debug(`Current track: queuePosition=${track.queuePosition}, title="${track.title}", artist="${track.artist}"`);
    }

    const tracks = [];

    result.items.forEach(function (item, i) {
      let trackTitle = item.title;
      let prefix = '';

      // Match by position OR by title/artist
      const positionMatch = track && (i + 1) === track.queuePosition;
      const nameMatch = track && item.title === track.title && item.artist === track.artist;
      const isCurrentTrack = positionMatch || (nameMatch && isFromQueue);

      // Check if track is gong banned (immune)
      const isImmune = voting && voting.isTrackGongBanned({ title: item.title, artist: item.artist, uri: item.uri });
      if (isImmune) {
        prefix = ':lock: ';
        trackTitle = item.title;
      } else if (isCurrentTrack && isFromQueue) {
        trackTitle = '*' + trackTitle + '*';
      } else {
        trackTitle = '_' + trackTitle + '_';
      }

      // Add star prefix for tracks with active votes
      const hasVotes = voting && voting.hasActiveVotes(i, item.uri, item.title, item.artist);
      if (hasVotes) {
        prefix = ':star: ' + prefix;
      }

      if (isCurrentTrack && isFromQueue) {
        tracks.push(':notes: ' + '_#' + i + '_ ' + trackTitle + ' by ' + item.artist);
      } else {
        tracks.push(prefix + '>_#' + i + '_ ' + trackTitle + ' by ' + item.artist);
      }
    });
    
    // Check if we should use threads (always thread if >20 tracks)
    const shouldUseThread = result.total > 20;
    const threadOptions = shouldUseThread ? { forceThread: true } : {};

    // Use array join to build message chunks efficiently
    const messageChunks = [];
    for (let i = 0; i < tracks.length; i++) {
      messageChunks.push(tracks[i]);
      if (i > 0 && Math.floor(i % 100) === 0) {
        sendMessage(message + messageChunks.join('\n') + '\n', channel, threadOptions);
        messageChunks.length = 0;
        message = '';
      }
    }

    if (message || messageChunks.length > 0) {
      sendMessage(message + messageChunks.join('\n') + '\n', channel, threadOptions);
    }
  } catch (err) {
    logger.error('Error fetching queue: ' + err);
    sendMessage('🚨 Error fetching queue. Try again! 🔄', channel);
  }
}

/**
 * Show upcoming tracks
 */
async function upNext(channel) {
  try {
    const [result, track] = await Promise.all([
      sonos.getQueue(),
      sonos.currentTrack().catch(() => null)
    ]);

    if (!result || !result.items || result.items.length === 0) {
      logger.debug('Queue is empty or undefined');
      sendMessage('🎶 The queue is emptier than a broken jukebox! Add something with `add <song>`! 🎵', channel);
      return;
    }

    if (!track) {
      logger.debug('Current track is undefined');
      sendMessage('🎵 No track is currently playing. Start something with `add <song>`! 🎶', channel);
      return;
    }

    let message = 'Upcoming tracks\n====================\n';
    let tracks = [];
    let currentIndex = track.queuePosition;

    // Add current track and upcoming tracks
    result.items.forEach((item, i) => {
      if (i >= currentIndex && i <= currentIndex + 5) {
        tracks.push('_#' + i + '_ ' + '_' + item.title + '_' + ' by ' + item.artist);
      }
    });

    for (let i in tracks) {
      message += tracks[i] + '\n';
    }

    if (message) {
      sendMessage(message, channel);
    }
  } catch (err) {
    logger.error('Error fetching queue for upNext: ' + err);
    sendMessage('🚨 Error fetching upcoming tracks. Try again! 🔄', channel);
  }
}

/**
 * Count tracks in queue
 */
function countQueue(channel, cb) {
  sonos
    .getQueue()
    .then((result) => {
      if (cb) {
        return cb(result.total);
      }
      sendMessage(`🎵 We've got *${result.total}* ${result.total === 1 ? 'track' : 'tracks'} queued up and ready to rock! 🎸`, channel);
    })
    .catch((err) => {
      logger.error(err);
      if (cb) {
        return cb(null, err);
      }
      sendMessage('🤷 Error getting queue length. Try again in a moment! 🔄', channel);
    });
}

// ==========================================
// VOLUME COMMANDS
// ==========================================

/**
 * Get current volume
 */
async function getVolume(channel) {
  const { maxVolume } = getConfig();
  
  try {
    const vol = await sonos.getVolume();
    logger.info('The volume is: ' + vol);
    let message = '🔊 *Sonos:* Currently blasting at *' + vol + '* out of ' + (maxVolume || 100) + ' (your ears\' limits, not ours)';

    // If Soundcraft is enabled, also show Soundcraft channel volumes
    if (soundcraft && soundcraft.isEnabled()) {
      const scVolumes = await soundcraft.getAllVolumes();
      if (Object.keys(scVolumes).length > 0) {
        message += '\n\n🎛️ *Soundcraft Channels:*';
        for (const [name, scVol] of Object.entries(scVolumes)) {
          message += `\n> *${name}:* ${scVol}%`;
        }
      }
    }

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error occurred: ' + err);
  }
}

/**
 * Set volume
 */
function setVolume(input, channel, userName) {
  logUserAction(userName, 'setVolume');
  const { maxVolume } = getConfig();

  // Check if Soundcraft is enabled and if we have multiple arguments
  if (soundcraft && soundcraft.isEnabled() && input.length >= 2) {
    const channelNames = soundcraft.getChannelNames();

    // Check if first argument is a Soundcraft channel name
    const possibleChannelName = input[1];
    if (channelNames.includes(possibleChannelName)) {
      // Syntax: setvolume <channel> <volume>
      const vol = Number(input[2]);

      if (!input[2] || isNaN(vol)) {
        sendMessage(`🤔 Usage: \`setvolume ${possibleChannelName} <number>\`\n\nExample: \`setvolume ${possibleChannelName} 50\``, channel);
        return;
      }

      if (vol < 0 || vol > 100) {
        sendMessage(`🚨 Volume must be between 0 and 100. You tried: ${vol}`, channel);
        return;
      }

      // Convert 0-100 scale to dB
      const minDB = -70;
      const maxDB = 0;
      const volDB = minDB + (maxDB - minDB) * (vol / 100);
      
      logger.info(`Setting Soundcraft channel '${possibleChannelName}' to ${vol}% (${volDB} dB)`);

      soundcraft.setVolume(possibleChannelName, volDB)
        .then(success => {
          if (success) {
            sendMessage(`🔊 Soundcraft channel *${possibleChannelName}* volume set to *${vol}%* (${volDB} dB)`, channel);
          } else {
            sendMessage(`❌ Failed to set Soundcraft volume. Check logs for details.`, channel);
          }
        })
        .catch(err => {
          logger.error('Error setting Soundcraft volume: ' + err);
          sendMessage(`❌ Error setting Soundcraft volume: ${err.message}`, channel);
        });
      return;
    }
  }

  // Default behavior: Set Sonos volume
  const vol = Number(input[1]);

  if (isNaN(vol)) {
    // If Soundcraft is enabled, show helpful message with available channels
    if (soundcraft && soundcraft.isEnabled()) {
      const channelNames = soundcraft.getChannelNames();
      const channelList = channelNames.map(c => `\`${c}\``).join(', ');
      sendMessage(
        `🤔 Invalid volume!\n\n` +
        `*Sonos:* \`setvolume <number>\`\n` +
        `*Soundcraft:* \`setvolume <channel> <number>\`\n\n` +
        `Available Soundcraft channels: ${channelList}`,
        channel
      );
    } else {
      sendMessage('🤔 That\'s not a number, that\'s... I don\'t even know what that is. Try again with actual digits!', channel);
    }
    return;
  }

  logger.info('Volume is: ' + vol);
  if (vol > (maxVolume || 100)) {
    sendMessage('🚨 Whoa there, ' + userName + '! That\'s louder than a metal concert in a phone booth. Max is *' + (maxVolume || 100) + '*. Try again! 🎸', channel);
    return;
  }

  setTimeout(() => {
    sonos
      .setVolume(vol)
      .then(() => {
        logger.info('The volume is set to: ' + vol);
        getVolume(channel);
      })
      .catch((err) => {
        logger.error('Error occurred while setting volume: ' + err);
      });
  }, 1000);
}

// ==========================================
// SEARCH COMMANDS
// ==========================================

/**
 * Search for tracks
 */
async function search(input, channel, userName) {
  logUserAction(userName, 'search');
  
  if (!spotify) {
    sendMessage('🎵 Spotify is not configured. Search is unavailable.', channel);
    return;
  }
  
  const { searchLimit } = getConfig();
  
  if (!input || input.length < 2) {
    sendMessage('🔍 What should I search for? Try `search <song or artist>` 🎵', channel);
    return;
  }

  const term = input.slice(1).join(' ');
  logger.info('Track to search for: ' + term);

  try {
    const tracks = await spotify.searchTrackList(term, searchLimit || 10);

    if (!tracks || tracks.length === 0) {
      sendMessage("🤷 Couldn't find anything matching that. Try different keywords or check the spelling! 🎵", channel);
      return;
    }

    // Sort tracks by relevance using queue-utils
    const sortedTracks = queueUtils.sortTracksByRelevance(tracks, term);

    let message = `🎵 Found *${sortedTracks.length} ${sortedTracks.length === 1 ? 'track' : 'tracks'}*:\n`;
    sortedTracks.forEach((track, index) => {
      message += `>${index + 1}. *${track.name}* by _${track.artists[0].name}_\n`;
    });
    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching for track: ' + err.message);
    sendMessage('🚨 Couldn\'t search for tracks. Error: ' + err.message + ' Try again! 🔄', channel);
  }
}

/**
 * Search for albums
 */
async function searchalbum(input, channel) {
  if (!spotify) {
    sendMessage('🎵 Spotify is not configured. Search is unavailable.', channel);
    return;
  }
  
  const { searchLimit } = getConfig();
  
  if (!input || input.length < 2) {
    sendMessage('🔍 You gotta tell me what album to search for! Try `searchalbum <album name>` 🎶', channel);
    return;
  }
  const album = input.slice(1).join(' ');
  logger.info('Album to search for: ' + album);

  try {
    const albums = await spotify.searchAlbumList(album, searchLimit || 10);

    if (!albums || albums.length === 0) {
      sendMessage('🤔 Couldn\'t find that album. Try including the artist name or checking the spelling! 🎶', channel);
      return;
    }

    // Sort albums by relevance using queue-utils
    const sortedAlbums = queueUtils.sortAlbumsByRelevance(albums, album);

    let message = `Found ${sortedAlbums.length} albums:\n`;
    sortedAlbums.forEach((albumResult) => {
      message += `> *${albumResult.name}* by _${albumResult.artist}_\n`;
    });
    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching for album: ' + err.message);
    sendMessage('🚨 Couldn\'t search for albums. Error: ' + err.message + ' 🔄', channel);
  }
}

/**
 * Search for playlists
 */
async function searchplaylist(input, channel, userName) {
  logUserAction(userName, 'searchplaylist');
  
  if (!spotify) {
    sendMessage('🎵 Spotify is not configured. Search is unavailable.', channel);
    return;
  }
  
  if (!input || input.length < 2) {
    sendMessage('🔍 Tell me which playlist to search for! `searchplaylist <name>` 🎶', channel);
    return;
  }
  const playlist = input.slice(1).join(' ');
  logger.info('Playlist to search for: ' + playlist);

  try {
    const playlists = await spotify.searchPlaylistList(playlist, 10);

    if (!playlists || playlists.length === 0) {
      sendMessage('🤷 Couldn\'t find that playlist. Check the spelling or try a different search! 🎶', channel);
      return;
    }

    // Sort by relevance using queue-utils
    const sortedPlaylists = queueUtils.sortPlaylistsByRelevance(playlists, playlist);

    // Show top 5 results
    const topFive = sortedPlaylists.slice(0, 5);
    let message = `Found ${sortedPlaylists.length} playlists:\n`;
    topFive.forEach((result, index) => {
      message += `>${index + 1}. *${result.name}* by _${result.owner}_ (${result.tracks} tracks)\n`;
    });

    sendMessage(message, channel);
  } catch (err) {
    logger.error('Error searching for playlist: ' + err.message);
    sendMessage('🚨 Couldn\'t search for playlists. Error: ' + err.message + ' 🔄', channel);
  }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Initialization
  initialize,
  
  // Playback commands
  stop,
  play,
  pause,
  resume,
  flush,
  shuffle,
  normal,
  nextTrack,
  previous,
  
  // Queue commands
  removeTrack,
  purgeHalfQueue,
  showQueue,
  upNext,
  countQueue,
  
  // Volume commands
  getVolume,
  setVolume,
  
  // Search commands
  search,
  searchalbum,
  searchplaylist
};
