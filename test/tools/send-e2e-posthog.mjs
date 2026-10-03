#!/usr/bin/env node

/**
 * Send one e2e run (written by integration-test-suite.mjs) to PostHog as a
 * single `e2e_run` event. Used by .github/workflows/e2e.yml.
 *
 * Replaces the old "append to data/e2e-history.json and commit it" step. That
 * never worked end to end: a push made with the default GITHUB_TOKEN does not
 * trigger workflow runs, so the image that would have baked the history in
 * was never built and the admin page's graph stayed empty.
 *
 * Usage:
 *   node test/tools/send-e2e-posthog.mjs <run.json>
 *
 * Env:
 *   E2E_POSTHOG_WRITE_KEY    phc_... project write key. OPTIONAL - defaults to
 *                            the same public key lib/telemetry.js uses. PUBLIC
 *                            by design: PostHog write keys ship in browsers
 *                            and can only append events, never read them.
 *   E2E_POSTHOG_HOST         default https://us.i.posthog.com
 *   E2E_POSTHOG_EVENT        default e2e_run
 *   E2E_POSTHOG_DISTINCT_ID  default slackonos-ci
 */

import { readFileSync } from 'fs';
import { sendEvent, DEFAULT_HOST, DEFAULT_EVENT, DEFAULT_DISTINCT_ID, DEFAULT_WRITE_KEY } from './e2e-posthog-event.mjs';

const [runFile] = process.argv.slice(2);
if (!runFile) {
    console.error('Usage: node test/tools/send-e2e-posthog.mjs <run.json>');
    process.exit(2);
}

// Falls back to the public project key, so a fresh clone records runs without
// any secret being configured.
const writeKey = process.env.E2E_POSTHOG_WRITE_KEY || DEFAULT_WRITE_KEY;

let run;
try {
    run = JSON.parse(readFileSync(runFile, 'utf8'));
} catch (error) {
    console.error(`::error::Could not read ${runFile}: ${error.message}`);
    process.exit(1);
}

try {
    await sendEvent(run, {
        writeKey,
        host: process.env.E2E_POSTHOG_HOST || DEFAULT_HOST,
        event: process.env.E2E_POSTHOG_EVENT || DEFAULT_EVENT,
        distinctId: process.env.E2E_POSTHOG_DISTINCT_ID || DEFAULT_DISTINCT_ID
    });
} catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
}

const label = run.release || run.commit || run.id || 'run';
console.log(`📈 Sent e2e run ${label} to PostHog (${run.passed}/${run.total} passed, outcome ${run.outcome})`);
