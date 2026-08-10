import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { WebClient } = require('@slack/web-api');
const { validateAppToken, validateBotToken, validateSlackTokens } = require('../lib/slack-validator.js');

describe('Slack token validator', function() {
  afterEach(function() {
    sinon.restore();
  });

  describe('#validateAppToken', function() {
    it('rejects a missing app token', async function() {
      const result = await validateAppToken('');

      expect(result).to.deep.equal({ valid: false, error: 'App token must start with xapp-' });
    });

    it('rejects a token that does not start with xapp-', async function() {
      const result = await validateAppToken('xoxb-not-an-app-token');

      expect(result.valid).to.equal(false);
      expect(result.error).to.equal('App token must start with xapp-');
    });

    it('accepts a correctly-prefixed app token on format alone', async function() {
      const result = await validateAppToken('xapp-1-A1B2C3-1234567890-abcdef');

      expect(result).to.deep.equal({ valid: true });
    });
  });

  describe('#validateBotToken', function() {
    it('rejects a missing bot token without calling the network', async function() {
      const apiCall = sinon.stub(WebClient.prototype, 'apiCall');

      const result = await validateBotToken('');

      expect(result).to.deep.equal({ valid: false, error: 'Bot token must start with xoxb-' });
      expect(apiCall.called).to.equal(false);
    });

    it('rejects a token that does not start with xoxb-', async function() {
      const result = await validateBotToken('xapp-not-a-bot-token');

      expect(result.valid).to.equal(false);
      expect(result.error).to.equal('Bot token must start with xoxb-');
    });

    it('returns bot info when Slack confirms the token via auth.test', async function() {
      sinon.stub(WebClient.prototype, 'apiCall').resolves({
        ok: true,
        bot_id: 'B123',
        user_id: 'U123',
        team: 'My Team',
        team_id: 'T123'
      });

      const result = await validateBotToken('xoxb-valid-token');

      expect(result).to.deep.equal({
        valid: true,
        botInfo: { botId: 'B123', userId: 'U123', team: 'My Team', teamId: 'T123' }
      });
    });

    it('returns an error when Slack reports the token as invalid', async function() {
      sinon.stub(WebClient.prototype, 'apiCall').resolves({
        ok: false,
        error: 'invalid_auth'
      });

      const result = await validateBotToken('xoxb-bad-token');

      expect(result).to.deep.equal({ valid: false, error: 'invalid_auth' });
    });

    it('returns a generic error when Slack reports failure without a message', async function() {
      sinon.stub(WebClient.prototype, 'apiCall').resolves({ ok: false });

      const result = await validateBotToken('xoxb-bad-token');

      expect(result.valid).to.equal(false);
      expect(result.error).to.equal('Token validation failed');
    });

    it('catches thrown errors and returns them as validation failures', async function() {
      sinon.stub(WebClient.prototype, 'apiCall').rejects(new Error('network unreachable'));

      const result = await validateBotToken('xoxb-valid-token');

      expect(result.valid).to.equal(false);
      expect(result.error).to.equal('network unreachable');
    });
  });

  describe('#validateSlackTokens', function() {
    it('reports valid:true with combined bot info when both tokens are good', async function() {
      sinon.stub(WebClient.prototype, 'apiCall').resolves({
        ok: true,
        bot_id: 'B1',
        user_id: 'U1',
        team: 'Team',
        team_id: 'T1'
      });

      const result = await validateSlackTokens('xapp-1-good', 'xoxb-good');

      expect(result.valid).to.equal(true);
      expect(result.errors).to.equal(undefined);
      expect(result.botInfo).to.deep.equal({ botId: 'B1', userId: 'U1', team: 'Team', teamId: 'T1' });
    });

    it('collects one error and still returns bot info when only the app token is bad', async function() {
      sinon.stub(WebClient.prototype, 'apiCall').resolves({
        ok: true,
        bot_id: 'B1',
        user_id: 'U1',
        team: 'Team',
        team_id: 'T1'
      });

      const result = await validateSlackTokens('bad-app-token', 'xoxb-good');

      expect(result.valid).to.equal(false);
      expect(result.errors).to.have.lengthOf(1);
      expect(result.errors[0]).to.match(/^App token:/);
      expect(result.botInfo).to.deep.equal({ botId: 'B1', userId: 'U1', team: 'Team', teamId: 'T1' });
    });

    it('collects two errors and no bot info when both tokens are bad', async function() {
      sinon.stub(WebClient.prototype, 'apiCall').resolves({ ok: false, error: 'invalid_auth' });

      const result = await validateSlackTokens('bad-app-token', 'bad-bot-token');

      expect(result.valid).to.equal(false);
      expect(result.errors).to.have.lengthOf(2);
      expect(result.errors[0]).to.match(/^App token:/);
      expect(result.errors[1]).to.match(/^Bot token:/);
      expect(result.botInfo).to.equal(null);
    });
  });
});
