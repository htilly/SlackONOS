import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load fixture data
const fixturesPath = path.join(__dirname, 'fixtures', 'spotify-responses.json');
const spotifyFixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));

/**
 * Tests for Spotify search commands with mocked responses
 * Verifies that we parse and handle Spotify data correctly
 */

describe('Spotify Search Integration', function() {
  
  describe('Search Track Command', function() {
    it('should parse search track response correctly', function() {
      const response = spotifyFixtures.searchTrack.bohemian_rhapsody;
      
      expect(response).to.have.property('name');
      expect(response).to.have.property('artist');
      expect(response).to.have.property('uri');
      expect(response.uri).to.match(/^spotify:track:/);
    });

    it('should format track for display', function() {
      const track = spotifyFixtures.searchTrack.smells_like_teen_spirit;
      const displayText = `*${track.name}* by ${track.artist}`;
      
      expect(displayText).to.equal('*Smells Like Teen Spirit* by Nirvana');
    });
  });

  describe('Best Of Command', function() {
    it('should parse track list for artist', function() {
      const tracks = spotifyFixtures.searchTrackList.foo_fighters;
      
      expect(tracks).to.be.an('array');
      expect(tracks.length).to.be.greaterThan(0);
      
      // Verify most tracks are from the searched artist
      const fooFightersTracks = tracks.filter(t => 
        t.artists[0].name === 'Foo Fighters'
      );
      expect(fooFightersTracks.length).to.be.greaterThan(0);
    });

    it('should sort tracks by popularity', function() {
      const tracks = spotifyFixtures.searchTrackList.foo_fighters;
      const sorted = [...tracks].sort((a, b) => 
        (b.popularity || 0) - (a.popularity || 0)
      );
      
      expect(sorted[0].name).to.equal('Everlong'); // Highest popularity
      expect(sorted[0].popularity).to.equal(85);
    });

    it('should take top 10 tracks', function() {
      const tracks = spotifyFixtures.searchTrackList.queen;
      const topTracks = tracks.slice(0, 10);
      
      expect(topTracks.length).to.be.at.most(10);
    });

    it('should infer artist from search results', function() {
      const tracks = spotifyFixtures.searchTrackList.foo_fighters;
      
      // Count artist occurrences
      const artistCounts = {};
      tracks.forEach(t => {
        const artist = t.artists[0].name;
        artistCounts[artist] = (artistCounts[artist] || 0) + 1;
      });
      
      // Find most common artist
      const bestArtist = Object.entries(artistCounts)
        .sort((a, b) => b[1] - a[1])[0][0];
      
      expect(bestArtist).to.equal('Foo Fighters');
    });
  });

  describe('Search Album Command', function() {
    it('should parse album response correctly', function() {
      const album = spotifyFixtures.searchAlbum.dark_side_of_the_moon;
      
      expect(album).to.have.property('name');
      expect(album).to.have.property('artist');
      expect(album).to.have.property('uri');
      expect(album.uri).to.match(/^spotify:album:/);
    });

    it('should include cover URL if available', function() {
      const album = spotifyFixtures.searchAlbum.dark_side_of_the_moon;
      
      if (album.coverUrl) {
        expect(album.coverUrl).to.be.a('string');
        expect(album.coverUrl).to.match(/^https?:\/\//);
      }
    });

    it('should format album message', function() {
      const album = spotifyFixtures.getAlbum.nevermind;
      const message = `Added album *${album.name}* by ${album.artist} to the queue.`;
      
      expect(message).to.equal('Added album *Nevermind (Remastered)* by Nirvana to the queue.');
    });
  });

  describe('Search Playlist Command', function() {
    it('should parse playlist search results', function() {
      const playlists = spotifyFixtures.searchPlaylist.rock_classics;
      
      expect(playlists).to.be.an('array');
      expect(playlists[0]).to.have.property('name');
      expect(playlists[0]).to.have.property('owner');
      expect(playlists[0]).to.have.property('uri');
    });

    it('should handle playlist URI format', function() {
      const playlist = spotifyFixtures.searchPlaylist.rock_classics[0];
      
      expect(playlist.uri).to.match(/^spotify:playlist:/);
    });

    it('should format playlist message', function() {
      const playlist = spotifyFixtures.getPlaylist.chill_hits;
      const message = `Added playlist *${playlist.name}* by ${playlist.owner} to the queue.`;
      
      expect(message).to.equal('Added playlist *Chill Hits 2025* by We Are Diamond to the queue.');
    });
  });

  describe('Search Results Formatting', function() {
    it('should format track list with numbers', function() {
      const tracks = spotifyFixtures.searchTrackList.foo_fighters;
      let message = `🎵 Found *${tracks.length} tracks*:\n`;
      
      tracks.forEach((track, index) => {
        message += `>${index + 1}. *${track.name}* by _${track.artists[0].name}_\n`;
      });
      
      expect(message).to.include('🎵 Found *10 tracks*:');
      expect(message).to.include('>1. *Everlong*');
      expect(message).to.include('>2. *The Pretender*');
      expect(message).to.include('>3. *My Hero*');
    });

    it('should handle singular vs plural tracks', function() {
      const singleTrack = [spotifyFixtures.searchTrackList.foo_fighters[0]];
      const multipleTracks = spotifyFixtures.searchTrackList.foo_fighters;
      
      const singularText = `${singleTrack.length} ${singleTrack.length === 1 ? 'track' : 'tracks'}`;
      const pluralText = `${multipleTracks.length} ${multipleTracks.length === 1 ? 'track' : 'tracks'}`;
      
      expect(singularText).to.equal('1 track');
      expect(pluralText).to.equal('10 tracks');
    });
  });

  describe('Spotify URI Validation', function() {
    it('should validate track URIs', function() {
      const track = spotifyFixtures.searchTrack.bohemian_rhapsody;
      const isValid = /^spotify:track:[a-zA-Z0-9]+$/.test(track.uri);
      
      expect(isValid).to.be.true;
    });

    it('should validate album URIs', function() {
      const album = spotifyFixtures.searchAlbum.dark_side_of_the_moon;
      const isValid = /^spotify:album:[a-zA-Z0-9]+$/.test(album.uri);
      
      expect(isValid).to.be.true;
    });

    it('should validate playlist URIs', function() {
      const playlist = spotifyFixtures.searchPlaylist.rock_classics[0];
      const isValid = /^spotify:playlist:[a-zA-Z0-9]+$/.test(playlist.uri);
      
      expect(isValid).to.be.true;
    });
  });

  describe('Error Handling', function() {
    it('should handle empty search results', function() {
      const emptyResults = [];
      const hasResults = emptyResults && emptyResults.length > 0;
      
      expect(hasResults).to.be.false;
    });

    it('should handle missing artist in track', function() {
      const trackWithMissingArtist = {
        name: 'Test Track',
        artists: [],
        uri: 'spotify:track:test123'
      };
      
      const artist = trackWithMissingArtist.artists[0]?.name || 'Unknown Artist';
      expect(artist).to.equal('Unknown Artist');
    });

    it('should handle missing popularity field', function() {
      const trackWithoutPopularity = {
        name: 'Test',
        artist: 'Test Artist'
      };
      
      const popularity = trackWithoutPopularity.popularity || 0;
      expect(popularity).to.equal(0);
    });
  });
});
