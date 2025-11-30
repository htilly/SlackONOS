# Changelog

All notable changes to SlackONOS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/htilly/SlackONOS/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/htilly/SlackONOS/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/htilly/SlackONOS/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/htilly/SlackONOS/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/htilly/SlackONOS/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/htilly/SlackONOS/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/htilly/SlackONOS/releases/tag/v1.0.0
