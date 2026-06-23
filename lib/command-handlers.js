/**
 * Command Handlers Module
 * Handles playback, queue, volume, and search commands
 * 
 * Uses dependency injection for testability
 * @module command-handlers
 */

const queueUtils = require('./queue-utils');
const queueCache = require('./queue-cache');
const { playFromQueue } = require('./sonos-playback');

const QUEUE_COUNT_TIMEOUT_MS = 3500;
const QUEUE_COUNT_COLD_TIMEOUT_MS = 10000;
const QUEUE_COUNT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_QUEUE_LIST_LIMIT = 10;
const DEFAULT_QUEUE_THREAD_THRESHOLD = 20;
const CURRENT_TRACK_TIMEOUT_MS = 2500;
const QUEUE_TITLE = 'Queue';

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

function withTimeout(promise, timeoutMs, timeoutMessage) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(timeoutMessage);
      err.code = 'TIMEOUT';
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => clearTimeout(timeoutId));
}

function formatAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 1000) {
    return 'just now';
  }

  if (ageMs < 60 * 1000) {
    return `${Math.round(ageMs / 1000)}s ago`;
  }

  return `${Math.round(ageMs / (60 * 1000))}m ago`;
}

function sendQueueCount(total, channel, options = {}) {
  const suffix = options.staleSnapshot
    ? ` _(last checked ${formatAge(options.staleSnapshot.ageMs)})_`
    : '';

  sendMessage(
    `🎵 We've got *${total}* ${total === 1 ? 'track' : 'tracks'} queued up and ready to rock! 🎸${suffix}`,
    channel
  );
}

function getQueueWithCache(source) {
  return sonos.getQueue().then((result) => {
    queueCache.updateFromQueue(result, source);
    return result;
  });
}

function getQueueWithTimeout(timeoutMs, source) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return getQueueWithCache(source);
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`Timed out getting Sonos queue after ${timeoutMs}ms`);
      err.code = 'SONOS_QUEUE_TIMEOUT';
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([
    getQueueWithCache(source),
    timeoutPromise
  ]).finally(() => clearTimeout(timeoutId));
}

function formatTrackTime(position, duration) {
  if (!duration || !position) {
    return null;
  }

  const remaining = Math.max(0, duration - position);
  const remainingMin = Math.floor(remaining / 60);
  const remainingSec = Math.floor(remaining % 60);
  const durationMin = Math.floor(duration / 60);
  const durationSec = Math.floor(duration % 60);

  return `${remainingMin}:${remainingSec.toString().padStart(2, '0')} remaining (${durationMin}:${durationSec.toString().padStart(2, '0')} total)`;
}

function getQueueTotal(result) {
  const normalized = queueCache.normalizeTotal(result);
  return normalized === null ? 0 : normalized;
}

function getQueueThreadThreshold() {
  const config = getConfig() || {};
  const threshold = Number(config.queueThreadThreshold);
  if (!Number.isFinite(threshold) || threshold < 1) {
    return DEFAULT_QUEUE_THREAD_THRESHOLD;
  }

  return threshold;
}

function splitQueueLinesForThread(lines) {
  const threshold = getQueueThreadThreshold();
  if (!Number.isFinite(threshold) || threshold < 1 || lines.length <= threshold) {
    return { mainLines: lines, threadLines: [] };
  }

  return {
    mainLines: lines.slice(0, threshold),
    threadLines: lines.slice(threshold)
  };
}

function getThreadOptionsForReply(mainResult) {
  if (mainResult && mainResult.ts) {
    return { thread_ts: mainResult.ts };
  }

  return { forceThread: true };
}

function chunkLines(lines, maxLines = 100) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    chunks.push(lines.slice(i, i + maxLines));
  }
  return chunks;
}

async function sendQueueWithThreadOverflow(mainMessage, channel, threadLines, threadHeader) {
  const mainResult = await sendMessage(mainMessage, channel);

  if (!threadLines || threadLines.length === 0) {
    return;
  }

  const threadOptions = getThreadOptionsForReply(mainResult);
  const chunks = chunkLines(threadLines);
  for (let i = 0; i < chunks.length; i++) {
    const header = i === 0 && threadHeader ? `${threadHeader}\n` : '';
    await sendMessage(header + chunks[i].join('\n') + '\n', channel, threadOptions);
  }
}

function getCurrentQueueIndex(track, items, isFromQueue) {
  if (!track || !Array.isArray(items) || items.length === 0 || !isFromQueue) {
    return -1;
  }

  const queuePosition = Number(track.queuePosition);
  if (Number.isInteger(queuePosition) && queuePosition > 0 && queuePosition <= items.length) {
    return queuePosition - 1;
  }

  return items.findIndex(item => item.title === track.title && item.artist === track.artist);
}

function getCurrentQueuePositionIndex(track, isFromQueue) {
  if (!track || !isFromQueue) {
    return -1;
  }

  const queuePosition = Number(track.queuePosition);
  if (Number.isInteger(queuePosition) && queuePosition > 0) {
    return queuePosition - 1;
  }

  return -1;
}

async function getCurrentTrackWithTimeout(source) {
  if (!sonos || typeof sonos.currentTrack !== 'function') {
    return null;
  }

  return withTimeout(
    sonos.currentTrack(),
    CURRENT_TRACK_TIMEOUT_MS,
    `Timed out getting current track after ${CURRENT_TRACK_TIMEOUT_MS}ms`
  ).catch(err => {
    if (err.code === 'TIMEOUT') {
      logger.warn(`${source}: current track lookup timed out; showing queue without current-track details`);
    } else {
      logger.warn(`${source}: could not get current track: ${err.message}`);
    }
    return null;
  });
}

function normalizeQueueWindowResult(result, startIndex, requestedCount) {
  const items = Array.isArray(result?.items) ? result.items : [];
  return {
    ...result,
    returned: result?.returned ?? items.length,
    total: result?.total ?? items.length,
    items: items.slice(0, requestedCount),
    startIndex
  };
}

function getQueueWindow(startIndex, requestedCount, source) {
  const normalizedStart = Math.max(0, Number.parseInt(startIndex, 10) || 0);
  const normalizedCount = Math.max(1, Number.parseInt(requestedCount, 10) || DEFAULT_QUEUE_LIST_LIMIT);

  if (sonos && typeof sonos.contentDirectoryService === 'function') {
    const contentDirectory = sonos.contentDirectoryService();
    if (contentDirectory && typeof contentDirectory.GetResult === 'function') {
      return contentDirectory.GetResult({
        BrowseFlag: 'BrowseDirectChildren',
        Filter: '*',
        StartingIndex: String(normalizedStart),
        RequestedCount: String(normalizedCount),
        SortCriteria: '',
        ObjectID: 'Q:0'
      }).then(result => {
        queueCache.updateFromQueue(result, source);
        return normalizeQueueWindowResult(result, normalizedStart, normalizedCount);
      });
    }
  }

  return sonos.getQueue().then(result => {
    queueCache.updateFromQueue(result, source);
    const fullItems = Array.isArray(result?.items) ? result.items : [];
    return normalizeQueueWindowResult({
      ...result,
      items: fullItems.slice(normalizedStart, normalizedStart + normalizedCount)
    }, normalizedStart, normalizedCount);
  });
}

function formatCurrentTrackLine(track, queueIndex = -1) {
  const title = track?.title || 'Unknown track';
  const artist = track?.artist || 'Unknown artist';
  const position = queueIndex >= 0 ? `#${queueIndex}` : 'Now';

  return `▶️ *${position} ${title}* — _${artist}_`;
}

function formatCurrentTrackMetadata(track) {
  const parts = [];
  if (track?.artist) {
    parts.push(track.artist);
  }

  const timeText = formatTrackTime(track?.position, track?.duration);
  if (timeText) {
    parts.push(timeText);
  }

  return parts.length > 0 ? `   _${parts.join(' · ')}_` : '';
}

function formatQueueTrackLine(item, index, track, isFromQueue) {
  const title = item.title || 'Unknown track';
  const artist = item.artist || 'Unknown artist';
  let prefix = '';

  const positionMatch = track && (index + 1) === Number(track.queuePosition);
  const nameMatch = track && item.title === track.title && item.artist === track.artist;
  const isCurrentTrack = positionMatch || (nameMatch && isFromQueue);

  const isImmune = voting && voting.isTrackGongBanned({ title: item.title, artist: item.artist, uri: item.uri });
  if (isImmune) {
    prefix = ':lock: ';
  }

  const hasVotes = voting && voting.hasActiveVotes(index, item.uri, item.title, item.artist);
  if (hasVotes) {
    prefix = ':star: ' + prefix;
  }

  const nowMarker = isCurrentTrack && isFromQueue ? '▶️ ' : '';
  return `${prefix}${nowMarker}#${index} ${title} — ${artist}`;
}

function parseQueueListOptions(input) {
  const option = String(input?.[1] || '').trim().toLowerCase();

  if (option === 'all' || option === 'full') {
    return { full: true, limit: null };
  }

  const requestedLimit = Number.parseInt(option, 10);
  if (Number.isInteger(requestedLimit) && requestedLimit > 0) {
    return { full: false, limit: Math.min(requestedLimit, 100) };
  }

  return { full: false, limit: DEFAULT_QUEUE_LIST_LIMIT };
}

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
  sendMessage('▶️ Let\'s gooo! Starting playback... 🎶', channel);

  (async () => {
    try {
      await playFromQueue(sonos, logger);
      logger.info('Playback started');
    } catch (err) {
      logger.error('Error starting playback: ' + err);
    }
  })();
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
      queueCache.setTotal(0, 'flush');
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
      queueCache.adjustTotal(-1, 'removeTrack');
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
      queueCache.updateFromQueue(result, 'purgeHalfQueue');
      const halfQueue = Math.floor(result.total / 2);
      if (halfQueue === 0) {
        sendMessage('🤷 The queue is too tiny to snap! Thanos needs at least 2 tracks to work his magic. 👏', channel);
        return;
      }
      sonos
        .removeTracksFromQueue(halfQueue, halfQueue)
        .then(() => {
          queueCache.adjustTotal(-halfQueue, 'purgeHalfQueue');
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
 * Show the compact queue list used by the standard list command
 */
async function listQueue(input, channel) {
  const options = parseQueueListOptions(input);
  if (options.full) {
    return showQueue(channel);
  }

  try {
    const listStart = Date.now();
    const limit = options.limit || DEFAULT_QUEUE_LIST_LIMIT;
    const statePromise = sonos.getCurrentState();
    const currentTrackPromise = statePromise.then(state => {
      return state === 'playing' ? getCurrentTrackWithTimeout('listQueue') : null;
    });
    const [state, trackCandidate] = await Promise.all([
      statePromise,
      currentTrackPromise
    ]);
    const track = state === 'playing' ? trackCandidate : null;
    const isFromQueue = track && track.queuePosition > 0;
    let currentIndex = getCurrentQueuePositionIndex(track, isFromQueue);
    let startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    let result = await getQueueWindow(startIndex, limit, 'listQueue');
    const total = getQueueTotal(result);

    if (total === 0) {
      logger.debug('Queue is empty');
      let emptyMsg = '🦗 *Crickets...* The queue is empty! Try `add <song>` to get started! 🎵';
      if (state === 'playing' && !isFromQueue) {
        emptyMsg += '\n⚠️ Note: Currently playing from external source (not queue). Run `stop` to switch to queue.';
      }
      sendMessage(emptyMsg, channel);
      return;
    }

    if (currentIndex < 0 && startIndex === 0) {
      currentIndex = getCurrentQueueIndex(track, result.items, isFromQueue);
    }

    if (track && currentIndex < 0) {
      const fullQueue = await getQueueWithTimeout(QUEUE_COUNT_TIMEOUT_MS, 'listQueue:reconcileCurrentTrack');
      const sourceInfo = queueUtils.determineSourceType(track, fullQueue?.items);

      if (sourceInfo?.type === 'queue' && Number.isInteger(sourceInfo.queuePosition) && sourceInfo.queuePosition > 0) {
        currentIndex = sourceInfo.queuePosition - 1;
        startIndex = currentIndex + 1;
        result = await getQueueWindow(startIndex, limit, 'listQueue:reconciledWindow');
      }
    }

    const shownItems = result.items
      .map((item, offset) => formatQueueTrackLine(item, startIndex + offset, track, isFromQueue));
    const { mainLines, threadLines } = splitQueueLinesForThread(shownItems);
    const shownCount = shownItems.length;
    const hiddenCount = Math.max(0, total - startIndex - shownCount);
    const upcomingTotal = currentIndex >= 0 ? Math.max(0, total - currentIndex - 1) : total;

    let message = '';
    if (currentIndex >= 0) {
      message += `🎵 ${QUEUE_TITLE} · showing next ${shownCount} of ${upcomingTotal}\n`;
      message += `${formatCurrentTrackLine(track, currentIndex)}\n`;
      const currentMeta = formatCurrentTrackMetadata(track);
      if (currentMeta) {
        message += `${currentMeta}\n`;
      }
    } else if (state === 'playing' && track) {
      message += `🎵 ${QUEUE_TITLE} · showing first ${shownCount} of ${total}\n`;
      message += `${formatCurrentTrackLine(track)}\n`;
      message += '⚠️ Source: *External* (not from queue)\n';
    } else {
      message += `🎵 ${QUEUE_TITLE} · showing first ${shownCount} of ${total}\n`;
      message += `Playback state: *${state}*\n`;
    }

    if (mainLines.length > 0) {
      message += '\n' + mainLines.join('\n') + '\n';
    } else if (currentIndex >= 0 && shownItems.length === 0) {
      message += '\nNo upcoming songs after the current track.\n';
    }

    if (threadLines.length > 0) {
      message += '\nMore from this list continues in the thread.';
    }

    if (hiddenCount > 0) {
      message += '\n*More songs queued.* Type `listall` or `list all` to show the full queue.';
    }

    logger.info(`[TIMING] list_queue start=${startIndex} requested=${limit} returned=${result.items.length} total=${total} ms=${Date.now() - listStart}`);
    await sendQueueWithThreadOverflow(message, channel, threadLines, 'More songs from `list`:');
  } catch (err) {
    logger.error('Error fetching queue: ' + err);
    sendMessage('🚨 Error fetching queue. Try again! 🔄', channel);
  }
}

/**
 * Show the full current queue
 */
async function showQueue(channel) {
  try {
    // Parallelize all Sonos API calls for better performance
    const [result, state] = await Promise.all([
      sonos.getQueue(),
      sonos.getCurrentState()
    ]);
    queueCache.updateFromQueue(result, 'showQueue');

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

    const total = getQueueTotal(result);
    let message = `🎵 ${QUEUE_TITLE} · showing ${Math.min(result.items.length, getQueueThreadThreshold())} of ${total}\n`;
    if (state === 'playing' && track) {
      const currentIndex = getCurrentQueueIndex(track, result.items, isFromQueue);
      message += `${formatCurrentTrackLine(track, currentIndex)}\n`;
      const currentMeta = formatCurrentTrackMetadata(track);
      if (currentMeta) {
        message += `${currentMeta}\n`;
      }

      if (!isFromQueue) {
        message += `⚠️ Source: *External* (not from queue)\n`;
      }
    } else {
      message += `Playback state: *${state}*\n`;
    }
    message += '\n';
    
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
      tracks.push(formatQueueTrackLine(item, i, track, isFromQueue));
    });
    
    const { mainLines, threadLines } = splitQueueLinesForThread(tracks);
    const mainMessage = message + mainLines.join('\n') + '\n' +
      (threadLines.length > 0 ? '\nMore queued songs continue in the thread.\n' : '');

    await sendQueueWithThreadOverflow(mainMessage, channel, threadLines, 'More queued songs:');
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
    queueCache.updateFromQueue(result, 'upNext');

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
async function countQueue(channel, cb, options = {}) {
  const cachedBefore = queueCache.getSnapshot(QUEUE_COUNT_CACHE_MAX_AGE_MS);
  const timeoutMs = options.timeoutMs ?? (
    cachedBefore ? QUEUE_COUNT_TIMEOUT_MS : QUEUE_COUNT_COLD_TIMEOUT_MS
  );

  try {
    const result = await getQueueWithTimeout(timeoutMs, 'countQueue');
    const total = queueCache.normalizeTotal(result);

    if (total === null) {
      throw new Error('Sonos queue response did not include a total');
    }

    if (cb) {
      return cb(total);
    }

    sendQueueCount(total, channel);
  } catch (err) {
    const cached = queueCache.getSnapshot(QUEUE_COUNT_CACHE_MAX_AGE_MS);
    if (err.code === 'SONOS_QUEUE_TIMEOUT' && cached) {
      logger.warn(`Sonos queue count timed out; using cached total ${cached.total} from ${formatAge(cached.ageMs)}`);
      if (cb) {
        return cb(cached.total);
      }

      sendQueueCount(cached.total, channel, { staleSnapshot: cached });
      return;
    }

    logger.error(err);
    if (cb) {
      return cb(null, err);
    }
    sendMessage('🤷 Error getting queue length. Try again in a moment! 🔄', channel);
  }
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
  if (vol < 0) {
    sendMessage('🚨 Volume must be between 0 and ' + (maxVolume || 100) + '. You tried: ' + vol, channel);
    return;
  }

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
  logUserAction(userName, 'search', { query: term, type: 'track' });
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
async function searchalbum(input, channel, userName) {
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
  logUserAction(userName, 'searchalbum', { query: album, type: 'album' });
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
      const trackInfo = albumResult.totalTracks
        ? ` (${albumResult.totalTracks} ${albumResult.totalTracks === 1 ? 'track' : 'tracks'})`
        : '';
      message += `> *${albumResult.name}* by _${albumResult.artist}_${trackInfo}\n`;
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
  if (!spotify) {
    sendMessage('🎵 Spotify is not configured. Search is unavailable.', channel);
    return;
  }
  
  if (!input || input.length < 2) {
    sendMessage('🔍 Tell me which playlist to search for! `searchplaylist <name>` 🎶', channel);
    return;
  }
  const playlist = input.slice(1).join(' ');
  logUserAction(userName, 'searchplaylist', { query: playlist, type: 'playlist' });
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
  listQueue,
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
