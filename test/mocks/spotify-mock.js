/**
 * Spotify Mock for Testing
 * Provides mocks for Spotify API responses
 * Can use fixtures from test/fixtures/spotify-responses.json if available
 */

import sinon from 'sinon';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, '..', 'fixtures', 'spotify-responses.json');

// Load fixtures if available
let fixtures = null;
try {
  if (existsSync(FIXTURES_PATH)) {
    fixtures = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));
  }
} catch (e) {
  // Fixtures not available, will use defaults
}

/**
 * Default track data for testing
 */
export const defaultTrack = {
  name: 'Test Track',
  uri: 'spotify:track:test123',
  id: 'test123',
  artists: [{ name: 'Test Artist', id: 'artist123' }],
  album: {
    name: 'Test Album',
    id: 'album123',
    images: [{ url: 'http://example.com/cover.jpg', width: 300, height: 300 }]
  },
  duration_ms: 180000,
  popularity: 75,
  external_urls: { spotify: 'https://open.spotify.com/track/test123' }
};

/**
 * Default album data for testing
 */
export const defaultAlbum = {
  name: 'Test Album',
  uri: 'spotify:album:album123',
  id: 'album123',
  artists: [{ name: 'Test Artist', id: 'artist123' }],
  images: [{ url: 'http://example.com/cover.jpg', width: 300, height: 300 }],
  total_tracks: 12,
  release_date: '2023-01-01',
  external_urls: { spotify: 'https://open.spotify.com/album/album123' },
  tracks: {
    items: [
      { name: 'Track 1', uri: 'spotify:track:t1', track_number: 1 },
      { name: 'Track 2', uri: 'spotify:track:t2', track_number: 2 },
      { name: 'Track 3', uri: 'spotify:track:t3', track_number: 3 }
    ]
  }
};

/**
 * Default playlist data for testing
 */
export const defaultPlaylist = {
  name: 'Test Playlist',
  uri: 'spotify:playlist:playlist123',
  id: 'playlist123',
  owner: { display_name: 'Test User', id: 'user123' },
  images: [{ url: 'http://example.com/cover.jpg' }],
  tracks: {
    total: 50,
    items: [
      { track: { ...defaultTrack, name: 'Playlist Track 1' } },
      { track: { ...defaultTrack, name: 'Playlist Track 2' } },
      { track: { ...defaultTrack, name: 'Playlist Track 3' } }
    ]
  },
  external_urls: { spotify: 'https://open.spotify.com/playlist/playlist123' }
};

/**
 * Create a mock Spotify API client
 * @param {Object} options - Configuration options
 * @returns {Object} Mock Spotify API
 */
export function createSpotifyMock(options = {}) {
  const searchResults = {
    tracks: {
      items: options.tracks || [defaultTrack],
      total: options.tracksTotal || 1
    },
    albums: {
      items: options.albums || [defaultAlbum],
      total: options.albumsTotal || 1
    },
    playlists: {
      items: options.playlists || [defaultPlaylist],
      total: options.playlistsTotal || 1
    }
  };

  const mock = {
    // Search methods
    getTrack: sinon.stub().callsFake(async (query, limit = 10) => {
      if (fixtures?.searchTrack?.[query]) {
        return fixtures.searchTrack[query];
      }
      return { ...searchResults.tracks, items: searchResults.tracks.items.slice(0, limit) };
    }),
    
    getAlbum: sinon.stub().callsFake(async (query, limit = 10) => {
      if (fixtures?.searchAlbum?.[query]) {
        return fixtures.searchAlbum[query];
      }
      return { ...searchResults.albums, items: searchResults.albums.items.slice(0, limit) };
    }),
    
    getPlaylist: sinon.stub().callsFake(async (query, limit = 10) => {
      if (fixtures?.searchPlaylist?.[query]) {
        return fixtures.searchPlaylist[query];
      }
      return { ...searchResults.playlists, items: searchResults.playlists.items.slice(0, limit) };
    }),
    
    // Artist methods
    getArtistTopTracks: sinon.stub().callsFake(async (artistId, market = 'US') => {
      if (fixtures?.searchTrackList?.bestof) {
        return fixtures.searchTrackList.bestof;
      }
      return {
        tracks: Array(10).fill(null).map((_, i) => ({
          ...defaultTrack,
          name: `Top Track ${i + 1}`,
          popularity: 100 - i * 5
        }))
      };
    }),
    
    searchArtists: sinon.stub().resolves({
      artists: {
        items: [{
          id: 'artist123',
          name: 'Test Artist',
          popularity: 80,
          genres: ['rock', 'pop']
        }]
      }
    }),
    
    // Album methods
    getAlbumTracks: sinon.stub().resolves({
      items: defaultAlbum.tracks.items,
      total: defaultAlbum.tracks.items.length
    }),
    
    // Playlist methods
    getPlaylistTracks: sinon.stub().resolves({
      items: defaultPlaylist.tracks.items,
      total: defaultPlaylist.tracks.total
    }),
    
    // Token management
    refreshToken: sinon.stub().resolves({ access_token: 'new_token', expires_in: 3600 }),
    
    // Helper methods
    _setSearchResults: function(type, items) {
      if (type === 'tracks') searchResults.tracks.items = items;
      if (type === 'albums') searchResults.albums.items = items;
      if (type === 'playlists') searchResults.playlists.items = items;
    },
    
    _reset: function() {
      Object.keys(mock).forEach(key => {
        if (mock[key] && typeof mock[key].reset === 'function') {
          mock[key].reset();
        }
      });
    }
  };

  return mock;
}

/**
 * Create a mock that simulates Spotify API errors
 */
export function createErrorSpotifyMock(errorType = 'auth') {
  const errors = {
    auth: { status: 401, message: 'Invalid access token' },
    notFound: { status: 404, message: 'Resource not found' },
    rateLimit: { status: 429, message: 'Rate limit exceeded', retryAfter: 30 },
    server: { status: 500, message: 'Internal server error' },
    network: new Error('ECONNREFUSED: Connection refused')
  };

  const error = errors[errorType];
  const rejection = errorType === 'network' ? error : Object.assign(new Error(error.message), error);

  return {
    getTrack: sinon.stub().rejects(rejection),
    getAlbum: sinon.stub().rejects(rejection),
    getPlaylist: sinon.stub().rejects(rejection),
    getArtistTopTracks: sinon.stub().rejects(rejection),
    searchArtists: sinon.stub().rejects(rejection),
    getAlbumTracks: sinon.stub().rejects(rejection),
    getPlaylistTracks: sinon.stub().rejects(rejection),
    refreshToken: sinon.stub().rejects(rejection)
  };
}

/**
 * Create sample track data for testing
 */
export function createTrackData(overrides = {}) {
  return { ...defaultTrack, ...overrides };
}

/**
 * Create sample album data for testing
 */
export function createAlbumData(overrides = {}) {
  return { ...defaultAlbum, ...overrides };
}

/**
 * Create sample playlist data for testing
 */
export function createPlaylistData(overrides = {}) {
  return { ...defaultPlaylist, ...overrides };
}

/**
 * Create a list of tracks with varying popularity (for bestof testing)
 */
export function createPopularityRankedTracks(count = 10, artist = 'Test Artist') {
  return Array(count).fill(null).map((_, i) => ({
    ...defaultTrack,
    name: `Track ${i + 1}`,
    id: `track${i + 1}`,
    uri: `spotify:track:track${i + 1}`,
    artists: [{ name: artist, id: 'artist123' }],
    popularity: Math.max(100 - i * 8, 10) // Decreasing popularity
  }));
}

export default {
  createSpotifyMock,
  createErrorSpotifyMock,
  createTrackData,
  createAlbumData,
  createPlaylistData,
  createPopularityRankedTracks,
  defaultTrack,
  defaultAlbum,
  defaultPlaylist
};
