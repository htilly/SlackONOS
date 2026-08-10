import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validateSpotifyCredentials } = require('../lib/spotify-validator.js');

function mockJsonResponse(ok, body) {
  return {
    ok,
    json: sinon.stub().resolves(body)
  };
}

describe('Spotify credentials validator', function() {
  afterEach(function() {
    sinon.restore();
  });

  it('rejects a missing client ID without calling the network', async function() {
    sinon.stub(global, 'fetch');

    const result = await validateSpotifyCredentials('', 'secret');

    expect(result).to.deep.equal({ valid: false, error: 'Client ID is required' });
    expect(global.fetch.called).to.equal(false);
  });

  it('rejects a whitespace-only client ID', async function() {
    const result = await validateSpotifyCredentials('   ', 'secret');

    expect(result.valid).to.equal(false);
    expect(result.error).to.equal('Client ID is required');
  });

  it('rejects a missing client secret without calling the network', async function() {
    sinon.stub(global, 'fetch');

    const result = await validateSpotifyCredentials('client-id', '');

    expect(result).to.deep.equal({ valid: false, error: 'Client Secret is required' });
    expect(global.fetch.called).to.equal(false);
  });

  it('requests a client-credentials token with basic auth', async function() {
    const fetchStub = sinon.stub(global, 'fetch').resolves(
      mockJsonResponse(true, { access_token: 'token-123' })
    );

    await validateSpotifyCredentials('my-id', 'my-secret');

    expect(fetchStub.calledOnce).to.equal(true);
    const [url, options] = fetchStub.firstCall.args;
    expect(url).to.equal('https://accounts.spotify.com/api/token');
    expect(options.method).to.equal('POST');
    expect(options.body).to.equal('grant_type=client_credentials');
    const expectedAuth = 'Basic ' + Buffer.from('my-id:my-secret').toString('base64');
    expect(options.headers.Authorization).to.equal(expectedAuth);
  });

  it('returns valid when Spotify issues an access token', async function() {
    sinon.stub(global, 'fetch').resolves(
      mockJsonResponse(true, { access_token: 'token-123' })
    );

    const result = await validateSpotifyCredentials('client-id', 'client-secret');

    expect(result).to.deep.equal({ valid: true });
  });

  it('returns the error_description when Spotify rejects the credentials', async function() {
    sinon.stub(global, 'fetch').resolves(
      mockJsonResponse(false, { error: 'invalid_client', error_description: 'Invalid client secret' })
    );

    const result = await validateSpotifyCredentials('client-id', 'wrong-secret');

    expect(result.valid).to.equal(false);
    expect(result.error).to.equal('Invalid client secret');
  });

  it('falls back to the error code when there is no error_description', async function() {
    sinon.stub(global, 'fetch').resolves(
      mockJsonResponse(false, { error: 'invalid_client' })
    );

    const result = await validateSpotifyCredentials('client-id', 'wrong-secret');

    expect(result.valid).to.equal(false);
    expect(result.error).to.equal('invalid_client');
  });

  it('falls back to a generic message when the response has no error details', async function() {
    sinon.stub(global, 'fetch').resolves(mockJsonResponse(false, {}));

    const result = await validateSpotifyCredentials('client-id', 'wrong-secret');

    expect(result.valid).to.equal(false);
    expect(result.error).to.equal('Invalid credentials');
  });

  it('returns a network error message when the fetch call throws', async function() {
    sinon.stub(global, 'fetch').rejects(new Error('getaddrinfo ENOTFOUND accounts.spotify.com'));

    const result = await validateSpotifyCredentials('client-id', 'client-secret');

    expect(result.valid).to.equal(false);
    expect(result.error).to.equal('getaddrinfo ENOTFOUND accounts.spotify.com');
  });
});
