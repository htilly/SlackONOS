'use strict'

const config = require('nconf')
const urllibsync = require('@jsfeb26/urllib-sync')
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
    let accessTokenExpires

    /* Initialize Logger */
    const logger = winston.createLogger({
        level: logLevel,
        format: winston.format.json(),
        transports: [
            new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) })
        ]
    });

    function _getAccessToken() {
        if (accessToken && accessTokenExpires > new Date().getTime()) {
            return accessToken
        }

        let getToken = urllibsync.request('https://accounts.spotify.com/api/token', {
            method: 'POST',
            data: { 'grant_type': 'client_credentials' },
            headers: { 'Authorization': 'Basic ' + (Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64')) }
        })
        let tokendata = JSON.parse(getToken.data.toString())
        accessTokenExpires = new Date().getTime() + (tokendata.expires_in - 10) * 1000
        accessToken = tokendata.access_token
        return accessToken
    }

    module.exports.instance = {

        // TODO - refactor duplicate boilerplate below
        // TODO - move messaging to index, get rid of channel/username args
        searchSpotify: function (input, channel, userName, limit) {
            let accessToken = _getAccessToken()
            if (!accessToken) {
                return false
            }

            var query = ''
            for (var i = 1; i < input.length; i++) {
                query += encodeURIComponent(input[i])
                // TODO - join
                if (i < input.length - 1) {
                    query += ' '
                }
            }

            var getapi = urllibsync.request(
                'https://api.spotify.com/v1/search?q=' +
                query +
                '&type=track&limit=' +
                limit +
                '&market=' +
                config.market +
                '&access_token=' +
                accessToken
            )

            var data = JSON.parse(getapi.data.toString())

            config.logger.debug(data)
            if (!data.tracks || !data.tracks.items || data.tracks.items.length === 0) {
                var message = 'Sorry ' + userName + ', I could not find that track :('
                data = null
            }

            return [data, message]
        },

        searchSpotifyPlaylist: function (input, channel, userName, limit) {
            let accessToken = _getAccessToken()
            if (!accessToken) {
                return false
            }

            var query = ''
            for (var i = 1; i < input.length; i++) {
                query += encodeURIComponent(input[i])
                if (i < input.length - 1) {
                    query += ' '
                }
            }

            var getapi = urllibsync.request(
                'https://api.spotify.com/v1/search?q=' +
                query +
                '&type=playlist&limit=' +
                limit +
                '&market=' +
                config.market +
                '&access_token=' +
                accessToken
            )

            var data = JSON.parse(getapi.data.toString())
            logger.debug(data)
            if (!data.playlists || !data.playlists.items || data.playlists.items.length === 0) {
                var message = 'Sorry ' + userName + ', I could not find that playlist :('
                data = null
            }

            return [data, message]
        },

        searchSpotifyAlbum: function (input, channel, userName, limit) {
            let accessToken = _getAccessToken()
            if (!accessToken) {
                return false
            }

            var query = ''
            for (var i = 1; i < input.length; i++) {
                query += encodeURIComponent(input[i])
                if (i < input.length - 1) {
                    query += ' '
                }
            }

            var getapi = urllibsync.request(
                'https://api.spotify.com/v1/search?q=' +
                query +
                '&type=album&limit=' +
                limit +
                '&market=' +
                config.market +
                '&access_token=' +
                accessToken
            )

            var data = JSON.parse(getapi.data.toString())
            config.logger.debug(data)
            if (!data.albums || !data.albums.items || data.albums.items.length === 0) {
                var message = 'Sorry ' + userName + ', I could not find that album :('
                data = null
            }

            return [data, message]
        },

        searchSpotifyArtist: function (input, channel, userName, limit) {
            let accessToken = _getAccessToken()
            if (!accessToken) {
                return false
            }

            var query = ''
            for (var i = 1; i < input.length; i++) {
                query += encodeURIComponent(input[i])
                if (i < input.length - 1) {
                    query += ' '
                }
            }

            var getapi = urllibsync.request(
                'https://api.spotify.com/v1/search?q=' +
                query +
                '&type=artist&limit=' +
                limit +
                '&market=' +
                config.market +
                '&access_token=' +
                accessToken
            )

            var data = JSON.parse(getapi.data.toString())
            config.logger.debug(data)
            if (!data.artists || !data.artists.items || data.artists.items.length === 0) {
                var message = 'Sorry ' + userName + ', I could not find that artist :('
                data = null
            }

            return [data, message]
        },

        // Get a specific track by search term or URI
        getTrack: function (term, callback) {
            let accessToken = _getAccessToken()
            if (!accessToken) {
                return callback(new Error('Could not get access token'))
            }

            // If it's a Spotify URI, extract info directly
            if (term.startsWith('spotify:track:')) {
                const trackId = term.split(':')[2]
                const getapi = urllibsync.request(
                    `https://api.spotify.com/v1/tracks/${trackId}?market=${config.market}&access_token=${accessToken}`
                )
                const track = JSON.parse(getapi.data.toString())
                return callback(null, {
                    name: track.name,
                    artist: track.artists[0].name,
                    uri: track.uri
                })
            }

            // Otherwise search for the track
            const query = encodeURIComponent(term)
            const getapi = urllibsync.request(
                `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1&market=${config.market}&access_token=${accessToken}`
            )

            const data = JSON.parse(getapi.data.toString())
            if (!data.tracks || !data.tracks.items || data.tracks.items.length === 0) {
                return callback(new Error('Track not found'))
            }

            const track = data.tracks.items[0]
            callback(null, {
                name: track.name,
                artist: track.artists[0].name,
                uri: track.uri
            })
        },

        // Get an album by search term or URI
        getAlbum: function (term, callback) {
            let accessToken = _getAccessToken()
            if (!accessToken) {
                return callback(new Error('Could not get access token'))
            }

            // If it's a Spotify URI, extract info directly
            if (term.startsWith('spotify:album:')) {
                const albumId = term.split(':')[2]
                const getapi = urllibsync.request(
                    `https://api.spotify.com/v1/albums/${albumId}?market=${config.market}&access_token=${accessToken}`
                )
                const album = JSON.parse(getapi.data.toString())
                return callback(null, {
                    name: album.name,
                    artist: album.artists[0].name,
                    uri: album.uri
                })
            }

            // Otherwise search for the album
            const query = encodeURIComponent(term)
            const getapi = urllibsync.request(
                `https://api.spotify.com/v1/search?q=${query}&type=album&limit=1&market=${config.market}&access_token=${accessToken}`
            )

            const data = JSON.parse(getapi.data.toString())
            if (!data.albums || !data.albums.items || data.albums.items.length === 0) {
                return callback(new Error('Album not found'))
            }

            const album = data.albums.items[0]
            callback(null, {
                name: album.name,
                artist: album.artists[0].name,
                uri: album.uri
            })
        },

        // Get a playlist by search term or URI
        getPlaylist: function (term, callback) {
            let accessToken = _getAccessToken()
            if (!accessToken) {
                return callback(new Error('Could not get access token'))
            }

            // If it's a Spotify URI, extract info directly
            if (term.startsWith('spotify:playlist:')) {
                const playlistId = term.split(':')[2]
                const getapi = urllibsync.request(
                    `https://api.spotify.com/v1/playlists/${playlistId}?market=${config.market}&access_token=${accessToken}`
                )
                const playlist = JSON.parse(getapi.data.toString())
                return callback(null, {
                    name: playlist.name,
                    owner: playlist.owner.display_name,
                    tracks: playlist.tracks.total,
                    uri: playlist.uri
                })
            }

            // Otherwise search for the playlist
            const query = encodeURIComponent(term)
            const getapi = urllibsync.request(
                `https://api.spotify.com/v1/search?q=${query}&type=playlist&limit=1&market=${config.market}&access_token=${accessToken}`
            )

            const data = JSON.parse(getapi.data.toString())
            if (!data.playlists || !data.playlists.items || data.playlists.items.length === 0) {
                return callback(new Error('Playlist not found'))
            }

            const playlist = data.playlists.items[0]
            callback(null, {
                name: playlist.name,
                owner: playlist.owner.display_name,
                tracks: playlist.tracks.total,
                uri: playlist.uri
            })
        },

        // Search functions for compatibility
        searchTrack: function (term, limit, callback) {
            const input = ['search'].concat(term.split(' '))
            const [data, errorMessage] = this.searchSpotify(input, null, null, limit)

            if (!data || errorMessage) {
                return callback(new Error(errorMessage || 'Track not found'))
            }

            const tracks = data.tracks.items.map(track => ({
                name: track.name,
                artist: track.artists[0].name,
                uri: track.uri
            }))

            callback(null, tracks)
        },

        searchAlbum: function (term, limit, callback) {
            const input = ['search'].concat(term.split(' '))
            const [data, errorMessage] = this.searchSpotifyAlbum(input, null, null, limit)

            if (!data || errorMessage) {
                return callback(new Error(errorMessage || 'Album not found'))
            }

            const albums = data.albums.items.map(album => ({
                name: album.name,
                artist: album.artists[0].name,
                uri: album.uri
            }))

            callback(null, albums)
        },

        searchPlaylist: function (term, callback) {
            const input = ['search'].concat(term.split(' '))
            const [data, errorMessage] = this.searchSpotifyPlaylist(input, null, null, 1)

            if (!data || errorMessage) {
                return callback(new Error(errorMessage || 'Playlist not found'))
            }

            const playlist = data.playlists.items[0]
            callback(null, {
                name: playlist.name,
                owner: playlist.owner.display_name,
                tracks: playlist.tracks.total,
                uri: playlist.uri
            })
        }
    }

    return module.exports.instance
}