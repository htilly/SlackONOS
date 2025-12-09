# Privacy Policy

**Last Updated:** [Date]

## Introduction

SlackONOS ("we", "our", or "the bot") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard information when you use SlackONOS.

## Information We Collect

### Configuration Data

SlackONOS stores configuration data locally on your server, including:
- Slack tokens (app-level and bot tokens)
- Sonos device IP addresses
- Spotify API credentials
- Discord tokens (if configured)
- Channel names/IDs
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
- ❌ Slack/Discord server information
- ❌ Song titles, playlists, or listening history
- ❌ Command usage or voting patterns

**Telemetry Control:** You can disable telemetry at any time by setting `telemetryEnabled: false` in your configuration.

### Message Data

SlackONOS processes messages in Slack/Discord channels where it's invited:
- Reads messages to detect commands
- Sends responses to channels
- Processes voting and queue management

**Storage:** Messages are not stored or logged beyond what's necessary for bot operation. No message content is transmitted outside your server.

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

- **Slack:** Processes messages and sends responses via Slack API
- **Spotify:** Searches and queues music via Spotify API
- **Discord:** Processes messages and sends responses via Discord API
- **Sonos:** Controls speakers via local network
- **OpenAI (optional):** Processes natural language commands if AI is enabled

Each service has its own privacy policy. We recommend reviewing them:
- [Slack Privacy Policy](https://slack.com/privacy-policy)
- [Spotify Privacy Policy](https://www.spotify.com/privacy)
- [Discord Privacy Policy](https://discord.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/privacy)

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
- Open an issue on GitHub: [Repository URL]
- Review documentation: See README.md and other docs in repository

## Compliance

This Privacy Policy is designed to comply with:
- General Data Protection Regulation (GDPR)
- California Consumer Privacy Act (CCPA)
- Other applicable privacy laws

---

**Note:** Since SlackONOS is self-hosted, you are the data controller. This policy describes how the software handles data, but you are responsible for compliance with applicable laws in your jurisdiction.




