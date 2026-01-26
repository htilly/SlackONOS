/**
 * Queue Utilities
 * Pure functions for queue operations, sorting, and source detection
 */

/**
 * Sort albums by relevance to search term
 * Prioritizes exact matches of both artist and album name
 * @param {Array} albums - Array of album objects from Spotify
 * @param {string} searchTerm - The search term used
 * @returns {Array} Sorted array of albums
 */
function sortAlbumsByRelevance(albums, searchTerm) {
  if (!albums || !Array.isArray(albums) || albums.length === 0) {
    return albums || [];
  }
  if (!searchTerm || typeof searchTerm !== 'string') {
    return albums;
  }

  const termLower = searchTerm.toLowerCase();
  
  // Try to detect "artist - album", "album - artist", "album by artist", or "artist by album" format
  let separatorIndex = -1;
  let separatorLength = 0;
  
  // Check for " - " separator
  if (termLower.includes(' - ')) {
    separatorIndex = termLower.indexOf(' - ');
    separatorLength = 3;
  }
  // Check for " by " separator
  else if (termLower.includes(' by ')) {
    separatorIndex = termLower.indexOf(' by ');
    separatorLength = 4;
  }
  
  let artistWords = [];
  let albumWords = [];
  
  if (separatorIndex > 0) {
    const part1 = termLower.substring(0, separatorIndex).trim();
    const part2 = termLower.substring(separatorIndex + separatorLength).trim();
    
    // For "by" separator: "album by artist" is most common
    // For "-" separator: "artist - album" is most common
    if (termLower.includes(' by ')) {
      albumWords = part1.split(/\s+/).filter(w => w.length > 1);
      artistWords = part2.split(/\s+/).filter(w => w.length > 2);
    } else {
      artistWords = part1.split(/\s+/).filter(w => w.length > 2);
      albumWords = part2.split(/\s+/).filter(w => w.length > 1);
    }
  } else {
    albumWords = termLower.split(/\s+/).filter(w => w.length > 1);
  }
  
  return [...albums].sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const aArtist = (a.artist || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    const bArtist = (b.artist || '').toLowerCase();
    
    let aScore = 0;
    let bScore = 0;
    
    if (artistWords.length > 0 && albumWords.length > 0) {
      const aArtistMatch = artistWords.every(word => aArtist.includes(word));
      const bArtistMatch = artistWords.every(word => bArtist.includes(word));
      const aAlbumMatch = albumWords.every(word => aName.includes(word));
      const bAlbumMatch = albumWords.every(word => bName.includes(word));
      
      if (aArtistMatch && aAlbumMatch) aScore += 10000;
      if (bArtistMatch && bAlbumMatch) bScore += 10000;
      if (aAlbumMatch) aScore += 5000;
      if (bAlbumMatch) bScore += 5000;
      if (aArtistMatch) aScore += 2000;
      if (bArtistMatch) bScore += 2000;
    } else {
      const aAlbumMatches = albumWords.filter(w => aName.includes(w)).length;
      const bAlbumMatches = albumWords.filter(w => bName.includes(w)).length;
      aScore += aAlbumMatches * 1000;
      bScore += bAlbumMatches * 1000;
      
      const aArtistMatches = albumWords.filter(w => w.length > 3 && aArtist.includes(w)).length;
      const bArtistMatches = albumWords.filter(w => w.length > 3 && bArtist.includes(w)).length;
      aScore += aArtistMatches * 500;
      bScore += bArtistMatches * 500;
    }
    
    if (aScore === bScore) {
      return (b.popularity || 0) - (a.popularity || 0);
    }
    
    return bScore - aScore;
  });
}

/**
 * Sort playlists by relevance to search term
 * Prioritizes exact matches and follower count
 * @param {Array} playlists - Array of playlist objects from Spotify
 * @param {string} searchTerm - The search term used
 * @returns {Array} Sorted array of playlists
 */
function sortPlaylistsByRelevance(playlists, searchTerm) {
  if (!playlists || !Array.isArray(playlists) || playlists.length === 0) {
    return playlists || [];
  }
  if (!searchTerm || typeof searchTerm !== 'string') {
    return playlists;
  }

  const termLower = searchTerm.toLowerCase();
  const searchWords = termLower.split(/\s+/).filter(w => w.length > 2);
  
  return [...playlists].sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    
    let aScore = 0;
    let bScore = 0;
    
    // Exact match in playlist name
    if (aName.includes(termLower)) aScore += 10000;
    if (bName.includes(termLower)) bScore += 10000;
    
    // Word matches
    const aMatches = searchWords.filter(w => aName.includes(w)).length;
    const bMatches = searchWords.filter(w => bName.includes(w)).length;
    aScore += aMatches * 1000;
    bScore += bMatches * 1000;
    
    // Use followers as tie-breaker (popular playlists are usually better)
    if (aScore === bScore) {
      return (b.followers || 0) - (a.followers || 0);
    }
    
    return bScore - aScore;
  });
}

/**
 * Sort tracks by relevance to search term
 * Prioritizes exact matches of both artist and track name
 * @param {Array} tracks - Array of track objects from Spotify
 * @param {string} searchTerm - The search term used
 * @returns {Array} Sorted array of tracks
 */
function sortTracksByRelevance(tracks, searchTerm) {
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return tracks || [];
  }
  if (!searchTerm || typeof searchTerm !== 'string') {
    return tracks;
  }

  const termLower = searchTerm.toLowerCase();
  
  // Try to detect "artist - track", "track - artist", "track by artist", or "artist by track" format
  let separatorIndex = -1;
  let separatorLength = 0;
  
  // Check for " - " separator
  if (termLower.includes(' - ')) {
    separatorIndex = termLower.indexOf(' - ');
    separatorLength = 3;
  }
  // Check for " by " separator
  else if (termLower.includes(' by ')) {
    separatorIndex = termLower.indexOf(' by ');
    separatorLength = 4;
  }
  
  let artistWords = [];
  let trackWords = [];
  
  if (separatorIndex > 0) {
    // Split on separator to separate artist and track
    const part1 = termLower.substring(0, separatorIndex).trim();
    const part2 = termLower.substring(separatorIndex + separatorLength).trim();
    
    // For "by" separator: "track by artist" is most common
    // For "-" separator: "artist - track" is most common
    if (termLower.includes(' by ')) {
      // "Best of You by Foo Fighters" -> track by artist
      trackWords = part1.split(/\s+/).filter(w => w.length > 1);
      artistWords = part2.split(/\s+/).filter(w => w.length > 2);
    } else {
      // "Foo Fighters - Best of You" -> artist - track
      artistWords = part1.split(/\s+/).filter(w => w.length > 2);
      trackWords = part2.split(/\s+/).filter(w => w.length > 1);
    }
  } else {
    // No clear separator, split all words
    trackWords = termLower.split(/\s+/).filter(w => w.length > 1);
  }
  
  return [...tracks].sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const aArtist = (a.artists?.[0]?.name || a.artist || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    const bArtist = (b.artists?.[0]?.name || b.artist || '').toLowerCase();
    
    let aScore = 0;
    let bScore = 0;
    
    // HIGHEST PRIORITY: Both artist AND track match
    if (artistWords.length > 0 && trackWords.length > 0) {
      const aArtistMatch = artistWords.every(word => aArtist.includes(word));
      const bArtistMatch = artistWords.every(word => bArtist.includes(word));
      const aTrackMatch = trackWords.every(word => aName.includes(word));
      const bTrackMatch = trackWords.every(word => bName.includes(word));
      
      if (aArtistMatch && aTrackMatch) aScore += 10000;
      if (bArtistMatch && bTrackMatch) bScore += 10000;
      
      // High priority: Track name matches even if artist doesn't
      if (aTrackMatch) aScore += 5000;
      if (bTrackMatch) bScore += 5000;
      
      // Medium priority: Artist matches
      if (aArtistMatch) aScore += 2000;
      if (bArtistMatch) bScore += 2000;
    } else {
      // No " - " separator: check if words match track name or artist
      const aTrackMatches = trackWords.filter(w => aName.includes(w)).length;
      const bTrackMatches = trackWords.filter(w => bName.includes(w)).length;
      aScore += aTrackMatches * 1000;
      bScore += bTrackMatches * 1000;
      
      // Check artist matches (lower priority)
      const aArtistMatches = trackWords.filter(w => w.length > 3 && aArtist.includes(w)).length;
      const bArtistMatches = trackWords.filter(w => w.length > 3 && bArtist.includes(w)).length;
      aScore += aArtistMatches * 500;
      bScore += bArtistMatches * 500;
    }
    
    // Use popularity as tie-breaker
    if (aScore === bScore) {
      return (b.popularity || 0) - (a.popularity || 0);
    }
    
    return bScore - aScore;
  });
}

/**
 * Find track in queue by title and artist
 * @param {Array} queueItems - Array of queue items
 * @param {string} title - Track title to find
 * @param {string} artist - Track artist to find
 * @returns {Object|null} { index, position } or null if not found
 */
function findTrackInQueue(queueItems, title, artist) {
  if (!queueItems || !Array.isArray(queueItems)) {
    return null;
  }
  
  const foundIndex = queueItems.findIndex((item) =>
    item.title === title && item.artist === artist
  );
  
  if (foundIndex >= 0) {
    return {
      index: foundIndex,
      position: foundIndex + 1 // 1-based position
    };
  }
  
  return null;
}

/**
 * Check if a track is a duplicate in the queue
 * @param {Array} queueItems - Array of queue items
 * @param {Object} track - Track to check { uri, title/name, artist/artists }
 * @returns {boolean} True if duplicate found
 */
function isDuplicateTrack(queueItems, track) {
  if (!queueItems || !Array.isArray(queueItems) || !track) {
    return false;
  }
  
  // Check by URI first (most reliable)
  if (track.uri) {
    const uriMatch = queueItems.some(item => item.uri === track.uri);
    if (uriMatch) return true;
  }
  
  // Check by title and artist
  const trackTitle = (track.title || track.name || '').toLowerCase();
  const trackArtist = (track.artist || track.artists?.[0]?.name || '').toLowerCase();
  
  if (trackTitle && trackArtist) {
    return queueItems.some(item => {
      const itemTitle = (item.title || item.name || '').toLowerCase();
      const itemArtist = (item.artist || '').toLowerCase();
      return itemTitle === trackTitle && itemArtist === trackArtist;
    });
  }
  
  return false;
}

/**
 * Determine source type from track and queue information
 * Pure function version - takes data as input instead of calling Sonos
 * @param {Object} track - Current track info with queuePosition
 * @param {Array} queueItems - Queue items array
 * @returns {Object} { type: 'queue'|'external', queuePosition?, note?, track? }
 */
function determineSourceType(track, queueItems) {
  if (!track) return null;
  
  // Check if track has queuePosition - if yes, it's from queue
  if (track.queuePosition !== undefined && track.queuePosition !== null && track.queuePosition > 0) {
    if (queueItems && Array.isArray(queueItems)) {
      // Verify the track actually exists at that position
      const queueIndex = track.queuePosition - 1; // Convert to 0-based index
      if (queueIndex >= 0 && queueIndex < queueItems.length) {
        const queueItem = queueItems[queueIndex];
        // Verify it's the same track
        if (queueItem.title === track.title && queueItem.artist === track.artist) {
          return { type: 'queue', queuePosition: track.queuePosition };
        }
      }
      
      // Try to find track by name/artist match
      const found = findTrackInQueue(queueItems, track.title, track.artist);
      if (found) {
        return { type: 'queue', queuePosition: found.position, note: 'position_mismatch' };
      }
    }
  } else if (queueItems && Array.isArray(queueItems)) {
    // No queuePosition - try to find in queue
    const found = findTrackInQueue(queueItems, track.title, track.artist);
    if (found) {
      return { type: 'queue', queuePosition: found.position };
    }
  }
  
  // Track not in queue - external source
  return { type: 'external', track: { title: track.title, artist: track.artist } };
}

/**
 * Convert user position (0-based from list display) to Sonos position (1-based)
 * @param {number} userPosition - Position as displayed to user (0-based)
 * @returns {number} Sonos 1-based position
 */
function toSonosPosition(userPosition) {
  return userPosition + 1;
}

/**
 * Convert Sonos position (1-based) to user position (0-based for list display)
 * @param {number} sonosPosition - Sonos 1-based position
 * @returns {number} 0-based position for display
 */
function toUserPosition(sonosPosition) {
  return sonosPosition - 1;
}

/**
 * Validate queue position is within bounds
 * @param {number} position - Position to validate (1-based)
 * @param {number} queueLength - Total items in queue
 * @returns {boolean} True if valid
 */
function isValidQueuePosition(position, queueLength) {
  return Number.isInteger(position) && position >= 1 && position <= queueLength;
}

module.exports = {
  sortAlbumsByRelevance,
  sortPlaylistsByRelevance,
  sortTracksByRelevance,
  findTrackInQueue,
  isDuplicateTrack,
  determineSourceType,
  toSonosPosition,
  toUserPosition,
  isValidQueuePosition
};
