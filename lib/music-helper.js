/**
 * Music Helper Module
 * Handles Spotify search, boosters, theme mixing, and track queuing
 */

const nconf = require('nconf');

let spotify = null;
let logger = null;
let isTrackBlacklisted = null;

function elapsedMs(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1000000);
}

// Mood/theme boosters for search queries
const BOOSTERS = [
  { match: /(xmas|christmas|jul)/, add: ' christmas holiday' },
  { match: /(party|fest|dansband)/, add: ' party upbeat' },
  { match: /(chill|relax|lugn|mysig|cozy)/, add: ' chill mellow' },
  { match: /(workout|gym|träning)/, add: ' workout energetic' },
  { match: /(sommar|summer|beach)/, add: ' summer beach hits' },
  { match: /(80s|80-tal|eighties)/, add: ' 80s classic hits' },
  { match: /(90s|90-tal|nineties)/, add: ' 90s classic hits' },
  { match: /(rock|metal)/, add: ' rock classic' },
  { match: /(pop|hits)/, add: ' pop hits' },
  { match: /(disco|funk)/, add: ' disco dance funk' },
  { match: /(ballad|kärleks|love|romantic)/, add: ' ballad love romantic' },
  { match: /(hip.?hop|rap|hiphop)/, add: ' hip hop rap hits' },
  { match: /(country|nashville)/, add: ' country hits' },
  { match: /(jazz|blues)/, add: ' jazz blues classic' },
  { match: /(klassisk|classical|opera)/, add: ' classical orchestra' },
  { match: /(reggae|ska|caribbean)/, add: ' reggae caribbean' },
  { match: /(indie|alternative)/, add: ' indie alternative' },
  { match: /(edm|electro|house|techno)/, add: ' electronic dance' },
  { match: /(latin|salsa|bachata|reggaeton)/, add: ' latin dance' },
  { match: /(svensk|swedish)/, add: ' swedish svenska' },
  { match: /(lounge|elevator|hiss)/, add: ' lounge smooth jazz' },
  { match: /(club|dance|dansmusik)/, add: ' club dance hits' },
  { match: /(season|säsong|winter|vinter|autumn|höst)/, add: ' cozy winter' },
  { match: /(barnlåt|kids|children|barn)/, add: ' children kids' }
];

/**
 * Initialize the music helper with dependencies
 * @param {Object} spotifyModule - The spotify-async module
 * @param {Object} loggerModule - The logger module
 * @param {Function} blacklistChecker - Optional function(name, artist) to check if track is blacklisted
 */
function initialize(spotifyModule, loggerModule, blacklistChecker = null) {
  spotify = spotifyModule;
  logger = loggerModule;
  isTrackBlacklisted = blacklistChecker;
  logger.info('✅ Music helper initialized');
}

/**
 * Apply boosters to a search query based on mood/theme keywords
 * @param {string} query - Original search query
 * @returns {{query: string, appliedBoosters: string[]}} - Boosted query and list of applied boosters
 */
function applyBoosters(query) {
  const qLower = query.toLowerCase();
  const appliedBoosters = [];
  let boostedQuery = query;
  
  BOOSTERS.forEach(b => {
    if (b.match.test(qLower)) {
      boostedQuery += b.add;
      appliedBoosters.push(b.add.trim());
    }
  });
  
  return { query: boostedQuery, appliedBoosters };
}

/**
 * Normalize track name for deduplication
 * @param {string} name - Track name
 * @returns {string} - Normalized name
 */
function normalizeTrackName(name) {
  return name.toLowerCase()
    .replace(/\s*[-–]\s*(single|edit|remaster|remix|radio|version|mix|live|acoustic|cover).*$/i, '')
    .replace(/\s*\(.*\)$/i, '')
    .trim();
}

function normalizeArtistName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTrackArtistNames(track) {
  if (Array.isArray(track?.artists) && track.artists.length > 0) {
    return track.artists
      .map(artist => typeof artist === 'string' ? artist : artist?.name)
      .filter(Boolean);
  }

  return track?.artist ? [track.artist] : [];
}

function trackMatchesArtist(track, artistName) {
  const target = normalizeArtistName(artistName);
  if (!target) return false;
  return getTrackArtistNames(track).some(name => normalizeArtistName(name) === target);
}

function quoteSpotifySearchValue(value) {
  return `"${String(value || '').replace(/"/g, '').trim()}"`;
}

function shouldTryArtistLock(query, targetType = 'unknown') {
  if (targetType === 'artist') return true;
  if (targetType && targetType !== 'unknown') return false;

  const words = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;

  const genericMusicTerms = /\b(music|tunes|songs|tracks|hits|playlist|album|best|top|great|good|nice|some|few|several|party|chill|funky|disco|rock|pop|seasonal|summer|winter|christmas|workout|dance)\b/i;
  return !genericMusicTerms.test(query);
}

async function findExactArtistName(query, targetType = 'unknown') {
  if (!spotify || typeof spotify.searchArtistList !== 'function') {
    return null;
  }

  const normalizedQuery = normalizeArtistName(query);
  if (!normalizedQuery) return null;
  if (!shouldTryArtistLock(query, targetType)) return null;

  try {
    const artists = await spotify.searchArtistList(query, 5);
    const exactMatch = (artists || []).find(artist =>
      normalizeArtistName(artist?.name) === normalizedQuery
    );
    return exactMatch?.name || null;
  } catch (err) {
    logger.debug(`Music helper: artist lookup for "${query}" failed: ${err.message}`);
    return null;
  }
}

/**
 * Validate Spotify URI format
 * @param {string} uri - Spotify URI to validate
 * @returns {boolean} - True if valid
 */
function isValidSpotifyUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  // Spotify URI format: spotify:track:22 characters base62
  const uriPattern = /^spotify:(track|album|playlist|artist):[a-zA-Z0-9]{22}$/;
  return uriPattern.test(uri);
}

/**
 * Search Spotify with multiple query variants to get enough results
 * @param {string} query - Search query
 * @param {number} targetCount - How many unique tracks we want
 * @returns {Promise<Array>} - Array of track objects
 */
async function multiSearch(query, targetCount, options = {}) {
  const searchVariants = options.variants || [
    query,
    query + ' 2024',
    query + ' 2023',
    query + ' classic',
    query + ' best'
  ];
  
  let allResults = [];
  
  for (let i = 0; i < searchVariants.length && (options.exhaustVariants || allResults.length < targetCount * 2); i++) {
    try {
      const results = await spotify.searchTrackList(searchVariants[i], 50);
      if (results && results.length) {
        allResults = allResults.concat(results);
        logger.info(`Music helper: search "${searchVariants[i]}" returned ${results.length} results (total: ${allResults.length})`);
      } else {
        logger.debug(`Music helper: search "${searchVariants[i]}" returned no results`);
      }
    } catch (searchErr) {
      logger.warn(`Music helper: search variant "${searchVariants[i]}" failed: ${searchErr.message}`);
      // Continue to next variant even if one fails
    }
  }
  
  // If no results found, log warning for debugging
  if (allResults.length === 0) {
    logger.warn(`Music helper: multiSearch found no results for query "${query}" after trying ${searchVariants.length} variants`);
  }
  
  return allResults;
}

/**
 * Deduplicate tracks by normalized name and artist
 * @param {Array} tracks - Array of track objects
 * @param {Set} existingKeys - Optional set of already-seen keys to exclude
 * @returns {Array} - Deduplicated array sorted by popularity
 */
function deduplicateTracks(tracks, existingKeys = new Set()) {
  const seen = new Set(existingKeys);
  
  return (tracks || [])
    .filter(t => {
      // Filter out tracks without valid URI
      if (!t.uri || !isValidSpotifyUri(t.uri)) {
        logger.debug(`Music helper: filtering out track without valid URI: "${t.name}" by ${t.artist || 'unknown'}`);
        return false;
      }
      
      const key = normalizeTrackName(t.name) + '|' + (t.artist || '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

/**
 * Search and prepare tracks with optional theme mixing
 * @param {string} query - Search query
 * @param {number} count - Number of tracks to return
 * @param {Object} options - Options object
 * @param {string} options.defaultTheme - Optional theme to mix in
 * @param {number} options.themePercentage - Percentage of tracks that should be theme-based (0-100)
 * @returns {Promise<{tracks: Array, mainCount: number, themeCount: number, query: string, appliedBoosters: Array<string>}>}
 */
async function searchTracks(query, count, options = {}) {
  const { defaultTheme = '', themePercentage = 0, targetType = 'unknown' } = options;
  
  // Apply boosters
  const { query: boostedQuery, appliedBoosters } = applyBoosters(query);
  const exactArtistName = await findExactArtistName(query, targetType);
  
  if (appliedBoosters.length) {
    logger.info(`Music helper: applied boosters [${appliedBoosters.join(', ')}] → query "${boostedQuery}"`);
  }
  if (exactArtistName) {
    logger.info(`Music helper: exact artist lock for "${query}" → "${exactArtistName}"`);
  }
  
  // Calculate theme split
  let themeCount = 0;
  let mainCount = count;
  
  if (defaultTheme && themePercentage > 0) {
    themeCount = Math.round(count * (themePercentage / 100));
    mainCount = count - themeCount;
    logger.info(`Music helper: splitting ${count} tracks → ${mainCount} main + ${themeCount} theme ("${defaultTheme}")`);
  }
  
  // Search for main tracks
  let mainResults = [];
  let uniqueMain = [];
  if (exactArtistName) {
    const quotedArtist = quoteSpotifySearchValue(exactArtistName);
    const artistVariants = [
      `artist:${quotedArtist}`,
      `${exactArtistName} best`,
      `${exactArtistName} greatest hits`,
      `${exactArtistName} top tracks`,
      boostedQuery
    ];
    mainResults = await multiSearch(`artist:${quotedArtist}`, mainCount, {
      variants: artistVariants,
      exhaustVariants: true
    });
    const artistTracks = mainResults.filter(track => trackMatchesArtist(track, exactArtistName));
    uniqueMain = deduplicateTracks(artistTracks);

    if (uniqueMain.length === 0) {
      logger.warn(`Music helper: exact artist lock "${exactArtistName}" found no matching tracks, falling back to loose search`);
    }
  }

  if (uniqueMain.length === 0) {
    mainResults = await multiSearch(boostedQuery, mainCount);
    uniqueMain = deduplicateTracks(mainResults);
  }
  
  // Search for theme tracks if configured
  let uniqueTheme = [];
  if (themeCount > 0 && defaultTheme) {
    const themeVariants = [
      defaultTheme,
      defaultTheme + ' music',
      defaultTheme + ' hits',
      defaultTheme + ' playlist'
    ];
    
    let themeResults = [];
    for (let i = 0; i < themeVariants.length && themeResults.length < themeCount * 2; i++) {
      try {
        const results = await spotify.searchTrackList(themeVariants[i], 50);
        if (results && results.length) {
          themeResults = themeResults.concat(results);
          logger.info(`Music helper: theme search "${themeVariants[i]}" returned ${results.length} results`);
        }
      } catch (searchErr) {
        logger.warn(`Music helper: theme search failed: ${searchErr.message}`);
      }
    }
    
    // Deduplicate theme tracks, excluding any already in main results
    const mainKeys = new Set(uniqueMain.map(t => 
      normalizeTrackName(t.name) + '|' + (t.artist || '').toLowerCase()
    ));
    uniqueTheme = deduplicateTracks(themeResults, mainKeys);
  }
  
  // Take requested counts
  const mainTracks = uniqueMain.slice(0, mainCount);
  const themeTracks = uniqueTheme.slice(0, themeCount);
  
  // Mix them together (interleave theme tracks)
  let tracks = [];
  if (themeTracks.length > 0) {
    const interval = Math.max(1, Math.floor(mainCount / (themeCount + 1)));
    let mainIdx = 0, themeIdx = 0;
    
    while (tracks.length < count && (mainIdx < mainTracks.length || themeIdx < themeTracks.length)) {
      for (let i = 0; i < interval && mainIdx < mainTracks.length && tracks.length < count; i++) {
        tracks.push(mainTracks[mainIdx++]);
      }
      if (themeIdx < themeTracks.length && tracks.length < count) {
        tracks.push(themeTracks[themeIdx++]);
      }
    }
    logger.info(`Music helper: mixed ${mainTracks.length} main + ${themeTracks.length} theme → ${tracks.length} total`);
  } else {
    tracks = uniqueMain.slice(0, count);
  }
  
  return {
    tracks,
    mainCount: mainTracks.length,
    themeCount: themeTracks.length,
    query: boostedQuery,
    appliedBoosters
  };
}

/**
 * Queue tracks to Sonos
 * @param {Object} sonos - Sonos device instance
 * @param {Array} tracks - Array of track objects with uri property
 * @returns {Promise<{added: number, skipped: Array, queuedTracks: Array}>} - Number of successfully queued tracks and skipped tracks
 */
async function queueTracks(sonos, tracks) {
  let added = 0;
  let skipped = [];
  let failed = [];
  let queuedTracks = [];
  
  for (const t of tracks) {
    // Check blacklist if checker is available
    if (isTrackBlacklisted && isTrackBlacklisted(t.name, t.artist)) {
      logger.info(`Music helper: skipping blacklisted track "${t.name}" by ${t.artist}`);
      skipped.push({ name: t.name, artist: t.artist, reason: 'blacklisted' });
      continue;
    }
    
    // Validate URI format
    if (!t.uri || !isValidSpotifyUri(t.uri)) {
      logger.warn(`Music helper: invalid URI for "${t.name}" by ${t.artist}: ${t.uri || 'missing'}`);
      failed.push({ name: t.name, artist: t.artist, reason: 'invalid_uri', uri: t.uri });
      continue;
    }
    
    try {
      await sonos.queue(t.uri);
      added++;
      queuedTracks.push(t);
      logger.debug(`Music helper: successfully queued "${t.name}" by ${t.artist} (${t.uri})`);
    } catch (e) {
      // Extract error code from UPnP error if available
      let errorCode = null;
      let errorDetails = e.message || String(e);
      
      // Try to extract UPnP error code from error message
      const upnpErrorMatch = errorDetails.match(/errorCode[>](\d+)[<]/);
      if (upnpErrorMatch) {
        errorCode = upnpErrorMatch[1];
      }
      
      // Log detailed error information
      if (errorCode === '800') {
        logger.warn(`Music helper: queue failed for "${t.name}" by ${t.artist} - UPnP error 800 (Invalid Action/Args). URI: ${t.uri}. This usually means the track is not available in your region or has been removed from Spotify.`);
      } else {
        logger.warn(`Music helper: queue failed for "${t.name}" by ${t.artist}: ${errorDetails}${errorCode ? ` (error code: ${errorCode})` : ''}. URI: ${t.uri}`);
      }
      
      failed.push({ 
        name: t.name, 
        artist: t.artist, 
        reason: 'queue_failed', 
        uri: t.uri,
        error: errorDetails,
        errorCode: errorCode
      });
    }
  }
  
  const totalSkipped = skipped.length + failed.length;
  logger.info(`Music helper: queued ${added}/${tracks.length} tracks (skipped ${skipped.length} blacklisted, ${failed.length} failed)`);
  
  return { added, skipped: skipped.concat(failed), queuedTracks };
}

/**
 * Full search and queue operation
 * @param {Object} sonos - Sonos device instance
 * @param {string} query - Search query
 * @param {number} count - Number of tracks
 * @param {Object} options - Options
 * @param {boolean} options.useTheme - Whether to mix in theme tracks (default: true)
 * @param {string} options.defaultTheme - Theme to mix in (overrides config)
 * @param {number} options.themePercentage - Theme percentage 0-100 (overrides config)
 * @param {boolean} options.autoPlay - Start playback if stopped (default: true)
 * @returns {Promise<{added: number, skipped: Array, tracks: Array, queuedTracks: Array, mainCount: number, themeCount: number, query: string, wasPlaying: boolean, appliedBoosters: Array<string>}>}
 */
async function searchAndQueue(sonos, query, count, options = {}) {
  const totalStart = process.hrtime.bigint();
  const { autoPlay = true, useTheme = true, targetType = 'unknown' } = options;
  let searchMs = 0;
  let stateMs = 0;
  let queueMs = 0;
  let autoplayMs = 0;
  
  // Get config values if not provided, but only if useTheme is enabled
  let defaultTheme = '';
  let themePercentage = 0;
  
  if (useTheme) {
    defaultTheme = options.defaultTheme ?? (nconf.get('defaultTheme') || '');
    themePercentage = options.themePercentage ?? (parseInt(nconf.get('themePercentage'), 10) || 0);
  }
  
  // Search for tracks
  const searchStart = process.hrtime.bigint();
  const searchResult = await searchTracks(query, count, { defaultTheme, themePercentage, targetType });
  searchMs = elapsedMs(searchStart);
  
  if (!searchResult.tracks.length) {
    logger.info(`[AI_TIMING] music_search_queue query="${query}" count=${count} added=0 searchMs=${searchMs} stateMs=0 queueMs=0 autoplayMs=0 totalMs=${elapsedMs(totalStart)}`);
    return {
      added: 0,
      tracks: [],
      mainCount: 0,
      themeCount: 0,
      query: searchResult.query,
      wasPlaying: false
    };
  }
  
  // Check current state
  let wasPlaying = false;
  let wasPaused = false;
  let queueWasActive = false;
  const stateStart = process.hrtime.bigint();
  try {
    const state = await sonos.getCurrentState();
    logger.info(`Music helper: current state = ${state}`);
    wasPlaying = (state === 'playing' || state === 'transitioning');
    wasPaused = state === 'paused';
    queueWasActive = wasPlaying || wasPaused;
    
    // If stopped, ensure queue is active source and flush
    if (!queueWasActive) {
      logger.info('Music helper: player stopped - ensuring queue is active and flushing');
      try {
        // Stop any active playback to force Sonos to use queue
        try {
          await sonos.stop();
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (stopErr) {
          // Ignore stop errors (might already be stopped)
          logger.debug('Music helper: stop command result (may already be stopped): ' + stopErr.message);
        }
        
        // Flush queue to start fresh
        await sonos.flush();
        await new Promise(resolve => setTimeout(resolve, 300));
        logger.info('Music helper: queue flushed and ready');
      } catch (flushErr) {
        logger.warn('Music helper: could not flush queue: ' + flushErr.message);
      }
    }
  } catch (stateErr) {
    logger.warn('Music helper: could not check state: ' + stateErr.message);
  } finally {
    stateMs = elapsedMs(stateStart);
  }
  
  // Queue the tracks
  const queueStart = process.hrtime.bigint();
  const queueResult = await queueTracks(sonos, searchResult.tracks);
  queueMs = elapsedMs(queueStart);
  
  // Start playback if wasn't playing
  if (autoPlay && queueResult.added > 0 && !wasPlaying) {
    const autoplayStart = process.hrtime.bigint();
    try {
      if (wasPaused) {
        await sonos.play();
        logger.info('Music helper: resumed paused playback');
      } else {
        // Ensure queue is the active source before starting playback
        try {
          await sonos.stop();
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (stopErr) {
          // Ignore stop errors (might already be stopped)
          logger.debug('Music helper: stop before play (may already be stopped): ' + stopErr.message);
        }

        // Wait a moment to ensure queue is ready
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Start playback from queue
        await sonos.play();
        logger.info('Music helper: started playback from queue');
      }
    } catch (playErr) {
      logger.warn('Music helper: could not start playback: ' + playErr.message);
    } finally {
      autoplayMs = elapsedMs(autoplayStart);
    }
  }

  logger.info(
    `[AI_TIMING] music_search_queue query="${query}" count=${count} added=${queueResult.added} ` +
    `searchMs=${searchMs} stateMs=${stateMs} queueMs=${queueMs} autoplayMs=${autoplayMs} totalMs=${elapsedMs(totalStart)}`
  );
  
  return {
    added: queueResult.added,
    skipped: queueResult.skipped,
    tracks: searchResult.tracks,
    queuedTracks: queueResult.queuedTracks,
    mainCount: searchResult.mainCount,
    themeCount: searchResult.themeCount,
    query: searchResult.query,
    appliedBoosters: searchResult.appliedBoosters,
    wasPlaying
  };
}

/**
 * Get the list of available boosters (for debugging/info)
 * @returns {Array} - Array of booster patterns
 */
function getBoosters() {
  return BOOSTERS.map(b => ({
    pattern: b.match.toString(),
    adds: b.add.trim()
  }));
}

module.exports = {
  initialize,
  applyBoosters,
  searchTracks,
  queueTracks,
  searchAndQueue,
  deduplicateTracks,
  normalizeTrackName,
  getBoosters,
  BOOSTERS,
  isValidSpotifyUri
};
