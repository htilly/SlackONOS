# Test Configuration

This directory contains configuration for integration tests.

## Setup

1. Copy the example config:
   ```bash
   cp test/config/test-config.json.example test/config/test-config.json
   ```

2. Edit `test-config.json` and add your test bot token:
   ```json
   {
     "slackBotToken": "xoxb-YOUR-TEST-BOT-TOKEN",
     "slackChannel": "C01JS8A0YC9",
     "slackAdminChannel": "C01J1TBLCA0",
     "slackONOSBotId": "U123ABC456",
     "sonosPingHost": "192.168.1.50",
     "sonosPingIntervalMs": 2000,
     "slackResponseGraceSeconds": 5
   }
   ```

**Configuration Fields:**
- `slackBotToken` - Your **test bot** token (xoxb-...) - NOT the production SlackONOS token
- `slackChannel` - Channel ID for regular tests (e.g., #music)
- `slackAdminChannel` - Channel ID for admin command tests (e.g., #music-admin)
- `slackONOSBotId` - **Production SlackONOS bot** user ID (U...) - needed for @mention tests
- `sonosPingHost` - Optional Sonos IP/host to ping during the integration suite (defaults to `config/config.json` `sonos`)
- `sonosPingIntervalMs` - Optional ping interval in milliseconds (default: `2000`)
- `slackResponseGraceSeconds` - Extra seconds to wait for slow bot responses before failing a test (default: `5`)

## Using a Separate Test Bot

**REQUIRED:** You must create a separate Slack bot for testing.

### Why is this required?

**Technical limitation:** SlackONOS filters out messages from itself by checking `botUserId`. If you use the same bot token for both running SlackONOS and sending test messages, the bot will ignore all test commands.

```javascript
// In index.js - bot ignores its own messages
if (e.user === botUserId) return;
```

### Additional Benefits:
- ✅ Test messages won't pollute production channels
- ✅ Can test in isolated test channels
- ✅ No risk of accidentally affecting live music playback
- ✅ Different permissions/scopes for testing

### How to Create a Test Bot

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name it "SlackONOS Test" (or similar)
4. Select your workspace
5. Enable Socket Mode (if needed for your tests)
6. Add OAuth scopes:
   - `chat:write` (to send messages)
   - `channels:history` (to read responses)
   - `users:read` (to lookup user info)
7. Install to workspace
8. Copy the Bot User OAuth Token (starts with `xoxb-`)
9. Add it to `test/config/test-config.json`

### Environment Variables

You can also use environment variables instead of the config file:

```bash
SLACK_BOT_TOKEN=xoxb-test-bot-token node test/tools/integration-test-helper.mjs "help"
```

Priority: ENV var > test-config.json > main config.json

For the full integration suite, Sonos ping monitoring is enabled automatically when a Sonos host is configured. Failed tests print the latest ping samples before the test and the samples that overlapped the test window. Override it with:

```bash
SONOS_PING_HOST=192.168.1.50 npm run test:integration
SONOS_PING_INTERVAL_MS=1000 npm run test:integration
SONOS_PING=0 npm run test:integration
SLACK_RESPONSE_GRACE_SECONDS=10 npm run test:integration
```

## Configuration Fields

| Field | Description | Example |
|-------|-------------|---------|
| `slackBotToken` | Bot User OAuth Token for test bot | `xoxb-123...` |
| `slackChannel` | Default channel ID for tests | `CJ51NPNN4` |
| `slackAdminChannel` | Admin channel ID for admin command tests | `C01J1TBLCA0` |
| `sonosPingHost` | Optional Sonos IP/host to monitor during E2E runs | `192.168.1.50` |
| `sonosPingIntervalMs` | Optional ping interval for Sonos monitoring | `2000` |
| `slackResponseGraceSeconds` | Extra response wait before a test is considered failed | `5` |

## Security

⚠️ **Important:** The `test-config.json` file is gitignored to prevent accidentally committing tokens to the repository.
