# Changelog

All notable changes to SlackONOS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
