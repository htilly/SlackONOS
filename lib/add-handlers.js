/**
 * Add Handlers Module
 * Handles add, addalbum, addplaylist, and append commands
 * 
 * Uses dependency injection for testability
 * @module add-handlers
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
let isTrackBlacklisted = () => false;
let musicHelper = null;
let getConfig = () => ({});
let getAdminChannel = () => null;
let getCurrentPlatform = () => 'slack';

/**
 * Initialize the add handlers with dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Winston logger instance (required)
 * @param {Object} deps.sonos - Sonos device instance (required)
 * @param {Object} deps.spotify - Spotify API wrapper (required)
 * @param {Function} deps.sendMessage - Message sending function (required)
 * @param {Function} deps.logUserAction - User action logging function (optional)
 * @param {Function} deps.isTrackBlacklisted - Blacklist check function (optional)
 * @param {Object} deps.musicHelper - Music helper for URI validation (optional)
 * @param {Function} deps.getConfig - Config getter function (optional)
 * @param {Function} deps.getAdminChannel - Admin channel getter (optional)
 * @param {Function} deps.getCurrentPlatform - Platform getter (optional)
 */
function initialize(deps) {
  if (!deps.logger) {
    throw new Error('Add handlers require a logger to be injected');
  }
  if (!deps.sonos) {
    throw new Error('Add handlers require sonos to be injected');
  }
  if (!deps.spotify) {
    throw new Error('Add handlers require spotify to be injected');
  }
  if (!deps.sendMessage) {
    throw new Error('Add handlers require sendMessage to be injected');
  }

  logger = deps.logger;
  sonos = deps.sonos;
  spotify = deps.spotify;
  sendMessage = deps.sendMessage;
  logUserAction = deps.logUserAction || (async () => {});
  isTrackBlacklisted = deps.isTrackBlacklisted || (() => false);
  musicHelper = deps.musicHelper || { isValidSpotifyUri: () => true };
  getConfig = deps.getConfig || (() => ({}));
  getAdminChannel = deps.getAdminChannel || (() => null);
  getCurrentPlatform = deps.getCurrentPlatform || (() => 'slack');

  logger.info('✅ Add handlers initialized');
}

// ==========================================
// ADD COMMANDS
// ==========================================

/**
 * Add a track to the queue
 * If stopped: flush queue and start fresh
 * If playing: just add to existing queue
 */
async function add(input, channel, userName) {
  logUserAction(userName, 'add');
  
  if (!input || input.length < 2) {
    sendMessage('🎵 You gotta tell me what to add! Use `add <song name or artist>` 🎶', channel);
    return;
  }
  const track = input.slice(1).join(' ');
  logger.info('Track to add: ' + track);

  try {
    const tracks = await spotify.searchTrackList(track, 3);
    if (!tracks || tracks.length === 0) {
      sendMessage("🤷 Couldn't find anything matching that. Try different keywords or check the spelling! 🎵", channel);
      return;
    }

    // Sort tracks by relevance using queue-utils
    const sortedTracks = queueUtils.sortTracksByRelevance(tracks, track);

    // Pre-validate all candidates in parallel before attempting to queue
    const candidates = sortedTracks
      .filter(t => musicHelper.isValidSpotifyUri(t.uri))
      .map(t => ({
        name: t.name,
        artist: t.artist,
        uri: t.uri
      }));

    if (candidates.length === 0) {
      sendMessage("🤷 Found tracks but they have invalid format. Try a different search! 🎵", channel);
      return;
    }

    // Check if first result is blacklisted (most common case)
    const firstCandidate = candidates[0];
    if (isTrackBlacklisted(firstCandidate.name, firstCandidate.artist)) {
      logger.info(`Track blocked by blacklist: ${firstCandidate.name} by ${firstCandidate.artist}`);
      sendMessage(`🚫 Sorry, *${firstCandidate.name}* by ${firstCandidate.artist} is on the blacklist and cannot be added.`, channel);
      return;
    }

    // Parallelize getting state and queue to save time
    const [state, queue] = await Promise.all([
      sonos.getCurrentState(),
      sonos.getQueue().catch(err => {
        logger.warn('Could not get queue: ' + err.message);
        return null;
      })
    ]);
    logger.info('Current state for add: ' + state);

    // Handle stopped state - flush queue
    if (state === 'stopped') {
      logger.info('Player stopped - ensuring queue is active source and flushing');
      try {
        try {
          await sonos.stop();
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (stopErr) {
          logger.debug('Stop command result (may already be stopped): ' + stopErr.message);
        }
        
        await sonos.flush();
        await new Promise(resolve => setTimeout(resolve, 300));
        logger.info('Queue flushed and ready');
      } catch (flushErr) {
        logger.warn('Could not flush queue: ' + flushErr.message);
      }
    } else if (queue && queue.items) {
      // Check for duplicates if playing (using pre-fetched queue)
      const duplicatePosition = queue.items.findIndex(item =>
        item.uri === firstCandidate.uri ||
        (item.title === firstCandidate.name && item.artist === firstCandidate.artist)
      );

      if (duplicatePosition >= 0) {
        sendMessage(
          `*${firstCandidate.name}* by _${firstCandidate.artist}_ is already in the queue at position #${duplicatePosition}! :musical_note:\nWant it to play sooner? Use \`vote ${duplicatePosition}\` to move it up! :arrow_up:`,
          channel
        );
        return;
      }
    }

    // Try to queue the first valid candidate (most relevant result)
    let result = null;
    try {
      logger.info(`Attempting to queue: ${firstCandidate.name} by ${firstCandidate.artist} (URI: ${firstCandidate.uri})`);
      await sonos.queue(firstCandidate.uri);
      logger.info('Successfully queued track: ' + firstCandidate.name);
      result = firstCandidate;
    } catch (e) {
      const errorDetails = e.message || String(e);
      const upnpErrorMatch = errorDetails.match(/errorCode[>](\d+)[<]/);
      const errorCode = upnpErrorMatch ? upnpErrorMatch[1] : null;

      logger.warn(`Queue failed for "${firstCandidate.name}" by ${firstCandidate.artist}: ${errorDetails}${errorCode ? ` (error code: ${errorCode})` : ''}`);

      if (errorCode === '800') {
        sendMessage('🤷 Track not available in your region. Try searching for different songs! 🎵', channel);
        
        // Also notify admin channel about region configuration
        const adminChannel = getAdminChannel();
        if (adminChannel && channel !== adminChannel) {
          const config = getConfig();
          const currentMarket = (config.get ? config.get('market') : config.market) || 'US';
          const marketOptions = ['US', 'SE', 'GB', 'DE', 'FR', 'CA', 'AU', 'JP', 'NO', 'DK', 'FI'];
          const marketOptionsList = marketOptions.map(m => m === currentMarket ? `*${m}* (current)` : m).join(', ');
          
          sendMessage(
            `⚠️ *Spotify Region Warning*\n` +
            `Track "*${firstCandidate.name}*" by ${firstCandidate.artist} failed due to region availability.\n\n` +
            `Please verify your Spotify region configuration.\n` +
            `Current region: *${currentMarket}*\n` +
            `Available options: ${marketOptionsList}\n` +
            `Update via setup wizard or admin panel.`,
            adminChannel
          );
        }
      } else {
        sendMessage('🤷 Couldn\'t add the track. It may not be available or there was an error. Try a different search! 🎵', channel);
      }
      return;
    }
    
    // Respond immediately to user (don't wait for playback to start)
    const currentPlatform = getCurrentPlatform();
    sendMessage(
      'Added ' + '*' + result.name + '*' + ' by ' + result.artist + ' to the queue! :notes:',
      channel,
      { trackName: result.name, addReactions: currentPlatform === 'discord' }
    );

    // Handle playback state asynchronously (don't block user response)
    if (state === 'stopped') {
      (async () => {
        try {
          try {
            await sonos.stop();
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (stopErr) {
            logger.debug('Stop before play (may already be stopped): ' + stopErr.message);
          }
          
          // Verify queue has items before trying to play
          let queueReady = false;
          let retries = 0;
          while (!queueReady && retries < 5) {
            try {
              const q = await sonos.getQueue();
              if (q && q.items && q.items.length > 0) {
                queueReady = true;
                logger.debug(`Queue verified: ${q.items.length} items ready`);
              } else {
                logger.debug(`Queue not ready yet (attempt ${retries + 1}/5), waiting...`);
                await new Promise(resolve => setTimeout(resolve, 300));
                retries++;
              }
            } catch (queueErr) {
              logger.debug(`Queue check failed (attempt ${retries + 1}/5): ${queueErr.message}`);
              await new Promise(resolve => setTimeout(resolve, 300));
              retries++;
            }
          }
          
          if (!queueReady) {
            logger.warn('Queue not ready after 5 attempts, attempting playback anyway');
          }
          
          // Try to activate queue by seeking to position 1
          try {
            logger.debug('Attempting to seek to queue position 1 to activate queue');
            await sonos.avTransportService().Seek({
              InstanceID: 0,
              Unit: 'TRACK_NR',
              Target: '1'
            });
            logger.debug('Successfully sought to track 1, queue should be active');
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (seekErr) {
            logger.debug('Seek failed, trying next() to activate queue: ' + seekErr.message);
            try {
              await sonos.next();
              logger.debug('Used next() to activate queue');
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (nextErr) {
              logger.debug('next() also failed: ' + nextErr.message);
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 500));
          await sonos.play();
          logger.info('Started playback from queue');
        } catch (playErr) {
          logger.warn('Failed to start playback: ' + playErr.message);
        }
      })();
    } else if (state === 'paused') {
      (async () => {
        try {
          await sonos.play();
          logger.info('Resumed playback');
        } catch (playErr) {
          logger.warn('Failed to resume playback: ' + playErr.message);
        }
      })();
    }
  } catch (err) {
    logger.error('Error adding track: ' + err.message);
    sendMessage('🤷 Couldn\'t find that track or hit an error adding it. Try being more specific with the song name! 🎵', channel);
  }
}

/**
 * Add an album to the queue
 * Supports Spotify URI or search
 */
async function addalbum(input, channel, userName) {
  logUserAction(userName, 'addalbum');
  
  if (!input || input.length < 2) {
    sendMessage('💿 You gotta tell me which album to add! Try `addalbum <album name>` 🎶', channel);
    return;
  }
  const album = input.slice(1).join(' ');
  logger.info('Album to add: ' + album);

  try {
    // If it's a Spotify URI, use getAlbum directly
    if (album.startsWith('spotify:album:') || album.includes('spotify.com/album/')) {
      const result = await spotify.getAlbum(album);
      await queueAlbum(result, album, channel, userName);
      return;
    }
    
    // Otherwise search and sort by relevance
    const albums = await spotify.searchAlbumList(album, 3);
    if (!albums || albums.length === 0) {
      sendMessage("🤷 Couldn't find that album. Try including the artist name or checking the spelling! 🎶", channel);
      return;
    }
    
    // Sort by relevance and take first result
    const sortedAlbums = queueUtils.sortAlbumsByRelevance(albums, album);
    const result = { ...sortedAlbums[0], uri: sortedAlbums[0].uri };
    logger.info(`Selected album: ${result.name} by ${result.artist}`);
    
    await queueAlbum(result, album, channel, userName);
  } catch (err) {
    logger.error('Error adding album: ' + err.message);
    sendMessage('🔎 Couldn\'t find that album. Try a Spotify link, or use `searchalbum <name>` to pick one. 🎵', channel);
  }
}

/**
 * Helper function to queue an album (shared between URI and search flows)
 * @private
 */
async function queueAlbum(result, albumSearchTerm, channel, userName) {
  try {
    // Check for blacklisted tracks in the album
    const albumTracks = await spotify.getAlbumTracks(result.uri);
    const blacklistedTracks = albumTracks.filter(track => 
      isTrackBlacklisted(track.name, track.artist)
    );
    
    // If ALL tracks are blacklisted, don't add anything
    if (blacklistedTracks.length > 0 && blacklistedTracks.length === albumTracks.length) {
      sendMessage(
        `🚫 Cannot add album *${result.name}* - all ${albumTracks.length} tracks are blacklisted!`,
        channel
      );
      return;
    }
    
    let warningMessage = '';
    if (blacklistedTracks.length > 0) {
      const bannedList = blacklistedTracks.map(t => `*${t.name}*`).join(', ');
      warningMessage = `\n⚠️ Skipped ${blacklistedTracks.length} blacklisted track(s): ${bannedList}`;
      logger.info(`Filtering out ${blacklistedTracks.length} blacklisted tracks from album ${result.name}`);
    }

    // Get current player state
    const state = await sonos.getCurrentState();
    logger.info('Current state for addalbum: ' + state);
    
    const isStopped = state === 'stopped';

    // If stopped, ensure queue is active source and flush
    if (isStopped) {
      logger.info('Player stopped - ensuring queue is active and flushing');
      try {
        try {
          await sonos.stop();
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (stopErr) {
          logger.debug('Stop command result (may already be stopped): ' + stopErr.message);
        }
        
        await sonos.flush();
        await new Promise(resolve => setTimeout(resolve, 300));
        logger.info('Queue flushed and ready');
      } catch (flushErr) {
        logger.warn('Could not flush queue: ' + flushErr.message);
      }
    }

    // Respond to user immediately
    const trackCountText = blacklistedTracks.length > 0
      ? `${albumTracks.length - blacklistedTracks.length} tracks from album`
      : 'album';
    let text = `Added ${trackCountText} *${result.name}* by ${result.artist} to the queue! :notes:`;
    text += warningMessage;

    if (result.coverUrl) {
      sendMessage(text, channel, {
        trackName: result.name,
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
      sendMessage(text, channel, { trackName: result.name });
    }

    // Queue tracks in background (don't block user response)
    (async () => {
      try {
        if (blacklistedTracks.length > 0) {
          const allowedTracks = albumTracks.filter(track =>
            !isTrackBlacklisted(track.name, track.artist)
          );

          const queuePromises = allowedTracks.map(track =>
            sonos.queue(track.uri).catch(err => {
              logger.warn(`Could not queue track ${track.name}: ${err.message}`);
              return null;
            })
          );

          await Promise.allSettled(queuePromises);
          logger.info(`Added ${allowedTracks.length} tracks from album (filtered ${blacklistedTracks.length})`);
        } else {
          await sonos.queue(result.uri);
          logger.info('Added album: ' + result.name);
        }

        if (isStopped) {
          await new Promise(resolve => setTimeout(resolve, 300));
          await sonos.play();
          logger.info('Started playback after album add');
        } else if (state !== 'playing' && state !== 'transitioning') {
          await sonos.play();
          logger.info('Player was not playing, started playback.');
        }
      } catch (err) {
        logger.error('Error in background album queueing: ' + err.message);
      }
    })();
  } catch (err) {
    logger.error('Error adding album: ' + err.message);
    sendMessage('🔎 Couldn\'t find that album. Double-check the spelling or try including the artist name! 🎶', channel);
  }
}

/**
 * Add a playlist to the queue
 * Supports Spotify URI or search
 */
async function addplaylist(input, channel, userName) {
  logUserAction(userName, 'addplaylist');
  
  if (!input || input.length < 2) {
    sendMessage('📋 You need to tell me which playlist to add! Use `addplaylist <playlist name>` 🎵', channel);
    return;
  }
  const playlist = input.slice(1).join(' ');
  logger.info('Playlist to add: ' + playlist);

  try {
    let result;
    try {
      result = await spotify.getPlaylist(playlist);
    } catch (e1) {
      logger.warn('Direct playlist lookup failed, falling back to search: ' + e1.message);
      const candidates = await spotify.searchPlaylistList(playlist, 5);
      if (candidates && candidates.length > 0) {
        const sortedCandidates = queueUtils.sortPlaylistsByRelevance(candidates, playlist);
        result = sortedCandidates[0];
        logger.info(`Using playlist candidate: ${result.name} by ${result.owner}`);
      } else {
        throw new Error('Playlist not found');
      }
    }
    
    // Check for blacklisted tracks in the playlist
    const playlistTracks = await spotify.getPlaylistTracks(result.uri);
    const blacklistedTracks = playlistTracks.filter(track => 
      isTrackBlacklisted(track.name, track.artist)
    );
    
    // If ALL tracks are blacklisted, don't add anything
    if (blacklistedTracks.length > 0 && blacklistedTracks.length === playlistTracks.length) {
      sendMessage(
        `🚫 Cannot add playlist *${result.name}* - all ${playlistTracks.length} tracks are blacklisted!`,
        channel
      );
      return;
    }
    
    let warningMessage = '';
    if (blacklistedTracks.length > 0) {
      const bannedList = blacklistedTracks.slice(0, 5).map(t => `*${t.name}*`).join(', ');
      const moreText = blacklistedTracks.length > 5 ? ` and ${blacklistedTracks.length - 5} more` : '';
      warningMessage = `\n⚠️ Skipped ${blacklistedTracks.length} blacklisted track(s): ${bannedList}${moreText}`;
      logger.info(`Filtering out ${blacklistedTracks.length} blacklisted tracks from playlist ${result.name}`);
    }

    // Get current player state
    const state = await sonos.getCurrentState();
    logger.info('Current state for addplaylist: ' + state);
    
    const isStopped = state === 'stopped';

    // If stopped, ensure queue is active source and flush
    if (isStopped) {
      logger.info('Player stopped - ensuring queue is active and flushing');
      try {
        try {
          await sonos.stop();
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (stopErr) {
          logger.debug('Stop command result (may already be stopped): ' + stopErr.message);
        }
        
        await sonos.flush();
        await new Promise(resolve => setTimeout(resolve, 300));
        logger.info('Queue flushed and ready');
      } catch (flushErr) {
        logger.warn('Could not flush queue: ' + flushErr.message);
      }
    }

    // If we have blacklisted tracks, add individually; otherwise use playlist URI
    if (blacklistedTracks.length > 0) {
      const allowedTracks = playlistTracks.filter(track => 
        !isTrackBlacklisted(track.name, track.artist)
      );
      
      for (const track of allowedTracks) {
        await sonos.queue(track.uri);
      }
      logger.info(`Added ${allowedTracks.length} tracks from playlist (filtered ${blacklistedTracks.length})`);
    } else {
      await sonos.queue(result.uri);
      logger.info('Added playlist: ' + result.name);
    }

    // Start playback if needed
    if (isStopped) {
      try {
        try {
          await sonos.stop();
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (stopErr) {
          logger.debug('Stop before play (may already be stopped): ' + stopErr.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sonos.play();
        logger.info('Started playback from queue');
      } catch (playErr) {
        logger.warn('Failed to start playback: ' + playErr.message);
      }
    } else if (state !== 'playing' && state !== 'transitioning') {
      try {
        await sonos.play();
        logger.info('Player was not playing, started playback.');
      } catch (playErr) {
        logger.warn('Failed to auto-play: ' + playErr.message);
      }
    }

    // Respond to user immediately
    const trackCountText = blacklistedTracks.length > 0
      ? `${playlistTracks.length - blacklistedTracks.length} tracks from playlist`
      : 'playlist';
    let text = `Added ${trackCountText} *${result.name}* by ${result.owner} to the queue! :notes:`;
    text += warningMessage;

    logger.info(`Sending playlist confirmation message: ${text}`);
    sendMessage(text, channel, { trackName: result.name });

    // Queue tracks in background (don't block user response)
    (async () => {
      try {
        if (blacklistedTracks.length > 0) {
          const allowedTracks = playlistTracks.filter(track =>
            !isTrackBlacklisted(track.name, track.artist)
          );

          const queuePromises = allowedTracks.map(track =>
            sonos.queue(track.uri).catch(err => {
              logger.warn(`Could not queue track ${track.name}: ${err.message}`);
              return null;
            })
          );

          await Promise.allSettled(queuePromises);
          logger.info(`Added ${allowedTracks.length} tracks from playlist (filtered ${blacklistedTracks.length})`);
        } else {
          await sonos.queue(result.uri);
          logger.info('Added playlist: ' + result.name);
        }

        if (isStopped) {
          await new Promise(resolve => setTimeout(resolve, 300));
          await sonos.play();
          logger.info('Started playback after playlist add');
        } else if (state !== 'playing' && state !== 'transitioning') {
          await sonos.play();
          logger.info('Player was not playing, started playback.');
        }
      } catch (err) {
        logger.error('Error in background playlist queueing: ' + err.message);
      }
    })();
  } catch (err) {
    logger.error('Error adding playlist: ' + err.message);
    sendMessage('🔎 Couldn\'t find that playlist. Try a Spotify link, or use `searchplaylist <name>` to pick one. 🎵', channel);
  }
}

/**
 * Append a track to the queue (never flushes existing queue)
 * Start playing if not already playing
 */
async function append(input, channel, userName) {
  logUserAction(userName, 'append');

  if (!input || input.length < 2) {
    sendMessage('🎶 Tell me what song to append! Use `append <song name>` 🎵', channel);
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
          sendMessage(
            `*${result.name}* by _${result.artist}_ is already in the queue at position #${duplicatePosition}! :musical_note:\nWant it to play sooner? Use \`vote ${duplicatePosition}\` to move it up! :arrow_up:`,
            channel
          );
          return;
        }
      }
    } catch (queueErr) {
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
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sonos.play();
        logger.info('Started playback after append.');
        msg += ' Playback started! :notes:';
      }
    } catch (stateErr) {
      logger.warn('Could not check/start playback: ' + stateErr.message);
    }

    sendMessage(msg, channel);
  } catch (err) {
    logger.error('Error appending track: ' + err.message);
    sendMessage('🤷 Couldn\'t find that track or something went wrong. Try a different search! 🎶', channel);
  }
}

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  initialize,
  add,
  addalbum,
  addplaylist,
  append
};
