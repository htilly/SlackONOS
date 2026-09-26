import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * spotify.getPlaylist against stubbed Spotify Web API responses.
 * Playlist search can return null entries - live, "rock classics" returned a
 * null top hit, which used to crash getPlaylist with
 * "Cannot read properties of null (reading 'name')".
 */

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

function jsonResponse(body, ok = true, statusText = 'OK') {
  return { ok, statusText, json: async () => body };
}

describe('Spotify getPlaylist', function() {
  let spotify;
  let fetchStub;
  let searchRequests;

  function stubSearch(searchResponse) {
    searchRequests = [];
    fetchStub = sinon.stub(globalThis, 'fetch').callsFake(async (url) => {
      if (String(url).startsWith('https://accounts.spotify.com/')) {
        return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
      }
      searchRequests.push(new URL(url));
      return typeof searchResponse === 'function' ? searchResponse(url) : jsonResponse(searchResponse);
    });
  }

  beforeEach(function() {
    delete require.cache[require.resolve('../lib/spotify.js')];
    spotify = require('../lib/spotify.js')({ clientId: 'id', clientSecret: 'secret', market: 'SE' }, quietLogger);
  });

  afterEach(function() {
    sinon.restore();
  });

  it('skips a null top hit and returns the first real playlist', async function() {
    stubSearch({
      playlists: {
        items: [
          null,
          { name: '100 Greatest Rock Songs', owner: { display_name: 'Topsify' }, tracks: { total: 100 }, uri: 'spotify:playlist:abc' }
        ]
      }
    });

    const result = await spotify.getPlaylist('rock classics');

    expect(result).to.deep.equal({
      name: '100 Greatest Rock Songs',
      owner: 'Topsify',
      tracks: 100,
      uri: 'spotify:playlist:abc'
    });
    const search = searchRequests.find(u => u.pathname === '/v1/search');
    expect(Number(search.searchParams.get('limit'))).to.be.greaterThan(1);
  });

  it('throws "Playlist not found" when every hit is null', async function() {
    stubSearch({ playlists: { items: [null, null] } });

    let caught = null;
    try {
      await spotify.getPlaylist('rock classics');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.an('error').with.property('message', 'Playlist not found');
  });

  it('tolerates a playlist without owner or track info', async function() {
    stubSearch({ playlists: { items: [{ name: 'Bare', uri: 'spotify:playlist:bare' }] } });

    const result = await spotify.getPlaylist('bare');

    expect(result).to.deep.equal({ name: 'Bare', owner: 'Unknown', tracks: 0, uri: 'spotify:playlist:bare' });
  });

  it('does not search when a playlist URI lookup fails', async function() {
    stubSearch(() => jsonResponse({}, false, 'Not Found'));

    let caught = null;
    try {
      await spotify.getPlaylist('spotify:playlist:37i9dQZF1DWXRqgorJj26U');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.an('error');
    expect(caught.message).to.include('Not Found');
    expect(searchRequests.map(u => u.pathname)).to.deep.equal(['/v1/playlists/37i9dQZF1DWXRqgorJj26U']);
  });
});
