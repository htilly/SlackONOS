# Slack Setup Guide (Socket Mode)

This guide walks you through creating and configuring a Slack bot for SlackONOS using Socket Mode. It mirrors the structure of `DISCORD.md` and focuses on the exact scopes, events, and settings SlackONOS requires.

## Overview
- Uses Socket Mode (WebSocket) — no public HTTP endpoints required
- Requires two tokens:
  - App-level token: `xapp-...` with `connections:write`
  - Bot user token: `xoxb-...` for API actions
- Subscribes to bot events to receive messages and mentions

## Prerequisites
- Slack workspace admin access (to create and install apps)
- SlackONOS repository cloned and Docker installed (optional)

## 1. Create a Slack App
1. Go to https://api.slack.com/apps and click "Create New App"
2. Choose "From scratch", give it a name (e.g., "SlackONOS"), and select your workspace

## 2. Enable Socket Mode + App Token
1. Open your app → "Socket Mode"
2. Toggle "Enable Socket Mode" to ON
3. Click "Generate App-Level Token" (or manage tokens)
4. Ensure the token has scope `connections:write`
5. Copy the token (`xapp-1-...`) — you'll put this in `config.json` as `slackAppToken`

## 3. OAuth & Permissions — Bot Token Scopes
Open "OAuth & Permissions" → scroll to "Bot Token Scopes" and add:
- `app_mentions:read` — receive mentions of your bot
- `chat:write` — send messages
- `channels:read` — read public channel list
- `channels:history` — read public channel messages
- `groups:read` — read private channel list
- `groups:history` — read private channel messages
- Optional (DMs): `im:history`

Note: You don’t need a Request URL when using Socket Mode.

## 4. Event Subscriptions (Bot Events)
Open "Event Subscriptions" → toggle "Enable Events" ON → "Subscribe to bot events" and add:
- `app_mention` — for @SlackONOS mentions
- `message.channels` — messages in public channels
- `message.groups` — messages in private channels
- Optional: `message.im` — direct messages to the bot

Click "Save Changes".

## 5. Install/Reinstall the App
1. Open "Install App"
2. Click "Install to Workspace" or "Reinstall to Workspace" to apply new scopes
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`) — use it as `token` in `config.json`

## 6. Invite the Bot to Channels
In Slack, invite the bot user to the channels where it should operate:
```text
/invite @SlackONOS
```

## 7. Configure SlackONOS
Create or edit `config/config.json`. Minimal example:
```json
{
  "adminChannel": "music-admin",          // or channel ID: C01ABC123XY (recommended)
  "standardChannel": "music",             // or channel ID: C987DEF654 (recommended)
  "slackAppToken": "xapp-1-...",          // Socket Mode app-level token
  "token": "xoxb-...",                    // Bot User OAuth token
  "sonos": "192.168.0.50",               // Sonos IP
  "market": "US",
  "maxVolume": 75,
  "logLevel": "info"
}
```

### Channel IDs Recommended (Large Workspaces)
- Using names like `music-admin` forces a full channel scan on first run (can hit rate limits)
- SlackONOS now auto-saves discovered channel IDs back to `config.json` after the first successful startup
- To skip the slow first run, set IDs directly:
```json
{
  "adminChannel": "C01ABC123XY",
  "standardChannel": "C987DEF654"
}
```
How to find IDs: Slack web → open channel → URL has `/C...` or "View channel details" → copy ID.

## 8. Run SlackONOS
Node (local):
```bash
npm install
node index.js
```
Docker Compose:
```bash
docker compose pull
docker compose up -d
```
Verify logs:
```text
[info] ✅ Voting module initialized
[info] ✅ Command router initialized with AI support
[info] Bot user ID loaded: U123...
[info] ✅ Successfully connected to Slack via Socket Mode
```
On first startup with names:
```text
[warn] Channel names detected — performing lookup (slow in large workspaces)
[info] Fetched 1247 channels total
[info] ✅ Auto-saved channel IDs to config.json
```

## 9. Troubleshooting
- `missing_scope`
  - Revisit OAuth & Permissions → ensure scopes above
  - Event Subscriptions → Save Changes
  - Install App → Reinstall to Workspace
  - Update `config.json` with the new `xoxb-` token
- Bot not responding
  - Ensure bot is invited to channels
  - Confirm Socket Mode is ON and `slackAppToken` is present
  - Check logs for rate limit messages and wait/backoff
- Rate limits on startup
  - Use channel IDs directly to avoid workspace-wide scans

## 10. Security Notes
- Treat `xapp-` and `xoxb-` tokens as secrets
- Prefer environment variables or Docker secrets for production
- Consider Slack token rotation features if your org requires it

## 11. Optional: Slash Commands
If you want slash commands (e.g., `/slackonos`):
- Enable "Slash Commands"
- Define a command (no Request URL needed for Socket Mode)
- Ensure `commands` scope is added
- Implement handler mapping in your app (SlackONOS has infrastructure ready, not enabled by default)

---
That’s it! Your Slack bot should be connected via Socket Mode and ready to handle mentions and channel messages.
