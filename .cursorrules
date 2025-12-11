# SlackONOS - Cursor Rules

## Project Overview
SlackONOS is a democratic music bot for Discord and Slack that controls Sonos speakers with Spotify integration. Features community voting, AI natural language parsing, and multi-platform support.

## Architecture & Core Files

### Main Application
- **`index.js`** - Main application file (~5300 lines). Contains:
  - Command handlers and routing
  - Sonos integration
  - Voting systems (gong, vote, flush)
  - HTTP/HTTPS server
  - Admin API endpoints
  - AI integration
  - Configuration management

### Key Modules
- **`slack.js`** - Slack Socket Mode client, event handling
- **`discord.js`** - Discord bot client and event handling
- **`spotify-async.js`** - Spotify API wrapper (async/await, native fetch)
- **`music-helper.js`** - Music search, queueing, deduplication logic
- **`voting.js`** - Voting system logic (gong, vote, immunity)
- **`ai-handler.js`** - OpenAI integration for natural language parsing
- **`telemetry.js`** - Anonymous telemetry (PostHog)
- **`lib/webauthn-handler.js`** - WebAuthn/FIDO2 passwordless authentication
- **`lib/auth-handler.js`** - Password authentication and admin access
- **`soundcraft-handler.js`** - Soundcraft Ui24R mixer integration

### Configuration
- **`config/config.json`** - Main configuration (never commit!)
- **`config/config.json.example`** - Example configuration template
- Uses `nconf` for configuration management
- Sensitive values: `openaiApiKey`, `telemetryInstanceId`, `adminPasswordHash`, tokens, secrets

## Coding Style & Conventions

### JavaScript Style
- Use **CommonJS** (`require`/`module.exports`) - no ES modules in main code
- Use **async/await** for asynchronous operations (preferred over callbacks)
- Use **const** and **let** (avoid `var`)
- Use **arrow functions** where appropriate
- Use **template literals** for string interpolation
- Use **logger** (Winston) for all logging - never `console.log` in production code

### Command Registry Pattern
Commands are registered in a Map-based registry:
```javascript
const commandRegistry = new Map([
  ['add', { fn: _add, admin: false }],
  ['gong', { fn: (args, ch, u) => voting.gong(ch, u), admin: false, aliases: ['dong'] }],
  ['setvolume', { fn: _setVolume, admin: true }],
]);
```
- Handler signature: `fn(legacyInput, channel, userName)`
- Admin commands require `channel === global.adminChannel`
- Aliases are automatically added to `aliasMap`

### Error Handling
- Always wrap async operations in try/catch
- Log errors with `logger.error()` or `logger.warn()`
- Provide user-friendly error messages via `_slackMessage()`
- Never expose sensitive information in error messages

### Security Best Practices
- **Never log or display sensitive values**:
  - API keys (`openaiApiKey`)
  - Tokens (`slackAppToken`, `slackBotToken`, `discordToken`)
  - Secrets (`spotifyClientSecret`)
  - Hashes (`adminPasswordHash`)
  - Instance IDs (`telemetryInstanceId`)
- Use `[REDACTED]` or masked values (first 3 + last 3 chars) in debug/configdump
- Validate user input before processing
- Check admin permissions before executing admin commands

### Message Formatting
- Use Slack markdown: `*bold*`, `_italic_`, `` `code` ``
- Use emojis appropriately for user feedback
- Keep messages concise and informative
- Use `_slackMessage()` helper for all Slack/Discord messages

## Testing

### Test Structure
- Tests in `test/` directory using Mocha and Chai
- Test files: `*.test.mjs` (ES modules in tests)
- Run tests: `npm test`
- Integration tests: `npm run test:integration`

### Test Guidelines
- Write tests for new features
- Mock external dependencies (Spotify, Sonos, Slack)
- Test edge cases and error conditions
- Keep tests fast and isolated

## File Organization

### Directories
- **`lib/`** - Library modules (auth, validators, handlers)
- **`public/setup/`** - Web setup wizard (HTML/JS/CSS)
- **`templates/`** - Message templates and help text
- **`config/`** - Configuration files (gitignored except examples)
- **`test/`** - Test files and test utilities

### Naming Conventions
- Functions: `_functionName` for command handlers (e.g., `_add`, `_gong`)
- Files: `kebab-case.js` for modules
- Constants: `UPPER_CASE` for true constants
- Variables: `camelCase`

## Important Patterns

### Sonos Queue Management
- Always check player state before queueing
- Flush queue when player is stopped
- Use `setAVTransportURI('x-rincon-queue:1')` to ensure queue is active source
- Stop playback before switching to queue
- Wait between operations (300-500ms) for Sonos to process

### Spotify Integration
- Validate Spotify URIs before queueing: `/^spotify:(track|album|artist|playlist):[a-zA-Z0-9]+$/`
- Handle UPnP error 800 (regional availability issues)
- Retry with alternative search results if queueing fails
- Use `musicHelper` functions for search and queue operations

### Voting System
- Track votes per user per track (prevent duplicates)
- Respect time limits (`voteTimeLimitMinutes`)
- Check immunity status before gonging
- Update vote counts atomically

### Configuration
- Use `config.get('key')` to read values
- Use `config.set('key', value)` to write values
- Always provide defaults: `config.get('key') || 'default'`
- Never commit `config/config.json` (only `config.json.example`)

## Platform Support

### Multi-Platform
- Support both Slack and Discord simultaneously
- Use `currentPlatform` and `currentChannel` for routing
- Platform-specific message formatting handled by `_slackMessage()`
- Admin checks are platform-aware

### Web Interface
- Setup wizard at `/setup`
- Admin panel at `/admin` (requires authentication)
- WebAuthn support for passwordless login
- HTTPS with auto-generated self-signed certs (optional)

## Common Tasks

### Adding a New Command
1. Create handler function: `async function _myCommand(input, channel, userName)`
2. Register in `commandRegistry` Map
3. Add to help text in `templates/help/`
4. Write tests if applicable
5. Document in README if user-facing

### Debugging
- Use `debug` command (admin only) for system info
- Use `configdump` command (admin only) for config (sensitive values redacted)
- Check logs via Winston logger
- Use `source` command to check Sonos playback source

### Security Updates
- Always redact sensitive values in debug output
- Never log API keys, tokens, or passwords
- Use password type inputs in web forms for sensitive fields
- Validate all user input

## Dependencies

### Key Libraries
- **`node-sonos`** - Sonos device control
- **`@slack/socket-mode`** - Slack Socket Mode
- **`discord.js`** - Discord bot framework
- **`nconf`** - Configuration management
- **`winston`** - Logging
- **`openai`** - AI natural language parsing
- **`posthog-node`** - Telemetry
- **`@simplewebauthn/server`** - WebAuthn/FIDO2

## Notes
- Node.js version: >=7.5 (check `package.json` engines)
- License: AGPL-3.0-or-later
- English comments/documentation only.
- Prefer async/await over callbacks
- Always handle errors gracefully
- Keep user-facing messages friendly and informative

