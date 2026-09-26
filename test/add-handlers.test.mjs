import { expect } from 'chai';
import sinon from 'sinon';

/**
 * Add Handlers Tests
 * Tests add, addalbum, addplaylist, and append commands with mocked dependencies
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const queueLock = require('../lib/queue-lock.js');

describe('Add Handlers', function() {
  let addHandlers;
  let mockSonos;
  let mockSpotify;
  let mockLogger;
  let mockMusicHelper;
  let messages;
  let userActions;

  beforeEach(function() {
    queueLock._resetForTests();
    // Clear module cache to get fresh module state
    delete require.cache[require.resolve('../lib/add-handlers.js')];
    addHandlers = require('../lib/add-handlers.js');

    messages = [];
    userActions = [];

    // Create mock Sonos device
    mockSonos = {
      stop: sinon.stub().resolves(),
      play: sinon.stub().resolves(),
      flush: sinon.stub().resolves(),
      queue: sinon.stub().resolves(),
      getQueue: sinon.stub().resolves({
        items: [
          { title: 'Track 1', artist: 'Artist 1', uri: 'spotify:track:1' },
          { title: 'Track 2', artist: 'Artist 2', uri: 'spotify:track:2' }
        ],
        total: 2
      }),
      getCurrentState: sinon.stub().resolves('playing'),
      next: sinon.stub().resolves(),
      avTransportService: sinon.stub().returns({
        Seek: sinon.stub().resolves()
      })
    };

    // Create mock Spotify
    mockSpotify = {
      searchTrackList: sinon.stub().resolves([
        { name: 'Test Track', artist: 'Test Artist', uri: 'spotify:track:abc123', popularity: 80 },
        { name: 'Test Track 2', artist: 'Test Artist', uri: 'spotify:track:def456', popularity: 60 }
      ]),
      searchAlbumList: sinon.stub().resolves([
        { name: 'Test Album', artist: 'Test Artist', uri: 'spotify:album:abc123', popularity: 75 }
      ]),
      searchPlaylistList: sinon.stub().resolves([
        { name: 'Test Playlist', owner: 'Test User', uri: 'spotify:playlist:abc123' }
      ]),
      getAlbum: sinon.stub().resolves({
        name: 'Test Album',
        artist: 'Test Artist',
        uri: 'spotify:album:abc123'
      }),
      getAlbumTracks: sinon.stub().resolves([
        { name: 'Track 1', artist: 'Test Artist', uri: 'spotify:track:1' },
        { name: 'Track 2', artist: 'Test Artist', uri: 'spotify:track:2' }
      ]),
      getPlaylist: sinon.stub().resolves({
        name: 'Test Playlist',
        owner: 'Test User',
        uri: 'spotify:playlist:abc123'
      }),
      getPlaylistTracks: sinon.stub().resolves([
        { name: 'Track 1', artist: 'Playlist Artist', uri: 'spotify:track:p1' },
        { name: 'Track 2', artist: 'Playlist Artist', uri: 'spotify:track:p2' }
      ]),
      getTrack: sinon.stub().resolves({
        name: 'Appended Track',
        artist: 'Append Artist',
        uri: 'spotify:track:append123'
      })
    };

    // Create mock logger
    mockLogger = {
      info: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub()
    };

    // Create mock music helper
    mockMusicHelper = {
      isValidSpotifyUri: sinon.stub().returns(true)
    };

    // Initialize add handlers
    addHandlers.initialize({
      logger: mockLogger,
      sonos: mockSonos,
      spotify: mockSpotify,
      sendMessage: async (msg, ch, opts) => {
        messages.push({ message: msg, channel: ch, options: opts });
      },
      logUserAction: async (userName, action) => {
        userActions.push({ userName, action });
      },
      isTrackBlacklisted: () => false,
      musicHelper: mockMusicHelper,
      getConfig: () => ({ get: () => 'US' }),
      getAdminChannel: () => null,
      getCurrentPlatform: () => 'slack'
    });
  });

  afterEach(function() {
    sinon.restore();
  });

  // ==========================================
  // INITIALIZATION TESTS
  // ==========================================

  describe('Initialization', function() {
    it('should throw error if logger is not provided', function() {
      delete require.cache[require.resolve('../lib/add-handlers.js')];
      const freshHandlers = require('../lib/add-handlers.js');
      
      expect(() => freshHandlers.initialize({
        sonos: mockSonos,
        spotify: mockSpotify,
        sendMessage: async () => {}
      })).to.throw('Add handlers require a logger to be injected');
    });

    it('should throw error if sonos is not provided', function() {
      delete require.cache[require.resolve('../lib/add-handlers.js')];
      const freshHandlers = require('../lib/add-handlers.js');
      
      expect(() => freshHandlers.initialize({
        logger: mockLogger,
        spotify: mockSpotify,
        sendMessage: async () => {}
      })).to.throw('Add handlers require sonos to be injected');
    });

    it('should throw error if spotify is not provided', function() {
      delete require.cache[require.resolve('../lib/add-handlers.js')];
      const freshHandlers = require('../lib/add-handlers.js');
      
      expect(() => freshHandlers.initialize({
        logger: mockLogger,
        sonos: mockSonos,
        sendMessage: async () => {}
      })).to.throw('Add handlers require spotify to be injected');
    });

    it('should throw error if sendMessage is not provided', function() {
      delete require.cache[require.resolve('../lib/add-handlers.js')];
      const freshHandlers = require('../lib/add-handlers.js');
      
      expect(() => freshHandlers.initialize({
        logger: mockLogger,
        sonos: mockSonos,
        spotify: mockSpotify
      })).to.throw('Add handlers require sendMessage to be injected');
    });

    it('should initialize successfully with all required dependencies', function() {
      delete require.cache[require.resolve('../lib/add-handlers.js')];
      const freshHandlers = require('../lib/add-handlers.js');
      
      expect(() => freshHandlers.initialize({
        logger: mockLogger,
        sonos: mockSonos,
        spotify: mockSpotify,
        sendMessage: async () => {}
      })).to.not.throw();
    });
  });

  // ==========================================
  // ADD COMMAND TESTS
  // ==========================================

  describe('add', function() {
    it('should send error message when no track specified', async function() {
      await addHandlers.add(['add'], 'channel1', 'user1');
      
      expect(messages).to.have.lengthOf(1);
      expect(messages[0].message).to.include('gotta tell me what to add');
    });

    it('should log user action', async function() {
      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      expect(userActions).to.have.lengthOf(1);
      expect(userActions[0]).to.deep.equal({ userName: 'user1', action: 'add' });
    });

    it('should search for tracks when valid input provided', async function() {
      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      expect(mockSpotify.searchTrackList.calledOnce).to.be.true;
      expect(mockSpotify.searchTrackList.calledWith('test track', 3)).to.be.true;
    });

    it('should send error message when no tracks found', async function() {
      mockSpotify.searchTrackList.resolves([]);
      
      await addHandlers.add(['add', 'nonexistent', 'track'], 'channel1', 'user1');
      
      expect(messages).to.have.lengthOf(1);
      expect(messages[0].message).to.include("Couldn't find anything");
    });

    it('should queue track when found', async function() {
      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockSonos.queue.called).to.be.true;
    });

    it('should send confirmation message when track added', async function() {
      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(messages.some(m => m.message.includes('Added'))).to.be.true;
    });

    it('should detect duplicate tracks in queue', async function() {
      // Set up queue with the track we'll try to add
      mockSonos.getQueue.resolves({
        items: [
          { title: 'Test Track', artist: 'Test Artist', uri: 'spotify:track:abc123' }
        ]
      });
      
      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      expect(messages.some(m => m.message.includes('already in the queue'))).to.be.true;
    });

    it('should detect duplicates before flushing when player reports stopped', async function() {
      mockSonos.getCurrentState.resolves('stopped');
      mockSonos.getQueue.resolves({
        items: [
          { title: 'Test Track', artist: 'Test Artist', uri: 'spotify:track:abc123' }
        ],
        total: 1
      });

      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');

      expect(messages.some(m => m.message.includes('already in the queue'))).to.be.true;
      expect(mockSonos.flush.called).to.be.false;
      expect(mockSonos.queue.called).to.be.false;
    });

    it('should serialize overlapping adds so a repeat is detected as a duplicate', async function() {
      // Slow Sonos + a user repeating the command while the first add hangs:
      // both adds must not queue the same track, and the second must not
      // flush the track the first one queued.
      this.timeout(10000);
      const liveQueue = [];
      let state = 'stopped';
      mockSonos.getCurrentState.callsFake(async () => state);
      mockSonos.getQueue.callsFake(async () => ({ items: [...liveQueue], total: liveQueue.length }));
      mockSonos.flush.callsFake(async () => { liveQueue.length = 0; });
      mockSonos.queue.callsFake(async (uri) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        liveQueue.push({ title: 'Test Track', artist: 'Test Artist', uri });
        return { FirstTrackNumberEnqueued: String(liveQueue.length) };
      });
      mockSonos.play.callsFake(async () => { state = 'playing'; });

      await Promise.all([
        addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1'),
        addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1')
      ]);

      expect(mockSonos.queue.callCount).to.equal(1);
      expect(mockSonos.flush.callCount).to.equal(1);
      expect(liveQueue).to.have.length(1);
      expect(messages.filter(m => m.message.includes('already in the queue'))).to.have.length(1);
    });

    it('should not flush a queued track while slow Sonos still reports stopped', async function() {
      // A slow speaker keeps reporting 'stopped' until play() has gone
      // through. A second add arriving in that window used to flush the
      // first add's track.
      this.timeout(10000);
      const liveQueue = [];
      let state = 'stopped';
      mockSpotify.searchTrackList.callsFake(async (query) => [
        { name: query, artist: 'Artist', uri: `spotify:track:${query.replace(/\W/g, '')}`, popularity: 50 }
      ]);
      mockSonos.getCurrentState.callsFake(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return state;
      });
      mockSonos.getQueue.callsFake(async () => ({ items: [...liveQueue], total: liveQueue.length }));
      mockSonos.flush.callsFake(async () => { liveQueue.length = 0; });
      mockSonos.queue.callsFake(async (uri) => {
        await new Promise(resolve => setTimeout(resolve, 80));
        liveQueue.push({ title: uri, artist: 'Artist', uri });
        return { FirstTrackNumberEnqueued: String(liveQueue.length) };
      });
      mockSonos.play.callsFake(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        state = 'playing';
      });

      await Promise.all([
        addHandlers.add(['add', 'first'], 'channel1', 'user1'),
        addHandlers.add(['add', 'second'], 'channel1', 'user1')
      ]);

      expect(mockSonos.flush.callCount).to.equal(1);
      expect(liveQueue.map(item => item.uri)).to.deep.equal(['spotify:track:first', 'spotify:track:second']);
    });

    it('should let later adds run when a Sonos call never answers', async function() {
      this.timeout(10000);
      queueLock._resetForTests({ maxHoldMs: 100 });
      mockSpotify.searchTrackList.callsFake(async (query) => [
        { name: query, artist: 'Artist', uri: `spotify:track:${query}`, popularity: 50 }
      ]);
      mockSonos.getQueue.resolves({ items: [], total: 0 });
      // The first queue call hangs forever, the next one answers normally
      mockSonos.queue.onFirstCall().returns(new Promise(() => {}));
      mockSonos.queue.resolves({ FirstTrackNumberEnqueued: '1' });

      addHandlers.add(['add', 'hung'], 'channel1', 'user1');
      await addHandlers.add(['add', 'next'], 'channel1', 'user1');

      expect(mockSonos.queue.secondCall.args[0]).to.equal('spotify:track:next');
      expect(messages.some(m => m.message.includes('Added') && m.message.includes('next'))).to.be.true;
      expect(mockLogger.warn.calledWithMatch(/Queue lock held by "add"/)).to.be.true;
    });

    it('should flush queue when player is stopped', async function() {
      mockSonos.getCurrentState.resolves('stopped');
      
      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockSonos.flush.called).to.be.true;
    });

    it('should block blacklisted tracks', async function() {
      delete require.cache[require.resolve('../lib/add-handlers.js')];
      const freshHandlers = require('../lib/add-handlers.js');
      
      freshHandlers.initialize({
        logger: mockLogger,
        sonos: mockSonos,
        spotify: mockSpotify,
        sendMessage: async (msg, ch, opts) => {
          messages.push({ message: msg, channel: ch, options: opts });
        },
        logUserAction: async () => {},
        isTrackBlacklisted: (name, artist) => name === 'Test Track',
        musicHelper: mockMusicHelper,
        getConfig: () => ({ get: () => 'US' }),
        getAdminChannel: () => null,
        getCurrentPlatform: () => 'slack'
      });
      
      await freshHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      expect(messages.some(m => m.message.includes('blacklist'))).to.be.true;
      expect(mockSonos.queue.called).to.be.false;
    });

    it('should handle invalid URIs gracefully', async function() {
      mockMusicHelper.isValidSpotifyUri.returns(false);
      
      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      expect(messages.some(m => m.message.includes('invalid format'))).to.be.true;
    });
  });

  // ==========================================
  // ADDALBUM COMMAND TESTS
  // ==========================================

  describe('addalbum', function() {
    it('should send error message when no album specified', async function() {
      await addHandlers.addalbum(['addalbum'], 'channel1', 'user1');
      
      expect(messages).to.have.lengthOf(1);
      expect(messages[0].message).to.include('gotta tell me which album');
    });

    it('should log user action', async function() {
      await addHandlers.addalbum(['addalbum', 'test', 'album'], 'channel1', 'user1');
      
      expect(userActions).to.have.lengthOf(1);
      expect(userActions[0]).to.deep.equal({ userName: 'user1', action: 'addalbum' });
    });

    it('should search for albums when valid input provided', async function() {
      await addHandlers.addalbum(['addalbum', 'test', 'album'], 'channel1', 'user1');
      
      expect(mockSpotify.searchAlbumList.calledOnce).to.be.true;
    });

    it('should send error message when no albums found', async function() {
      mockSpotify.searchAlbumList.resolves([]);
      
      await addHandlers.addalbum(['addalbum', 'nonexistent'], 'channel1', 'user1');
      
      expect(messages.some(m => m.message.includes("Couldn't find that album"))).to.be.true;
    });

    it('should handle Spotify URI directly', async function() {
      await addHandlers.addalbum(['addalbum', 'spotify:album:abc123'], 'channel1', 'user1');
      
      expect(mockSpotify.getAlbum.calledOnce).to.be.true;
      expect(mockSpotify.searchAlbumList.called).to.be.false;
    });

    it('should handle Spotify URL directly', async function() {
      await addHandlers.addalbum(['addalbum', 'https://open.spotify.com/album/abc123'], 'channel1', 'user1');
      
      expect(mockSpotify.getAlbum.calledOnce).to.be.true;
    });

    it('should get album tracks for blacklist checking', async function() {
      await addHandlers.addalbum(['addalbum', 'test', 'album'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockSpotify.getAlbumTracks.called).to.be.true;
    });

    it('should send confirmation message when album added', async function() {
      await addHandlers.addalbum(['addalbum', 'test', 'album'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(messages.some(m => m.message.includes('Added') && m.message.includes('album'))).to.be.true;
    });

    it('should block completely blacklisted albums', async function() {
      delete require.cache[require.resolve('../lib/add-handlers.js')];
      const freshHandlers = require('../lib/add-handlers.js');
      
      freshHandlers.initialize({
        logger: mockLogger,
        sonos: mockSonos,
        spotify: mockSpotify,
        sendMessage: async (msg, ch, opts) => {
          messages.push({ message: msg, channel: ch, options: opts });
        },
        logUserAction: async () => {},
        isTrackBlacklisted: () => true, // All tracks blacklisted
        musicHelper: mockMusicHelper,
        getConfig: () => ({ get: () => 'US' }),
        getAdminChannel: () => null,
        getCurrentPlatform: () => 'slack'
      });
      
      await freshHandlers.addalbum(['addalbum', 'test', 'album'], 'channel1', 'user1');
      
      expect(messages.some(m => m.message.includes('Cannot add album') && m.message.includes('blacklisted'))).to.be.true;
    });

    it('should queue filtered album tracks sequentially in album order', async function() {
      delete require.cache[require.resolve('../lib/add-handlers.js')];
      const freshHandlers = require('../lib/add-handlers.js');

      mockSpotify.getAlbumTracks.resolves([
        { name: 'Track 1', artist: 'Test Artist', uri: 'spotify:track:1' },
        { name: 'Blocked Track', artist: 'Test Artist', uri: 'spotify:track:blocked' },
        { name: 'Track 3', artist: 'Test Artist', uri: 'spotify:track:3' }
      ]);

      freshHandlers.initialize({
        logger: mockLogger,
        sonos: mockSonos,
        spotify: mockSpotify,
        sendMessage: async (msg, ch, opts) => {
          messages.push({ message: msg, channel: ch, options: opts });
        },
        logUserAction: async () => {},
        isTrackBlacklisted: (name) => name === 'Blocked Track',
        musicHelper: mockMusicHelper,
        getConfig: () => ({ get: () => 'US' }),
        getAdminChannel: () => null,
        getCurrentPlatform: () => 'slack'
      });

      await freshHandlers.addalbum(['addalbum', 'test', 'album'], 'channel1', 'user1');
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockSonos.queue.getCall(0).args[0]).to.equal('spotify:track:1');
      expect(mockSonos.queue.getCall(1).args[0]).to.equal('spotify:track:3');
      expect(mockSonos.queue.calledWith('spotify:track:blocked')).to.be.false;
    });
  });

  // ==========================================
  // ADDPLAYLIST COMMAND TESTS
  // ==========================================

  describe('addplaylist', function() {
    it('should send error message when no playlist specified', async function() {
      await addHandlers.addplaylist(['addplaylist'], 'channel1', 'user1');
      
      expect(messages).to.have.lengthOf(1);
      expect(messages[0].message).to.include('need to tell me which playlist');
    });

    it('should log user action', async function() {
      await addHandlers.addplaylist(['addplaylist', 'test', 'playlist'], 'channel1', 'user1');
      
      expect(userActions).to.have.lengthOf(1);
      expect(userActions[0]).to.deep.equal({ userName: 'user1', action: 'addplaylist' });
    });

    it('should try direct lookup first', async function() {
      await addHandlers.addplaylist(['addplaylist', 'test', 'playlist'], 'channel1', 'user1');
      
      expect(mockSpotify.getPlaylist.called).to.be.true;
    });

    it('should fall back to search when direct lookup fails', async function() {
      mockSpotify.getPlaylist.rejects(new Error('Not found'));
      
      await addHandlers.addplaylist(['addplaylist', 'test', 'playlist'], 'channel1', 'user1');
      
      expect(mockSpotify.searchPlaylistList.called).to.be.true;
    });

    it('should not search for the link text when a playlist URI lookup fails', async function() {
      mockSpotify.getPlaylist.rejects(new Error('Spotify API error: Not Found'));

      await addHandlers.addplaylist(['addplaylist', 'spotify:playlist:37i9dQZF1DWXRqgorJj26U'], 'channel1', 'user1');

      expect(mockSpotify.searchPlaylistList.called).to.be.false;
      expect(mockSonos.queue.called).to.be.false;
      expect(mockSonos.flush.called).to.be.false;
      expect(messages.some(m => m.message.includes("Couldn't open that playlist"))).to.be.true;
    });

    it('should not search for the link text when a playlist link lookup fails', async function() {
      mockSpotify.getPlaylist.rejects(new Error('Spotify API error: Not Found'));

      await addHandlers.addplaylist(['addplaylist', 'https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U?si=x'], 'channel1', 'user1');

      expect(mockSpotify.searchPlaylistList.called).to.be.false;
      expect(mockSonos.queue.called).to.be.false;
    });

    it('should get playlist tracks for blacklist checking', async function() {
      await addHandlers.addplaylist(['addplaylist', 'test', 'playlist'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockSpotify.getPlaylistTracks.called).to.be.true;
    });

    it('should send confirmation message when playlist added', async function() {
      await addHandlers.addplaylist(['addplaylist', 'test', 'playlist'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(messages.some(m => m.message.includes('Added') && m.message.includes('playlist'))).to.be.true;
    });

    it('should send error when search also fails', async function() {
      mockSpotify.getPlaylist.rejects(new Error('Not found'));
      mockSpotify.searchPlaylistList.resolves([]);
      
      await addHandlers.addplaylist(['addplaylist', 'nonexistent'], 'channel1', 'user1');
      
      expect(messages.some(m => m.message.includes("Couldn't find that playlist"))).to.be.true;
    });
  });

  // ==========================================
  // APPEND COMMAND TESTS
  // ==========================================

  describe('append', function() {
    it('should send error message when no track specified', async function() {
      await addHandlers.append(['append'], 'channel1', 'user1');
      
      expect(messages).to.have.lengthOf(1);
      expect(messages[0].message).to.include('Tell me what song to append');
    });

    it('should log user action', async function() {
      await addHandlers.append(['append', 'test', 'track'], 'channel1', 'user1');
      
      expect(userActions).to.have.lengthOf(1);
      expect(userActions[0]).to.deep.equal({ userName: 'user1', action: 'append' });
    });

    it('should get track from Spotify', async function() {
      await addHandlers.append(['append', 'test', 'track'], 'channel1', 'user1');
      
      expect(mockSpotify.getTrack.calledOnce).to.be.true;
      expect(mockSpotify.getTrack.calledWith('test track')).to.be.true;
    });

    it('should queue track without flushing', async function() {
      await addHandlers.append(['append', 'test', 'track'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockSonos.queue.called).to.be.true;
      expect(mockSonos.flush.called).to.be.false;
    });

    it('should send confirmation message when track appended', async function() {
      await addHandlers.append(['append', 'test', 'track'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(messages.some(m => m.message.includes('Added') && m.message.includes('Appended Track'))).to.be.true;
    });

    it('should detect duplicate tracks when appending', async function() {
      mockSonos.getQueue.resolves({
        items: [
          { title: 'Appended Track', artist: 'Append Artist', uri: 'spotify:track:append123' }
        ]
      });
      
      await addHandlers.append(['append', 'test', 'track'], 'channel1', 'user1');
      
      expect(messages.some(m => m.message.includes('already in the queue'))).to.be.true;
      expect(mockSonos.queue.called).to.be.false;
    });

    it('should start playback if not already playing', async function() {
      this.timeout(3000); // Increase timeout for this test
      mockSonos.getCurrentState.resolves('stopped');
      
      await addHandlers.append(['append', 'test', 'track'], 'channel1', 'user1');
      
      // Wait for async operations (including the 1000ms timeout in append)
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      expect(mockSonos.play.called).to.be.true;
    });

    it('should send error when track not found', async function() {
      mockSpotify.getTrack.rejects(new Error('Track not found'));
      
      await addHandlers.append(['append', 'nonexistent'], 'channel1', 'user1');
      
      expect(messages.some(m => m.message.includes("Couldn't find that track"))).to.be.true;
    });
  });

  // ==========================================
  // QUEUE BEHAVIOR TESTS
  // ==========================================

  describe('Queue Behavior', function() {
    it('add should flush queue when stopped, then start playback', async function() {
      mockSonos.getCurrentState.resolves('stopped');
      
      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(mockSonos.flush.called).to.be.true;
    });

    it('add should not flush queue when playing', async function() {
      mockSonos.getCurrentState.resolves('playing');
      
      await addHandlers.add(['add', 'test', 'track'], 'channel1', 'user1');
      
      expect(mockSonos.flush.called).to.be.false;
    });

    it('append should never flush queue regardless of state', async function() {
      mockSonos.getCurrentState.resolves('stopped');
      
      await addHandlers.append(['append', 'test', 'track'], 'channel1', 'user1');
      
      expect(mockSonos.flush.called).to.be.false;
    });
  });
});
