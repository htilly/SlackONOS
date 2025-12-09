# Changelog

All notable changes to SlackONOS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [2.0.0] - 2024-12-09

### 🚀 Performance (Major)
- **75-90% faster command execution** - Parallelized all Sonos/Spotify API calls across commands
  - `add` command: 75-90% faster (removed 1.5s delays, parallel API calls, non-blocking playback)
  - `list` command: 50% faster (parallel state/queue/track fetching)
  - `bestof` command: 90% faster (parallel track queueing)
  - `addalbum`/`addplaylist`: 85% faster (parallel queueing with immediate user feedback)
  - `getNowPlaying`: 40-50% faster (parallel API calls)
- **Async file I/O** - Converted all synchronous file operations to async for better event loop utilization
- **Non-blocking operations** - Users get immediate feedback while background operations complete

### 🎨 Web Interface (Major)
- **Complete Setup Wizard** - Zero-config onboarding at `/setup`
  - Automatic Sonos device discovery with 15s timeout
  - Slack/Discord bot validation
  - Spotify credential verification
  - Admin password setup
  - Live configuration preview
- **Admin Panel** - Full-featured management interface at `/admin`
  - Real-time now-playing display with SSE updates
  - Playback controls (play, pause, next, volume)
  - Configuration management with live validation
  - WebAuthn/FIDO2 security key management
  - Credential caching to eliminate redundant API calls
  - SSE reconnection with exponential backoff (max 10 attempts)

### 🔐 Authentication (Major)
- **WebAuthn/FIDO2 Passwordless Login** - Modern authentication with security keys
  - Support for Touch ID, Face ID, Windows Hello
  - Yubikey and hardware security key support
  - User verification toggle for PIN vs touch-only modes
  - Multi-credential support per user
- **Password Authentication** - Traditional bcrypt-based login option
- **Session Management** - Secure cookie-based sessions with configurable expiry

### 🤖 AI Enhancements
- **Multi-turn Conversation Support** - Context-aware conversations with the bot
  - Remembers conversation history (configurable context limit)
  - Follow-up questions and clarifications
  - Seasonal awareness and personalized suggestions
- **Improved AI Handler** - Better natural language understanding
  - Enhanced reasoning and confidence scoring
  - Better error handling and user feedback
  - AI unparsed request logging for debugging
- **Memory Management** - Automatic cleanup of old conversation contexts

### 📊 Monitoring & Logging
- **Enhanced Telemetry** - Improved PostHog integration
  - Persistent instance ID for cross-restart tracking
  - Heartbeat events every 24h
  - Graceful shutdown tracking
  - Platform and version metadata
- **Better Logging** - Comprehensive Winston-based logging
  - Structured log levels (debug, info, warn, error)
  - Sensitive data redaction in all outputs
  - AI handler logging and debugging tools

### 📁 Project Organization (Major)
- **Reorganized Repository** - Cleaner, more maintainable structure
  - Moved 15 documentation files to `/docs` directory
  - Moved 3 Docker files to `/docker` directory
  - Merged old `/doc` folder into `/docs`
  - Updated README.md with new documentation links
  - Enhanced `.gitignore` (test artifacts, editor files, OS files)
- **Updated GitHub Actions** - Docker build workflow uses new paths
- **Modular Architecture** - Better separation of concerns
  - `lib/auth-handler.js` - Authentication logic
  - `lib/webauthn-handler.js` - WebAuthn implementation
  - `lib/setup-handler.js` - Setup wizard backend
  - `lib/sonos-discovery.js` - Device discovery utilities
  - Validator modules for Slack, Discord, Spotify

### 🧪 Testing Improvements
- **Expanded Test Coverage** - 622+ tests across multiple suites
  - Error handling tests (622 tests)
  - Memory management tests (330 tests)
  - Setup wizard tests (163 tests)
  - Integration test suite enhancements
- **Better Test Infrastructure** - Improved mocking and fixtures
  - Spotify response recording for consistent tests
  - Enhanced integration test validators
  - Test configuration management

### 🔧 Configuration
- **Config Validation** - Comprehensive validation for all settings
- **Safe Config Dumps** - All sensitive values properly redacted
  - API keys, tokens, secrets masked in debug output
  - Consistent redaction across all commands
- **Config Merging** - New settings merge with existing config (preserves user data)

### 🎵 Music Features
- **Source Detection** - New `source` command shows playback source
  - Identifies queue vs external source (Spotify Connect, AirPlay, etc.)
  - Helps debug playback issues
  - Smart suggestions for switching sources
- **Improved Queue Display** - Better formatting and track information
  - Shows currently playing track with metadata
  - Time remaining and total duration
  - Lock icons for immune tracks
  - Source warnings when playing external content

### 🐛 Bug Fixes
- Fixed WebAuthn user verification issues with Yubikey
- Fixed credential validation race conditions
- Fixed SSE connection handling and reconnection
- Fixed config value masking for sensitive data
- Fixed file I/O blocking event loop
- Fixed queue display position matching
- Fixed admin panel real-time update bugs

### 🔒 Security Enhancements
- **Never expose sensitive values** - Comprehensive redaction
  - API keys, tokens, secrets, passwords
  - Hashes and instance IDs
  - All debug/configdump commands sanitized
- **Secure session management** - HttpOnly cookies with expiry
- **Password hashing** - Bcrypt with proper salt rounds
- **WebAuthn challenge verification** - Proper attestation and assertion validation

### 📖 Documentation
- **Slack Setup Guide** - Comprehensive Socket Mode configuration
- **Discord Setup Guide** - Complete bot setup instructions
- **Testing Guide** - How to run and write tests
- **Telemetry Documentation** - Privacy and opt-out information
- **Troubleshooting Guide** - Common issues and solutions
- **App Directory Manifest** - Slack App Directory listing preparation
- **Privacy Policy & Terms of Service** - Legal documentation

### ⚠️ Breaking Changes
- **Repository structure changed** - Documentation moved to `/docs`, Docker files to `/docker`
- **Config format extended** - New optional fields for WebAuthn, setup wizard, AI context
- **Node.js >= 18** recommended for optimal performance (native fetch support)

### 🎯 Migration Guide
1. Update documentation links if hardcoded (use `/docs/` prefix)
2. Update Docker build paths if using custom workflows
3. Optional: Configure WebAuthn for passwordless admin access
4. Optional: Set `aiContextLimit` for conversation memory management
5. Review new config options in `config/config.json.example`

## [1.7.1] - 2025-12-02

### Fixed
- Help text and message templates are now loaded from `templates/` instead of `config/` for improved security and clarity.

## [1.7.3] - 2025-12-03

### Added
- **Persistent Telemetry Instance ID** - Anonymous telemetry now uses a persistent UUID stored in config, ensuring consistent tracking across restarts
- **Soundcraft Volume Display** - The `volume` command now shows configured Soundcraft mixer channel levels alongside Sonos volume

### Changed
- Soundcraft volume conversion now uses linear dB mapping for more accurate fader representation

## [1.7.2] - 2025-12-02

### Changed
- The `add` command now uses the same search logic as the `search` command, ensuring the top result is always added to the queue. This fixes inconsistencies when adding tracks after searching.

## [1.7.0] - 2025-12-02

### Added
- **Comprehensive Integration Test Suite** - 21 automated end-to-end tests
  - Multi-channel testing (regular + admin channels)
  - Democratic feature validation (gong, vote, flushvote)
  - Admin command access control testing
  - Strict validators with `notContainsText` support
  - Test configuration in `test/config/test-config.json`
  - Documentation in `test/INTEGRATION_TESTING.md`
  - NPM scripts: `test:integration` and `test:integration:verbose`

### Changed
- **Repository Organization** - Cleaner project structure
  - Moved message templates to `config/messages/` (gong.txt, vote.txt, tts.txt)
  - Moved help files to `config/help/` (helpText.txt, helpTextAdmin.txt)
  - Updated Docker Compose to use `htilly/slackonos:latest` image
  - Enhanced `.dockerignore` with better exclusions
- **Dependency Updates**
  - Updated sinon: 19.0.2 → 21.0.0
  - Updated chai: 6.2.0 → 6.2.1
  - Updated posthog-node: 4.3.0 → 5.15.0
  - Updated openai: 4.76.1 → 6.9.1

### Removed
- Removed unused legacy files and folders
  - Deleted empty `tools/` directory
  - Removed `.travis.yml` (using GitHub Actions)
  - Removed `.snyk` config file
  - Removed `Procfile` (Heroku deployment)
  - Removed `sound/` directory with unused audio files
  - Cleaned up `.gitignore` (removed obsolete entries)

### Fixed
- Corrected TTS server port mapping in docker-compose (8080)
- Removed local file paths from documentation

## [1.7.0] - 2025-12-02

### Added
- **Comprehensive Integration Test Suite** - 21 automated end-to-end tests
  - Multi-channel testing (regular + admin channels)
  - Democratic feature validation (gong, vote, flushvote)
  - Admin command access control testing
  - Strict validators with `notContainsText` support
  - Test configuration in `test/config/test-config.json`
  - Documentation in `test/INTEGRATION_TESTING.md`
  - NPM scripts: `test:integration` and `test:integration:verbose`

### Changed
- **Repository Organization** - Cleaner project structure
  - Moved message templates to `config/messages/` (gong.txt, vote.txt, tts.txt)
  - Moved help files to `config/help/` (helpText.txt, helpTextAdmin.txt)
  - Updated Docker Compose to use `htilly/slackonos:latest` image
  - Enhanced `.dockerignore` with better exclusions
- **Dependency Updates**
  - Updated sinon: 19.0.2 → 21.0.0
  - Updated chai: 6.2.0 → 6.2.1
  - Updated posthog-node: 4.3.0 → 5.15.0
  - Updated openai: 4.76.1 → 6.9.1

### Removed
- Removed unused legacy files and folders
  - Deleted empty `tools/` directory
  - Removed `.travis.yml` (using GitHub Actions)
  - Removed `.snyk` config file
  - Removed `Procfile` (Heroku deployment)
  - Removed `sound/` directory with unused audio files
  - Cleaned up `.gitignore` (removed obsolete entries)

### Fixed
- Corrected TTS server port mapping in docker-compose (8080)
- Removed local file paths from documentation

## [1.6.0] - 2025-12-02

### Added
- **Track Blacklist System** - Block specific tracks or artists from being added to the queue
  - `trackblacklist` command for adding/removing blacklisted tracks (admin-only)
  - Case-insensitive partial matching (blocks "Last Christmas" variations)
  - Persistent storage in `config/track-blacklist.json`
  - Works with all add methods: individual tracks, albums, playlists, and AI-generated lists
- **Album/Playlist Filtering** - Smart filtering instead of blocking entire collections
  - Automatically filters out blacklisted tracks from albums and playlists
  - Shows warning message with skipped track names (up to 5 listed)
  - Adds remaining tracks individually when filtering is needed
- **AI Blacklist Integration** - AI-generated music requests now respect blacklist
  - Music helper module checks blacklist before queueing tracks
  - Reports skipped tracks in success message
- **PostHog Telemetry** - Anonymous usage tracking for development insights
  - Migrated from Plausible to PostHog SDK (posthog-node v4.3.0)
  - Tracks startup, heartbeat (24h), and shutdown events
  - Includes OS platform, Node version, and market info
  - Fully documented in TELEMETRY.md with privacy details
  - Opt-out via `telemetryEnabled: false` in config
- **Soundcraft Ui24R Integration** - Control mixer volume on multiple buses directly from Slack/Discord
  - Multi-bus support with named channels (e.g., `setvolume receptionen 30`)
  - WebSocket-based real-time connection with auto-reconnection
  - Configuration via `soundcraftEnabled`, `soundcraftIp`, `soundcraftChannels`
  - Comprehensive documentation in SOUNDCRAFT.md
- **Channel ID Support** - Use Slack channel IDs directly in config to avoid rate limits in large workspaces (100+ channels)
- **Auto-save Channel IDs** - After first successful lookup by name, IDs are automatically saved to config.json for instant future startups
- **Smart Channel Lookup** - Detects if config uses IDs vs names; warns when scanning all channels
- **Comprehensive Test Suite** - 138 passing tests covering text cleaning, voting, parsing, and integrations
  - Text cleaning tests for Slack formatting (backticks, HTML entities, quotes)
  - Voting system tests with dynamic config changes
  - Integration tests for command logic and Spotify API

### Changed
- `setvolume` command now supports both Sonos (`setvolume 50`) and Soundcraft (`setvolume master 50`) syntax
- Channel lookup now skips API pagination if IDs are used directly
- Config file auto-updates with discovered IDs after first successful name-based lookup
- Text cleaning improvements: removes backticks, HTML entities (&gt;, &lt;, &amp;, &quot;), quote markers, number prefixes
- Music helper module now accepts optional blacklist checker function
- Album and playlist commands show track count and skipped tracks in messages

### Fixed
- Slack Socket Mode auto-reconnect prevents crashes on disconnect
- Build.txt dependency removed (was causing ENOENT errors)
- Variable redeclaration errors in album/playlist refactoring
- Private channel IDs (G...) now supported in channel lookup
- Soundcraft API calls corrected for aux/fx bus control
- ARM v7 platform support for Raspberry Pi deployments

## [1.5.0] - 2025-11-30

### Added
- **AI Natural Language Processing** - Talk to the bot naturally! "play some U2", "hit me with 50 rock songs"
- **Seasonal Awareness** - AI suggests music based on current season (winter/holiday, summer, etc.)
- **Chat Command** - Ask the bot anything, get witty responses with music suggestions
- **Multi-step Commands** - "flush and add 100 songs" works as expected
- **Follow-up Actions** - Say "do it!" after a suggestion to execute it
- **Smart Suggestions** - When admin commands are blocked, bot suggests alternatives (e.g., "vote for track X")
- **Track Limits** - Regular channels: 20 tracks, Admin channel: 200 tracks
- **music-helper.js Module** - Consolidated search, boosters, and queue logic

### Changed
- **Theme Mixing** - Venue theme (`defaultTheme`) only applies in admin channel
- **Default Query** - Uses `defaultTheme` from config instead of hardcoded "popular hits"
- **Boosters** - 24 mood/theme patterns enhance search queries (party, chill, workout, etc.)

### Fixed
- Chat command now properly handles non-music questions
- Follow-up context expires after 5 minutes to prevent stale suggestions
- Duplicate track detection improved with normalized names

## [1.4.0] - 2025-11-29

### Added
- **Discord Support** - Full Discord integration alongside Slack
- **Voting System Refactor** - Extracted to `voting.js` module
- **AI Handler** - Extracted to `ai-handler.js` module
- **Test Suite** - Mocha tests for parser, voting, AI handler, Spotify

### Changed
- Migrated from RTM API to Socket Mode for Slack
- Improved error handling and logging throughout

## [1.3.0] - 2025-11-27

### Added
- **Blacklist Persistence** - Blacklist stored in `config/blacklist.json`
- **User Action Logging** - All commands logged to `config/userActions.json`
- **Snyk Security Scanning** - Automated vulnerability scanning

### Fixed
- Bot no longer responds to its own messages
- Channel ID lookup more reliable

## [1.2.0] - 2025-11-25

### Added
- **BestOf Command** - Play top tracks from any artist
- **Gong Immunity** - Voted-up tracks protected from immediate gonging
- **Vote Limits** - Per-user vote limits prevent spam

### Changed
- Volume cap enforced via `maxVolume` config

## [1.1.0] - 2025-11-20

### Added
- **TTS (Text-to-Speech)** - Announce messages through Sonos
- **Admin Commands** - setvolume, setconfig, blacklist management
- **Queue Display** - Show current queue with track info

## [1.0.0] - 2025-11-15

### Added
- Initial release
- Slack bot with Sonos control
- Spotify integration for track search and queue
- Democratic voting system (gong to skip)
- Flush voting for queue clear
- Basic commands: add, play, pause, next, list, current, help

---

[Unreleased]: https://github.com/htilly/SlackONOS/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/htilly/SlackONOS/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/htilly/SlackONOS/compare/v1.4.0...v1.5.0
[1.5.0]: https://github.com/htilly/SlackONOS/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/htilly/SlackONOS/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/htilly/SlackONOS/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/htilly/SlackONOS/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/htilly/SlackONOS/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/htilly/SlackONOS/releases/tag/v1.0.0
