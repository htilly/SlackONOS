#!/usr/bin/env node

/**
 * Fully automated end-to-end run:
 *   1. Installs the e2e bot config as config/config.json (backing up any existing one)
 *   2. Starts SlackONOS (node index.js) from the current checkout
 *   3. Waits until the bot reports "System startup complete"
 *   4. Runs test/tools/integration-test-suite.mjs (TestBot acting as a user)
 *   5. Stops the bot and restores the original config/config.json
 *
 * Config (gitignored, never committed):
 *   test/config/e2e-bot-config.json  - SlackONOS config used during the run
 *   test/config/test-config.json     - TestBot config
 * Set E2E_CONFIG_DIR to read both files from another directory.
 *
 * Usage:
 *   npm run test:e2e
 *   npm run test:e2e:verbose
 *   node test/tools/run-e2e.mjs [--verbose] [--channel <id>]
 *
 * Env:
 *   E2E_CONFIG_DIR           Directory holding e2e-bot-config.json + test-config.json
 *   E2E_BOT_START_TIMEOUT    Seconds to wait for the bot to start (default 120)
 *   E2E_BOT_SETTLE_SECONDS   Extra wait after startup before tests (default 3)
 *   E2E_BOT_CMD              Override bot command (default: "node index.js")
 *   E2E_QUIET_BOT=1          Don't echo bot output (still written to test/e2e-bot.log)
 */

import { spawn } from 'child_process';
import { existsSync, copyFileSync, renameSync, rmSync, createWriteStream, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

const configDir = resolve(process.env.E2E_CONFIG_DIR || join(repoRoot, 'test/config'));
const botConfigSource = join(configDir, 'e2e-bot-config.json');
const testConfigSource = join(configDir, 'test-config.json');
const botConfigTarget = join(repoRoot, 'config/config.json');
const botConfigBackup = join(repoRoot, 'config/config.json.e2e-backup');
const testConfigTarget = join(repoRoot, 'test/config/test-config.json');
const testConfigBackup = join(repoRoot, 'test/config/test-config.json.e2e-backup');
const botLogPath = join(repoRoot, 'test/e2e-bot.log');

const startTimeoutMs = (parseInt(process.env.E2E_BOT_START_TIMEOUT || '120', 10) || 120) * 1000;
const settleMs = (parseInt(process.env.E2E_BOT_SETTLE_SECONDS || '3', 10) || 0) * 1000;
const botCmd = (process.env.E2E_BOT_CMD || 'node index.js').split(/\s+/).filter(Boolean);

const READY_MARKER = 'System startup complete';
const FAILED_MARKER = 'STARTUP FAILED';

let botProcess = null;
let botLog = null;
let suiteProcess = null;
let restoreActions = [];
let shuttingDown = false;

function log(msg) {
    console.log(`[e2e] ${msg}`);
}

function installFile(source, target, backup) {
    if (resolve(source) === resolve(target)) return;
    if (existsSync(backup)) {
        throw new Error(`Found leftover backup ${backup} from an interrupted run. ` +
            `Restore it manually (mv it back to ${target}) and try again.`);
    }
    if (existsSync(target)) {
        renameSync(target, backup);
        restoreActions.push(() => {
            rmSync(target, { force: true });
            renameSync(backup, target);
        });
    } else {
        restoreActions.push(() => rmSync(target, { force: true }));
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
}

function restoreFiles() {
    for (const action of restoreActions.reverse()) {
        try {
            action();
        } catch (err) {
            console.error(`[e2e] ⚠️  Failed to restore config: ${err.message}`);
        }
    }
    restoreActions = [];
}

function botEnv() {
    // NODE_ENV=test is meant for unit tests; run the bot as it runs in production
    const env = { ...process.env };
    if (env.NODE_ENV === 'test') delete env.NODE_ENV;
    return env;
}

function startBot() {
    return new Promise((resolvePromise, rejectPromise) => {
        botLog = createWriteStream(botLogPath, { flags: 'w' });
        log(`Starting bot: ${botCmd.join(' ')}`);
        botProcess = spawn(botCmd[0], botCmd.slice(1), {
            cwd: repoRoot,
            env: botEnv(),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const recentLines = [];
        let settled = false;
        const timer = setTimeout(() => {
            finish(new Error(`Bot did not report "${READY_MARKER}" within ${startTimeoutMs / 1000}s`));
        }, startTimeoutMs);

        function finish(err) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (err) {
                err.recentLines = recentLines.slice();
                rejectPromise(err);
            } else {
                resolvePromise();
            }
        }

        function onData(chunk) {
            botLog.write(chunk);
            for (const line of chunk.toString().split('\n')) {
                if (!line.trim()) continue;
                recentLines.push(line);
                if (recentLines.length > 30) recentLines.shift();
                if (process.env.E2E_QUIET_BOT !== '1') console.log(`[bot] ${line}`);
                if (line.includes(READY_MARKER)) finish();
                if (line.includes(FAILED_MARKER)) finish(new Error(`Bot startup failed: ${line.trim()}`));
            }
        }

        botProcess.stdout.on('data', onData);
        botProcess.stderr.on('data', onData);
        botProcess.on('error', (err) => finish(new Error(`Could not start bot: ${err.message}`)));
        botProcess.on('exit', (code, signal) => {
            finish(new Error(`Bot exited before startup completed (code ${code}, signal ${signal})`));
            if (settled && !shuttingDown) {
                console.error(`[e2e] ⚠️  Bot exited during tests (code ${code}, signal ${signal})`);
            }
        });
    });
}

function stopBot() {
    return new Promise((resolvePromise) => {
        if (!botProcess || botProcess.exitCode !== null || botProcess.signalCode !== null) {
            resolvePromise();
            return;
        }
        log('Stopping bot...');
        const killTimer = setTimeout(() => {
            log('Bot did not stop in 10s, sending SIGKILL');
            botProcess.kill('SIGKILL');
        }, 10000);
        botProcess.once('exit', () => {
            clearTimeout(killTimer);
            resolvePromise();
        });
        botProcess.kill('SIGTERM');
    });
}

function runSuite(args) {
    return new Promise((resolvePromise) => {
        log('Running integration test suite...');
        suiteProcess = spawn(process.execPath, [join(repoRoot, 'test/tools/integration-test-suite.mjs'), ...args], {
            cwd: repoRoot,
            env: process.env,
            stdio: 'inherit'
        });
        suiteProcess.on('exit', (code, signal) => {
            suiteProcess = null;
            resolvePromise(code ?? (signal ? 1 : 0));
        });
        suiteProcess.on('error', (err) => {
            console.error(`[e2e] ❌ Could not start test suite: ${err.message}`);
            resolvePromise(1);
        });
    });
}

async function cleanup() {
    shuttingDown = true;
    if (suiteProcess) suiteProcess.kill('SIGTERM');
    await stopBot();
    if (botLog) botLog.end();
    restoreFiles();
}

async function main() {
    const missing = [
        [botConfigSource, 'e2e-bot-config.json.example'],
        [testConfigSource, 'test-config.json.example']
    ].filter(([file]) => !existsSync(file));

    if (missing.length > 0) {
        console.error('[e2e] ❌ Missing e2e config:');
        for (const [file, example] of missing) {
            console.error(`       ${file}`);
            console.error(`         (copy test/config/${example} and fill in)`);
        }
        return 1;
    }

    log(`Using config from ${configDir}`);
    try {
        installFile(botConfigSource, botConfigTarget, botConfigBackup);
        installFile(testConfigSource, testConfigTarget, testConfigBackup);
    } catch (err) {
        console.error(`[e2e] ❌ ${err.message}`);
        return 1;
    }

    try {
        await startBot();
    } catch (err) {
        console.error(`[e2e] ❌ ${err.message}`);
        if (err.recentLines?.length && process.env.E2E_QUIET_BOT === '1') {
            console.error('[e2e] Last bot output:');
            for (const line of err.recentLines) console.error(`  ${line}`);
        }
        console.error(`[e2e] Full bot log: ${botLogPath}`);
        return 1;
    }

    log('✅ Bot is up');
    if (settleMs > 0) await new Promise(r => setTimeout(r, settleMs));

    const code = await runSuite(process.argv.slice(2));
    log(code === 0 ? '✅ E2E tests passed' : `❌ E2E tests failed (exit code ${code})`);
    return code;
}

// A closed stdout/stderr (e.g. piped into a process that died) must not crash
// us before the bot is stopped and the config restored.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

// Last-resort synchronous cleanup if we exit without going through cleanup()
process.on('exit', () => {
    if (botProcess && botProcess.exitCode === null && botProcess.signalCode === null) {
        botProcess.kill('SIGKILL');
    }
    if (suiteProcess) suiteProcess.kill('SIGKILL');
    restoreFiles();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        if (shuttingDown) return;
        log(`${signal} received, cleaning up...`);
        await cleanup();
        process.exit(130);
    });
}

let exitCode = 1;
try {
    exitCode = await main();
} catch (err) {
    console.error(`[e2e] ❌ Unexpected error: ${err.stack || err.message}`);
} finally {
    await cleanup();
}
process.exit(exitCode);
