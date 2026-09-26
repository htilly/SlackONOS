'use strict';

/**
 * Stores e2e test runs (per-command response times) so the admin page can
 * graph them over releases.
 *
 * The e2e suite runs against a throwaway SlackONOS instance on the test
 * runner, so it cannot write into this instance's state directly. Instead it
 * POSTs each run to /api/e2e/results, authenticated with the shared
 * `e2eIngestToken` config value (or E2E_INGEST_TOKEN env var). With no token
 * configured the endpoint does not exist (404).
 *
 * Runs are kept in config/e2e-history.json (the persisted config volume in
 * Docker), newest last, capped at MAX_RUNS.
 *
 * @module e2e-history
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readRequestBody } = require('./http-utils');
const { timingSafeEqualString } = require('./setup-bootstrap');

const MAX_RUNS = 200;
const MAX_TESTS_PER_RUN = 300;
const MAX_BODY_BYTES = 512 * 1024;
const OUTCOMES = new Set(['passed', 'failed', 'aborted']);

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function str(value, maxLen) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, maxLen) : null;
}

function ms(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n < 24 * 60 * 60 * 1000 ? Math.round(n) : null;
}

function count(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function isoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function httpUrl(value) {
  const s = str(value, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Validate and whitelist an incoming run. Anything unexpected is dropped, so
 * the stored file only ever holds the fields the admin page renders.
 * @throws {Error} with statusCode 400 when the payload is not a usable run.
 */
function normalizeRun(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.tests)) {
    const err = new Error('Payload must be an object with a tests array');
    err.statusCode = 400;
    throw err;
  }

  const tests = payload.tests.slice(0, MAX_TESTS_PER_RUN)
    .filter(t => t && typeof t === 'object' && str(t.name, 120))
    .map(t => ({
      name: str(t.name, 120),
      command: str(t.command, 200),
      channel: t.channel === 'admin' ? 'admin' : 'standard',
      passed: t.passed === true,
      retried: t.retried === true,
      slackLatencyMs: ms(t.slackLatencyMs),
      firstResponseMs: ms(t.firstResponseMs),
      totalMs: ms(t.totalMs),
      responseCount: count(t.responseCount)
    }));

  const ping = payload.sonosPing && typeof payload.sonosPing === 'object' ? payload.sonosPing : null;
  const lossPercent = ping ? Number(ping.lossPercent) : NaN;

  return {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    startedAt: isoDate(payload.startedAt),
    finishedAt: isoDate(payload.finishedAt),
    outcome: OUTCOMES.has(payload.outcome) ? payload.outcome : 'failed',
    abortReason: str(payload.abortReason, 200),
    release: str(payload.release, 100),
    commit: str(payload.commit, 64),
    trigger: str(payload.trigger, 50),
    runUrl: httpUrl(payload.runUrl),
    passed: count(payload.passed),
    failed: count(payload.failed),
    total: count(payload.total),
    wallClockMs: ms(payload.wallClockMs),
    sonosPing: ping ? {
      samples: count(ping.samples),
      lossPercent: Number.isFinite(lossPercent) ? Math.min(100, Math.max(0, lossPercent)) : null,
      avgLatencyMs: Number.isFinite(Number(ping.avgLatencyMs)) ? Number(ping.avgLatencyMs) : null
    } : null,
    tests
  };
}

function createE2eHistory({ filePath, config, logger, maxRuns = MAX_RUNS }) {
  function getIngestToken() {
    const value = process.env.E2E_INGEST_TOKEN || (config && config.get('e2eIngestToken')) || '';
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function readRuns() {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(data.runs) ? data.runs : [];
    } catch (err) {
      if (err.code !== 'ENOENT' && logger) {
        logger.warn(`Could not read e2e history (${filePath}): ${err.message}`);
      }
      return [];
    }
  }

  function appendRun(run) {
    const runs = readRuns();
    runs.push(run);
    const kept = runs.slice(-maxRuns);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Write to a temp file and rename so a crash never leaves half a JSON file
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ runs: kept }, null, 2));
    fs.renameSync(tmpPath, filePath);
    return kept.length;
  }

  /**
   * Handle POST /api/e2e/results. Returns true when the request was handled.
   */
  async function handleIngest(req, res) {
    const expected = getIngestToken();
    if (!expected) {
      writeJson(res, 404, { error: 'Not found' });
      return true;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      writeJson(res, 405, { error: 'Method not allowed' });
      return true;
    }

    const auth = req.headers.authorization || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    if (!provided || !timingSafeEqualString(provided, expected)) {
      writeJson(res, 401, { error: 'Invalid or missing e2e ingest token' });
      return true;
    }

    let payload;
    try {
      payload = JSON.parse(await readRequestBody(req, { limit: MAX_BODY_BYTES }));
    } catch (err) {
      writeJson(res, err.statusCode || 400, { error: err.statusCode ? err.message : 'Invalid JSON' });
      return true;
    }

    try {
      const run = normalizeRun(payload);
      const stored = appendRun(run);
      if (logger) {
        logger.info(`📈 Stored e2e run ${run.release || run.commit || run.id}: ${run.passed}/${run.total} passed (${run.outcome})`);
      }
      writeJson(res, 201, { success: true, id: run.id, storedRuns: stored });
    } catch (err) {
      if (!err.statusCode && logger) logger.error('Failed to store e2e run: ' + err.message);
      writeJson(res, err.statusCode || 500, { success: false, error: err.statusCode ? err.message : 'Failed to store run' });
    }
    return true;
  }

  return { readRuns, appendRun, handleIngest, getIngestToken };
}

function defaultHistoryPath(rootDir) {
  return path.join(rootDir, 'config', 'e2e-history.json');
}

module.exports = { createE2eHistory, normalizeRun, defaultHistoryPath, MAX_RUNS };
