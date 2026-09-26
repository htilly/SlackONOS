import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const commandContext = require('../lib/command-context.js');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('Command Context', function() {
  it('returns null outside of a command', function() {
    expect(commandContext.get()).to.equal(null);
  });

  it('keeps the context across awaits', async function() {
    await commandContext.run({ platform: 'discord', channel: 'D1' }, async () => {
      await delay(5);
      expect(commandContext.get()).to.include({ platform: 'discord', channel: 'D1' });
    });
  });

  it('keeps the context inside timers started by the command', async function() {
    const seen = await commandContext.run({ platform: 'slack', channel: 'C1' }, () =>
      new Promise(resolve => setTimeout(() => resolve(commandContext.get()), 5))
    );
    expect(seen).to.include({ platform: 'slack', channel: 'C1' });
  });

  it('isolates overlapping commands from each other', async function() {
    const seen = [];
    const slow = commandContext.run({ platform: 'slack', channel: 'C1' }, async () => {
      await delay(20);
      seen.push(commandContext.get().platform);
    });
    const fast = commandContext.run({ platform: 'discord', channel: 'D1' }, async () => {
      await delay(5);
      seen.push(commandContext.get().platform);
    });
    await Promise.all([slow, fast]);
    expect(seen).to.deep.equal(['discord', 'slack']);
  });

  it('exposes a read-only context', function() {
    commandContext.run({ platform: 'slack' }, () => {
      expect(Object.isFrozen(commandContext.get())).to.be.true;
    });
  });
});
