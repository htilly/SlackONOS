# Privacy Policy

**Last Updated:** December 13, 2025

## Introduction

SlackONOS ("we", "our", or "the bot") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard information when you use SlackONOS on Slack, Discord, or both platforms.

## Information We Collect

### Configuration Data

SlackONOS stores configuration data locally on your server, including:
- Slack tokens (app-level and bot tokens)
- Discord tokens and bot configuration
- Sonos device IP addresses
- Spotify API credentials
- Channel names/IDs (Slack and Discord)
- Discord role IDs for admin permissions
- User preferences and settings

**Storage:** All configuration data is stored locally in `config/config.json` on your server. We do not have access to this data.

### Telemetry Data (Optional)

If telemetry is enabled, SlackONOS may send anonymous usage data:
- Startup and shutdown events
- Uptime duration
- Operating system and Node.js version
- Release version/commit hash
- Anonymous instance ID (random UUID)

**What We DON'T Collect:**
- ❌ User data, usernames, or chat messages
- ❌ Slack/Discord server information or member lists
- ❌ Song titles, playlists, or listening history
- ❌ Command usage or voting patterns
- ❌ Discord user IDs or personal information

**Telemetry Control:** You can disable telemetry at any time by setting `telemetryEnabled: false` in your configuration.

### Discord-Specific Data Collection

When using SlackONOS on Discord, the bot accesses:
- **Message Content:** To read commands and parse natural language requests (requires privileged intent)
- **Message Reactions:** To track emoji voting (🎵 for votes, 🔔 for gongs)
- **User Roles:** To determine admin permissions based on configured role names/IDs
- **Channel Information:** To identify which channels the bot should respond in

**Important:** All Discord data is processed in real-time and not stored permanently. The bot only retains temporary information needed for voting/queue management during active use.

### Slack-Specific Data Collection

When using SlackONOS on Slack, the bot accesses:
- **Message Content:** To read commands and mentions
- **Channel Information:** To identify admin vs. standard channels
- **User Information:** Usernames for logging command usage

**Important:** All Slack data is processed in real-time via Socket Mode and not stored permanently.

### Message Data

SlackONOS processes messages in Slack/Discord channels where it's invited:
- Reads messages to detect commands
- Parses natural language requests (if AI is enabled)
- Sends responses to channels or Direct Messages
- Processes voting and queue management

**Storage:** Messages are not stored or logged beyond what's necessary for bot operation. No message content is transmitted outside your server except to authorized APIs (Spotify, OpenAI if enabled) for functionality.

## How We Use Information

### Configuration Data
- Used solely for bot operation
- Never transmitted outside your server
- You have full control over this data

### Telemetry Data (if enabled)
- Used to understand usage patterns
- Helps improve the bot
- Completely anonymous and aggregated

### Message Data
- Processed in real-time for command execution
- Not stored or analyzed beyond immediate processing

## Data Security

- All configuration data is stored locally on your server
- Tokens and credentials are never transmitted to third parties (except for API calls to Slack, Spotify, Discord as required for functionality)
- We recommend securing your `config/config.json` file with appropriate file permissions

## Third-Party Services

SlackONOS integrates with:

- **Slack:** Processes messages and sends responses via Slack API (Socket Mode)
- **Discord:** Processes messages, reactions, and role information via Discord Gateway API
- **Spotify:** Searches and queues music via Spotify Web API
- **Sonos:** Controls speakers via local network (UPnP)
- **OpenAI (optional):** Processes natural language commands via OpenAI API if AI features are enabled

Each service has its own privacy policy. We recommend reviewing them:
- [Slack Privacy Policy](https://slack.com/privacy-policy)
- [Discord Privacy Policy](https://discord.com/privacy)
- [Spotify Privacy Policy](https://www.spotify.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/privacy)

### Discord Gateway Intents

SlackONOS uses the following Discord Gateway Intents:
- **Guilds (Standard):** Access server/channel information
- **Guild Messages (Standard):** Receive message events
- **Message Content (Privileged):** Read message text for command parsing - requires approval
- **Guild Message Reactions (Standard):** Track emoji reactions for voting

**Privileged Intent Notice:** The Message Content intent is classified as privileged by Discord and requires explicit approval. This intent is necessary for SlackONOS to read and respond to your commands. We only process message content for bot functionality and do not store or transmit it beyond what's required for operation.

## Data Retention

- Configuration data: Stored locally until you delete it
- Telemetry data: Aggregated and anonymized, retained for analytics purposes
- Message data: Not retained beyond immediate processing

## Your Rights

You have the right to:
- Access your configuration data (stored locally)
- Modify or delete your configuration
- Disable telemetry
- Stop using the bot at any time

## Self-Hosted Nature

**Important:** SlackONOS is self-hosted software. This means:
- You control where it runs
- You control all data storage
- We do not have access to your server or data
- You are responsible for securing your installation

## Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be posted in the repository with an updated "Last Updated" date.

## Contact

For questions about this Privacy Policy:
- Open an issue on GitHub: https://github.com/htilly/SlackONOS/issues
- Review documentation: See README.md and docs/ folder in repository
- Discord Setup Guide: https://github.com/htilly/SlackONOS/blob/master/docs/discord/SETUP.md
- Discord Support Server: [Join support server for community help]

## Discord App Directory Compliance

If you installed SlackONOS from the Discord App Directory:
- The bot operates on your self-hosted server, not on Discord's infrastructure
- All data processing happens on your server
- Discord's privacy policy applies to Discord Gateway communications
- This privacy policy applies to the bot's behavior and data handling

## Compliance

This Privacy Policy is designed to comply with:
- General Data Protection Regulation (GDPR)
- California Consumer Privacy Act (CCPA)
- Other applicable privacy laws

---

**Note:** Since SlackONOS is self-hosted, you are the data controller. This policy describes how the software handles data, but you are responsible for compliance with applicable laws in your jurisdiction.




