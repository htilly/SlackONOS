/**
 * Serializes operations that read and then mutate the Sonos queue.
 *
 * Add commands check for duplicates, flush the queue when the player is
 * stopped, queue tracks and start playback. When two of them overlap (a slow
 * Sonos, or a user repeating a command that seemed to hang) each sees the queue
 * before the other's changes: the same track gets queued twice, or one add
 * flushes the track another add just queued. Running them one at a time keeps
 * every check-then-act sequence consistent.
 *
 * A hung Sonos call must not block every later add forever, so a holder that
 * exceeds maxHoldMs gives up the lock (the stuck operation keeps running).
 */

const DEFAULT_MAX_HOLD_MS = 60 * 1000;

let tail = Promise.resolve();
let defaultMaxHoldMs = DEFAULT_MAX_HOLD_MS;

function withQueueLock(label, fn, options = {}) {
  const maxHoldMs = options.maxHoldMs ?? defaultMaxHoldMs;
  const logger = options.logger;

  const run = tail.then(() => {
    const operation = Promise.resolve().then(fn);
    let timer = null;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => {
        if (logger) {
          logger.warn(`Queue lock held by "${label}" for over ${maxHoldMs}ms; releasing it for the next operation`);
        }
        resolve();
      }, maxHoldMs);
      if (timer.unref) timer.unref();
    });
    // The lock is released when the operation settles or the hold limit hits
    const released = Promise.race([operation.catch(() => {}), timeout])
      .finally(() => clearTimeout(timer));
    return { operation, released };
  });

  tail = run.then(({ released }) => released);
  return run.then(({ operation }) => operation);
}

function _resetForTests({ maxHoldMs = DEFAULT_MAX_HOLD_MS } = {}) {
  tail = Promise.resolve();
  defaultMaxHoldMs = maxHoldMs;
}

module.exports = {
  withQueueLock,
  _resetForTests
};
