'use strict';

/**
 * O-008 mitigation: Slack admin authorization is bare channel membership -
 * any workspace member who joins `config.adminChannel` gets full bot admin
 * control (debug, setconfig, flush, ...), with no further check. Enforcing
 * "the channel must be private" would be a breaking behavior change for
 * existing deployments (some operators may run with an intentionally open
 * channel), so this module does not change authorization at all - it makes
 * the risk impossible to miss instead:
 *
 *   1. A clear, unambiguous log line at startup if the channel isn't private.
 *   2. A loud warning posted into the channel itself at every startup.
 *   3. A recurring reminder wrapped around every `help` response shown in
 *      that channel, so it isn't a one-time message that scrolls away.
 *
 * @module admin-channel-privacy
 */

let logger = null;
let sendMessage = async () => {};
let slackWeb = null;

/**
 * @param {Object} deps
 * @param {Object} deps.logger - must provide .warn/.info/.debug
 * @param {Function} [deps.sendMessage] - async (text, channel) => any
 * @param {Object} [deps.slackWeb] - a @slack/web-api WebClient instance
 *   (or any object exposing `.conversations.info({channel})`)
 */
function initialize(deps) {
  if (!deps || !deps.logger) {
    throw new Error('admin-channel-privacy requires a logger');
  }
  logger = deps.logger;
  sendMessage = deps.sendMessage || (async () => {});
  slackWeb = deps.slackWeb || null;
}

/**
 * @param {boolean} compact - true for the short reminder wrapped around
 *   `help` output; false for the full startup announcement.
 */
function warningText(compact) {
  if (compact) {
    return '⚠️ _This admin channel is **not private** — anyone who joins it gets full bot admin control. See `help` above for more, or convert it to a private channel._';
  }
  return '🚨 *SECURITY WARNING* 🚨\n' +
    'This admin channel is *not configured as a private Slack channel*. ' +
    'Anyone in the workspace who joins it automatically gets full admin control of this bot ' +
    '(`debug`, `setconfig`, `flush`, `resetvotes`, etc.) — there is no further check.\n\n' +
    '👉 Convert it to a private channel (Slack channel settings → "Change to a private channel"), ' +
    'or restrict who can join, as soon as possible.';
}

/**
 * Queries Slack for whether `adminChannel` is private, logs the result
 * either way, and - only when it is confirmed NOT private - posts the loud
 * warning into the channel itself. Never throws; a failed check is reported
 * as "unknown", never silently treated as "private" or "not private".
 *
 * @param {string} adminChannel - Slack channel ID (or null/undefined, e.g.
 *   Discord-only mode)
 * @returns {Promise<boolean|null>} true = confirmed private, false =
 *   confirmed NOT private, null = unknown (no channel, no Slack client
 *   available, or the API call failed)
 */
async function checkAndAnnounce(adminChannel) {
  if (!adminChannel) return null;
  if (!slackWeb || !slackWeb.conversations || typeof slackWeb.conversations.info !== 'function') {
    logger.debug('Skipping admin channel privacy check: Slack web client not available');
    return null;
  }

  try {
    const result = await slackWeb.conversations.info({ channel: adminChannel });
    const isPrivate = !!(result && result.channel && result.channel.is_private);

    if (!isPrivate) {
      logger.warn(
        '🚨 SECURITY WARNING: Slack adminChannel is NOT a private channel! ' +
        'Any workspace member who joins it gets full bot admin control (debug, setconfig, flush, etc.) ' +
        'with no further check. Convert it to a private channel or restrict who can join.'
      );
      await sendMessage(warningText(false), adminChannel);
    } else {
      logger.info('✅ Slack admin channel privacy check passed: channel is private.');
    }
    return isPrivate;
  } catch (err) {
    logger.warn(`Could not verify Slack admin channel privacy (conversations.info failed): ${err.message}`);
    return null;
  }
}

/**
 * Wraps a help message with the compact warning before and after, but only
 * when the channel is confirmed non-private (isPrivate === false). Returns
 * the message unchanged for true (private) or null (unknown) - never claim
 * a risk that wasn't actually confirmed.
 *
 * @param {string} message
 * @param {boolean|null} isPrivate - the cached result of checkAndAnnounce()
 * @returns {string}
 */
function wrapHelpMessage(message, isPrivate) {
  if (isPrivate !== false) return message;
  const warning = warningText(true);
  return `${warning}\n\n${message}\n\n${warning}`;
}

module.exports = {
  initialize,
  checkAndAnnounce,
  wrapHelpMessage,
  warningText,
};
