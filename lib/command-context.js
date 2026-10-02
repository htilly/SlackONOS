'use strict';

/**
 * Per-command context (platform, channel, isAdmin, userName).
 *
 * Backed by AsyncLocalStorage so the context follows a command through every
 * await, promise chain and setTimeout it starts. This replaces shared
 * module-level globals, which overlapping Slack/Discord commands could
 * overwrite mid-flight (sending replies to the wrong platform).
 */

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Run fn with the given command context.
 * @param {{platform?: string, channel?: string, isAdmin?: boolean, userName?: string}} ctx
 * @param {Function} fn
 * @returns {*} Whatever fn returns
 */
function run(ctx, fn) {
  return storage.run(Object.freeze({ ...ctx }), fn);
}

/**
 * Get the context of the command currently executing, or null outside a command.
 * @returns {Readonly<{platform?: string, channel?: string, isAdmin?: boolean, userName?: string}>|null}
 */
function get() {
  return storage.getStore() || null;
}

module.exports = { run, get };
