'use strict';

/**
 * Single, deny-by-default source of truth for which config keys are safe to
 * print verbatim in chat (the `debug` and `configdump` commands).
 *
 * Before this module existed, `_debug` redacted only an 8-entry exact-name
 * allowlist that missed `discordToken`, `githubToken`, `githubAppPrivateKey`
 * (a full RSA PEM) and `setupBootstrapToken`, while `configdump`'s separate
 * substring heuristic (`token`/`secret`/`apikey`/`clientid`/`password`) also
 * missed `githubAppPrivateKey` - it contains neither "token" nor "apikey".
 * The two implementations drifted apart and both under-redacted the same
 * class of secret. See security-review finding O-006.
 *
 * A key is treated as sensitive if it merely *looks* like a credential by
 * name - deny-by-default, not an allowlist of known-bad names - so a newly
 * added config key (e.g. a future `xyzApiSecret`) is redacted automatically
 * instead of silently leaking until someone remembers to list it.
 *
 * @module redact-config
 */

const SENSITIVE_KEY_PATTERN = /token|secret|key|password|hash|credential|clientid/i;

// Names that would otherwise slip past the pattern above but are still
// sensitive enough to hide from chat output (e.g. a telemetry instance ID is
// a stable per-install identifier, not a credential by name, but still
// isn't something to broadcast into a channel).
const EXTRA_SENSITIVE_KEYS = new Set(['telemetryInstanceId']);

/**
 * @param {string} key - A config key name.
 * @returns {boolean} true if the key's value should never be shown verbatim.
 */
function isSensitiveConfigKey(key) {
  if (typeof key !== 'string') return false;
  return SENSITIVE_KEY_PATTERN.test(key) || EXTRA_SENSITIVE_KEYS.has(key);
}

/**
 * @param {string} key - A config key name.
 * @param {string} displayValue - The value already formatted for display
 *   (e.g. via JSON.stringify), used only when `key` is not sensitive.
 * @returns {string} `displayValue`, or the redaction placeholder.
 */
function redactConfigValue(key, displayValue) {
  return isSensitiveConfigKey(key) ? '[REDACTED]' : displayValue;
}

module.exports = { isSensitiveConfigKey, redactConfigValue, SENSITIVE_KEY_PATTERN };
