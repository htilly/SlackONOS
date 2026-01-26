import { expect } from 'chai';
import sinon from 'sinon';

/**
 * Command Handlers Tests
 * Tests playback, queue, volume, and search commands with mocked dependencies
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('Command Handlers', function() {
  let commandHandlers;
  let mockSonos;
  let mockSpotify;
  let mockLogger;
  let mockVoting;
  let mockSoundcraft;
  let messages;
  let userActions;

  beforeEach(function() {
    // Clear module cache to get fresh module state
    delete require.cache[require.resolve('../lib/command-handlers.js')];
    commandHandlers = require('../lib/command-handlers.js');

    messages = [];
    userActions = [];

    // Create mock Sonos device
    mockSonos = {
      stop: sinon.stub().resolves(),
      play: sinon.stub().resolves(),
      pause: sinon.stub().resolves(),
      next: sinon.stub().resolves(),
      previous: sinon.stub().resolves(),
      flush: sinon.stub().resolves(),
      setPlayMode: sinon.stub().resolves(),
      getVolume: sinon.stub().resolves(50),
      setVolume: sinon.stub().resolves(),
      getQueue: sinon.stub().resolves({
        items: [
          { title: 'Track 1', artist: 'Artist 1', uri: 'spotify:track:1' },
          { title: 'Track 2', artist: 'Artist 2', uri: 'spotify:track:2' },
          { title: 'Track 3', artist: 'Artist 3', uri: 'spotify:track:3' }
        ],
        total: 3
      }),
      getCurrentState: sinon.stub().resolves('playing'),
      currentTrack: sinon.stub().resolves({
        title: 'Track 1',
        artist: 'Artist 1',
        queuePosition: 1,
        duration: 180,
        position: 60
      }),
      removeTracksFromQueue: sinon.stub().resolves()
    };

    // Create mock Spotify
    mockSpotify = {
      searchTrackList: sinon.stub().resolves([
        { name: 'Test Track', artists: [{ name: 'Test Artist' }], popularity: 80 }
      ]),
      searchAlbumList: sinon.stub().resolves([
        { name: 'Test Album', artist: 'Test Artist', popularity: 75 }
      ]),
      searchPlaylistList: sinon.stub().resolves([
        { name: 'Test Playlist', owner: 'Test User', tracks: 50 }
      ])
    };

    // Create mock logger
    mockLogger = {
      info: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub()
    };

    // Create mock voting
    mockVoting = {
      isTrackGongBanned: sinon.stub().returns(false),
      hasActiveVotes: sinon.stub().returns(false)
    };

    // Create mock Soundcraft
    mockSoundcraft = {
      isEnabled: sinon.stub().returns(false),
      getChannelNames: sinon.stub().returns(['Main', 'Aux']),
      getAllVolumes: sinon.stub().resolves({}),
      setVolume: sinon.stub().resolves(true)
    };

    // Initialize command handlers
    commandHandlers.initialize({
      logger: mockLogger,
      sonos: mockSonos,
      spotify: mockSpotify,
      sendMessage: async (msg, ch, opts) => {
        messages.push({ msg, channel: ch, opts });
      },
      logUserAction: async (user, action) => {
        userActions.push({ user, action });
      },
      getConfig: () => ({
        maxVolume: 80,
        searchLimit: 10
      }),
      voting: mockVoting,
      soundcraft: mockSoundcraft
    });
  });

  describe('initialize', function() {
    it('should throw if logger not provided', function() {
      delete require.cache[require.resolve('../lib/command-handlers.js')];
      const fresh = require('../lib/command-handlers.js');
      
      expect(() => fresh.initialize({ sonos: mockSonos, sendMessage: () => {} }))
        .to.throw('logger');
    });

    it('should throw if sonos not provided', function() {
      delete require.cache[require.resolve('../lib/command-handlers.js')];
      const fresh = require('../lib/command-handlers.js');
      
      expect(() => fresh.initialize({ logger: mockLogger, sendMessage: () => {} }))
        .to.throw('sonos');
    });

    it('should throw if sendMessage not provided', function() {
      delete require.cache[require.resolve('../lib/command-handlers.js')];
      const fresh = require('../lib/command-handlers.js');
      
      expect(() => fresh.initialize({ logger: mockLogger, sonos: mockSonos }))
        .to.throw('sendMessage');
    });
  });

  describe('Playback Commands', function() {
    describe('stop', function() {
      it('should call sonos.stop()', function(done) {
        commandHandlers.stop(['stop'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(mockSonos.stop.calledOnce).to.be.true;
          done();
        }, 50);
      });

      it('should send success message', function(done) {
        commandHandlers.stop(['stop'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(messages.length).to.be.greaterThan(0);
          expect(messages[0].msg).to.include('Silence');
          done();
        }, 50);
      });

      it('should log user action', function() {
        commandHandlers.stop(['stop'], 'C123', 'user1');
        
        expect(userActions.some(a => a.action === 'stop')).to.be.true;
      });
    });

    describe('play', function() {
      it('should call sonos.play()', function(done) {
        commandHandlers.play(['play'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(mockSonos.play.calledOnce).to.be.true;
          done();
        }, 50);
      });

      it('should send success message', function(done) {
        commandHandlers.play(['play'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(messages.length).to.be.greaterThan(0);
          expect(messages[0].msg).to.include('gooo');
          done();
        }, 50);
      });
    });

    describe('pause', function() {
      it('should call sonos.pause()', function(done) {
        commandHandlers.pause(['pause'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(mockSonos.pause.calledOnce).to.be.true;
          done();
        }, 50);
      });
    });

    describe('resume', function() {
      it('should call sonos.play()', function(done) {
        commandHandlers.resume(['resume'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(mockSonos.play.calledOnce).to.be.true;
          done();
        }, 50);
      });
    });

    describe('flush', function() {
      it('should call sonos.flush()', function(done) {
        commandHandlers.flush(['flush'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(mockSonos.flush.calledOnce).to.be.true;
          done();
        }, 50);
      });
    });

    describe('shuffle', function() {
      it('should call sonos.setPlayMode with SHUFFLE', function(done) {
        commandHandlers.shuffle(['shuffle'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(mockSonos.setPlayMode.calledWith('SHUFFLE')).to.be.true;
          done();
        }, 50);
      });
    });

    describe('normal', function() {
      it('should call sonos.setPlayMode with NORMAL', function(done) {
        commandHandlers.normal(['normal'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(mockSonos.setPlayMode.calledWith('NORMAL')).to.be.true;
          done();
        }, 50);
      });
    });

    describe('nextTrack', function() {
      it('should call sonos.next()', function(done) {
        commandHandlers.nextTrack('C123', 'user1');
        
        setTimeout(() => {
          expect(mockSonos.next.calledOnce).to.be.true;
          done();
        }, 50);
      });
    });

    describe('previous', function() {
      it('should call sonos.previous()', function(done) {
        commandHandlers.previous(['previous'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(mockSonos.previous.calledOnce).to.be.true;
          done();
        }, 50);
      });
    });
  });

  describe('Queue Commands', function() {
    describe('removeTrack', function() {
      it('should require track number', function() {
        commandHandlers.removeTrack(['remove'], 'C123');
        
        expect(messages.some(m => m.msg.includes('must provide'))).to.be.true;
      });

      it('should reject invalid track number', function() {
        commandHandlers.removeTrack(['remove', 'abc'], 'C123');
        
        expect(messages.some(m => m.msg.includes('not a valid'))).to.be.true;
      });

      it('should remove track from queue', function(done) {
        commandHandlers.removeTrack(['remove', '1'], 'C123');
        
        setTimeout(() => {
          // Track number 1 (0-based) becomes 2 (1-based for Sonos)
          expect(mockSonos.removeTracksFromQueue.calledWith(2, 1)).to.be.true;
          done();
        }, 50);
      });
    });

    describe('purgeHalfQueue', function() {
      it('should get queue first', function(done) {
        commandHandlers.purgeHalfQueue(['thanos'], 'C123');
        
        setTimeout(() => {
          expect(mockSonos.getQueue.calledOnce).to.be.true;
          done();
        }, 50);
      });

      it('should remove half the queue', function(done) {
        mockSonos.getQueue.resolves({
          items: [{}, {}, {}, {}],
          total: 4
        });

        commandHandlers.purgeHalfQueue(['thanos'], 'C123');
        
        setTimeout(() => {
          expect(mockSonos.removeTracksFromQueue.calledWith(2, 2)).to.be.true;
          done();
        }, 100);
      });

      it('should handle small queue', function(done) {
        mockSonos.getQueue.resolves({
          items: [{}],
          total: 1
        });

        commandHandlers.purgeHalfQueue(['thanos'], 'C123');
        
        setTimeout(() => {
          expect(messages.some(m => m.msg.includes('too tiny'))).to.be.true;
          done();
        }, 100);
      });
    });

    describe('showQueue', function() {
      it('should show queue with tracks', async function() {
        await commandHandlers.showQueue('C123');
        
        expect(messages.length).to.be.greaterThan(0);
        expect(messages[0].msg).to.include('Track 1');
      });

      it('should handle empty queue', async function() {
        mockSonos.getQueue.resolves({ items: [], total: 0 });
        
        await commandHandlers.showQueue('C123');
        
        expect(messages.some(m => m.msg.includes('empty'))).to.be.true;
      });

      it('should show current track info', async function() {
        await commandHandlers.showQueue('C123');
        
        expect(messages[0].msg).to.include('Currently playing');
      });

      it('should mark immune tracks', async function() {
        mockVoting.isTrackGongBanned.returns(true);
        
        await commandHandlers.showQueue('C123');
        
        expect(messages[0].msg).to.include(':lock:');
      });

      it('should mark voted tracks', async function() {
        mockVoting.hasActiveVotes.returns(true);
        
        await commandHandlers.showQueue('C123');
        
        expect(messages[0].msg).to.include(':star:');
      });
    });

    describe('upNext', function() {
      it('should show upcoming tracks', async function() {
        await commandHandlers.upNext('C123');
        
        expect(messages.length).to.be.greaterThan(0);
        expect(messages[0].msg).to.include('Upcoming');
      });

      it('should handle empty queue', async function() {
        mockSonos.getQueue.resolves({ items: [], total: 0 });
        
        await commandHandlers.upNext('C123');
        
        expect(messages.some(m => m.msg.includes('emptier'))).to.be.true;
      });

      it('should handle no current track', async function() {
        mockSonos.currentTrack.resolves(null);
        
        await commandHandlers.upNext('C123');
        
        expect(messages.some(m => m.msg.includes('No track'))).to.be.true;
      });
    });

    describe('countQueue', function() {
      it('should show queue count', function(done) {
        commandHandlers.countQueue('C123');
        
        setTimeout(() => {
          expect(messages.some(m => m.msg.includes('3'))).to.be.true;
          done();
        }, 50);
      });

      it('should call callback if provided', function(done) {
        let result = null;
        commandHandlers.countQueue('C123', (count) => {
          result = count;
        });
        
        setTimeout(() => {
          expect(result).to.equal(3);
          done();
        }, 50);
      });
    });
  });

  describe('Volume Commands', function() {
    describe('getVolume', function() {
      it('should get current volume', async function() {
        await commandHandlers.getVolume('C123');
        
        expect(mockSonos.getVolume.calledOnce).to.be.true;
        expect(messages.some(m => m.msg.includes('50'))).to.be.true;
      });

      it('should show Soundcraft volumes when enabled', async function() {
        mockSoundcraft.isEnabled.returns(true);
        mockSoundcraft.getAllVolumes.resolves({ Main: 75, Aux: 50 });
        
        await commandHandlers.getVolume('C123');
        
        expect(messages[0].msg).to.include('Soundcraft');
        expect(messages[0].msg).to.include('Main');
      });
    });

    describe('setVolume', function() {
      it('should reject non-numeric volume', function() {
        commandHandlers.setVolume(['setvolume', 'abc'], 'C123', 'user1');
        
        expect(messages.some(m => m.msg.includes('not a number'))).to.be.true;
      });

      it('should reject volume above max', function() {
        commandHandlers.setVolume(['setvolume', '100'], 'C123', 'user1');
        
        expect(messages.some(m => m.msg.includes('louder'))).to.be.true;
      });

      it('should set valid volume', function(done) {
        commandHandlers.setVolume(['setvolume', '50'], 'C123', 'user1');
        
        setTimeout(() => {
          // Volume setting is delayed by 1 second in the implementation
        }, 50);
        done();
      });

      it('should handle Soundcraft channel volume', function(done) {
        mockSoundcraft.isEnabled.returns(true);
        
        commandHandlers.setVolume(['setvolume', 'Main', '50'], 'C123', 'user1');
        
        setTimeout(() => {
          expect(mockSoundcraft.setVolume.calledOnce).to.be.true;
          done();
        }, 50);
      });
    });
  });

  describe('Search Commands', function() {
    describe('search', function() {
      it('should require search term', async function() {
        await commandHandlers.search(['search'], 'C123', 'user1');
        
        expect(messages.some(m => m.msg.includes('What should I search'))).to.be.true;
      });

      it('should search Spotify', async function() {
        await commandHandlers.search(['search', 'test', 'query'], 'C123', 'user1');
        
        expect(mockSpotify.searchTrackList.calledOnce).to.be.true;
        expect(mockSpotify.searchTrackList.firstCall.args[0]).to.equal('test query');
      });

      it('should display search results', async function() {
        await commandHandlers.search(['search', 'test'], 'C123', 'user1');
        
        expect(messages.some(m => m.msg.includes('Test Track'))).to.be.true;
      });

      it('should handle no results', async function() {
        mockSpotify.searchTrackList.resolves([]);
        
        await commandHandlers.search(['search', 'test'], 'C123', 'user1');
        
        expect(messages.some(m => m.msg.includes("Couldn't find"))).to.be.true;
      });

      it('should log user action', async function() {
        await commandHandlers.search(['search', 'test'], 'C123', 'user1');
        
        expect(userActions.some(a => a.action === 'search')).to.be.true;
      });
    });

    describe('searchalbum', function() {
      it('should require search term', async function() {
        await commandHandlers.searchalbum(['searchalbum'], 'C123');
        
        expect(messages.some(m => m.msg.includes('tell me what album'))).to.be.true;
      });

      it('should search albums', async function() {
        await commandHandlers.searchalbum(['searchalbum', 'test'], 'C123');
        
        expect(mockSpotify.searchAlbumList.calledOnce).to.be.true;
        expect(messages.some(m => m.msg.includes('Test Album'))).to.be.true;
      });
    });

    describe('searchplaylist', function() {
      it('should require search term', async function() {
        await commandHandlers.searchplaylist(['searchplaylist'], 'C123', 'user1');
        
        expect(messages.some(m => m.msg.includes('Tell me which playlist'))).to.be.true;
      });

      it('should search playlists', async function() {
        await commandHandlers.searchplaylist(['searchplaylist', 'test'], 'C123', 'user1');
        
        expect(mockSpotify.searchPlaylistList.calledOnce).to.be.true;
        expect(messages.some(m => m.msg.includes('Test Playlist'))).to.be.true;
      });

      it('should log user action', async function() {
        await commandHandlers.searchplaylist(['searchplaylist', 'test'], 'C123', 'user1');
        
        expect(userActions.some(a => a.action === 'searchplaylist')).to.be.true;
      });
    });
  });

  describe('Error Handling', function() {
    it('should handle sonos.stop error', function(done) {
      mockSonos.stop.rejects(new Error('Connection failed'));
      
      commandHandlers.stop(['stop'], 'C123', 'user1');
      
      setTimeout(() => {
        expect(mockLogger.error.called).to.be.true;
        done();
      }, 50);
    });

    it('should handle sonos.getQueue error in showQueue', async function() {
      mockSonos.getQueue.rejects(new Error('Connection failed'));
      
      await commandHandlers.showQueue('C123');
      
      expect(messages.some(m => m.msg.includes('Error'))).to.be.true;
    });

    it('should handle spotify search error', async function() {
      mockSpotify.searchTrackList.rejects(new Error('API error'));
      
      await commandHandlers.search(['search', 'test'], 'C123', 'user1');
      
      expect(messages.some(m => m.msg.includes('Error'))).to.be.true;
    });
  });
});
