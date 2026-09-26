# Integration Testing Guide

Complete guide for running integration tests against a live SlackONOS bot.

## Overview

The integration test suite sends real commands to your SlackONOS bot via Slack and validates the responses. This tests the entire system end-to-end:

**Flow:** Slack message → Bot processing → Spotify search → Sonos action → Response

### ⚠️ Separate Test Bot Required

**You MUST use a separate Slack bot** for integration testing. The SlackONOS bot ignores messages from itself (filters by `botUserId`), so if you send test messages using the same bot token, it will ignore them.

**Technical reason:** The bot has self-filtering logic to prevent responding to its own messages, which would create infinite loops.

## Fully Automated Run (recommended)

One command starts SlackONOS from the current checkout, waits until it is up, runs the whole suite with the TestBot and shuts everything down again:

```bash
cp test/config/test-config.json.example    test/config/test-config.json     # TestBot
cp test/config/e2e-bot-config.json.example test/config/e2e-bot-config.json  # SlackONOS under test
# fill in both files, then:
npm run test:e2e            # or: npm run test:e2e:verbose
```

Both files are gitignored - all tokens and API keys stay on the test machine.

What `test/tools/run-e2e.mjs` does:

1. Copies `test/config/e2e-bot-config.json` to `config/config.json` (an existing `config/config.json` is backed up and restored afterwards).
2. Starts `node index.js`, writes its output to `test/e2e-bot.log`.
3. Waits for `🚀 System startup complete.` (fails fast on `STARTUP FAILED` or if the process exits).
4. Runs `test/tools/integration-test-suite.mjs` (arguments such as `--verbose` / `--channel <id>` are passed on).
5. Stops the bot, restores the config and exits with the suite's exit code.

| Env var | Default | Purpose |
|---|---|---|
| `E2E_CONFIG_DIR` | `test/config` | Directory holding `e2e-bot-config.json` + `test-config.json` |
| `E2E_BOT_START_TIMEOUT` | `120` | Seconds to wait for the bot to start |
| `E2E_BOT_SETTLE_SECONDS` | `3` | Extra wait after startup before the first test |
| `E2E_QUIET_BOT` | unset | `1` = don't echo bot output (still written to `test/e2e-bot.log`) |
| `E2E_BOT_CMD` | `node index.js` | Override how the bot is started |

**Requirements for the SlackONOS instance under test:**

- It must be its **own Slack app** (not your production SlackONOS app). Two Socket Mode connections for the same app split the events between them, so tests would randomly miss replies.
- Stop any other SlackONOS running on the same machine, or give the e2e config other `webPort`/`httpsPort` values.
- `adminChannel`/`standardChannel` must match `slackAdminChannel`/`slackChannel` in `test-config.json`, and `slackONOSBotId` should be the user ID of this e2e SlackONOS bot (for the @mention/AI tests).
- `ping` must be installed if Sonos ping monitoring is used.

The suite itself can also be configured with env vars only (no `test-config.json`): `SLACK_BOT_TOKEN`, `SLACK_CHANNEL`, `SLACK_ADMIN_CHANNEL`, `SLACKONOS_BOT_ID`, `SONOS_PING_HOST`.

## Response Time History (admin page graph)

Every e2e run is committed to `data/e2e-history.json` on master. The file ships with every later build and Docker image, and the admin page graphs it (**📈 E2E Response Times**). You can view the median or a single command, per release/run. Failed and aborted runs are marked in red. A table compares each command with the previous run. No server has to be running to collect the data.

**How the data flows:**

1. The suite writes the run to `test/e2e-run.json` (override with `E2E_RESULTS_FILE`). This includes aborted runs (health or pre-flight failure).
2. The `e2e` job in `.github/workflows/e2e.yml` uploads that file as a workflow artifact. This job runs on the self-hosted runner with read-only repo access.
3. The `record-history` job on a GitHub-hosted runner checks out master and appends the run with `test/tools/append-e2e-history.mjs`. It then pushes the change as `chore(e2e): record response times for <tag> [skip ci]`. `[skip ci]` keeps the commit from starting CI or a Docker build of its own; the next real build includes it. The newest 200 runs are kept.
4. The admin page reads the file from disk (`GET /api/admin/e2e-history`).

Because the tests run after a release is published, a release's own image contains the history up to the previous run. Its own results appear in the next build.

The push needs `contents: write` for the workflow's `GITHUB_TOKEN`. If master is protected so that only pull requests can change it, allow GitHub Actions to push or the `record-history` job fails.

Three metrics are stored per test:

| Metric | Meaning |
|---|---|
| Bot latency (default) | Slack timestamp of the bot's first reply minus the timestamp of the test message. Measured by Slack, so it has no poll-interval noise; use this one to compare releases |
| First response seen by test | When the suite's 1s polling first saw a reply |
| Total wait | How long the test waited in total (includes polling and grace time) |

Local runs (`npm run test:e2e`) also write `test/e2e-run.json`. To add one to the history by hand: `node test/tools/append-e2e-history.mjs test/e2e-run.json`.

The GitHub workflow runs on every published release and can also be started manually (**Actions → E2E Tests → Run workflow**). The graph labels each point with the release tag, or the branch name for manual runs.

## Manual Quick Start

### 1. Setup Test Bot

```bash
# Copy example config
cp test/config/test-config.json.example test/config/test-config.json

# Edit and add your test bot token  
nano test/config/test-config.json
```

See [test/config/README.md](config/README.md) for test bot setup guide.

### 2. Start SlackONOS Bot

```bash
# Local
node index.js

# Docker
docker compose up
```

### 3. Run Integration Tests

```bash
# Full test suite
npm run test:integration

# Verbose output
npm run test:integration:verbose
```

## Test Suite

The automated test suite validates all core functionality including permission checks and admin commands.

### Test Flow

The suite follows a logical workflow:

0. **Health Check** - Runs `debug` in the admin channel and requires the bot to answer with Sonos and Spotify both reported as connected. If this fails the suite aborts immediately, since every later test depends on a working speaker.
1. **Permission Testing** - Verify admin command restrictions
2. **Queue Cleanup** - Clear queue via admin channel
3. **Basic Operations** - Add tracks, check duplicates
4. **Information Commands** - Help, status, volume, etc.
5. **Search & Discovery** - Search and "best of" features
6. **Admin Configuration** - Runtime config changes
7. **Voting Features** - Gong system validation

### Commands Tested

✅ **Health Check**
- `debug` (admin channel) - Bot answers, Sonos + Spotify reachable (aborts the suite on failure)

✅ **Permission & Access Control**
- `flush` (regular channel) - Access denied validation
- `flush` (admin channel) - Successful queue clear
- `setconfig` (admin channel) - Runtime configuration

✅ **Queue Management**
- `add <track>` - Add to queue (first time)
- `add <track>` - Duplicate detection
- `list` - Queue listing
- `size` - Queue count

✅ **Information Commands**
- `help` - Help text
- `current` - Current track
- `volume` - Volume level
- `status` - System status
- `search <query>` - Search tracks

✅ **Advanced Features**
- `bestof <artist>` - AI-powered track selection (uses OpenAI + Spotify popularity ranking)
- `gong` - Vote to skip track

### Example Output

```
🚀 SlackONOS Integration Test Suite

📋 Channel: C01JS8A0YC9
🤖 TestBot ID: U0A148SQDKN

────────────────────────────────────────────────────────────
Running 14 tests...

Flush Queue - Access Denied (regular channel)... ✅ PASS
Flush Queue - Admin Channel... ✅ PASS
Add Track - First Time... ✅ PASS
Add Track - Duplicate Detection... ✅ PASS
Help Command... ✅ PASS
Current Track... ✅ PASS
List Queue... ✅ PASS
Queue Size... ✅ PASS
Volume Check... ✅ PASS
Search Track... ✅ PASS
Status Command... ✅ PASS
Best Of Command... ✅ PASS
Admin - Set Gong Limit... ✅ PASS
Gong Track... ✅ PASS

────────────────────────────────────────────────────────────
📊 Test Results:
   ✅ Passed: 14/14
   ❌ Failed: 0/14
   📈 Success Rate: 100%
────────────────────────────────────────────────────────────

🎉 All tests passed!
```

## Testing Tools

### 1. Automated Test Suite ⭐

```bash
npm run test:integration
```

Runs all tests automatically and reports results.

The suite also pings the configured Sonos device in parallel during the run and stores packet loss/latency in `test/timing-log.json`, both overall and per test window. Failed tests print the latest ping samples before the test and the samples that overlapped the test window. The host defaults to `sonosPingHost` in `test/config/test-config.json`, then `sonos` in `config/config.json`. You can override or disable it:

```bash
SONOS_PING_HOST=192.168.1.50 npm run test:integration
SONOS_PING_INTERVAL_MS=1000 npm run test:integration
SONOS_PING=0 npm run test:integration
SLACK_RESPONSE_GRACE_SECONDS=10 npm run test:integration
```

### 2. Interactive Test Helper

```bash
# Send command and see response
node test/tools/integration-test-helper.mjs "current"

# Custom wait time
node test/tools/integration-test-helper.mjs "list" --wait 5

# Watch mode
node test/tools/integration-test-helper.mjs "add queen" --watch
```

### 3. Quick Sender

```bash
node test/tools/send-test-message.mjs "help"
```

### 4. Diagnostics

```bash
# Check bot scopes
node test/tools/check-scopes.mjs

# List bot channels
node test/tools/list-bot-channels.mjs
```

## Writing Tests

Tests are defined in `test/tools/integration-test-suite.mjs` using the `TestCase` class.

### Basic Test Structure

```javascript
new TestCase(
    'Test Name',           // Display name
    'command text',        // Command to send
    validators.containsText('expected'),  // Validation function
    3                      // Wait time in seconds
)
```

### Multi-Channel Testing

Tests can target different channels (e.g., admin vs regular):

```javascript
new TestCase(
    'Admin Command',
    'setconfig gongLimit 1',
    validators.containsText('updated'),
    3,
    adminChannelId        // Send to admin channel
)
```

### Validation Functions

The `validators` object provides flexible validation:

**Basic Validators:**

```javascript
// Check for specific text (case-insensitive)
validators.containsText('queue')

// Validate response count
validators.responseCount(1, 3)  // Between 1-3 responses

// Ensure response has text
validators.hasText()

// Match regex pattern
validators.matchesRegex(/\d+/)  // Contains numbers
```

**Logical Combinators:**

```javascript
// AND - all must pass
validators.and(
    validators.responseCount(1, 3),
    validators.containsText('success')
)

// OR - at least one must pass
validators.or(
    validators.containsText('queue'),
    validators.containsText('already')
)

// Nested combinations
validators.and(
    validators.responseCount(1, 2),
    validators.or(
        validators.containsText('admin-only'),
        validators.containsText('permission')
    )
)
```

### Real-World Examples

**Test Successful Operation:**
```javascript
new TestCase(
    'Add Track - First Time',
    'add Foo Fighters - Best Of You',
    validators.and(
        validators.responseCount(1, 3),
        validators.or(
            validators.containsText('queue'),
            validators.containsText('added')
        )
    ),
    5
)
```

**Test Duplicate Prevention:**
```javascript
new TestCase(
    'Add Track - Duplicate Detection',
    'add Foo Fighters - Best Of You',  // Same track again
    validators.and(
        validators.responseCount(1, 3),
        validators.containsText('already')  // Expects rejection
    ),
    5
)
```

**Test Access Control:**
```javascript
new TestCase(
    'Flush Queue - Access Denied',
    'flush',
    validators.or(
        validators.containsText('admin-only'),
        validators.containsText('flushvote')
    ),
    3
    // No channel specified = regular channel
)
```

**Test Admin Command:**
```javascript
new TestCase(
    'Admin - Set Gong Limit',
    'setconfig gongLimit 1',
    validators.containsText('gongLimit'),
    3,
    adminChannelId  // Admin channel required
)
```

## Troubleshooting

### No Response

**Problem:** Bot doesn't respond

**Solutions:**
- Check bot is running
- Verify bot invited to channel (`/invite @testbot`)
- Increase wait time
- Check bot logs

### missing_scope

**Problem:** Token lacks permissions

**Solutions:**
1. Add scopes in Slack App settings:
   - `chat:write`
   - `channels:read`
   - `channels:history`
   - `users:read`
   - `groups:read`
2. **Reinstall** app
3. Copy new token

### not_in_channel

**Problem:** Bot not member

**Solution:**
```
/invite @testbot
```

## Best Practices

✅ **DO:**
- **Use separate test bot** (REQUIRED - bot ignores its own messages)
- Test in dedicated channels
- Run before releases
- Keep tests independent
- Verify bot is running before tests

❌ **DON'T:**
- Use same bot token for both SlackONOS and test messages
- Use production bot/channel for testing
- Run on every commit (too slow)
- Commit test tokens
- Create test dependencies

## CI/CD Integration (self-hosted runner, releases only)

`.github/workflows/e2e.yml` runs `npm run test:e2e` **only when a new release is published**, on the test machine registered as a self-hosted GitHub Actions runner. No GitHub secrets are involved - the runner reads the config files that live on the machine.

### One-time setup on the test machine

1. Clone the repo (e.g. `~/SlackONOS`) and fill in `test/config/test-config.json` and `test/config/e2e-bot-config.json` there. Check with `npm run test:e2e` that it passes locally.
2. Register the machine as a runner: GitHub → repo **Settings → Actions → Runners → New self-hosted runner**. Follow the instructions and give it the extra label **`slackonos-e2e`**.
3. Tell the runner where the config lives. `actions/checkout` wipes gitignored files in the job workspace, so the job reads them from your clone instead. Add to the runner's `.env` file (in the runner directory):
   ```
   E2E_CONFIG_DIR=/home/<user>/SlackONOS/test/config
   ```
4. Install the runner as a service (`sudo ./svc.sh install && sudo ./svc.sh start`) so it survives reboots. Node.js is installed by the workflow via `actions/setup-node`.

### Security notes

- The repo is public: under **Settings → Actions → General**, require approval for workflow runs from outside collaborators. The e2e workflow only runs on `release: published`, which needs write access, so fork PRs never reach the runner.
- Bot output is not printed in the Actions log (`E2E_QUIET_BOT=1`); the full log stays on the runner in `test/e2e-bot.log` in the job workspace.
- Only one e2e run at a time (`concurrency: slackonos-e2e`) since there is one physical speaker.

## Security

⚠️ **Never commit test bot tokens!**

- `test/config/test-config.json` is gitignored
- `test/config/e2e-bot-config.json` is gitignored
- CI reads config from the runner machine, not from GitHub secrets
- Rotate tokens regularly

## More Info

- [Test Config Setup](config/README.md)
- [Main Test Docs](README.md)
- [GitHub Workflows](../.github/WORKFLOWS.md)
