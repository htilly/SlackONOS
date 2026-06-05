# Integration Testing Guide

Complete guide for running integration tests against a live SlackONOS bot.

## Overview

The integration test suite sends real commands to your SlackONOS bot via Slack and validates the responses. This tests the entire system end-to-end:

**Flow:** Slack message → Bot processing → Spotify search → Sonos action → Response

### ⚠️ Separate Test Bot Required

**You MUST use a separate Slack bot** for integration testing. The SlackONOS bot ignores messages from itself (filters by `botUserId`), so if you send test messages using the same bot token, it will ignore them.

**Technical reason:** The bot has self-filtering logic to prevent responding to its own messages, which would create infinite loops.

## Quick Start

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

1. **Permission Testing** - Verify admin command restrictions
2. **Queue Cleanup** - Clear queue via admin channel
3. **Basic Operations** - Add tracks, check duplicates
4. **Information Commands** - Help, status, volume, etc.
5. **Search & Discovery** - Search and "best of" features
6. **Admin Configuration** - Runtime config changes
7. **Voting Features** - Gong system validation

### Commands Tested

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

## CI/CD Integration

Integration tests are **manual/scheduled only** (not on every PR) since they require a running bot.

Example GitHub Action:

```yaml
name: Integration Tests
on:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install
      - run: npm run test:integration
        env:
          SLACK_BOT_TOKEN: ${{ secrets.TEST_BOT_TOKEN }}
```

## Security

⚠️ **Never commit test bot tokens!**

- `test/config/test-config.json` is gitignored
- Use env vars in CI/CD
- Rotate tokens regularly

## More Info

- [Test Config Setup](config/README.md)
- [Main Test Docs](README.md)
- [GitHub Workflows](../.github/WORKFLOWS.md)
