/**
 * Shared PostHog event shape for e2e runs, used by both
 * send-e2e-posthog.mjs (one run, from CI) and
 * backfill-e2e-posthog.mjs (the committed history, one-off migration).
 *
 * Kept in its own module so both callers - and the unit tests - can import it
 * without executing a script that has top-level side effects.
 */

export const DEFAULT_HOST = 'https://us.i.posthog.com';
export const DEFAULT_EVENT = 'e2e_run';
/**
 * ONE fixed identity for all CI traffic. Product telemetry estimates "how
 * many people run SlackONOS" from unique distinct_ids, so CI must look like a
 * single install, not one per build.
 */
export const DEFAULT_DISTINCT_ID = 'slackonos-ci';
/**
 * The project's write key. PUBLIC by design: PostHog write keys ship inside
 * browsers and can only append events, never read them. This is the same key
 * lib/telemetry.js already defaults to, so CI needs no secret configured -
 * set E2E_POSTHOG_WRITE_KEY only to point runs at a different project.
 */
export const DEFAULT_WRITE_KEY = 'phc_dkh7jm9oxMh7lLKr8TRBY0eKQ5Jn708pXk9McRC0qlO';

/**
 * @param {object} run - A run in lib/e2e-history.js's normalized shape.
 * @returns {object} A PostHog capture body without the api_key.
 */
export function buildEvent(run, { event = DEFAULT_EVENT, distinctId = DEFAULT_DISTINCT_ID } = {}) {
    return {
        event,
        distinct_id: distinctId,
        // The run's own finish time, so re-sending does not move the point.
        timestamp: run.finishedAt || run.recordedAt || new Date().toISOString(),
        properties: {
            // Field names match what the admin page already renders, so the
            // read path is a straight unwrap (lib/e2e-history-posthog.js).
            id: run.id,
            recordedAt: run.recordedAt,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            outcome: run.outcome,
            abortReason: run.abortReason ?? null,
            release: run.release ?? null,
            commit: run.commit ?? null,
            trigger: run.trigger ?? null,
            runUrl: run.runUrl ?? null,
            passed: run.passed,
            failed: run.failed,
            total: run.total,
            wallClockMs: run.wallClockMs,
            sonosPing: run.sonosPing ?? null,
            tests: Array.isArray(run.tests) ? run.tests : [],
            source: 'ci',
            // No person profile: these are not users.
            $process_person_profile: false
        }
    };
}

/**
 * POST one event. Throws on transport error or non-2xx.
 */
export async function sendEvent(run, { writeKey, host = DEFAULT_HOST, event, distinctId } = {}) {
    if (!writeKey) throw new Error('A PostHog project write key is required');
    const url = `${String(host).replace(/\/+$/, '')}/i/v0/e/`;
    const body = JSON.stringify({ api_key: writeKey, ...buildEvent(run, { event, distinctId }) });
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
    });
    if (!response.ok) throw new Error(`PostHog capture returned HTTP ${response.status}`);
    return true;
}
