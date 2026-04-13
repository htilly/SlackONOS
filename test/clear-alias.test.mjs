import { expect } from 'chai';
import sinon from 'sinon';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * SLAC-10 — "clear" as an alias for the "flush" command
 *
 * Test suites:
 *  1. flush handler (core behaviour)          — verifies the shared handler logic
 *  2. "clear" alias contract                  — the primary SLAC-10 requirement
 *  3. flush regression                        — existing flush behaviour is unchanged
 *  4. Help text discoverability               — "clear" appears in helpText.txt
 *  5. Module export structure                 — structural / static contract
 */

// ---------------------------------------------------------------------------
// Shared factory — builds a fresh, fully-initialised commandHandlers instance
// ---------------------------------------------------------------------------

function buildHandlers() {
  // Clear the module cache so module-level state (let variables) is reset
  delete require.cache[require.resolve('../lib/command-handlers.js')];
  const commandHandlers = require('../lib/command-handlers.js');

  const messages    = [];
  const userActions = [];

  const mockSonos = {
    stop:                  sinon.stub().resolves(),
    play:                  sinon.stub().resolves(),
    pause:                 sinon.stub().resolves(),
    next:                  sinon.stub().resolves(),
    previous:              sinon.stub().resolves(),
    flush:                 sinon.stub().resolves(),
    setPlayMode:           sinon.stub().resolves(),
    getVolume:             sinon.stub().resolves(50),
    setVolume:             sinon.stub().resolves(),
    getQueue:              sinon.stub().resolves({ items: [], total: 0 }),
    getCurrentState:       sinon.stub().resolves('playing'),
    currentTrack:          sinon.stub().resolves({
      title: 'Track 1', artist: 'Artist 1', queuePosition: 1, duration: 180, position: 60
    }),
    removeTracksFromQueue: sinon.stub().resolves(),
  };

  const mockLogger = {
    info:  sinon.stub(),
    error: sinon.stub(),
    warn:  sinon.stub(),
    debug: sinon.stub(),
  };

  commandHandlers.initialize({
    logger:        mockLogger,
    sonos:         mockSonos,
    sendMessage:   async (msg, ch) => messages.push({ msg, channel: ch }),
    logUserAction: async (user, action) => userActions.push({ user, action }),
    getConfig:     () => ({ maxVolume: 80, searchLimit: 10 }),
  });

  return { commandHandlers, mockSonos, mockLogger, messages, userActions };
}

// ---------------------------------------------------------------------------
// Suite 1 — flush handler (core behaviour, no alias involved)
// ---------------------------------------------------------------------------

describe('SLAC-10 — flush handler (core behaviour)', function () {
  let commandHandlers, mockSonos, mockLogger, messages, userActions;

  beforeEach(function () {
    ({ commandHandlers, mockSonos, mockLogger, messages, userActions } = buildHandlers());
  });

  afterEach(function () {
    sinon.restore();
  });

  it('calls sonos.flush() exactly once', function (done) {
    commandHandlers.flush(['flush'], 'C001', 'alice');

    setTimeout(() => {
      expect(mockSonos.flush.callCount).to.equal(1);
      done();
    }, 50);
  });

  it('sends a success message to the correct channel', function (done) {
    commandHandlers.flush(['flush'], 'C001', 'alice');

    setTimeout(() => {
      expect(messages).to.have.lengthOf(1);
      expect(messages[0].channel).to.equal('C001');
      done();
    }, 50);
  });

  it('success message communicates that the queue was cleared', function (done) {
    commandHandlers.flush(['flush'], 'C001', 'alice');

    setTimeout(() => {
      const text = messages[0].msg.toLowerCase();
      expect(text).to.satisfy(
        (t) => t.includes('queue') || t.includes('wipe') || t.includes('clean') || t.includes('flush'),
        'Expected success message to reference the queue being cleared'
      );
      done();
    }, 50);
  });

  it('success message is a non-empty string', function (done) {
    commandHandlers.flush(['flush'], 'C001', 'alice');

    setTimeout(() => {
      expect(messages[0].msg).to.be.a('string').and.to.have.length.greaterThan(0);
      done();
    }, 50);
  });

  it('logs the user action with the correct user name', function () {
    commandHandlers.flush(['flush'], 'C001', 'alice');

    expect(userActions).to.have.lengthOf(1);
    expect(userActions[0].user).to.equal('alice');
  });

  it('logs the user action as "flush"', function () {
    commandHandlers.flush(['flush'], 'C001', 'alice');

    expect(userActions[0].action).to.equal('flush');
  });

  it('logs an error when sonos.flush() rejects', function (done) {
    mockSonos.flush.rejects(new Error('Sonos unavailable'));

    commandHandlers.flush(['flush'], 'C001', 'alice');

    setTimeout(() => {
      expect(mockLogger.error.called).to.be.true;
      done();
    }, 50);
  });

  it('does NOT send a user-facing message when sonos.flush() rejects', function (done) {
    mockSonos.flush.rejects(new Error('Sonos unavailable'));

    commandHandlers.flush(['flush'], 'C001', 'alice');

    setTimeout(() => {
      expect(messages).to.have.lengthOf(0);
      done();
    }, 50);
  });

  it('error log contains relevant context when sonos.flush() rejects', function (done) {
    mockSonos.flush.rejects(new Error('network timeout'));

    commandHandlers.flush(['flush'], 'C001', 'alice');

    setTimeout(() => {
      const errorArgs = mockLogger.error.args.flat().join(' ').toLowerCase();
      expect(errorArgs).to.satisfy(
        (s) => s.includes('flush') || s.includes('queue') || s.includes('error'),
        'Expected error log to contain relevant context'
      );
      done();
    }, 50);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — "clear" alias contract  (primary SLAC-10 requirement)
// ---------------------------------------------------------------------------

describe('SLAC-10 — "clear" alias contract', function () {
  afterEach(function () {
    sinon.restore();
  });

  // --- structural ---

  it('"clear" is exported as a top-level property of commandHandlers', function () {
    const { commandHandlers } = buildHandlers();
    expect(commandHandlers).to.have.property('clear');
  });

  it('"clear" is a callable function', function () {
    const { commandHandlers } = buildHandlers();
    expect(commandHandlers.clear).to.be.a('function');
  });

  it('"clear" and "flush" are the exact same function reference (shared by reference, no wrapper)', function () {
    const { commandHandlers } = buildHandlers();
    expect(commandHandlers.clear).to.equal(
      commandHandlers.flush,
      '"clear" must be the exact same function reference as "flush" — not a copy or wrapper'
    );
  });

  it('"clear" has the same arity (parameter count) as "flush"', function () {
    const { commandHandlers } = buildHandlers();
    expect(commandHandlers.clear.length).to.equal(commandHandlers.flush.length);
  });

  // --- behavioural ---

  it('"clear" calls sonos.flush() exactly once', function (done) {
    const { commandHandlers, mockSonos } = buildHandlers();

    commandHandlers.clear(['clear'], 'C002', 'bob');

    setTimeout(() => {
      expect(mockSonos.flush.callCount).to.equal(1);
      done();
    }, 50);
  });

  it('"clear" sends a success message to the correct channel', function (done) {
    const { commandHandlers, messages } = buildHandlers();

    commandHandlers.clear(['clear'], 'C002', 'bob');

    setTimeout(() => {
      expect(messages).to.have.lengthOf(1);
      expect(messages[0].channel).to.equal('C002');
      done();
    }, 50);
  });

  it('"clear" produces the identical response message as "flush"', function (done) {
    // Use two independent module instances so state is fully isolated
    const flushCtx = buildHandlers();
    const clearCtx = buildHandlers();

    flushCtx.commandHandlers.flush(['flush'], 'C003', 'user1');
    clearCtx.commandHandlers.clear(['clear'], 'C003', 'user1');

    setTimeout(() => {
      expect(flushCtx.messages).to.have.lengthOf(1);
      expect(clearCtx.messages).to.have.lengthOf(1);
      expect(clearCtx.messages[0].msg).to.equal(
        flushCtx.messages[0].msg,
        'Response message from "clear" must be identical to the response from "flush"'
      );
      done();
    }, 50);
  });

  it('"clear" logs a user action', function () {
    const { commandHandlers, userActions } = buildHandlers();

    commandHandlers.clear(['clear'], 'C002', 'bob');

    expect(userActions).to.have.lengthOf(1);
    expect(userActions[0].user).to.equal('bob');
    expect(userActions[0].action).to.be.a('string').and.to.have.length.greaterThan(0);
  });

  it('"clear" does NOT call any Sonos method other than flush()', function (done) {
    const { commandHandlers, mockSonos } = buildHandlers();

    commandHandlers.clear(['clear'], 'C002', 'bob');

    setTimeout(() => {
      expect(mockSonos.stop.called,        'stop should not be called').to.be.false;
      expect(mockSonos.play.called,        'play should not be called').to.be.false;
      expect(mockSonos.pause.called,       'pause should not be called').to.be.false;
      expect(mockSonos.setPlayMode.called, 'setPlayMode should not be called').to.be.false;
      expect(mockSonos.flush.callCount).to.equal(1);
      done();
    }, 50);
  });

  // --- error handling parity ---

  it('"clear" logs an error when sonos.flush() rejects', function (done) {
    const { commandHandlers, mockSonos, mockLogger } = buildHandlers();
    mockSonos.flush.rejects(new Error('boom'));

    commandHandlers.clear(['clear'], 'C004', 'bob');

    setTimeout(() => {
      expect(mockLogger.error.called).to.be.true;
      done();
    }, 50);
  });

  it('"clear" does NOT send a user-facing message when sonos.flush() rejects', function (done) {
    const { commandHandlers, mockSonos, messages } = buildHandlers();
    mockSonos.flush.rejects(new Error('boom'));

    commandHandlers.clear(['clear'], 'C004', 'bob');

    setTimeout(() => {
      expect(messages).to.have.lengthOf(0);
      done();
    }, 50);
  });

  it('"clear" and "flush" handle Sonos errors identically', function (done) {
    const flushCtx = buildHandlers();
    const clearCtx = buildHandlers();

    flushCtx.mockSonos.flush.rejects(new Error('network error'));
    clearCtx.mockSonos.flush.rejects(new Error('network error'));

    flushCtx.commandHandlers.flush(['flush'], 'C005', 'user1');
    clearCtx.commandHandlers.clear(['clear'], 'C005', 'user1');

    setTimeout(() => {
      // Both log an error
      expect(flushCtx.mockLogger.error.called).to.be.true;
      expect(clearCtx.mockLogger.error.called).to.be.true;
      // Neither sends a user-facing message
      expect(flushCtx.messages).to.have.lengthOf(0);
      expect(clearCtx.messages).to.have.lengthOf(0);
      done();
    }, 50);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — flush regression (SLAC-10 must not break existing behaviour)
// ---------------------------------------------------------------------------

describe('SLAC-10 — flush regression (no existing behaviour broken)', function () {
  let commandHandlers, mockSonos, mockLogger, messages, userActions;

  beforeEach(function () {
    ({ commandHandlers, mockSonos, mockLogger, messages, userActions } = buildHandlers());
  });

  afterEach(function () {
    sinon.restore();
  });

  it('"flush" still calls sonos.flush() after the alias was added', function (done) {
    commandHandlers.flush(['flush'], 'C010', 'carol');

    setTimeout(() => {
      expect(mockSonos.flush.calledOnce).to.be.true;
      done();
    }, 50);
  });

  it('"flush" still sends its success message after the alias was added', function (done) {
    commandHandlers.flush(['flush'], 'C010', 'carol');

    setTimeout(() => {
      expect(messages).to.have.lengthOf(1);
      expect(messages[0].msg).to.be.a('string').and.to.have.length.greaterThan(0);
      done();
    }, 50);
  });

  it('"flush" still logs the user action after the alias was added', function () {
    commandHandlers.flush(['flush'], 'C010', 'carol');

    expect(userActions.some((a) => a.user === 'carol')).to.be.true;
  });

  it('"flush" is still exported as a named export', function () {
    expect(commandHandlers.flush).to.be.a('function');
  });

  it('"flush" and "clear" can be called sequentially without interfering with each other', function (done) {
    commandHandlers.flush(['flush'], 'C011', 'dave');
    commandHandlers.clear(['clear'], 'C011', 'eve');

    setTimeout(() => {
      // Each invocation triggers one sonos.flush() call → 2 total
      expect(mockSonos.flush.callCount).to.equal(2);
      // Each invocation sends one message → 2 total
      expect(messages).to.have.lengthOf(2);
      done();
    }, 50);
  });

  it('calling "clear" does not affect the behaviour of a subsequent "flush" call', function (done) {
    commandHandlers.clear(['clear'], 'C012', 'frank');

    setTimeout(() => {
      // Reset call counts so we can isolate the flush call
      mockSonos.flush.resetHistory();
      messages.length = 0;

      commandHandlers.flush(['flush'], 'C012', 'frank');

      setTimeout(() => {
        expect(mockSonos.flush.callCount).to.equal(1);
        expect(messages).to.have.lengthOf(1);
        done();
      }, 50);
    }, 50);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Help text discoverability (SLAC-10 acceptance criterion)
// ---------------------------------------------------------------------------

describe('SLAC-10 — help text contains "clear" alias', function () {
  let helpText;

  before(function () {
    helpText = readFileSync('templates/help/helpText.txt', 'utf8');
  });

  it('helpText.txt contains the word "clear"', function () {
    expect(helpText).to.include('clear');
  });

  it('helpText.txt still contains the word "flush" (no regression)', function () {
    expect(helpText).to.include('flush');
  });

  it('"clear" and "flush" appear close together in the help text (same entry)', function () {
    const flushIndex = helpText.indexOf('flush');
    const clearIndex = helpText.indexOf('clear');

    expect(flushIndex).to.be.greaterThan(-1, '"flush" not found in help text');
    expect(clearIndex).to.be.greaterThan(-1, '"clear" not found in help text');

    // They should be within 200 characters of each other (same line / same entry)
    expect(Math.abs(flushIndex - clearIndex)).to.be.lessThan(
      200,
      '"clear" and "flush" should appear close together in the help text (same entry)'
    );
  });

  it('help text is non-empty', function () {
    expect(helpText.trim()).to.have.length.greaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — Module export structure (static / structural contract)
// ---------------------------------------------------------------------------

describe('SLAC-10 — module export structure', function () {
  afterEach(function () {
    sinon.restore();
  });

  it('module exports both "flush" and "clear" as top-level properties', function () {
    const { commandHandlers } = buildHandlers();

    expect(commandHandlers).to.have.property('flush');
    expect(commandHandlers).to.have.property('clear');
  });

  it('"clear" is not undefined after initialization', function () {
    const { commandHandlers } = buildHandlers();

    expect(commandHandlers.clear).to.not.be.undefined;
  });

  it('"clear" is not null after initialization', function () {
    const { commandHandlers } = buildHandlers();

    expect(commandHandlers.clear).to.not.be.null;
  });

  it('"flush" is not undefined after initialization', function () {
    const { commandHandlers } = buildHandlers();

    expect(commandHandlers.flush).to.not.be.undefined;
  });
});
