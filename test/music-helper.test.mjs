import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const musicHelper = require('../lib/music-helper.js');

function track(name, artist, popularity, idChar) {
  return {
    name,
    artist,
    artists: [{ name: artist }],
    popularity,
    uri: `spotify:track:${idChar.repeat(22)}`
  };
}

describe('Music Helper', function() {
  describe('#searchTracks', function() {
    it('locks exact artist requests to that artist instead of popular loose matches', async function() {
      const u2Tracks = [
        track('With Or Without You', 'U2', 91, 'a'),
        track('Beautiful Day', 'U2', 88, 'b'),
        track('One', 'U2', 86, 'c'),
        track('Pride (In The Name Of Love)', 'U2', 84, 'd'),
        track('Where The Streets Have No Name', 'U2', 82, 'e')
      ];
      const looseWrongTracks = [
        track('2.0', 'BTS', 99, 'f'),
        track('2 Hard 4 The Radio', 'Drake', 98, 'g'),
        track('24K Magic', 'Bruno Mars', 97, 'h')
      ];
      const spotify = {
        searchArtistList: sinon.stub().resolves([{ name: 'U2', uri: 'spotify:artist:abc' }]),
        searchTrackList: sinon.stub().callsFake(async query => {
          if (query.startsWith('artist:') || query.startsWith('U2 ')) {
            return looseWrongTracks.concat(u2Tracks);
          }
          return looseWrongTracks;
        })
      };

      musicHelper.initialize(spotify, {
        info: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
        error: sinon.stub()
      });

      const result = await musicHelper.searchTracks('U2', 5, { targetType: 'artist' });

      expect(result.tracks).to.have.length(5);
      expect(result.tracks.every(item => item.artist === 'U2')).to.equal(true);
      expect(result.tracks.map(item => item.name)).to.deep.equal([
        'With Or Without You',
        'Beautiful Day',
        'One',
        'Pride (In The Name Of Love)',
        'Where The Streets Have No Name'
      ]);
      expect(spotify.searchArtistList.calledWith('U2', 5)).to.equal(true);
    });
  });
});
