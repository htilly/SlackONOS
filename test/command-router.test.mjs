import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createCommandRouter } = require('../lib/command-router.js');

describe('Command Router', function() {
  function makeRouter(overrides = {}) {
    const messages = [];
    const messageTimestamps = new Map();
    const contextUpdates = [];
    const echoHandler = sinon.stub();
    const flushHandler = sinon.stub();
    const voteHandler = sinon.stub();
    const appendAIUnparsed = sinon.stub().resolves();

    const commandRegistry = overrides.commandRegistry || new Map([
      ['echo', { fn: echoHandler, admin: false, aliases: ['sayecho'] }],
      ['flush', { fn: flushHandler, admin: true }],
      ['vote', { fn: voteHandler, admin: false }],
    ]);

    const AIHandler = overrides.AIHandler || {
      isAIEnabled: sinon.stub().returns(false),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves(null),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };

    const router = createCommandRouter({
      logger: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      commandRegistry,
      AIHandler,
      musicHelper: { searchAndQueue: sinon.stub() },
      sonos: {},
      config: { get: sinon.stub().returns(null) },
      sendMessage: async (msg, channel) => {
        messages.push({ msg, channel });
      },
      appendAIUnparsed,
      parseArgs: (text) => {
        const args = [];
        let current = '';
        let quote = null;
        for (const ch of (text || '').trim()) {
          if ((ch === '"' || ch === "'") && !quote) {
            quote = ch;
            continue;
          }
          if (ch === quote) {
            quote = null;
            continue;
          }
          if (!quote && /\s/.test(ch)) {
            if (current) args.push(current);
            current = '';
            continue;
          }
          current += ch;
        }
        if (current) args.push(current);
        return args;
      },
      normalizeUser: (user) => user.replace(/[<@>]/g, ''),
      isBlacklisted: overrides.isBlacklisted || (() => false),
      setContext: (platform, channel, isAdmin) => {
        contextUpdates.push({ platform, channel, isAdmin });
      },
      messageTimestamps,
      getAdminChannel: () => 'ADMIN',
    });

    return {
      router,
      messages,
      messageTimestamps,
      contextUpdates,
      echoHandler,
      flushHandler,
      voteHandler,
      AIHandler,
      appendAIUnparsed,
    };
  }

  it('cleans input and dispatches a known command', async function() {
    const { router, echoHandler, contextUpdates } = makeRouter();

    await router.routeCommand('`sayecho "hello world"`', 'C123', '<@U123>', 'slack');

    expect(echoHandler.calledOnce).to.be.true;
    expect(echoHandler.firstCall.args[0]).to.deep.equal(['sayecho', 'hello world']);
    expect(echoHandler.firstCall.args[1]).to.equal('C123');
    expect(echoHandler.firstCall.args[2]).to.equal('<@U123>');
    expect(contextUpdates[0]).to.deep.equal({ platform: 'slack', channel: 'C123', isAdmin: false });
  });

  it('stores Slack message timestamps for threaded replies', async function() {
    const { router, messageTimestamps } = makeRouter();

    await router.routeCommand('echo hello', 'C123', '<@U123>', 'slack', false, false, '123.456');

    expect(messageTimestamps.get('C123')).to.equal('123.456');
  });

  it('blocks unauthorized Slack admin commands and suggests a democratic alternative', async function() {
    const { router, flushHandler, messages, AIHandler } = makeRouter();

    await router.routeCommand('flush', 'C123', '<@U123>', 'slack');

    expect(flushHandler.called).to.be.false;
    expect(messages[0].msg).to.include('flushvote');
    expect(AIHandler.setUserContext.calledWith('<@U123>', 'flushvote')).to.be.true;
  });

  it('allows Discord admin commands when the caller is admin', async function() {
    const { router, flushHandler } = makeRouter();

    await router.routeCommand('flush', 'discord-channel', 'henrik', 'discord', true);

    expect(flushHandler.calledOnce).to.be.true;
    expect(flushHandler.firstCall.args[2]).to.equal('<@henrik>');
  });

  it('routes mentions through AI fallback when AI is disabled', async function() {
    const { router, messages, appendAIUnparsed } = makeRouter();

    await router.routeCommand('<@BOT> play something', 'C123', '<@U123>', 'slack', false, true);

    expect(messages[0].msg).to.include("didn't understand");
    expect(appendAIUnparsed.calledOnce).to.be.true;
  });
});
