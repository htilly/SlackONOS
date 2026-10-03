import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createRateLimiter } = require('../lib/rate-limiter.js');

describe('rate-limiter', function() {
  function makeLimiter(opts = {}) {
    let t = 1000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60000, now: () => t, ...opts });
    return { limiter, advance: (ms) => { t += ms; } };
  }

  it('allows up to the limit, then blocks', function() {
    const { limiter } = makeLimiter();
    expect(limiter.hit('u').allowed).to.be.true;
    expect(limiter.hit('u').allowed).to.be.true;
    expect(limiter.hit('u').allowed).to.be.true;
    const blocked = limiter.hit('u');
    expect(blocked.allowed).to.be.false;
    expect(blocked.retryAfterMs).to.equal(60000);
  });

  it('reports firstBlock only once per window', function() {
    const { limiter } = makeLimiter({ limit: 1 });
    limiter.hit('u');
    expect(limiter.hit('u').firstBlock).to.be.true;
    expect(limiter.hit('u').firstBlock).to.be.false;
  });

  it('frees capacity as old hits leave the window', function() {
    const { limiter, advance } = makeLimiter({ limit: 1 });
    limiter.hit('u');
    expect(limiter.hit('u').allowed).to.be.false;
    advance(60000);
    expect(limiter.hit('u').allowed).to.be.true;
    // A fresh window warns again
    expect(limiter.hit('u').firstBlock).to.be.true;
  });

  it('tracks keys independently', function() {
    const { limiter } = makeLimiter({ limit: 1 });
    limiter.hit('a');
    expect(limiter.hit('a').allowed).to.be.false;
    expect(limiter.hit('b').allowed).to.be.true;
  });

  it('treats a limit of 0 as disabled and reads function limits live', function() {
    let max = 0;
    const { limiter } = makeLimiter({ limit: () => max });
    for (let i = 0; i < 10; i++) expect(limiter.hit('u').allowed).to.be.true;
    expect(limiter.size()).to.equal(0);
    max = 1;
    expect(limiter.hit('u').allowed).to.be.true;
    expect(limiter.hit('u').allowed).to.be.false;
  });

  it('caps the number of tracked keys', function() {
    const { limiter } = makeLimiter({ maxKeys: 2 });
    limiter.hit('a');
    limiter.hit('b');
    limiter.hit('c');
    expect(limiter.size()).to.equal(2);
  });
});
