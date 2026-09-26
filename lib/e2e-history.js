'use strict';

/**
 * E2E test history (per-command response times) graphed on the admin page.
 *
 * The e2e workflow runs on a self-hosted runner against a throwaway
 * SlackONOS, so there is no long-lived server to send results to. Instead the
 * suite writes each run to a file, the workflow appends it to
 * data/e2e-history.json with test/tools/append-e2e-history.mjs and commits
 * that file to master. Every later build (and Docker image) ships the
 * history, and the admin page reads it read-only from disk.
 *
 * Runs are kept newest last, capped at MAX_RUNS.
 *
 * @module e2e-history
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_RUNS = 200;
const MAX_TESTS_PER_RUN = 300;
const OUTCOMES = new Set(['passed', 'failed', 'aborted']);

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
    recordedAt: new Date().toISOString(),
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

function readRuns(filePath, logger) {
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

/**
 * Validate a run and append it to the history file, keeping the newest
 * maxRuns. Returns the number of stored runs.
 */
function appendRun(filePath, payload, { maxRuns = MAX_RUNS } = {}) {
  const run = normalizeRun(payload);
  const kept = [...readRuns(filePath), run].slice(-maxRuns);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Write to a temp file and rename so a crash never leaves half a JSON file
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({ runs: kept }, null, 2) + '\n');
  fs.renameSync(tmpPath, filePath);
  return kept.length;
}

function defaultHistoryPath(rootDir) {
  return path.join(rootDir, 'data', 'e2e-history.json');
}

module.exports = { readRuns, appendRun, normalizeRun, defaultHistoryPath, MAX_RUNS };
