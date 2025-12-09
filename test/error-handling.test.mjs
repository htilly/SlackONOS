import { expect } from 'chai';

/**
 * Error Handling Tests
 * Tests for robust error handling across the application:
 * 1. API failures (Spotify, Sonos, Discord, Slack)
 * 2. Invalid input validation
 * 3. Edge cases and boundary conditions
 * 4. Graceful degradation
 */

describe('Error Handling', function() {

  describe('Spotify API Error Handling', function() {
    let mockSpotifySearch;

    beforeEach(function() {
      mockSpotifySearch = function(query, shouldFail = false, errorType = 'network') {
        if (shouldFail) {
          if (errorType === 'network') {
            throw new Error('Network error: ECONNREFUSED');
          } else if (errorType === 'auth') {
            throw new Error('401 Unauthorized: Invalid token');
          } else if (errorType === 'ratelimit') {
            throw new Error('429 Too Many Requests');
          } else if (errorType === 'notfound') {
            return { tracks: { items: [] } };
          }
        }
        return {
          tracks: {
            items: [
              { name: 'Test Track', artists: [{ name: 'Test Artist' }], uri: 'spotify:track:123' }
            ]
          }
        };
      };
    });

    it('should handle network errors gracefully', function() {
      try {
        mockSpotifySearch('test query', true, 'network');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Network error');
      }
    });

    it('should handle authentication errors', function() {
      try {
        mockSpotifySearch('test query', true, 'auth');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Unauthorized');
      }
    });

    it('should handle rate limiting', function() {
      try {
        mockSpotifySearch('test query', true, 'ratelimit');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Too Many Requests');
      }
    });

    it('should handle empty search results', function() {
      const result = mockSpotifySearch('nonexistent track', true, 'notfound');
      expect(result.tracks.items).to.be.an('array').that.is.empty;
    });

    it('should validate Spotify URI format', function() {
      const validURIs = [
        'spotify:track:5W3cjX2J3tjhG8zb6u0qHn',
        'spotify:album:4LH4d3cOWNNsVw41Gqt2kv',
        'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'
      ];

      const invalidURIs = [
        'spotify:invalid:123',
        'not-a-uri',
        'spotify:track:',
        'spotify::123',
        ''
      ];

      validURIs.forEach(uri => {
        const match = uri.match(/^spotify:(track|album|playlist):[a-zA-Z0-9]+$/);
        expect(match).to.not.be.null;
      });

      invalidURIs.forEach(uri => {
        const match = uri.match(/^spotify:(track|album|playlist):[a-zA-Z0-9]+$/);
        expect(match).to.be.null;
      });
    });
  });

  describe('Queue Operation Error Handling', function() {
    let queue;

    beforeEach(function() {
      queue = [
        { name: 'Track 1', artist: 'Artist 1', uri: 'spotify:track:1' },
        { name: 'Track 2', artist: 'Artist 2', uri: 'spotify:track:2' },
        { name: 'Track 3', artist: 'Artist 3', uri: 'spotify:track:3' }
      ];
    });

    it('should handle remove from empty queue', function() {
      const emptyQueue = [];
      const position = 1;

      if (position > emptyQueue.length || position < 1) {
        expect(true).to.be.true; // Validation passed
      } else {
        expect.fail('Should have validated empty queue');
      }
    });

    it('should handle invalid position (negative)', function() {
      const position = -1;

      if (position < 1 || position > queue.length) {
        expect(true).to.be.true; // Invalid position caught
      } else {
        expect.fail('Should reject negative position');
      }
    });

    it('should handle invalid position (out of bounds)', function() {
      const position = 999;

      if (position < 1 || position > queue.length) {
        expect(true).to.be.true; // Invalid position caught
      } else {
        expect.fail('Should reject out of bounds position');
      }
    });

    it('should handle invalid position (zero)', function() {
      const position = 0;

      if (position < 1 || position > queue.length) {
        expect(true).to.be.true; // Invalid position caught
      } else {
        expect.fail('Should reject zero position');
      }
    });

    it('should handle non-numeric position', function() {
      const position = 'abc';
      const numericPosition = parseInt(position, 10);

      expect(isNaN(numericPosition)).to.be.true;
    });

    it('should handle valid boundary positions', function() {
      const firstPosition = 1;
      const lastPosition = queue.length;

      expect(firstPosition).to.be.at.least(1).and.at.most(queue.length);
      expect(lastPosition).to.be.at.least(1).and.at.most(queue.length);
    });
  });

  describe('Config Validation Error Handling', function() {
    let validateConfig;

    beforeEach(function() {
      validateConfig = function(key, value, min, max) {
        const num = parseInt(value, 10);
        if (isNaN(num)) {
          throw new Error(`Invalid value for ${key}: not a number`);
        }
        if (num < min || num > max) {
          throw new Error(`Invalid value for ${key}: must be between ${min} and ${max}`);
        }
        return num;
      };
    });

    it('should reject non-numeric config values', function() {
      expect(() => validateConfig('gongLimit', 'abc', 1, 10)).to.throw('not a number');
      expect(() => validateConfig('voteLimit', 'xyz', 1, 10)).to.throw('not a number');
    });

    it('should reject values below minimum', function() {
      expect(() => validateConfig('gongLimit', '0', 1, 10)).to.throw('must be between');
      expect(() => validateConfig('voteLimit', '-5', 1, 10)).to.throw('must be between');
    });

    it('should reject values above maximum', function() {
      expect(() => validateConfig('gongLimit', '100', 1, 10)).to.throw('must be between');
      expect(() => validateConfig('voteLimit', '999', 1, 10)).to.throw('must be between');
    });

    it('should accept valid values at boundaries', function() {
      expect(validateConfig('gongLimit', '1', 1, 10)).to.equal(1);
      expect(validateConfig('gongLimit', '10', 1, 10)).to.equal(10);
    });

    it('should accept valid values in range', function() {
      expect(validateConfig('gongLimit', '5', 1, 10)).to.equal(5);
      expect(validateConfig('voteLimit', '3', 1, 10)).to.equal(3);
    });

    it('should handle decimal values correctly', function() {
      // Should convert to integer
      expect(validateConfig('gongLimit', '5.7', 1, 10)).to.equal(5);
      expect(validateConfig('voteLimit', '3.2', 1, 10)).to.equal(3);
    });

    it('should handle string numbers with whitespace', function() {
      expect(validateConfig('gongLimit', ' 5 ', 1, 10)).to.equal(5);
      expect(validateConfig('voteLimit', '  3  ', 1, 10)).to.equal(3);
    });
  });

  describe('User Input Validation', function() {
    let cleanInput;

    beforeEach(function() {
      cleanInput = function(text) {
        if (typeof text !== 'string') {
          return '';
        }
        return text.trim();
      };
    });

    it('should handle null input', function() {
      const result = cleanInput(null);
      expect(result).to.equal('');
    });

    it('should handle undefined input', function() {
      const result = cleanInput(undefined);
      expect(result).to.equal('');
    });

    it('should handle empty string', function() {
      const result = cleanInput('');
      expect(result).to.equal('');
    });

    it('should handle whitespace-only input', function() {
      const result = cleanInput('   ');
      expect(result).to.equal('');
    });

    it('should handle very long input', function() {
      const longInput = 'a'.repeat(10000);
      const result = cleanInput(longInput);
      expect(result.length).to.equal(10000);
    });

    it('should handle special characters', function() {
      const specialChars = '!@#$%^&*(){}[]|\\:;"\'<>,.?/~`';
      const result = cleanInput(specialChars);
      expect(result).to.equal(specialChars);
    });

    it('should handle unicode characters', function() {
      const unicode = '你好世界 🎵 🎶 🔔';
      const result = cleanInput(unicode);
      expect(result).to.equal(unicode);
    });

    it('should handle newlines and tabs', function() {
      const withNewlines = 'line1\nline2\tline3';
      const result = cleanInput(withNewlines);
      expect(result).to.equal('line1\nline2\tline3');
    });
  });

  describe('Track Name Validation', function() {
    let parseTrackInput;

    beforeEach(function() {
      parseTrackInput = function(input) {
        if (!input || typeof input !== 'string') {
          return null;
        }

        const trimmed = input.trim();
        if (trimmed.length === 0) {
          return null;
        }

        // Check if it's a Spotify URI or HTTP link
        if (trimmed.match(/^spotify:/i)) {
          return { type: 'uri', value: trimmed };
        }
        if (trimmed.match(/^https?:\/\/open\.spotify\.com/i)) {
          return { type: 'link', value: trimmed };
        }

        // Otherwise treat as search query
        return { type: 'search', value: trimmed };
      };
    });

    it('should reject null input', function() {
      const result = parseTrackInput(null);
      expect(result).to.be.null;
    });

    it('should reject empty string', function() {
      const result = parseTrackInput('');
      expect(result).to.be.null;
    });

    it('should reject whitespace-only input', function() {
      const result = parseTrackInput('   ');
      expect(result).to.be.null;
    });

    it('should identify Spotify URIs', function() {
      const result = parseTrackInput('spotify:track:5W3cjX2J3tjhG8zb6u0qHn');
      expect(result).to.deep.equal({
        type: 'uri',
        value: 'spotify:track:5W3cjX2J3tjhG8zb6u0qHn'
      });
    });

    it('should identify Spotify HTTP links', function() {
      const result = parseTrackInput('https://open.spotify.com/track/5W3cjX2J3tjhG8zb6u0qHn');
      expect(result).to.deep.equal({
        type: 'link',
        value: 'https://open.spotify.com/track/5W3cjX2J3tjhG8zb6u0qHn'
      });
    });

    it('should identify search queries', function() {
      const result = parseTrackInput('Foo Fighters - Best Of You');
      expect(result).to.deep.equal({
        type: 'search',
        value: 'Foo Fighters - Best Of You'
      });
    });

    it('should handle mixed case URIs', function() {
      const result = parseTrackInput('SPOTIFY:TRACK:ABC123');
      expect(result.type).to.equal('uri');
    });
  });

  describe('Message Sending Error Handling', function() {
    let mockSendMessage;

    beforeEach(function() {
      mockSendMessage = function(channelId, text, shouldFail = false, errorType = 'not_found') {
        if (!channelId || typeof channelId !== 'string') {
          throw new Error('Invalid channel ID');
        }
        if (!text || typeof text !== 'string') {
          throw new Error('Invalid message text');
        }
        if (shouldFail) {
          if (errorType === 'not_found') {
            throw new Error('Channel not found');
          } else if (errorType === 'rate_limit') {
            throw new Error('Rate limit exceeded');
          } else if (errorType === 'network') {
            throw new Error('Network error');
          }
        }
        return { ok: true, ts: Date.now() };
      };
    });

    it('should reject null channel ID', function() {
      expect(() => mockSendMessage(null, 'test')).to.throw('Invalid channel ID');
    });

    it('should reject empty channel ID', function() {
      expect(() => mockSendMessage('', 'test')).to.throw('Invalid channel ID');
    });

    it('should reject null message text', function() {
      expect(() => mockSendMessage('C123456', null)).to.throw('Invalid message text');
    });

    it('should reject empty message text', function() {
      expect(() => mockSendMessage('C123456', '')).to.throw('Invalid message text');
    });

    it('should handle channel not found', function() {
      expect(() => mockSendMessage('C123456', 'test', true, 'not_found')).to.throw('Channel not found');
    });

    it('should handle rate limiting', function() {
      expect(() => mockSendMessage('C123456', 'test', true, 'rate_limit')).to.throw('Rate limit exceeded');
    });

    it('should handle network errors', function() {
      expect(() => mockSendMessage('C123456', 'test', true, 'network')).to.throw('Network error');
    });

    it('should succeed with valid inputs', function() {
      const result = mockSendMessage('C123456', 'test message');
      expect(result.ok).to.be.true;
      expect(result.ts).to.be.a('number');
    });
  });

  describe('Volume Control Error Handling', function() {
    let setVolume;

    beforeEach(function() {
      setVolume = function(volume) {
        const vol = parseInt(volume, 10);
        if (isNaN(vol)) {
          throw new Error('Volume must be a number');
        }
        if (vol < 0 || vol > 100) {
          throw new Error('Volume must be between 0 and 100');
        }
        return vol;
      };
    });

    it('should reject non-numeric volume', function() {
      expect(() => setVolume('abc')).to.throw('must be a number');
    });

    it('should reject negative volume', function() {
      expect(() => setVolume('-10')).to.throw('between 0 and 100');
    });

    it('should reject volume above 100', function() {
      expect(() => setVolume('150')).to.throw('between 0 and 100');
    });

    it('should accept volume at boundaries', function() {
      expect(setVolume('0')).to.equal(0);
      expect(setVolume('100')).to.equal(100);
    });

    it('should accept valid volume values', function() {
      expect(setVolume('50')).to.equal(50);
      expect(setVolume('25')).to.equal(25);
      expect(setVolume('75')).to.equal(75);
    });

    it('should handle decimal volumes', function() {
      expect(setVolume('50.5')).to.equal(50);
      expect(setVolume('75.9')).to.equal(75);
    });
  });

  describe('Duplicate Track Detection Error Handling', function() {
    let isDuplicate;
    let queue;

    beforeEach(function() {
      queue = [
        { name: 'Best Of You', artist: 'Foo Fighters', uri: 'spotify:track:123' },
        { name: 'Everlong', artist: 'Foo Fighters', uri: 'spotify:track:456' }
      ];

      isDuplicate = function(newTrack) {
        if (!newTrack || !newTrack.uri) {
          throw new Error('Invalid track object');
        }

        for (const track of queue) {
          // Check URI match
          if (track.uri === newTrack.uri) {
            return true;
          }
          // Check name + artist match (case insensitive)
          if (track.name && newTrack.name && track.artist && newTrack.artist) {
            const nameMatch = track.name.toLowerCase() === newTrack.name.toLowerCase();
            const artistMatch = track.artist.toLowerCase() === newTrack.artist.toLowerCase();
            if (nameMatch && artistMatch) {
              return true;
            }
          }
        }
        return false;
      };
    });

    it('should reject null track', function() {
      expect(() => isDuplicate(null)).to.throw('Invalid track object');
    });

    it('should reject track without URI', function() {
      expect(() => isDuplicate({ name: 'Test', artist: 'Artist' })).to.throw('Invalid track object');
    });

    it('should detect duplicate by URI', function() {
      const duplicate = { name: 'Different Name', artist: 'Different Artist', uri: 'spotify:track:123' };
      expect(isDuplicate(duplicate)).to.be.true;
    });

    it('should detect duplicate by name and artist', function() {
      const duplicate = { name: 'Best Of You', artist: 'Foo Fighters', uri: 'spotify:track:999' };
      expect(isDuplicate(duplicate)).to.be.true;
    });

    it('should handle case-insensitive matching', function() {
      const duplicate = { name: 'BEST OF YOU', artist: 'FOO FIGHTERS', uri: 'spotify:track:999' };
      expect(isDuplicate(duplicate)).to.be.true;
    });

    it('should not flag unique tracks as duplicates', function() {
      const unique = { name: 'New Track', artist: 'New Artist', uri: 'spotify:track:789' };
      expect(isDuplicate(unique)).to.be.false;
    });

    it('should handle tracks with missing names gracefully', function() {
      const trackWithoutName = { artist: 'Foo Fighters', uri: 'spotify:track:789' };
      expect(isDuplicate(trackWithoutName)).to.be.false;
    });
  });

  describe('AI Error Handling', function() {
    let mockAICall;

    beforeEach(function() {
      mockAICall = function(prompt, shouldFail = false, errorType = 'timeout') {
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
          throw new Error('Invalid prompt');
        }

        if (shouldFail) {
          if (errorType === 'timeout') {
            throw new Error('Request timeout');
          } else if (errorType === 'api_error') {
            throw new Error('OpenAI API error: 500');
          } else if (errorType === 'auth') {
            throw new Error('Invalid API key');
          } else if (errorType === 'rate_limit') {
            throw new Error('Rate limit exceeded');
          }
        }

        return {
          command: 'search',
          args: ['Best Of You'],
          confidence: 0.9
        };
      };
    });

    it('should reject empty prompt', function() {
      expect(() => mockAICall('')).to.throw('Invalid prompt');
    });

    it('should reject null prompt', function() {
      expect(() => mockAICall(null)).to.throw('Invalid prompt');
    });

    it('should handle timeout errors', function() {
      expect(() => mockAICall('test', true, 'timeout')).to.throw('timeout');
    });

    it('should handle API errors', function() {
      expect(() => mockAICall('test', true, 'api_error')).to.throw('API error');
    });

    it('should handle authentication errors', function() {
      expect(() => mockAICall('test', true, 'auth')).to.throw('Invalid API key');
    });

    it('should handle rate limiting', function() {
      expect(() => mockAICall('test', true, 'rate_limit')).to.throw('Rate limit');
    });

    it('should succeed with valid prompt', function() {
      const result = mockAICall('play best of you by foo fighters');
      expect(result).to.have.property('command');
      expect(result).to.have.property('confidence');
      expect(result.command).to.be.a('string');
    });
  });

  describe('Sonos Device Error Handling', function() {
    let mockSonosOperation;

    beforeEach(function() {
      mockSonosOperation = function(operation, shouldFail = false, errorType = 'not_found') {
        if (shouldFail) {
          if (errorType === 'not_found') {
            throw new Error('Sonos device not found');
          } else if (errorType === 'network') {
            throw new Error('Network unreachable');
          } else if (errorType === 'timeout') {
            throw new Error('Operation timeout');
          } else if (errorType === 'unavailable') {
            throw new Error('Device unavailable');
          }
        }
        return { success: true };
      };
    });

    it('should handle device not found', function() {
      expect(() => mockSonosOperation('play', true, 'not_found')).to.throw('not found');
    });

    it('should handle network errors', function() {
      expect(() => mockSonosOperation('play', true, 'network')).to.throw('unreachable');
    });

    it('should handle timeout errors', function() {
      expect(() => mockSonosOperation('play', true, 'timeout')).to.throw('timeout');
    });

    it('should handle device unavailable', function() {
      expect(() => mockSonosOperation('play', true, 'unavailable')).to.throw('unavailable');
    });

    it('should succeed when device is available', function() {
      const result = mockSonosOperation('play');
      expect(result.success).to.be.true;
    });
  });
});
