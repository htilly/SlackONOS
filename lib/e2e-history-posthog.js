'use strict';

/**
 * E2E test history read from PostHog.
 *
 * Previously each run was appended to data/e2e-history.json and committed to
 * master, so the history only became visible once a *later* image was built
 * with that file baked in. Two separate GitHub mechanics made that
 * unworkable: the commit carried [skip ci], and - more fundamentally -
 * pushes made with the default GITHUB_TOKEN never trigger workflow runs. The
 * graph therefore waited indefinitely for an unrelated push.
 *
 * Now the e2e workflow captures one event per run (see
 * test/tools/send-e2e-posthog.mjs) and this module reads them back with a
 * HogQL query. The graph updates as soon as a run finishes - no rebuild, no
 * personal access token in CI, no trigger games.
 *
 * The query runs SERVER-SIDE only. PostHog's query API needs a personal API
 * key, which must never reach the browser; the admin endpoint calls this
 * module and returns already-shaped runs.
 *
 * @module e2e-history-posthog
 */

const { normalizeRun } = require('./e2e-history.js');

const DEFAULT_HOST = 'https://us.i.posthog.com';
const DEFAULT_EVENT = 'e2e_run';
const DEFAULT_MAX_RUNS = 200;
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * True when enough is configured to attempt a read. The write path only needs
 * the public project key, so a half-configured install (CI writing, admin
 * page not reading) is a normal state and must not throw.
 */
function isReadConfigured(cfg = {}) {
  return Boolean(cfg.personalApiKey && cfg.projectId);
}

/**
 * PostHog stores our run under event properties. Unwrap one row back into the
 * run shape the admin page already renders, then push it through the same
 * whitelist the file-backed path uses so a malformed or hostile event cannot
 * reach the frontend with unexpected fields.
 */
function rowToRun(row) {
  if (!row) return null;
  let props = row;
  if (typeof row === 'string') {
    try { props = JSON.parse(row); } catch { return null; }
  }
  if (!props || typeof props !== 'object') return null;

  const payload = {
    startedAt: props.startedAt,
    finishedAt: props.finishedAt,
    outcome: props.outcome,
    abortReason: props.abortReason,
    release: props.release,
    commit: props.commit,
    trigger: props.trigger,
    runUrl: props.runUrl,
    passed: props.passed,
    failed: props.failed,
    total: props.total,
    wallClockMs: props.wallClockMs,
    sonosPing: props.sonosPing,
    tests: Array.isArray(props.tests) ? props.tests : []
  };

  const run = normalizeRun(payload);
  // normalizeRun mints a fresh id/recordedAt; keep the originals so the
  // frontend's "has anything changed?" check stays stable across polls.
  if (typeof props.id === 'string' && props.id) run.id = props.id.slice(0, 64);
  if (props.recordedAt) {
    const d = new Date(props.recordedAt);
    if (!Number.isNaN(d.getTime())) run.recordedAt = d.toISOString();
  }
  return run;
}

/**
 * Fetch runs from PostHog, oldest first (the order the chart expects).
 *
 * @param {object} cfg
 * @param {string} cfg.personalApiKey - phx_... Server-side only.
 * @param {string|number} cfg.projectId
 * @param {string} [cfg.host]
 * @param {string} [cfg.eventName]
 * @param {number} [cfg.maxRuns]
 * @param {number} [cfg.timeoutMs]
 * @param {object} [logger]
 * @returns {Promise<Array<object>>}
 * @throws {Error} when not configured or the query fails - callers are
 *   expected to fall back rather than surface a broken page.
 */
async function fetchRuns(cfg = {}, logger = null) {
  if (!isReadConfigured(cfg)) {
    throw new Error('PostHog e2e history is not configured (needs projectId and personalApiKey)');
  }

  const host = String(cfg.host || DEFAULT_HOST).replace(/\/+$/, '');
  const eventName = cfg.eventName || DEFAULT_EVENT;
  const maxRuns = Number.isInteger(cfg.maxRuns) && cfg.maxRuns > 0 ? cfg.maxRuns : DEFAULT_MAX_RUNS;
  const timeoutMs = Number.isInteger(cfg.timeoutMs) && cfg.timeoutMs > 0 ? cfg.timeoutMs : DEFAULT_TIMEOUT_MS;

  // Parameterised so the event name cannot break out of the query.
  const query = {
    kind: 'HogQLQuery',
    query: `SELECT properties FROM events
            WHERE event = {event}
            ORDER BY timestamp DESC
            LIMIT {limit}`,
    values: { event: eventName, limit: maxRuns }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${host}/api/projects/${encodeURIComponent(cfg.projectId)}/query/`, {
      method: 'POST',
      headers: {
        // Never logged: see the catch below, which reports status only.
        Authorization: `Bearer ${cfg.personalApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError'
      ? `PostHog query timed out after ${timeoutMs}ms`
      : `PostHog query failed: ${err.message}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Deliberately does not include the response body: PostHog echoes the
    // request on some errors and we must not risk logging the key.
    throw new Error(`PostHog query returned HTTP ${response.status}`);
  }

  const body = await response.json();
  const rows = Array.isArray(body.results) ? body.results : [];

  const runs = rows
    .map(row => {
      try {
        return rowToRun(Array.isArray(row) ? row[0] : row);
      } catch (err) {
        if (logger) logger.warn(`Skipped an unusable e2e run from PostHog: ${err.message}`);
        return null;
      }
    })
    .filter(Boolean)
    .reverse(); // query is DESC for the LIMIT; chart wants oldest first

  return runs;
}

module.exports = { fetchRuns, rowToRun, isReadConfigured, DEFAULT_HOST, DEFAULT_EVENT };
