#!/usr/bin/env node

/**
 * Append one e2e run (written by integration-test-suite.mjs) to the
 * committed history file shown on the admin page.
 *
 * Usage:
 *   node test/tools/append-e2e-history.mjs <run.json> [history.json]
 *
 * history.json defaults to data/e2e-history.json. The run is validated with
 * the same whitelist the admin page relies on and the file keeps the newest
 * 200 runs. Used by .github/workflows/e2e.yml.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { appendRun } = require('../../lib/e2e-history.js');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const [runFile, historyArg] = process.argv.slice(2);

if (!runFile) {
    console.error('Usage: node test/tools/append-e2e-history.mjs <run.json> [history.json]');
    process.exit(2);
}

const historyFile = resolve(historyArg || join(repoRoot, 'data/e2e-history.json'));

try {
    const run = JSON.parse(readFileSync(runFile, 'utf8'));
    const stored = appendRun(historyFile, run);
    console.log(`📈 Appended ${run.release || run.commit || 'run'} to ${historyFile} (${stored} runs stored)`);
} catch (error) {
    console.error(`❌ Could not append e2e run: ${error.message}`);
    process.exit(1);
}
