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
    const musicHelper = overrides.musicHelper || { searchAndQueue: sinon.stub().resolves({ added: 5 }) };

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
      musicHelper,
      sonos: {},
      config: overrides.config || { get: sinon.stub().returns(null) },
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
      getUserMusicProfile: overrides.getUserMusicProfile,
      getUserInteractionProfile: overrides.getUserInteractionProfile,
      logUserAction: overrides.logUserAction,
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
      musicHelper,
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

    expect(messages[0].msg).to.include('🎧 Booth brain is offline');
    expect(appendAIUnparsed.calledOnce).to.be.true;
  });

  it('does not send AI summary before rejecting an unauthorized admin command', async function() {
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'flush',
        args: [],
        confidence: 0.95,
        reasoning: 'User wants to clear the queue',
        summary: 'Clearing the decks!',
        followUp: null,
        response: null,
        suggestedAction: null,
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const { router, flushHandler, messages } = makeRouter({ AIHandler });

    await router.routeCommand('<@BOT> clear the queue', 'C123', '<@U123>', 'slack', false, true);

    expect(flushHandler.called).to.be.false;
    expect(messages.some(m => m.msg.includes('Clearing the decks'))).to.be.false;
    expect(messages[0].msg).to.include('admin-only');
  });

  it('sends AI summary after a successful AI-routed command', async function() {
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'echo',
        args: ['hello'],
        confidence: 0.95,
        reasoning: 'User wants echo',
        summary: 'Echoing with style.',
        followUp: null,
        response: null,
        suggestedAction: null,
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const { router, echoHandler, messages } = makeRouter({ AIHandler });

    await router.routeCommand('<@BOT> say hello nicely', 'C123', '<@U123>', 'slack', false, true);

    expect(echoHandler.calledOnce).to.be.true;
    expect(messages.some(m => m.msg === '🎧 Echoing with style.')).to.be.true;
  });

  it('starts AI chat responses in the DJ voice and stores suggested actions', async function() {
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'chat',
        args: [],
        confidence: 0.95,
        reasoning: 'User asked about weather',
        summary: '',
        followUp: null,
        response: 'Weather radar is not in my booth, but sunny beach tunes are armed.',
        suggestedAction: {
          command: 'add',
          args: ['summer beach hits', '10'],
          description: 'sunny beach tunes',
        },
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const commandRegistry = new Map([
      ['add', { fn: sinon.stub(), admin: false }],
    ]);
    const { router, messages } = makeRouter({ commandRegistry, AIHandler });

    await router.routeCommand('<@BOT> how is the weather?', 'C123', '<@U123>', 'slack', false, true);

    expect(messages[0].msg).to.equal('🎧 Weather radar is not in my booth, but sunny beach tunes are armed.');
    expect(AIHandler.setUserContext.calledOnce).to.be.true;
    expect(AIHandler.setUserContext.firstCall.args[0]).to.equal('<@U123>');
    expect(AIHandler.setUserContext.firstCall.args[1]).to.equal('add summer beach hits 10');
  });

  it('executes AI-routed admin config commands in the Slack admin channel', async function() {
    const setconfigHandler = sinon.stub();
    const commandRegistry = new Map([
      ['setconfig', { fn: setconfigHandler, admin: true }],
    ]);
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'setconfig',
        args: ['aiMoodMirrorEnabled', 'true'],
        confidence: 0.95,
        reasoning: 'Admin wants to enable mood mirror',
        summary: 'Mood mirror switched on.',
        followUp: null,
        response: null,
        suggestedAction: null,
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const { router, messages } = makeRouter({ commandRegistry, AIHandler });

    await router.routeCommand('<@BOT> set aiMoodMirrorEnabled to true', 'ADMIN', '<@U123>', 'slack', false, true);

    expect(setconfigHandler.calledOnce).to.be.true;
    expect(setconfigHandler.firstCall.args[0]).to.deep.equal(['setconfig', 'aiMoodMirrorEnabled', 'true']);
    expect(setconfigHandler.firstCall.args[1]).to.equal('ADMIN');
    expect(messages.some(m => m.msg === '🎧 Mood mirror switched on.')).to.be.true;
  });

  it('rejects AI-routed admin config commands outside the Slack admin channel', async function() {
    const setconfigHandler = sinon.stub();
    const commandRegistry = new Map([
      ['setconfig', { fn: setconfigHandler, admin: true }],
    ]);
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'setconfig',
        args: ['aiMoodMirrorEnabled', 'true'],
        confidence: 0.95,
        reasoning: 'Admin wants to enable mood mirror',
        summary: 'Mood mirror switched on.',
        followUp: null,
        response: null,
        suggestedAction: null,
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const { router, messages } = makeRouter({ commandRegistry, AIHandler });

    await router.routeCommand('<@BOT> set aiMoodMirrorEnabled to true', 'C123', '<@U123>', 'slack', false, true);

    expect(setconfigHandler.called).to.be.false;
    expect(messages.some(m => m.msg === '🎧 Mood mirror switched on.')).to.be.false;
    expect(messages[0].msg).to.include('admin-only');
  });

  it('treats "play some nice tunes" as adding music, not playback control', async function() {
    const playHandler = sinon.stub();
    const commandRegistry = new Map([
      ['add', { fn: sinon.stub(), admin: false }],
      ['play', { fn: playHandler, admin: true }],
    ]);
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'play',
        args: [],
        targetType: 'mood',
        confidence: 0.95,
        reasoning: 'Ambiguous play request',
        summary: 'DJ sparkle cannon primed for nice tunes.',
        followUp: null,
        response: null,
        suggestedAction: null,
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const musicHelper = { searchAndQueue: sinon.stub().resolves({
      added: 5,
      wasPlaying: true,
      queuedTracks: [
        { name: 'Make Luv', artist: 'Room 5' },
        { name: 'Lost in Music', artist: 'Sister Sledge' },
        { name: "Chillin'", artist: 'Modjo' },
        { name: "I'm Watching You", artist: 'Gadjo' },
        { name: 'Woman Like You', artist: 'kryptogram' },
      ],
      appliedBoosters: ['disco dance funk']
    }) };
    const logUserAction = sinon.stub().resolves();
    const { router, messages } = makeRouter({ commandRegistry, AIHandler, musicHelper, logUserAction });

    await router.routeCommand('<@BOT> play some nice tunes', 'C123', '<@U123>', 'slack', false, true);

    expect(playHandler.called).to.be.false;
    expect(musicHelper.searchAndQueue.calledOnce).to.be.true;
    expect(musicHelper.searchAndQueue.firstCall.args[1]).to.equal('nice tunes');
    expect(musicHelper.searchAndQueue.firstCall.args[2]).to.equal(5);
    expect(musicHelper.searchAndQueue.firstCall.args[3]).to.include({ targetType: 'mood' });
    expect(messages).to.have.length(1);
    expect(messages[0].msg).to.include('🎧 DJ sparkle cannon primed for nice tunes.');
    expect(messages[0].msg).to.include('I heard "nice tunes" and cranked the Spotify radar toward disco dance funk');
    expect(messages[0].msg).to.not.include('Why:');
    expect(messages[0].msg).to.include('Added:');
    expect(messages[0].msg).to.include('*Make Luv* by Room 5');
    expect(messages[0].msg).to.include('*Lost in Music* by Sister Sledge');
    const intentCall = logUserAction.getCalls().find(call => call.args[1] === 'ai_intent');
    expect(intentCall).to.exist;
    expect(intentCall.args[0]).to.equal('<@U123>');
    expect(intentCall.args[2]).to.include({
      source: 'ai_intent',
      type: 'add',
      targetType: 'mood',
      query: 'nice tunes',
      requestedCount: 5,
      countStats: false
    });
  });

  it('records AI intent even when the parsed command is rejected by authorization', async function() {
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'flush',
        args: [],
        confidence: 0.95,
        reasoning: 'User wants to clear the queue',
        summary: 'Clearing the queue.',
        followUp: null,
        response: null,
        suggestedAction: null,
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const logUserAction = sinon.stub().resolves();
    const { router, flushHandler } = makeRouter({ AIHandler, logUserAction });

    await router.routeCommand('<@BOT> clear the queue', 'C123', '<@U123>', 'slack', false, true);

    expect(flushHandler.called).to.be.false;
    const intentCall = logUserAction.getCalls().find(call => call.args[1] === 'ai_intent');
    expect(intentCall).to.exist;
    expect(intentCall.args[2]).to.include({
      source: 'ai_intent',
      type: 'flush',
      query: 'clear the queue',
      confidence: 0.95,
      countStats: false
    });
  });

  it('skips AI followUp when the primary command is rejected', async function() {
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'flush',
        args: [],
        confidence: 0.95,
        reasoning: 'User wants to clear then add music',
        summary: 'Clear queue, then add music.',
        followUp: {
          command: 'add',
          args: ['Queen', '5'],
          reasoning: 'Add music after clearing',
        },
        response: null,
        suggestedAction: null,
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const musicHelper = { searchAndQueue: sinon.stub().resolves({ added: 5 }) };
    const { router } = makeRouter({ AIHandler, musicHelper });

    await router.routeCommand('<@BOT> clear the queue and add Queen', 'C123', '<@U123>', 'slack', false, true);

    expect(musicHelper.searchAndQueue.called).to.be.false;
  });

  it('passes personal music history into AI parsing', async function() {
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'echo',
        args: ['hello'],
        confidence: 0.95,
        reasoning: 'User wants echo',
        summary: 'Echoing.',
        followUp: null,
        response: null,
        suggestedAction: null,
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const getUserMusicProfile = sinon.stub().resolves('- add: query "Daft Punk"');
    const { router } = makeRouter({ AIHandler, getUserMusicProfile });

    await router.routeCommand('<@BOT> play something for me', 'C123', '<@U123>', 'slack', false, true);

    expect(getUserMusicProfile.calledWith('<@U123>')).to.be.true;
    expect(AIHandler.parseNaturalLanguage.firstCall.args[2]).to.include({
      platform: 'slack',
      channel: 'C123',
      personalContext: '- add: query "Daft Punk"'
    });
  });

  it('passes interaction tone context into AI parsing when mood mirror is enabled', async function() {
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub().returns(null),
      parseNaturalLanguage: sinon.stub().resolves({
        command: 'add',
        args: ['happy tunes', '5'],
        confidence: 0.95,
        reasoning: 'User wants upbeat music',
        summary: 'Queueing happy tunes.',
        followUp: null,
        response: null,
        suggestedAction: null,
      }),
      setUserContext: sinon.stub(),
      clearUserContext: sinon.stub(),
    };
    const config = { get: sinon.stub().callsFake(key => key === 'aiMoodMirrorEnabled') };
    const getUserInteractionProfile = sinon.stub().resolves('Recent interaction tone: mostly warm');
    const { router } = makeRouter({ AIHandler, config, getUserInteractionProfile });

    await router.routeCommand('<@BOT> please play something fun thanks', 'C123', '<@U123>', 'slack', false, true);

    expect(getUserInteractionProfile.calledWith('<@U123>')).to.be.true;
    const scope = AIHandler.parseNaturalLanguage.firstCall.args[2];
    expect(scope.interactionContext).to.equal('Recent interaction tone: mostly warm');
    expect(scope.interactionTone).to.include({
      mood: 'warm',
      kindnessScore: 3
    });
  });

  it('keeps AI confirmation context scoped to the channel', async function() {
    const flushVoteHandler = sinon.stub();
    const commandRegistry = new Map([
      ['flush', { fn: sinon.stub(), admin: true }],
      ['flushvote', { fn: flushVoteHandler, admin: false }],
    ]);
    const contexts = new Map();
    const keyFor = (user, scope = {}) => `${scope.platform || ''}:${scope.channel || ''}:${user}`;
    const AIHandler = {
      isAIEnabled: sinon.stub().returns(true),
      getUserContext: sinon.stub((user, scope) => contexts.get(keyFor(user, scope)) || null),
      parseNaturalLanguage: sinon.stub().resolves(null),
      setUserContext: sinon.stub((user, suggestion, context, suggestedAction, scope) => {
        contexts.set(keyFor(user, scope), {
          lastSuggestion: suggestion,
          context,
          suggestedAction,
          timestamp: Date.now(),
        });
      }),
      clearUserContext: sinon.stub((user, scope) => contexts.delete(keyFor(user, scope))),
    };
    const { router } = makeRouter({ commandRegistry, AIHandler });

    await router.routeCommand('flush', 'C123', '<@U123>', 'slack');
    await router.routeCommand('<@BOT> ok', 'C999', '<@U123>', 'slack', false, true);
    await router.routeCommand('<@BOT> ok', 'C123', '<@U123>', 'slack', false, true);

    expect(flushVoteHandler.calledOnce).to.be.true;
  });
});
