#!/usr/bin/env node

/**
 * One-off migration: send every run already committed in
 * data/e2e-history.json to PostHog, so the admin page's graph does not start
 * empty when it switches from the baked file to PostHog.
 *
 * Each event keeps the run's original id and finishedAt, so re-running this
 * is visible as duplicates by id rather than shifting the timeline - but it
 * is NOT idempotent (PostHog has no upsert). Run it once; use --dry-run first.
 *
 * Usage:
 *   E2E_POSTHOG_WRITE_KEY=phc_... node test/tools/backfill-e2e-posthog.mjs [history.json] [--dry-run]
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { sendEvent, buildEvent, DEFAULT_HOST, DEFAULT_EVENT, DEFAULT_DISTINCT_ID, DEFAULT_WRITE_KEY } from './e2e-posthog-event.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const historyArg = args.find(a => !a.startsWith('--'));
const historyFile = resolve(historyArg || join(repoRoot, 'data/e2e-history.json'));

const writeKey = process.env.E2E_POSTHOG_WRITE_KEY || DEFAULT_WRITE_KEY;

let runs;
try {
    const data = JSON.parse(readFileSync(historyFile, 'utf8'));
    runs = Array.isArray(data.runs) ? data.runs : [];
} catch (error) {
    console.error(`Could not read ${historyFile}: ${error.message}`);
    process.exit(1);
}

if (!runs.length) {
    console.log(`No runs in ${historyFile}; nothing to backfill.`);
    process.exit(0);
}

const opts = {
    writeKey,
    host: process.env.E2E_POSTHOG_HOST || DEFAULT_HOST,
    event: process.env.E2E_POSTHOG_EVENT || DEFAULT_EVENT,
    distinctId: process.env.E2E_POSTHOG_DISTINCT_ID || DEFAULT_DISTINCT_ID
};

console.log(`${dryRun ? 'DRY RUN: would send' : 'Sending'} ${runs.length} run(s) from ${historyFile}`);
let sent = 0;
for (const run of runs) {
    const label = `${run.release || run.commit || run.id || 'run'} (${run.passed}/${run.total}, ${run.outcome}, ${run.finishedAt})`;
    if (dryRun) {
        const ev = buildEvent(run, opts);
        console.log(`  would send ${ev.event} @ ${ev.timestamp} :: ${label} :: ${ev.properties.tests.length} test timings`);
        continue;
    }
    try {
        await sendEvent(run, opts);
        sent += 1;
        console.log(`  sent ${label}`);
    } catch (error) {
        console.error(`  FAILED ${label}: ${error.message}`);
        process.exit(1);
    }
}

if (!dryRun) console.log(`Backfilled ${sent}/${runs.length} run(s).`);
