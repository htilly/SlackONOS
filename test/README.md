# SlackONOS Tests

Test suite for SlackONOS covering unit tests, integration tests, and end-to-end testing.

## Test Types

### Unit Tests
Tests core logic without external dependencies (Spotify, Slack, Sonos).

```bash
npm test
```

### Integration Tests
End-to-end tests against a live SlackONOS bot via Slack.

```bash
npm run test:integration
```

See [INTEGRATION_TESTING.md](INTEGRATION_TESTING.md) for complete guide.

## Installation

```bash
npm install
```

## Running Tests

Run all unit tests:

```bash
npm test
```

Run specific test file:

```bash
npx mocha test/voting.test.mjs
npx mocha test/parser.test.mjs
npx mocha test/integration.test.mjs
```

Watch mode (auto-rerun on changes):

```bash
npx mocha --watch test/**/*.test.mjs
```

Run integration tests:

```bash
npm run test:integration          # Normal output
npm run test:integration:verbose  # Detailed output
```

## Test Structure

### Unit Tests

#### `test.mjs` (existing)
- Tests `numFormatter` utility function
- Basic unit tests

#### `voting.test.mjs` ⭐ NEW
Tests voting system logic without external dependencies:
- **Gong Vote Tracking**: Verify users can gong, prevent duplicate gongs, trigger at limit
- **Track Vote Tracking**: Count votes, prevent duplicate votes, promote tracks at limit
- **Gong Immunity System**: Protect tracks from gong, track banning
- **Flush Vote System**: Democratic voting to clear queue

#### `parser.test.mjs` ⭐ NEW
Tests argument parser:
- Basic command parsing
- Quote handling (double and single)
- Edge cases (empty strings, null, spaces)
- Mixed quotes and plain text

#### `integration.test.mjs` ⭐ NEW
Higher-level business logic tests:
- **Track Duplicate Detection**: URI and name/artist matching
- **Player State Logic**: When to flush queue, auto-play
- **Spotify URI Conversion**: HTTP links → Spotify URIs
- **Vote Time Limit Logic**: Expiring votes over time
- **Queue Position Calculation**: Convert between user input and Sonos positions
- **Blacklist Management**: Add/remove/check users
- **Config Validation**: Number ranges, type checking

### Integration Tests

#### `test/tools/integration-test-suite.mjs` ⭐ NEW
Automated end-to-end test suite via Slack:
- **14 automated tests** covering all core features
- **Multi-channel testing**: Regular and admin channels
- **Permission validation**: Access control and admin restrictions
- **Feature validation**: Duplicate detection, voting, search, etc.

**Test Coverage:**
- Queue management (add, flush, list, size)
- Information commands (help, status, volume, current)
- Search and discovery (search, bestof)
- Admin features (setconfig, admin-only commands)
- Voting system (gong with configurable limits)
- Access control (permission checks)

See [INTEGRATION_TESTING.md](INTEGRATION_TESTING.md) for detailed guide.

#### `test/tools/integration-test-helper.mjs`
Interactive testing tool for manual E2E testing.

#### `test/tools/send-test-message.mjs`
Quick message sender for one-off tests.

#### `test/tools/check-scopes.mjs`
Diagnostic tool to validate OAuth token scopes.

#### `test/tools/list-bot-channels.mjs`
Lists all channels the test bot is a member of.

## Benefits of This Structure

✅ **No external dependencies**: Tests run without Spotify/Slack/Sonos  
✅ **Fast feedback**: Runs in seconds, not minutes  
✅ **Regression testing**: Detect when changes break existing functionality  
✅ **Documentation**: Tests show how the system should behave  
✅ **CI/CD ready**: Can run in GitHub Actions, Jenkins, etc.

## Next Steps: Mock External Dependencies

For testing more complex logic, use **sinon** to mock Spotify/Sonos:

```javascript
import sinon from 'sinon';

describe('Add command with mocked Sonos', function() {
  let sonosStub;
  
  beforeEach(function() {
    sonosStub = {
      getCurrentState: sinon.stub().resolves('stopped'),
      flush: sinon.stub().resolves(),
      queue: sinon.stub().resolves(),
      play: sinon.stub().resolves()
    };
  });
  
  it('should flush queue when stopped', async function() {
    await sonosStub.getCurrentState();
    await sonosStub.flush();
    
    expect(sonosStub.flush.calledOnce).to.be.true;
  });
});
```

## 📸 Record Spotify Responses (Snapshot Testing)

### What is it?
Instead of mocking Spotify, you can **record real API responses** once and then use them in tests. This is called "snapshot testing" or "fixture-based testing".

### How it works:

1. **Record responses** (requires Spotify credentials):
```bash
npm run test:record
```

This runs the script `test/tools/record-spotify-responses.mjs` which:
- Makes real Spotify API calls
- Saves responses to `test/fixtures/spotify-responses.json`
- You only need to do this once (or when you want to update)

2. **Use in tests** (no credentials needed):
```bash
npm test
```

Tests in `test/spotify.test.mjs` read from fixtures and verify:
- ✅ Spotify responses parse correctly
- ✅ "bestof" sorts by popularity
- ✅ Album/playlist formatting is correct
- ✅ URIs are valid

### Benefits:

✅ **Fast** - No API calls during tests  
✅ **Reproducible** - Same results every time  
✅ **Offline** - Works without internet  
✅ **CI-friendly** - GitHub Actions doesn't need Spotify credentials  
✅ **Realistic** - Uses real data from Spotify

### Add more test cases:

Edit `test/tools/record-spotify-responses.mjs` and add:

```javascript
fixtures.searchTrack.my_new_test = await spotify.getTrack('test query');
```

Then run:
```bash
npm run test:record
```

### Fixture file:

`test/fixtures/spotify-responses.json` contains:
- `searchTrack` - Individual track searches
- `searchTrackList` - Lists for "bestof" command
- `searchAlbum` - Album searches
- `searchPlaylist` - Playlist searches
- `getAlbum` - Albums with cover art
- `getPlaylist` - Playlists with owner info

## Integration Testing

SlackONOS includes comprehensive end-to-end integration testing tools that test against real Slack channels and a running bot.

### Quick Start

1. **Setup test bot configuration:**
```bash
cp test/config/test-config.json.example test/config/test-config.json
nano test/config/test-config.json
```

2. **Start SlackONOS bot:**
```bash
node index.js
```

3. **Run automated test suite:**
```bash
npm run test:integration
```

### Test Suite Features

The automated integration test suite (`test/tools/integration-test-suite.mjs`) provides:

✅ **14 automated tests** covering core functionality  
✅ **Multi-channel testing** (regular and admin channels)  
✅ **Permission validation** (access control checks)  
✅ **Feature validation** (duplicate detection, voting, etc.)  
✅ **Flexible validators** (containsText, regex, AND/OR logic)  
✅ **Clear reporting** with pass/fail statistics

**Test Coverage:**
- Permission & access control (admin-only commands)
- Queue management (add, flush, list, size)
- Information commands (help, status, volume, current)
- Search & discovery (search, bestof)
- Admin features (setconfig, runtime configuration)
- Voting system (gong with configurable limits)
- Duplicate detection (prevent re-adding same track)

### Interactive Testing Tools

#### 1. Automated Test Suite ⭐
```bash
npm run test:integration          # Normal output
npm run test:integration:verbose  # Detailed output
```

#### 2. Quick Message Sender
Send a quick message to the bot:
```bash
node test/tools/send-test-message.mjs "add foo fighters"
```

#### 3. Integration Test Helper (with bot responses)
Send message and see bot's full response:
```bash
# Basic usage
node test/tools/integration-test-helper.mjs "help"

# With options
node test/tools/integration-test-helper.mjs "list" --channel music-admin --wait 5

# Watch mode (listen for new responses)
node test/tools/integration-test-helper.mjs "add queen" --watch
```

#### 4. Diagnostic Tools
```bash
# Check OAuth token scopes
node test/tools/check-scopes.mjs

# List bot channel memberships
node test/tools/list-bot-channels.mjs
```

### Configuration

**test-config.json:**
```json
{
  "slackBotToken": "xoxb-YOUR-TEST-BOT-TOKEN",
  "slackChannel": "C01JS8A0YC9",
  "slackAdminChannel": "C01J1TBLCA0"
}
```

**Token priority:**
1. `SLACK_BOT_TOKEN` environment variable
2. `test/config/test-config.json` (test-specific)
3. `config/config.json` (main config)

See [test/config/README.md](config/README.md) for complete setup guide.

### Complete Documentation

For detailed information about:
- Writing new integration tests
- Validator functions and combinators
- Multi-channel testing
- Troubleshooting
- CI/CD integration

See **[INTEGRATION_TESTING.md](INTEGRATION_TESTING.md)**

## Tips for Writing New Tests

1. **Isolera logiken**: Bryt ut ren logik från I/O-operationer
2. **Test en sak i taget**: Varje test ska verifiera EN beteende
3. **Använd beskrivande namn**: "should allow first gong from user"
4. **Setup/Teardown**: Använd `beforeEach`/`afterEach` för att resetta state
5. **Mock externa anrop**: Använd sinon för Spotify/Sonos/Slack anrop
6. **Use test bot för integration**: Undvik att störa production med test-meddelanden

## Coverage (framtida förbättring)

Lägg till test coverage reporting:

```bash
npm install --save-dev c8
```

Uppdatera `package.json`:
```json
{
  "scripts": {
    "test": "NODE_ENV=test mocha --reporter spec",
    "test:coverage": "c8 npm test"
  }
}
```

Kör med coverage:
```bash
npm run test:coverage
```
