/**
 * Sonos Mock for Testing
 * Provides a configurable mock of the Sonos device API
 */

import sinon from 'sinon';

/**
 * Create a mock Sonos device with configurable responses
 * @param {Object} options - Configuration options
 * @param {string} options.state - Initial playback state ('stopped', 'playing', 'paused')
 * @param {Object} options.track - Current track info
 * @param {Object} options.queue - Queue data with items array and total
 * @param {number} options.volume - Current volume level (0-100)
 * @returns {Object} Mock Sonos device
 */
export function createSonosMock(options = {}) {
  const defaultTrack = {
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 180,
    position: 0,
    albumArtURL: 'http://example.com/art.jpg',
    uri: 'spotify:track:test123',
    queuePosition: 1
  };

  const defaultQueue = {
    items: [
      { id: 'Q:0/1', title: 'Track 1', artist: 'Artist 1', uri: 'spotify:track:1' },
      { id: 'Q:0/2', title: 'Track 2', artist: 'Artist 2', uri: 'spotify:track:2' },
      { id: 'Q:0/3', title: 'Track 3', artist: 'Artist 3', uri: 'spotify:track:3' }
    ],
    total: 3
  };

  const mock = {
    // Playback state
    getCurrentState: sinon.stub().resolves(options.state || 'stopped'),
    currentTrack: sinon.stub().resolves(options.track || defaultTrack),
    
    // Queue operations
    getQueue: sinon.stub().resolves(options.queue || defaultQueue),
    queue: sinon.stub().resolves({ queued: true }),
    flush: sinon.stub().resolves(),
    removeTracksFromQueue: sinon.stub().resolves(),
    reorderTracksInQueue: sinon.stub().resolves(),
    
    // Playback controls
    play: sinon.stub().resolves(),
    pause: sinon.stub().resolves(),
    stop: sinon.stub().resolves(),
    next: sinon.stub().resolves(),
    previous: sinon.stub().resolves(),
    seek: sinon.stub().resolves(),
    
    // Volume
    setVolume: sinon.stub().resolves(),
    getVolume: sinon.stub().resolves(options.volume || 50),
    
    // Play modes
    setPlayMode: sinon.stub().resolves(),
    getPlayMode: sinon.stub().resolves('NORMAL'),
    
    // Services
    avTransportService: sinon.stub().returns({
      GetCrossfadeMode: sinon.stub().resolves({ CrossfadeMode: '0' }),
      SetCrossfadeMode: sinon.stub().resolves()
    }),
    
    // Device info
    deviceDescription: sinon.stub().resolves({
      roomName: 'Test Room',
      modelName: 'Sonos One',
      serialNum: 'TEST123'
    }),

    // Helper methods for tests
    _reset: function() {
      Object.keys(mock).forEach(key => {
        if (mock[key] && typeof mock[key].reset === 'function') {
          mock[key].reset();
        }
      });
    },
    
    _setState: function(newState) {
      mock.getCurrentState.resolves(newState);
    },
    
    _setTrack: function(track) {
      mock.currentTrack.resolves({ ...defaultTrack, ...track });
    },
    
    _setQueue: function(queue) {
      mock.getQueue.resolves(queue);
    },
    
    _setVolume: function(vol) {
      mock.getVolume.resolves(vol);
    }
  };

  return mock;
}

/**
 * Create a mock that simulates common error scenarios
 */
export function createErrorSonosMock(errorType = 'network') {
  const errors = {
    network: new Error('ECONNREFUSED: Connection refused'),
    timeout: new Error('ETIMEDOUT: Connection timed out'),
    notFound: new Error('Device not found'),
    unavailable: new Error('Device unavailable')
  };

  const error = errors[errorType] || errors.network;

  return {
    getCurrentState: sinon.stub().rejects(error),
    currentTrack: sinon.stub().rejects(error),
    getQueue: sinon.stub().rejects(error),
    queue: sinon.stub().rejects(error),
    flush: sinon.stub().rejects(error),
    play: sinon.stub().rejects(error),
    pause: sinon.stub().rejects(error),
    stop: sinon.stub().rejects(error),
    next: sinon.stub().rejects(error),
    previous: sinon.stub().rejects(error),
    setVolume: sinon.stub().rejects(error),
    getVolume: sinon.stub().rejects(error),
    removeTracksFromQueue: sinon.stub().rejects(error),
    reorderTracksInQueue: sinon.stub().rejects(error)
  };
}

export default { createSonosMock, createErrorSonosMock };
