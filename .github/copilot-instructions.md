# SlackONOS AI Coding Guidelines

## Project Overview
SlackONOS is a democratic Slack bot for controlling Sonos speakers with Spotify integration. Users queue music via Slack commands, and the community votes to skip tracks they dislike using "gong" and "vote" commands.

## Architecture

### Core Components
- **`index.js`** (2243 lines): Main application file containing all business logic, command handlers, voting systems, and Sonos integration
- **`slack.js`**: Socket Mode client module handling Slack event subscriptions (messages, mentions, slash commands)
- **`spotify-async.js`**: Async Spotify API wrapper using native `fetch` for track/album/playlist search and retrieval
- **`utils.js`**: Minimal utilities (`getRandomInt`, `numFormatter`)
- **`logger.js`**: Winston wrapper for SocketModeClient compatibility

### Data Flow
1. Slack events → `slack.js` → `processInput()` in `index.js`
2. Commands resolved via `commandRegistry` Map with alias support
3. Spotify searches → `spotify-async.js` → returns URI
4. Sonos actions via `node-sonos` library (queue, play, volume, etc.)
5. User actions logged to `config/userActions.json`, blacklist to `config/blacklist.json`

## Command Registry Pattern

Commands are declared in a **Map-based registry** (line 419-461 in `index.js`):

```javascript
const commandRegistry = new Map([
  ['add', { fn: _add, admin: false }],
  ['gong', { fn: (args, ch, u) => _gong(ch, u), admin: false, aliases: ['dong', ':gong:', ':gun:'] }],
  ['setvolume', { fn: _setVolume, admin: true }],
]);
```

- **Admin commands** require `channel === global.adminChannel`
- **Aliases** built into `aliasMap` for quick resolution
- **Handler signature**: `fn(legacyInput, channel, userName)` where `legacyInput[0]` is the command

## Voting Systems (Critical Business Logic)

### Gong System
- Tracks become "gong banned" when threshold is met (`gongLimit`, default 3 votes)
- Banned tracks stored in `gongBannedTracks` object, preventing re-queue via voting
- Per-user limit: `gongLimitPerUser = 1` (each user can gong once per track)
- Votes stored in `gongScore` object: `{userName: voteCount}`

### Vote-to-Play System
- Users vote for tracks in queue: `trackVoteCount[trackName]++`
- When `trackVoteCount[trackName] >= voteLimit`, track is moved to next position and becomes "gong immune"
- Gong immunity: `voteImmuneScore[trackName]` prevents immediate gonging after being voted up
- Tracks marked immune in queue display with `:lock:` emoji

### Flush Voting
- Democratic queue flush requires `flushVoteLimit` (default 6) votes
- Tracked via `flushVoteScore` object

## Configuration Patterns

Runtime-mutable config via `nconf` hierarchy: **CLI args > env vars > config.json > defaults**.

Dynamic config updates use `_setconfig()` command (admin-only):
```javascript
setconfig gongLimit 5        // Updates gongLimit at runtime
setconfig voteTimeLimitMinutes 10
setconfig defaultTheme lounge   // Set venue theme
setconfig themePercentage 30    // 30% of bulk requests match venue theme
```

**Config files:**
- `config/config.json` (gitignored) – must contain both `slackAppToken` (xapp-) and `token` (xoxb-)
- `config/userActions.json` – persisted user action logs
- `config/blacklist.json` – persisted user blacklist (migrated from config.json array)

## AI Features

### Seasonal Awareness
`ai-handler.js` includes `getSeasonalContext()` which returns current season info:
- `season` - Current season (Winter/Holiday, Halloween, Summer, Spring, Valentine's, Autumn, Winter)
- `month` - Month name
- `themes` - Array of music themes for the season
- `suggestion` - DJ suggestion for seasonal music

### Venue/Default Theme
Configure a default music theme via config:
- `defaultTheme` - Base style (e.g., "lounge", "club", "office")
- `themePercentage` - Percentage (0-100) of tracks matching venue theme

When users request bulk music, the AI mixes in venue-themed tracks.

### User Context Memory
`ai-handler.js` maintains per-user context for follow-up responses:
- `setUserContext(userName, lastSuggestion, context)` - Store suggestion
- `getUserContext(userName)` - Retrieve (expires after 5 minutes)
- Used when admin commands are blocked to suggest alternatives

## Slack Integration (Socket Mode v2.0+)

**Critical:** Uses Socket Mode, NOT RTM API. Requires:
- `slackAppToken` (xapp-...) for app-level connection
- `token` (xoxb-...) for bot operations

Events handled in `slack.js`:
- `message` events (channels with bot invited)
- `app_mention` events (strips `<@U123>` from text)
- Slash commands (not yet implemented but infrastructure ready)

**Bot user filtering:** All events with `e.user === botUserId` are ignored to prevent self-loops.

## Spotify Patterns

**All Spotify methods are async** (no callbacks). Example:
```javascript
const track = await spotify.getTrack('search term or spotify:track:ID');
// Returns: { name, artist, uri }
```

**HTTP Link Conversion:** Spotify links auto-converted to URIs:
- `https://open.spotify.com/track/2PZHam8oh74c1xTQFo86dY` → `spotify:track:2PZHam8oh74c1xTQFo86dY`

## Testing & Development

- **Test command:** `npm test` (runs Mocha tests in `test/test.mjs`)
- Tests verify `numFormatter` utility function
- **Docker:** Multi-platform Dockerfile targets Node 24-slim, volume-mount `config/` at runtime
- **Docker Compose:** See `docker-compose-example.yml`

## Argument Parsing

Custom quote-aware parser (`parseArgs()` at line 380):
```javascript
parseArgs('add "my song title" artist')  // → ['add', 'my song title', 'artist']
```

Supports both `"` and `'` quotes, collapses whitespace.

## Common Gotchas

1. **Channel IDs are fetched dynamically** at startup via `_lookupChannelID()` – set as `global.adminChannel` and `global.standardChannel`
2. **Sonos region:** If `market !== 'US'`, sets `SONOS.SpotifyRegion.EU`
3. **Volume cap:** `maxVolume` config prevents users from setting excessive volume via `setvolume`
4. **Blacklist checking:** User normalization strips `<@>` before checking `blacklist` array
5. **Message deduplication:** Track votes are time-limited via `voteTimeLimitMinutes` (default 5 min)
6. **User action logging:** All significant commands log to `config/userActions.json` via `_logUserAction()`

## Adding New Commands

1. Add handler function (e.g., `async function _mycommand(input, channel, userName)`)
2. Register in `commandRegistry`: `['mycommand', { fn: _mycommand, admin: false, aliases: ['mc'] }]`
3. Admin commands must check `channel === global.adminChannel` (or use `admin: true` flag)
4. Send responses via `_slackMessage(text, channel)`
5. Log user actions: `_logUserAction(userName, 'actionName')`

## Troubleshooting Common Issues

### Bot Not Responding to Commands

**Symptom:** Bot is online but ignores messages
- **Check:** Bot must be invited to channel (`/invite @SlackONOS`)
- **Check:** Verify `botUserId` is set (logged at startup: "Bot user ID loaded: U123...")
- **Check:** Events are subscribed in Slack app config (`message.channels`, `app_mention`)
- **Debug:** Look for "Unknown command" logs - command may not be in `commandRegistry`

### Socket Mode Connection Failures

**Symptom:** "Failed to initialize Slack" or repeated disconnects
- **Cause:** Missing or invalid `slackAppToken` (must start with `xapp-`)
- **Cause:** Socket Mode not enabled in Slack app settings
- **Fix:** Increase `clientPingTimeout` in `slack.js` if network is slow (default: 30s)
- **Check:** Both `slackAppToken` AND `token` must be in `config/config.json`

### Spotify Search Returns No Results

**Symptom:** "Track not found" for valid songs
- **Cause:** Invalid or expired `spotifyClientId`/`spotifyClientSecret`
- **Cause:** Wrong `market` setting (e.g., "US" when using EU account)
- **Debug:** Check logs for "Error getting Spotify access token"
- **Fix:** Verify credentials at https://developer.spotify.com/dashboard

### Sonos Connection Issues

**Symptom:** "Failed to connect to Sonos speaker" at startup
- **Cause:** Incorrect `sonos` IP address in config
- **Cause:** Firewall blocking port 1400 (TCP)
- **Cause:** Sonos and server on different subnets/VLANs
- **Fix:** Use static IP for Sonos; verify with `curl http://<sonos-ip>:1400/xml/device_description.xml`
- **Region:** If outside US, ensure `market` is set correctly (triggers `SpotifyRegion.EU`)

### Admin Commands Not Working

**Symptom:** "You don't have permission" or silent failure
- **Cause:** Command sent to wrong channel (not `adminChannel`)
- **Check:** Verify channel names match exactly in config: `config.get('adminChannel')` vs actual channel name
- **Debug:** Global channels logged at startup: "Admin channelID: C123...", "Standard channelID: C456..."
- **Note:** Channel names in config should NOT include `#` prefix

### Vote/Gong Not Counting

**Symptom:** Votes don't accumulate or reset unexpectedly
- **Cause:** Vote time limit expired (`voteTimeLimitMinutes`, default 5 min)
- **Cause:** User already voted (per-user limits: `gongLimitPerUser=1`, `voteLimitPerUser=4`)
- **Cause:** Track is gong immune (voted up previously, marked with `:lock:`)
- **Debug:** Use `gongcheck`, `votecheck`, `voteimmunecheck` commands to inspect state
- **Reset:** Votes stored in-memory; restart bot to clear all vote state

### Config Changes Not Taking Effect

**Symptom:** Updated `config.json` but bot uses old values
- **Cause:** Config is read once at startup (via `nconf`)
- **Fix:** Restart bot after editing `config.json`
- **OR:** Use `setconfig` command for runtime changes (admin-only):
  ```
  setconfig gongLimit 5
  setconfig voteTimeLimitMinutes 10
  ```
- **Note:** Runtime changes via `setconfig` are NOT persisted to file

### Blacklist Not Working

**Symptom:** Blocked users can still use commands
- **Cause:** User normalization issue - blacklist expects user ID without `<@>` wrappers
- **Check:** Blacklist file format in `config/blacklist.json`: `["U123ABC", "U456DEF"]`
- **Migration:** Old format in `config.json` (`@username`) is deprecated
- **Add users:** Use `blacklist add <@user>` or `blacklist remove <@user>` admin commands

### Queue Display Issues

**Symptom:** `list` command shows empty queue but music is playing
- **Cause:** Sonos queue API may lag during rapid changes
- **Debug:** Check `_showQueue()` logs for errors
- **Workaround:** Use `current` command to verify playback state

### TTS (Text-to-Speech) Failures

**Symptom:** `tts` command fails or no audio plays
- **Cause:** Missing or incorrect `ipAddress` config (server's IP that Sonos can reach)
- **Cause:** Sonos can't access file share path `x-file-cifs://sonos-smb/share/sonos/tts/`
- **Cause:** Network file sharing not configured between server and Sonos
- **Requirement:** TTS requires SMB/CIFS share accessible by Sonos at configured path
- **Note:** This is an advanced feature requiring network file sharing setup

### Memory Leaks / Performance Issues

**Symptom:** Bot becomes slow or crashes after extended use
- **Cause:** `userCache` grows unbounded (stores all user lookups forever)
- **Cause:** Vote state objects (`gongScore`, `trackVoteCount`, etc.) never cleared
- **Fix:** Restart bot periodically or implement cache eviction
- **Monitor:** Check heap usage if running in production

### Duplicate Messages or Command Loops

**Symptom:** Bot responds multiple times or triggers itself
- **Cause:** Bot user filtering failure (check `e.user === botUserId` logic)
- **Cause:** Multiple instances running against same Slack app
- **Check:** Only ONE instance should use the same `slackAppToken`
- **Debug:** Look for duplicate "Bot user ID loaded" messages in logs
