import { expect } from 'chai';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('Queue Count Cache', function() {
  let queueCache;

  beforeEach(function() {
    delete require.cache[require.resolve('../lib/queue-cache.js')];
    queueCache = require('../lib/queue-cache.js');
  });

  it('stores queue totals from Sonos queue responses', function() {
    const snapshot = queueCache.updateFromQueue({ total: 12, items: [{}, {}] }, 'test');

    expect(snapshot.total).to.equal(12);
    expect(snapshot.source).to.equal('test');
    expect(queueCache.getSnapshot().total).to.equal(12);
  });

  it('falls back to item length when total is missing', function() {
    const snapshot = queueCache.updateFromQueue({ items: [{}, {}, {}] }, 'items');

    expect(snapshot.total).to.equal(3);
  });

  it('adjusts cached totals without going below zero', function() {
    queueCache.setTotal(2, 'seed');

    expect(queueCache.adjustTotal(3, 'add').total).to.equal(5);
    expect(queueCache.adjustTotal(-10, 'remove').total).to.equal(0);
  });

  it('does not return expired snapshots', async function() {
    queueCache.setTotal(7, 'seed');
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(queueCache.getSnapshot(1)).to.equal(null);
    expect(queueCache.getSnapshot(1000).total).to.equal(7);
  });
});
