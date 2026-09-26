import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { withQueueLock, _resetForTests } = require('../lib/queue-lock.js');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('Queue Lock', function() {
  beforeEach(function() {
    _resetForTests();
  });

  it('runs overlapping operations one at a time, in call order', async function() {
    const events = [];
    const op = (name, ms) => async () => {
      events.push(`${name}:start`);
      await sleep(ms);
      events.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([
      withQueueLock('a', op('a', 30)),
      withQueueLock('b', op('b', 5)),
      withQueueLock('c', op('c', 5))
    ]);

    expect(results).to.deep.equal(['a', 'b', 'c']);
    expect(events).to.deep.equal(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('passes errors to the caller without blocking later operations', async function() {
    const failing = withQueueLock('fail', async () => { throw new Error('boom'); });
    const next = withQueueLock('next', async () => 'ok');

    let caught = null;
    try {
      await failing;
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.an('error').with.property('message', 'boom');
    expect(await next).to.equal('ok');
  });

  it('releases the lock when a holder exceeds maxHoldMs', async function() {
    const logger = { warn: sinon.stub() };
    const events = [];

    const stuck = withQueueLock('stuck', async () => {
      await sleep(200);
      events.push('stuck:end');
    }, { maxHoldMs: 20, logger });
    const next = withQueueLock('next', async () => {
      events.push('next:run');
    }, { maxHoldMs: 20, logger });

    await next;
    expect(events).to.deep.equal(['next:run']);
    expect(logger.warn.calledOnce).to.be.true;
    await stuck;
    expect(events).to.deep.equal(['next:run', 'stuck:end']);
  });
});
