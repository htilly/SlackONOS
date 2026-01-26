import { expect } from 'chai';

/**
 * Queue Utils Tests
 * Tests sorting functions, duplicate detection, and source type determination
 */

// Import the module (CommonJS)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const queueUtils = require('../lib/queue-utils.js');

describe('Queue Utils', function() {
  
  describe('sortTracksByRelevance', function() {
    const tracks = [
      { name: 'Some Other Song', artist: 'Random Artist', popularity: 50 },
      { name: 'Best of You', artists: [{ name: 'Foo Fighters' }], popularity: 80 },
      { name: 'Best', artist: 'Someone Else', popularity: 60 },
      { name: 'You Are The Best', artists: [{ name: 'Foo' }], popularity: 70 }
    ];

    it('should prioritize exact artist+track match', function() {
      const result = queueUtils.sortTracksByRelevance(tracks, 'Foo Fighters - Best of You');
      expect(result[0].name).to.equal('Best of You');
    });

    it('should handle "track by artist" format', function() {
      const result = queueUtils.sortTracksByRelevance(tracks, 'Best of You by Foo Fighters');
      expect(result[0].name).to.equal('Best of You');
    });

    it('should fall back to word matching without separator', function() {
      const result = queueUtils.sortTracksByRelevance(tracks, 'Best of You');
      expect(result[0].name).to.equal('Best of You');
    });

    it('should use popularity as tie-breaker', function() {
      const sameTracks = [
        { name: 'Test', artist: 'Artist', popularity: 30 },
        { name: 'Test', artist: 'Artist', popularity: 80 },
        { name: 'Test', artist: 'Artist', popularity: 50 }
      ];
      const result = queueUtils.sortTracksByRelevance(sameTracks, 'something else');
      expect(result[0].popularity).to.equal(80);
      expect(result[1].popularity).to.equal(50);
      expect(result[2].popularity).to.equal(30);
    });

    it('should handle empty array', function() {
      const result = queueUtils.sortTracksByRelevance([], 'test');
      expect(result).to.deep.equal([]);
    });

    it('should handle null array', function() {
      const result = queueUtils.sortTracksByRelevance(null, 'test');
      expect(result).to.deep.equal([]);
    });

    it('should handle empty search term', function() {
      const result = queueUtils.sortTracksByRelevance(tracks, '');
      expect(result).to.have.length(4);
    });

    it('should not mutate original array', function() {
      const original = [...tracks];
      queueUtils.sortTracksByRelevance(tracks, 'Best');
      expect(tracks).to.deep.equal(original);
    });
  });

  describe('sortAlbumsByRelevance', function() {
    const albums = [
      { name: 'Random Album', artist: 'Someone', popularity: 40 },
      { name: 'Wasting Light', artist: 'Foo Fighters', popularity: 85 },
      { name: 'Light Up', artist: 'Random', popularity: 50 },
      { name: 'Concrete and Gold', artist: 'Foo Fighters', popularity: 75 }
    ];

    it('should prioritize exact artist+album match', function() {
      const result = queueUtils.sortAlbumsByRelevance(albums, 'Foo Fighters - Wasting Light');
      expect(result[0].name).to.equal('Wasting Light');
    });

    it('should handle "album by artist" format', function() {
      const result = queueUtils.sortAlbumsByRelevance(albums, 'Wasting Light by Foo Fighters');
      expect(result[0].name).to.equal('Wasting Light');
    });

    it('should fall back to album name matching', function() {
      const result = queueUtils.sortAlbumsByRelevance(albums, 'Wasting Light');
      expect(result[0].name).to.equal('Wasting Light');
    });

    it('should handle empty array', function() {
      const result = queueUtils.sortAlbumsByRelevance([], 'test');
      expect(result).to.deep.equal([]);
    });

    it('should not mutate original array', function() {
      const original = [...albums];
      queueUtils.sortAlbumsByRelevance(albums, 'Light');
      expect(albums).to.deep.equal(original);
    });
  });

  describe('sortPlaylistsByRelevance', function() {
    const playlists = [
      { name: 'Random Mix', followers: 100 },
      { name: 'Rock Classics', followers: 50000 },
      { name: 'Classic Rock Hits', followers: 10000 },
      { name: 'Rock', followers: 500 }
    ];

    it('should prioritize exact match in name', function() {
      const result = queueUtils.sortPlaylistsByRelevance(playlists, 'Rock Classics');
      expect(result[0].name).to.equal('Rock Classics');
    });

    it('should use followers as tie-breaker', function() {
      const result = queueUtils.sortPlaylistsByRelevance(playlists, 'Rock');
      // "Rock Classics" has 50000 followers and contains "Rock"
      expect(result[0].followers).to.be.greaterThan(result[1].followers);
    });

    it('should handle empty array', function() {
      const result = queueUtils.sortPlaylistsByRelevance([], 'test');
      expect(result).to.deep.equal([]);
    });

    it('should not mutate original array', function() {
      const original = [...playlists];
      queueUtils.sortPlaylistsByRelevance(playlists, 'Rock');
      expect(playlists).to.deep.equal(original);
    });
  });

  describe('findTrackInQueue', function() {
    const queueItems = [
      { title: 'Track One', artist: 'Artist A' },
      { title: 'Track Two', artist: 'Artist B' },
      { title: 'Track Three', artist: 'Artist C' }
    ];

    it('should find track by title and artist', function() {
      const result = queueUtils.findTrackInQueue(queueItems, 'Track Two', 'Artist B');
      expect(result).to.not.be.null;
      expect(result.index).to.equal(1);
      expect(result.position).to.equal(2);
    });

    it('should return null for non-existent track', function() {
      const result = queueUtils.findTrackInQueue(queueItems, 'Unknown Track', 'Unknown Artist');
      expect(result).to.be.null;
    });

    it('should return null for partial match (title only)', function() {
      const result = queueUtils.findTrackInQueue(queueItems, 'Track One', 'Wrong Artist');
      expect(result).to.be.null;
    });

    it('should return null for empty queue', function() {
      const result = queueUtils.findTrackInQueue([], 'Track', 'Artist');
      expect(result).to.be.null;
    });

    it('should handle null queue', function() {
      const result = queueUtils.findTrackInQueue(null, 'Track', 'Artist');
      expect(result).to.be.null;
    });
  });

  describe('isDuplicateTrack', function() {
    const queueItems = [
      { uri: 'spotify:track:abc123', title: 'Test Track', artist: 'Test Artist' },
      { uri: 'spotify:track:def456', title: 'Another Track', artist: 'Another Artist' }
    ];

    it('should detect duplicate by URI', function() {
      const track = { uri: 'spotify:track:abc123' };
      expect(queueUtils.isDuplicateTrack(queueItems, track)).to.be.true;
    });

    it('should detect duplicate by title and artist', function() {
      const track = { title: 'Test Track', artist: 'Test Artist' };
      expect(queueUtils.isDuplicateTrack(queueItems, track)).to.be.true;
    });

    it('should handle artists array format', function() {
      const track = { name: 'Test Track', artists: [{ name: 'Test Artist' }] };
      expect(queueUtils.isDuplicateTrack(queueItems, track)).to.be.true;
    });

    it('should be case-insensitive', function() {
      const track = { title: 'test track', artist: 'TEST ARTIST' };
      expect(queueUtils.isDuplicateTrack(queueItems, track)).to.be.true;
    });

    it('should return false for unique track', function() {
      const track = { uri: 'spotify:track:xyz789', title: 'New Track', artist: 'New Artist' };
      expect(queueUtils.isDuplicateTrack(queueItems, track)).to.be.false;
    });

    it('should return false for empty queue', function() {
      const track = { title: 'Track', artist: 'Artist' };
      expect(queueUtils.isDuplicateTrack([], track)).to.be.false;
    });

    it('should handle null track', function() {
      expect(queueUtils.isDuplicateTrack(queueItems, null)).to.be.false;
    });
  });

  describe('determineSourceType', function() {
    const queueItems = [
      { title: 'Track One', artist: 'Artist A' },
      { title: 'Track Two', artist: 'Artist B' },
      { title: 'Track Three', artist: 'Artist C' }
    ];

    it('should identify queue source with valid queuePosition', function() {
      const track = { title: 'Track Two', artist: 'Artist B', queuePosition: 2 };
      const result = queueUtils.determineSourceType(track, queueItems);
      expect(result.type).to.equal('queue');
      expect(result.queuePosition).to.equal(2);
    });

    it('should identify queue source when found by search (no queuePosition)', function() {
      const track = { title: 'Track Two', artist: 'Artist B' };
      const result = queueUtils.determineSourceType(track, queueItems);
      expect(result.type).to.equal('queue');
      expect(result.queuePosition).to.equal(2);
    });

    it('should mark position mismatch when queuePosition differs', function() {
      const track = { title: 'Track Two', artist: 'Artist B', queuePosition: 5 };
      const result = queueUtils.determineSourceType(track, queueItems);
      expect(result.type).to.equal('queue');
      expect(result.queuePosition).to.equal(2);
      expect(result.note).to.equal('position_mismatch');
    });

    it('should identify external source when track not in queue', function() {
      const track = { title: 'External Track', artist: 'External Artist', queuePosition: 1 };
      const result = queueUtils.determineSourceType(track, queueItems);
      expect(result.type).to.equal('external');
      expect(result.track.title).to.equal('External Track');
    });

    it('should return null for null track', function() {
      const result = queueUtils.determineSourceType(null, queueItems);
      expect(result).to.be.null;
    });

    it('should handle empty queue', function() {
      const track = { title: 'Track', artist: 'Artist' };
      const result = queueUtils.determineSourceType(track, []);
      expect(result.type).to.equal('external');
    });
  });

  describe('Position Conversion', function() {
    describe('toSonosPosition', function() {
      it('should convert 0-based to 1-based', function() {
        expect(queueUtils.toSonosPosition(0)).to.equal(1);
        expect(queueUtils.toSonosPosition(5)).to.equal(6);
        expect(queueUtils.toSonosPosition(99)).to.equal(100);
      });
    });

    describe('toUserPosition', function() {
      it('should convert 1-based to 0-based', function() {
        expect(queueUtils.toUserPosition(1)).to.equal(0);
        expect(queueUtils.toUserPosition(6)).to.equal(5);
        expect(queueUtils.toUserPosition(100)).to.equal(99);
      });
    });
  });

  describe('isValidQueuePosition', function() {
    it('should accept valid positions', function() {
      expect(queueUtils.isValidQueuePosition(1, 10)).to.be.true;
      expect(queueUtils.isValidQueuePosition(5, 10)).to.be.true;
      expect(queueUtils.isValidQueuePosition(10, 10)).to.be.true;
    });

    it('should reject position 0', function() {
      expect(queueUtils.isValidQueuePosition(0, 10)).to.be.false;
    });

    it('should reject negative positions', function() {
      expect(queueUtils.isValidQueuePosition(-1, 10)).to.be.false;
    });

    it('should reject positions beyond queue length', function() {
      expect(queueUtils.isValidQueuePosition(11, 10)).to.be.false;
      expect(queueUtils.isValidQueuePosition(100, 10)).to.be.false;
    });

    it('should reject non-integer positions', function() {
      expect(queueUtils.isValidQueuePosition(1.5, 10)).to.be.false;
      expect(queueUtils.isValidQueuePosition(NaN, 10)).to.be.false;
    });
  });
});
