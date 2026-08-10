import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validateDiscordToken } = require('../lib/discord-validator.js');

// Well-formed dummy tokens (format-valid, length >= 50) used to exercise the
// network branches without tripping the early format/length guards.
const VALID_FORMAT_TOKEN = `${'A'.repeat(24)}.${'B'.repeat(6)}.${'C'.repeat(27)}`;
const VALID_MFA_TOKEN = `mfa.${'D'.repeat(80)}`;

function mockJsonResponse(ok, body) {
  return {
    ok,
    status: ok ? 200 : 401,
    statusText: ok ? 'OK' : 'Unauthorized',
    json: sinon.stub().resolves(body)
  };
}

describe('Discord token validator', function() {
  afterEach(function() {
    sinon.restore();
  });

  it('rejects an empty token without calling the network', async function() {
    sinon.stub(global, 'fetch');

    const result = await validateDiscordToken('');

    expect(result).to.deep.equal({ valid: false, error: 'Discord token is required' });
    expect(global.fetch.called).to.equal(false);
  });

  it('rejects a whitespace-only token', async function() {
    const result = await validateDiscordToken('   ');

    expect(result.valid).to.equal(false);
    expect(result.error).to.equal('Discord token is required');
  });

  it('rejects a malformed token that does not match the expected shape', async function() {
    sinon.stub(global, 'fetch');

    const result = await validateDiscordToken('not a valid token!!');

    expect(result.valid).to.equal(false);
    expect(result.error).to.match(/Invalid Discord token format/);
    expect(global.fetch.called).to.equal(false);
  });

  it('rejects a correctly-shaped token that is too short', async function() {
    sinon.stub(global, 'fetch');

    const result = await validateDiscordToken('abc.def.ghi');

    expect(result.valid).to.equal(false);
    expect(result.error).to.match(/too short/);
    expect(global.fetch.called).to.equal(false);
  });

  it('accepts the mfa.* token shape and calls the Discord API', async function() {
    const fetchStub = sinon.stub(global, 'fetch').resolves(
      mockJsonResponse(true, { id: '123', username: 'bot', discriminator: '0000' })
    );

    const result = await validateDiscordToken(VALID_MFA_TOKEN);

    expect(result.valid).to.equal(true);
    expect(fetchStub.calledOnce).to.equal(true);
    expect(fetchStub.firstCall.args[0]).to.equal('https://discord.com/api/v10/users/@me');
  });

  it('returns bot info when the Discord API confirms the token', async function() {
    sinon.stub(global, 'fetch').resolves(
      mockJsonResponse(true, { id: '42', username: 'SlackONOS', discriminator: '1234' })
    );

    const result = await validateDiscordToken(VALID_FORMAT_TOKEN);

    expect(result).to.deep.equal({
      valid: true,
      botInfo: { id: '42', username: 'SlackONOS', discriminator: '1234' }
    });
  });

  it('returns the API error message when Discord rejects the token', async function() {
    sinon.stub(global, 'fetch').resolves(
      mockJsonResponse(false, { message: '401: Unauthorized' })
    );

    const result = await validateDiscordToken(VALID_FORMAT_TOKEN);

    expect(result.valid).to.equal(false);
    expect(result.error).to.equal('401: Unauthorized');
  });

  it('falls back to the HTTP status text when the error body has no message', async function() {
    const response = mockJsonResponse(false, {});
    response.json = sinon.stub().rejects(new Error('no body'));
    sinon.stub(global, 'fetch').resolves(response);

    const result = await validateDiscordToken(VALID_FORMAT_TOKEN);

    expect(result.valid).to.equal(false);
    expect(result.error).to.equal('HTTP 401: Unauthorized');
  });

  it('returns a network error message when the fetch call throws', async function() {
    sinon.stub(global, 'fetch').rejects(new Error('getaddrinfo ENOTFOUND discord.com'));

    const result = await validateDiscordToken(VALID_FORMAT_TOKEN);

    expect(result.valid).to.equal(false);
    expect(result.error).to.equal('getaddrinfo ENOTFOUND discord.com');
  });
});
