'use strict'

const config = require('nconf')
const winston = require('winston')

config.argv()
    .env()
    .file({ file: 'config.json' })
    .defaults({
        'logLevel': 'info',
    })

const logLevel = config.get('logLevel')

module.exports = function (config) {
    if (module.exports.instance) {
        return module.exports.instance
    }

    config = config || {}
    let accessToken
    let accessTokenExpires = 0

    /* Initialize Logger */
    const logger = winston.createLogger({
        level: logLevel,
        format: winston.format.json(),
        transports: [
            new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) })
        ]
    });

    async function _getAccessToken() {
        if (accessToken && accessTokenExpires > new Date().getTime()) {
            return accessToken
        }

        try {
            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + (Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64')),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'grant_type=client_credentials'
            });

            if (!response.ok) {
                throw new Error(`Failed to get access token: ${response.statusText}`);
            }

            const tokendata = await response.json();
            accessTokenExpires = new Date().getTime() + (tokendata.expires_in - 10) * 1000;
            accessToken = tokendata.access_token;
            return accessToken;
        } catch (error) {
            logger.error('Error getting Spotify access token:', error);
            throw error;
        }
    }

    async function _search(endpoint, params) {
        const token = await _getAccessToken();
        const queryParams = new URLSearchParams(params).toString();
        const url = `https://api.spotify.com/v1/${endpoint}?${queryParams}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Spotify API error: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Convert Spotify HTTP links to Spotify URIs
     * Example: https://open.spotify.com/track/2PZHam8oh74c1xTQFo86dY?si=... → spotify:track:2PZHam8oh74c1xTQFo86dY
     */
    function _convertSpotifyLinkToUri(term) {
        // Check if it's a Spotify HTTP link
        const linkPattern = /https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)(\?.*)?/;
        const match = term.match(linkPattern);

        if (match) {
            const type = match[1];  // track, album, or playlist
            const id = match[2];    // the Spotify ID
            return `spotify:${type}:${id}`;
        }

        // Return the original term if it's not a Spotify link
        return term;
    }

    module.exports.instance = {
        // Modern async methods
        getTrack: async function (term) {
            // Convert Spotify HTTP links to URIs
            term = _convertSpotifyLinkToUri(term);

            // If it's a Spotify URI
            if (term.startsWith('spotify:track:')) {
                const trackId = term.split(':')[2];
                const data = await _search(`tracks/${trackId}`, { market: config.market });
                return {
                    name: data.name,
                    artist: data.artists[0].name,
                    uri: data.uri
                };
            }

            // Search
            const data = await _search('search', {
                q: term,
                type: 'track',
                limit: 1,
                market: config.market
            });

            if (!data.tracks || !data.tracks.items || data.tracks.items.length === 0) {
                throw new Error('Track not found');
            }

            const track = data.tracks.items[0];
            return {
                name: track.name,
                artist: track.artists[0].name,
                uri: track.uri
            };
        },

        getAlbum: async function (term) {
            // Convert Spotify HTTP links to URIs
            term = _convertSpotifyLinkToUri(term);

            if (term.startsWith('spotify:album:')) {
                const albumId = term.split(':')[2];
                const data = await _search(`albums/${albumId}`, { market: config.market });
                return {
                    name: data.name,
                    artist: data.artists[0].name,
                    uri: data.uri,
                    coverUrl: data.images && data.images.length > 0 ? data.images[0].url : null
                };
            }

            const data = await _search('search', {
                q: term,
                type: 'album',
                limit: 1,
                market: config.market
            });

            if (!data.albums || !data.albums.items || data.albums.items.length === 0) {
                throw new Error('Album not found');
            }

            const album = data.albums.items[0];
            return {
                name: album.name,
                artist: album.artists[0].name,
                uri: album.uri,
                coverUrl: album.images && album.images.length > 0 ? album.images[0].url : null
            };
        },

        getPlaylist: async function (term) {
            // Convert Spotify HTTP links to URIs
            term = _convertSpotifyLinkToUri(term);

            if (term.startsWith('spotify:playlist:')) {
                const playlistId = term.split(':')[2];
                const data = await _search(`playlists/${playlistId}`, { market: config.market });
                return {
                    name: data.name,
                    owner: data.owner.display_name,
                    tracks: data.tracks.total,
                    uri: data.uri
                };
            }

            const data = await _search('search', {
                q: term,
                type: 'playlist',
                limit: 1,
                market: config.market
            });

            if (!data.playlists || !data.playlists.items || data.playlists.items.length === 0) {
                throw new Error('Playlist not found');
            }

            const playlist = data.playlists.items[0];
            return {
                name: playlist.name,
                owner: playlist.owner.display_name,
                tracks: playlist.tracks.total,
                uri: playlist.uri
            };
        },

        // Get all tracks from an album
        getAlbumTracks: async function (albumUri) {
            const albumId = albumUri.split(':')[2];
            const data = await _search(`albums/${albumId}/tracks`, { 
                market: config.market,
                limit: 50 
            });
            
            if (!data.items) {
                return [];
            }

            return data.items.map(track => ({
                name: track.name,
                artist: track.artists[0].name,
                uri: track.uri
            }));
        },

        // Get all tracks from a playlist
        getPlaylistTracks: async function (playlistUri) {
            const playlistId = playlistUri.split(':')[2];
            const data = await _search(`playlists/${playlistId}/tracks`, { 
                market: config.market,
                limit: 100
            });
            
            if (!data.items) {
                return [];
            }

            return data.items.map(item => ({
                name: item.track.name,
                artist: item.track.artists[0].name,
                uri: item.track.uri
            }));
        },

        searchTrackList: async function (term, limit) {
            const data = await _search('search', {
                q: term,
                type: 'track',
                limit: limit,
                market: config.market
            });

            if (!data.tracks || !data.tracks.items) {
                return [];
            }

            return data.tracks.items.map(track => ({
                name: track.name,
                artist: track.artists[0].name,
                uri: track.uri,
                artists: track.artists, // Keep full artists array for display
                popularity: track.popularity // Keep popularity for sorting
            }));
        },

        searchAlbumList: async function (term, limit) {
            const data = await _search('search', {
                q: term,
                type: 'album',
                limit: limit,
                market: config.market
            });

            if (!data.albums || !data.albums.items) {
                return [];
            }

            return data.albums.items.map(album => ({
                name: album.name,
                artist: album.artists[0].name,
                uri: album.uri
            }));
        },

        searchPlaylistList: async function (term, limit) {
            const data = await _search('search', {
                q: term,
                type: 'playlist',
                limit: limit,
                market: config.market
            });

            logger.info(`[SPOTIFY DEBUG] Playlist search for "${term}": ${JSON.stringify(data.playlists)}`);

            if (!data.playlists || !data.playlists.items) {
                logger.warn('[SPOTIFY DEBUG] No playlists or items in response');
                return [];
            }

            logger.info(`[SPOTIFY DEBUG] Found ${data.playlists.items.length} items before filtering`);

            const filtered = data.playlists.items
                .filter(playlist => playlist && playlist.name); // Filter out null/undefined items

            logger.info(`[SPOTIFY DEBUG] ${filtered.length} items after filtering`);

            return filtered.map(playlist => ({
                name: playlist.name,
                owner: playlist.owner?.display_name || 'Unknown',
                tracks: playlist.tracks?.total || 0,
                uri: playlist.uri
            }));
        },

        searchArtistList: async function (term, limit) {
            const data = await _search('search', {
                q: term,
                type: 'artist',
                limit: limit,
                market: config.market
            });

            if (!data.artists || !data.artists.items) {
                return [];
            }

            return data.artists.items.map(artist => ({
                name: artist.name,
                uri: artist.uri
            }));
        }
    }

    return module.exports.instance
}

async function searchArtist(name) {
    const data = await doSearch(name, 'artist');
    if (data && data.artists && data.artists.items.length > 0) {
        return data.artists.items[0];
    }
    return null;
}

async function getArtistTopTracks(artistId, market) {
    const url = `${API_BASE}/artists/${artistId}/top-tracks?market=${market}`;
    const response = await fetch(url, { headers: authHeader() });
    const data = await response.json();
    return data.tracks || [];
}


