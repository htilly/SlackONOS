import { expect } from 'chai';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { readRuns, appendRun, normalizeRun, defaultHistoryPath } = require('../lib/e2e-history.js');
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function sampleRun(overrides = {}) {
  return {
    startedAt: '2026-09-26T10:00:00Z',
    finishedAt: '2026-09-26T10:20:00Z',
    outcome: 'passed',
    release: 'v3.1.0',
    commit: 'abc1234def',
    passed: 2,
    failed: 0,
    total: 2,
    tests: [
      { name: 'Health: Debug Report', command: 'debug', channel: 'admin', passed: true, slackLatencyMs: 812, firstResponseMs: 1400, totalMs: 3100, responseCount: 1 },
      { name: 'Queue Size', command: 'size', channel: 'standard', passed: true, slackLatencyMs: 240, firstResponseMs: 1100, totalMs: 2400, responseCount: 1 }
    ],
    ...overrides
  };
}

describe('e2e-history', function() {
  let tmpDir;
  let filePath;

  beforeEach(function() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-history-'));
    filePath = path.join(tmpDir, 'data', 'e2e-history.json');
  });

  afterEach(function() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('normalizeRun', function() {
    it('keeps the known fields and drops everything else', function() {
      const run = normalizeRun(sampleRun({ evil: '<script>', tests: [{ name: 'X', command: 'size', slackLatencyMs: 12.4, extra: 1 }] }));
      expect(run).to.not.have.property('evil');
      expect(run.tests[0]).to.deep.equal({
        name: 'X', command: 'size', channel: 'standard', passed: false, retried: false,
        slackLatencyMs: 12, firstResponseMs: null, totalMs: null, responseCount: 0
      });
      expect(run.id).to.be.a('string');
    });

    it('rejects invalid numbers, outcomes and non-http run URLs', function() {
      const run = normalizeRun(sampleRun({
        outcome: 'hacked',
        runUrl: 'javascript:alert(1)',
        tests: [{ name: 'X', slackLatencyMs: -5, totalMs: 'abc', firstResponseMs: Infinity }]
      }));
      expect(run.outcome).to.equal('failed');
      expect(run.runUrl).to.equal(null);
      expect(run.tests[0].slackLatencyMs).to.equal(null);
      expect(run.tests[0].totalMs).to.equal(null);
      expect(run.tests[0].firstResponseMs).to.equal(null);
    });

    it('throws a 400 error when tests is missing', function() {
      expect(() => normalizeRun({})).to.throw().with.property('statusCode', 400);
    });
  });

  describe('storage', function() {
    it('returns an empty list when no file exists', function() {
      expect(readRuns(filePath)).to.deep.equal([]);
    });

    it('returns an empty list for a corrupt file', function() {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '{nope');
      expect(readRuns(filePath)).to.deep.equal([]);
    });

    it('appends runs and keeps only the newest maxRuns', function() {
      for (let i = 1; i <= 5; i++) appendRun(filePath, sampleRun({ release: `v${i}` }), { maxRuns: 3 });
      expect(readRuns(filePath).map(r => r.release)).to.deep.equal(['v3', 'v4', 'v5']);
    });

    it('ships an empty, valid history file with the build', function() {
      const runs = readRuns(defaultHistoryPath(repoRoot));
      expect(runs).to.be.an('array');
    });
  });

  describe('append-e2e-history.mjs', function() {
    const script = path.join(repoRoot, 'test/tools/append-e2e-history.mjs');

    it('appends a run file to the given history file', function() {
      const runFile = path.join(tmpDir, 'run.json');
      fs.writeFileSync(runFile, JSON.stringify(sampleRun()));
      execFileSync(process.execPath, [script, runFile, filePath], { stdio: 'pipe' });
      execFileSync(process.execPath, [script, runFile, filePath], { stdio: 'pipe' });
      const runs = readRuns(filePath);
      expect(runs).to.have.length(2);
      expect(runs[0].tests.map(t => t.slackLatencyMs)).to.deep.equal([812, 240]);
    });

    it('fails without touching the history for an invalid run', function() {
      const runFile = path.join(tmpDir, 'run.json');
      fs.writeFileSync(runFile, JSON.stringify({ nope: true }));
      expect(() => execFileSync(process.execPath, [script, runFile, filePath], { stdio: 'pipe' })).to.throw();
      expect(fs.existsSync(filePath)).to.equal(false);
    });
  });
});
