import { expect } from 'chai';
import { createRequire } from 'module';
import { Readable } from 'stream';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { createE2eHistory, normalizeRun } = require('../lib/e2e-history.js');

function createConfig(token) {
  return { get: (key) => (key === 'e2eIngestToken' ? token : undefined) };
}

function createRequest({ method = 'POST', token = null, body = '' } = {}) {
  const req = Readable.from([Buffer.from(body)]);
  req.method = method;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  return req;
}

function createResponse() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(code) { this.statusCode = code; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; }
  };
  return res;
}

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
  const savedEnvToken = process.env.E2E_INGEST_TOKEN;

  beforeEach(function() {
    delete process.env.E2E_INGEST_TOKEN;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-history-'));
    filePath = path.join(tmpDir, 'config', 'e2e-history.json');
  });

  afterEach(function() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (savedEnvToken === undefined) delete process.env.E2E_INGEST_TOKEN;
    else process.env.E2E_INGEST_TOKEN = savedEnvToken;
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
      const history = createE2eHistory({ filePath, config: createConfig('t') });
      expect(history.readRuns()).to.deep.equal([]);
    });

    it('keeps only the newest maxRuns runs', function() {
      const history = createE2eHistory({ filePath, config: createConfig('t'), maxRuns: 3 });
      for (let i = 1; i <= 5; i++) history.appendRun(normalizeRun(sampleRun({ release: `v${i}` })));
      expect(history.readRuns().map(r => r.release)).to.deep.equal(['v3', 'v4', 'v5']);
    });
  });

  describe('handleIngest', function() {
    it('is 404 when no ingest token is configured', async function() {
      const history = createE2eHistory({ filePath, config: createConfig('') });
      const res = createResponse();
      await history.handleIngest(createRequest({ token: 'anything', body: JSON.stringify(sampleRun()) }), res);
      expect(res.statusCode).to.equal(404);
      expect(fs.existsSync(filePath)).to.equal(false);
    });

    it('rejects a missing or wrong token', async function() {
      const history = createE2eHistory({ filePath, config: createConfig('secret-token') });
      for (const token of [null, 'wrong', 'secret-token-longer']) {
        const res = createResponse();
        await history.handleIngest(createRequest({ token, body: JSON.stringify(sampleRun()) }), res);
        expect(res.statusCode).to.equal(401);
      }
      expect(history.readRuns()).to.have.length(0);
    });

    it('rejects non-POST requests', async function() {
      const history = createE2eHistory({ filePath, config: createConfig('secret-token') });
      const res = createResponse();
      await history.handleIngest(createRequest({ method: 'GET', token: 'secret-token' }), res);
      expect(res.statusCode).to.equal(405);
    });

    it('rejects invalid JSON with 400', async function() {
      const history = createE2eHistory({ filePath, config: createConfig('secret-token') });
      const res = createResponse();
      await history.handleIngest(createRequest({ token: 'secret-token', body: '{nope' }), res);
      expect(res.statusCode).to.equal(400);
    });

    it('stores a valid run with the correct token', async function() {
      const history = createE2eHistory({ filePath, config: createConfig('secret-token') });
      const res = createResponse();
      await history.handleIngest(createRequest({ token: 'secret-token', body: JSON.stringify(sampleRun()) }), res);
      expect(res.statusCode).to.equal(201);
      const runs = history.readRuns();
      expect(runs).to.have.length(1);
      expect(runs[0].release).to.equal('v3.1.0');
      expect(runs[0].tests.map(t => t.slackLatencyMs)).to.deep.equal([812, 240]);
    });

    it('accepts the token from E2E_INGEST_TOKEN', async function() {
      process.env.E2E_INGEST_TOKEN = 'env-token';
      const history = createE2eHistory({ filePath, config: createConfig('') });
      const res = createResponse();
      await history.handleIngest(createRequest({ token: 'env-token', body: JSON.stringify(sampleRun()) }), res);
      expect(res.statusCode).to.equal(201);
    });
  });
});
