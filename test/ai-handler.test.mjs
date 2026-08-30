import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';
import {
  getSeasonalContext,
  initialize,
  parseNaturalLanguage,
  isAIEnabled,
  getAIDebugInfo,
  setUserContext,
  getUserContext,
  clearUserContext
} from '../lib/ai-handler.js';

const require = createRequire(import.meta.url);
const nconf = require('nconf');
const OpenAI = require('openai');

// Every OpenAI client shares the same Completions prototype, so stubbing it
// here intercepts the `openai.chat.completions.create(...)` calls made deep
// inside lib/ai-handler.js without needing to inject a fake client.
nconf.use('memory');
const completionsProto = Object.getPrototypeOf(new OpenAI({ apiKey: 'sk-probe-0000000000000000' }).chat.completions);

function createLogger() {
  return {
    debug: sinon.stub(),
    info: sinon.stub(),
    warn: sinon.stub(),
    error: sinon.stub()
  };
}

function planResponse(overrides = {}) {
  const parsed = {
    command: 'add',
    args: ['Queen', '5'],
    targetType: 'artist',
    confidence: 0.92,
    reasoning: 'Clear request for an artist',
    summary: 'Queen signal caught; regal bangers incoming.',
    followUp: null,
    response: null,
    suggestedAction: null,
    ...overrides
  };
  return {
    choices: [{ message: { content: JSON.stringify(parsed) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };
}

describe('AI Handler', function() {
  describe('#getSeasonalContext', function() {
    it('should return seasonal context object', function() {
      const ctx = getSeasonalContext();

      expect(ctx).to.be.an('object');
      expect(ctx).to.have.property('season');
      expect(ctx).to.have.property('month');
      expect(ctx).to.have.property('themes');
      expect(ctx).to.have.property('suggestion');

      expect(ctx.season).to.be.a('string');
      expect(ctx.month).to.be.a('string');
      expect(ctx.themes).to.be.an('array');
      expect(ctx.suggestion).to.be.a('string');
    });

    it('should return valid month name', function() {
      const ctx = getSeasonalContext();
      const validMonths = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];

      expect(validMonths).to.include(ctx.month);
    });

    it('should return themes array with at least one theme', function() {
      const ctx = getSeasonalContext();
      expect(ctx.themes.length).to.be.greaterThan(0);
    });

    it('should return a valid season', function() {
      const ctx = getSeasonalContext();
      const validSeasons = ['Winter', 'Spring', 'Summer', 'Autumn', 'Winter/Holiday', 'Halloween', "Valentine's"];

      expect(validSeasons).to.include(ctx.season);
    });
  });

  describe('user context (#setUserContext / #getUserContext / #clearUserContext)', function() {
    before(async function() {
      // initialize() unconditionally stores the logger before touching the
      // API key, so this gives the context helpers a logger without
      // enabling AI parsing or making any network calls.
      nconf.clear('openaiApiKey');
      await initialize(createLogger());
    });

    afterEach(function() {
      sinon.restore();
    });

    it('returns null for a user with no stored context', function() {
      expect(getUserContext('nobody-yet')).to.equal(null);
    });

    it('round-trips a stored suggestion', function() {
      setUserContext('alice', 'add queen', 'wants queen music');

      const ctx = getUserContext('alice');
      expect(ctx.lastSuggestion).to.equal('add queen');
      expect(ctx.context).to.equal('wants queen music');
    });

    it('keeps separate contexts per scope for the same user', function() {
      setUserContext('bob', 'add queen', 'ctx-a', null, { platform: 'slack', channel: 'C1' });
      setUserContext('bob', 'add u2', 'ctx-b', null, { platform: 'slack', channel: 'C2' });

      expect(getUserContext('bob', { platform: 'slack', channel: 'C1' }).lastSuggestion).to.equal('add queen');
      expect(getUserContext('bob', { platform: 'slack', channel: 'C2' }).lastSuggestion).to.equal('add u2');
    });

    it('clears stored context on request', function() {
      setUserContext('carol', 'gong', 'wants to skip');
      clearUserContext('carol');

      expect(getUserContext('carol')).to.equal(null);
    });

    it('expires context after the timeout window', function() {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });

      setUserContext('dave', 'add queen', 'wants queen music');
      expect(getUserContext('dave')).to.not.equal(null);

      clock.tick(5 * 60 * 1000 + 1000); // just past the 5 minute context timeout

      expect(getUserContext('dave')).to.equal(null);
    });

    it('sanitizes the stored suggestedAction (drops extra args, truncates description)', function() {
      setUserContext('erin', 'add u2', 'ctx', {
        command: 'add',
        args: Array.from({ length: 15 }, (_, i) => `arg${i}`),
        description: 'x'.repeat(200)
      });

      const ctx = getUserContext('erin');
      expect(ctx.suggestedAction.command).to.equal('add');
      expect(ctx.suggestedAction.args).to.have.lengthOf(10);
      expect(ctx.suggestedAction.description).to.have.lengthOf(120);
    });

    it('rejects a "chat" suggestedAction as invalid', function() {
      setUserContext('frank', 'chat', 'ctx', { command: 'chat', args: [], description: 'x' });

      expect(getUserContext('frank').suggestedAction).to.equal(null);
    });

    // Defense-in-depth for security-review finding O-001 / O-011: every
    // current caller of setUserContext passes a `scope` object, so this is
    // not reachable with today's call sites - but buildContextKey's no-scope
    // branch returns the raw userName as an object key (`userContext[key] = {...}`),
    // which would pollute Object.prototype process-wide if a future caller
    // ever omits scope and userName is '__proto__'.
    it('does not pollute Object.prototype when userName is "__proto__" and no scope is given', function() {
      setUserContext('__proto__', 'add queen', 'wants queen music');

      expect(Object.prototype).to.not.have.property('lastSuggestion');
      // A brand-new plain object must not have inherited the polluted field.
      expect(({}).lastSuggestion).to.equal(undefined);
    });

    it('still stores and retrieves context for a user literally named "__proto__"', function() {
      setUserContext('__proto__', 'add queen', 'wants queen music');

      const ctx = getUserContext('__proto__');
      expect(ctx.lastSuggestion).to.equal('add queen');
    });

    it('does not pollute Object.prototype for "constructor" or "prototype" either', function() {
      setUserContext('constructor', 'gong', 'skip it');
      setUserContext('prototype', 'gong', 'skip it');

      expect(Object.prototype).to.not.have.property('lastSuggestion');
    });
  });

  describe('#initialize', function() {
    let logger;
    let createStub;

    beforeEach(function() {
      logger = createLogger();
      createStub = sinon.stub(completionsProto, 'create');
    });

    afterEach(function() {
      sinon.restore();
      nconf.clear('openaiApiKey');
    });

    it('disables AI parsing when no API key is configured', async function() {
      nconf.clear('openaiApiKey');

      await initialize(logger);

      expect(isAIEnabled()).to.equal(false);
      expect(logger.warn.calledOnce).to.equal(true);
      expect(createStub.called).to.equal(false);
    });

    it('disables AI parsing when the key has an invalid format', async function() {
      nconf.set('openaiApiKey', 'not-a-valid-key');

      await initialize(logger);

      expect(isAIEnabled()).to.equal(false);
      expect(logger.error.calledWithMatch(/Invalid OpenAI API key format/)).to.equal(true);
      expect(createStub.called).to.equal(false);
    });

    it('enables AI parsing when the key validates successfully', async function() {
      nconf.set('openaiApiKey', 'sk-valid-1234567890');
      createStub.resolves({ choices: [{ message: { content: 'ok' } }] });

      await initialize(logger);

      expect(isAIEnabled()).to.equal(true);
      expect(logger.info.calledWithMatch(/AI natural language parsing enabled/)).to.equal(true);
    });

    it('disables AI parsing and logs a specific message on a 401', async function() {
      nconf.set('openaiApiKey', 'sk-valid-1234567890');
      const err = new Error('Unauthorized');
      err.status = 401;
      createStub.rejects(err);

      await initialize(logger);

      expect(isAIEnabled()).to.equal(false);
      expect(logger.error.calledWithMatch(/invalid or unauthorized/)).to.equal(true);
    });

    it('disables AI parsing and logs a quota message on a 429', async function() {
      nconf.set('openaiApiKey', 'sk-valid-1234567890');
      const err = new Error('Too Many Requests');
      err.status = 429;
      createStub.rejects(err);

      await initialize(logger);

      expect(isAIEnabled()).to.equal(false);
      expect(logger.error.calledWithMatch(/quota exceeded/)).to.equal(true);
    });

    it('disables AI parsing and logs a connection message on DNS/connection errors', async function() {
      nconf.set('openaiApiKey', 'sk-valid-1234567890');
      const err = new Error('getaddrinfo ENOTFOUND api.openai.com');
      err.code = 'ENOTFOUND';
      createStub.rejects(err);

      await initialize(logger);

      expect(isAIEnabled()).to.equal(false);
      expect(logger.error.calledWithMatch(/Cannot connect to OpenAI API/)).to.equal(true);
    });

    it('disables AI parsing and logs the raw message for other errors', async function() {
      nconf.set('openaiApiKey', 'sk-valid-1234567890');
      createStub.rejects(new Error('boom'));

      await initialize(logger);

      expect(isAIEnabled()).to.equal(false);
      expect(logger.error.calledWithMatch(/Failed to initialize OpenAI client: boom/)).to.equal(true);
    });

    it('disables AI parsing when the validation response has no choices', async function() {
      nconf.set('openaiApiKey', 'sk-valid-1234567890');
      createStub.resolves({});

      await initialize(logger);

      expect(isAIEnabled()).to.equal(false);
      expect(logger.error.calledWithMatch(/Invalid response from OpenAI API/)).to.equal(true);
    });
  });

  describe('#parseNaturalLanguage', function() {
    let logger;
    let createStub;

    beforeEach(async function() {
      logger = createLogger();
      createStub = sinon.stub(completionsProto, 'create');
      nconf.set('openaiApiKey', 'sk-valid-1234567890');
      createStub.resolves({ choices: [{ message: { content: 'ok' } }] });
      await initialize(logger);
      createStub.resetHistory();
    });

    afterEach(function() {
      sinon.restore();
      nconf.clear('openaiApiKey');
    });

    it('returns null without calling OpenAI when AI parsing is not enabled', async function() {
      nconf.clear('openaiApiKey');
      await initialize(logger); // re-init with no key disables AI again
      createStub.resetHistory();

      const result = await parseNaturalLanguage('play queen', 'alice');

      expect(result).to.equal(null);
      expect(createStub.called).to.equal(false);
    });

    it('parses a valid command plan from OpenAI', async function() {
      createStub.resolves(planResponse());

      const result = await parseNaturalLanguage('add queen', 'alice');

      expect(result.command).to.equal('add');
      expect(result.args).to.deep.equal(['Queen', '5']);
      expect(getAIDebugInfo().lastSuccessTS).to.be.a('string');
    });

    it('retries with JSON mode when the model does not support structured outputs', async function() {
      const schemaErr = new Error('This model does not support response_format json_schema');
      schemaErr.status = 400;
      createStub.onFirstCall().rejects(schemaErr);
      createStub.onSecondCall().resolves(planResponse());

      const result = await parseNaturalLanguage('add queen', 'alice');

      expect(result.command).to.equal('add');
      expect(createStub.calledTwice).to.equal(true);
      expect(createStub.secondCall.args[0].response_format).to.deep.equal({ type: 'json_object' });
    });

    it('returns null when OpenAI refuses to answer', async function() {
      createStub.resolves({ choices: [{ message: { refusal: 'cannot comply' } }] });

      const result = await parseNaturalLanguage('add queen', 'alice');

      expect(result).to.equal(null);
      expect(logger.warn.calledWithMatch(/refused/)).to.equal(true);
    });

    it('returns null and records an error when the response is not valid JSON', async function() {
      createStub.resolves({ choices: [{ message: { content: 'not json' } }] });

      const result = await parseNaturalLanguage('add queen', 'alice');

      expect(result).to.equal(null);
      expect(getAIDebugInfo().lastErrorMessage).to.be.a('string');
    });

    it('returns null when the parsed plan fails schema validation', async function() {
      createStub.resolves(planResponse({ command: 'not-a-real-command' }));

      const result = await parseNaturalLanguage('do something weird', 'alice');

      expect(result).to.equal(null);
      expect(logger.warn.calledWithMatch(/invalid command plan/)).to.equal(true);
    });

    it('re-interprets "play <music descriptors>" as an add request', async function() {
      createStub.resolves(planResponse({
        command: 'play',
        args: [],
        targetType: 'command',
        summary: 'Got it.'
      }));

      const result = await parseNaturalLanguage('play some queen', 'alice');

      expect(result.command).to.equal('add');
      expect(result.args).to.deep.equal(['queen', '5']);
      expect(result.summary).to.not.equal('Got it.');
    });

    it('clears follow-up context after a confident parse', async function() {
      setUserContext('alice', 'add queen', 'wants queen music');
      expect(getUserContext('alice')).to.not.equal(null);

      createStub.resolves(planResponse({ confidence: 0.9 }));
      await parseNaturalLanguage('yes', 'alice');

      expect(getUserContext('alice')).to.equal(null);
    });

    it('returns null and records the error when the OpenAI call rejects', async function() {
      createStub.rejects(new Error('network down'));

      const result = await parseNaturalLanguage('add queen', 'alice');

      expect(result).to.equal(null);
      expect(getAIDebugInfo().lastErrorMessage).to.equal('network down');
    });
  });
});
