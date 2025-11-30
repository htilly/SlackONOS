/**
 * Music Helper Module
 * Handles Spotify search, boosters, theme mixing, and track queuing
 */

const nconf = require('nconf');

let spotify = null;
let logger = null;

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
 */
function initialize(spotifyModule, loggerModule) {
  spotify = spotifyModule;
  logger = loggerModule;
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

/**
 * Search Spotify with multiple query variants to get enough results
 * @param {string} query - Search query
 * @param {number} targetCount - How many unique tracks we want
 * @returns {Promise<Array>} - Array of track objects
 */
async function multiSearch(query, targetCount) {
  const searchVariants = [
    query,
    query + ' 2024',
    query + ' 2023',
    query + ' classic',
    query + ' best'
  ];
  
  let allResults = [];
  
  for (let i = 0; i < searchVariants.length && allResults.length < targetCount * 2; i++) {
    try {
      const results = await spotify.searchTrackList(searchVariants[i], 50);
      if (results && results.length) {
        allResults = allResults.concat(results);
        logger.info(`Music helper: search "${searchVariants[i]}" returned ${results.length} results (total: ${allResults.length})`);
      }
    } catch (searchErr) {
      logger.warn(`Music helper: search variant failed: ${searchErr.message}`);
    }
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
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .filter(t => {
      const key = normalizeTrackName(t.name) + '|' + (t.artist || '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Search and prepare tracks with optional theme mixing
 * @param {string} query - Search query
 * @param {number} count - Number of tracks to return
 * @param {Object} options - Options object
 * @param {string} options.defaultTheme - Optional theme to mix in
 * @param {number} options.themePercentage - Percentage of tracks that should be theme-based (0-100)
 * @returns {Promise<{tracks: Array, mainCount: number, themeCount: number, query: string}>}
 */
async function searchTracks(query, count, options = {}) {
  const { defaultTheme = '', themePercentage = 0 } = options;
  
  // Apply boosters
  const { query: boostedQuery, appliedBoosters } = applyBoosters(query);
  
  if (appliedBoosters.length) {
    logger.info(`Music helper: applied boosters [${appliedBoosters.join(', ')}] → query "${boostedQuery}"`);
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
  const mainResults = await multiSearch(boostedQuery, mainCount);
  const uniqueMain = deduplicateTracks(mainResults);
  
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
    query: boostedQuery
  };
}

/**
 * Queue tracks to Sonos
 * @param {Object} sonos - Sonos device instance
 * @param {Array} tracks - Array of track objects with uri property
 * @returns {Promise<number>} - Number of successfully queued tracks
 */
async function queueTracks(sonos, tracks) {
  let added = 0;
  
  for (const t of tracks) {
    try {
      await sonos.queue(t.uri);
      added++;
    } catch (e) {
      logger.warn(`Music helper: queue failed for "${t.name}": ${e.message}`);
    }
  }
  
  logger.info(`Music helper: queued ${added}/${tracks.length} tracks`);
  return added;
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
 * @returns {Promise<{added: number, tracks: Array, mainCount: number, themeCount: number, query: string, wasPlaying: boolean}>}
 */
async function searchAndQueue(sonos, query, count, options = {}) {
  const { autoPlay = true, useTheme = true } = options;
  
  // Get config values if not provided, but only if useTheme is enabled
  let defaultTheme = '';
  let themePercentage = 0;
  
  if (useTheme) {
    defaultTheme = options.defaultTheme ?? (nconf.get('defaultTheme') || '');
    themePercentage = options.themePercentage ?? (parseInt(nconf.get('themePercentage'), 10) || 0);
  }
  
  // Search for tracks
  const searchResult = await searchTracks(query, count, { defaultTheme, themePercentage });
  
  if (!searchResult.tracks.length) {
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
  try {
    const state = await sonos.getCurrentState();
    logger.info(`Music helper: current state = ${state}`);
    wasPlaying = (state === 'playing' || state === 'transitioning');
    
    // If stopped, flush queue first
    if (!wasPlaying) {
      logger.info('Music helper: player stopped - flushing queue first');
      await sonos.flush();
    }
  } catch (stateErr) {
    logger.warn('Music helper: could not check state: ' + stateErr.message);
  }
  
  // Queue the tracks
  const added = await queueTracks(sonos, searchResult.tracks);
  
  // Start playback if wasn't playing
  if (autoPlay && !wasPlaying && added > 0) {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      await sonos.play();
      logger.info('Music helper: started playback');
    } catch (playErr) {
      logger.warn('Music helper: could not start playback: ' + playErr.message);
    }
  }
  
  return {
    added,
    tracks: searchResult.tracks,
    mainCount: searchResult.mainCount,
    themeCount: searchResult.themeCount,
    query: searchResult.query,
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
  BOOSTERS
};
