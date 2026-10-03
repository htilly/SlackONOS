import { expect } from 'chai';
import { createRequire } from 'module';
import { buildEvent, DEFAULT_DISTINCT_ID, DEFAULT_EVENT } from './tools/e2e-posthog-event.mjs';

const require = createRequire(import.meta.url);
const { rowToRun, isReadConfigured } = require('../lib/e2e-history-posthog.js');

// A run in the shape lib/e2e-history.js normalizeRun produces.
const run = {
  id: 'run-abc',
  recordedAt: '2026-10-02T09:34:30.000Z',
  startedAt: '2026-10-02T09:22:44.558Z',
  finishedAt: '2026-10-02T09:34:21.009Z',
  outcome: 'passed',
  abortReason: null,
  release: null,
  commit: 'b3c3e092615331555b610556543e5fa07c7061c0',
  trigger: 'push',
  runUrl: 'https://github.com/htilly/SlackONOS/actions/runs/1',
  passed: 111,
  failed: 0,
  total: 111,
  wallClockMs: 696270,
  sonosPing: { samples: 349, lossPercent: 0, avgLatencyMs: 6.84 },
  tests: [{
    name: 'add track', command: 'add', channel: 'standard', passed: true,
    retried: false, slackLatencyMs: 120, firstResponseMs: 450, totalMs: 900,
    responseCount: 2
  }]
};

describe('e2e history via PostHog', function() {
  describe('#isReadConfigured', function() {
    it('is false until both the project id and the personal key are present', function() {
      expect(isReadConfigured({})).to.be.false;
      expect(isReadConfigured({ projectId: '1' })).to.be.false;
      expect(isReadConfigured({ personalApiKey: 'phx_x' })).to.be.false;
      expect(isReadConfigured({ projectId: '1', personalApiKey: 'phx_x' })).to.be.true;
    });
  });

  describe('#buildEvent', function() {
    const event = buildEvent(run);

    it('uses the namespaced event name so CI never mixes with product telemetry', function() {
      expect(event.event).to.equal('e2e_run');
      expect(DEFAULT_EVENT).to.equal('e2e_run');
    });

    it('uses ONE fixed distinct_id so CI counts as a single install', function() {
      // Product telemetry estimates installs from unique distinct_ids; a
      // per-run id here would inflate that number on every build.
      expect(event.distinct_id).to.equal(DEFAULT_DISTINCT_ID);
      expect(buildEvent({ ...run, id: 'other' }).distinct_id).to.equal(event.distinct_id);
    });

    it("timestamps the event with the run's own finish time, not now", function() {
      expect(event.timestamp).to.equal(run.finishedAt);
    });

    it('tags the event as CI and suppresses person profiles', function() {
      expect(event.properties.source).to.equal('ci');
      expect(event.properties.$process_person_profile).to.be.false;
    });
  });

  describe('#rowToRun', function() {
    it('round-trips an event back into the shape the admin page renders', function() {
      const back = rowToRun(buildEvent(run).properties);
      for (const key of ['outcome', 'commit', 'trigger', 'passed', 'failed', 'total', 'wallClockMs',
        'startedAt', 'finishedAt', 'runUrl']) {
        expect(back[key], key).to.deep.equal(run[key]);
      }
      expect(back.id).to.equal(run.id);
      expect(back.recordedAt).to.equal(run.recordedAt);
      expect(back.sonosPing.samples).to.equal(349);
      expect(back.tests).to.have.lengthOf(1);
      expect(back.tests[0].command).to.equal('add');
      expect(back.tests[0].totalMs).to.equal(900);
    });

    it('accepts properties delivered as a JSON string (HogQL returns it that way)', function() {
      const back = rowToRun(JSON.stringify(buildEvent(run).properties));
      expect(back.commit).to.equal(run.commit);
      expect(back.tests).to.have.lengthOf(1);
    });

    it('drops unknown fields rather than passing them to the frontend', function() {
      const props = { ...buildEvent(run).properties, evil: '<script>', total: 111 };
      expect(rowToRun(props)).to.not.have.property('evil');
    });

    it('returns null for unusable rows instead of throwing', function() {
      expect(rowToRun(null)).to.equal(null);
      expect(rowToRun('not json')).to.equal(null);
      expect(rowToRun(42)).to.equal(null);
    });
  });
});
