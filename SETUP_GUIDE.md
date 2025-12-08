# Complete Setup Guide

Comprehensive guide for setting up SlackONOS using the web-based setup wizard.

## Overview

SlackONOS uses a web-based setup wizard that makes configuration easy. The wizard guides you through all necessary steps and validates your configuration automatically.

## Prerequisites

Before starting, make sure you have:

- ✅ Node.js installed (v18+ recommended)
- ✅ A Sonos speaker with Spotify configured
- ✅ Slack workspace admin access (for creating Slack app)
- ✅ Spotify Developer account (free)
- ✅ Discord Developer account (optional, for Discord support)

## Step-by-Step Setup

### 1. Install and Start SlackONOS

```bash
# Clone or download the repository
cd SlackONOS

# Install dependencies
npm install

# Start SlackONOS
node index.js
```

You should see:
```
[info] Starting SlackONOS...
[info] 📻 HTTP server listening on port 8181
[info]    Setup wizard: http://YOUR_IP:8181/setup
```

### 2. Access Setup Wizard

Open your browser and navigate to:
- **Local setup:** `http://localhost:8181/setup`
- **Remote server:** `http://YOUR_SERVER_IP:8181/setup`

The setup wizard will automatically detect if configuration is needed and guide you through the process.

### 3. Configure Slack Integration

#### 3.1 Create Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name your app (e.g., "SlackONOS") and select your workspace
4. Click "Create App"

#### 3.2 Enable Socket Mode

1. In your app, go to "Socket Mode" (under Features)
2. Toggle "Enable Socket Mode" to ON
3. Click "Generate App-Level Token"
4. Name it (e.g., "SlackONOS Socket")
5. Add scope: `connections:write`
6. Click "Generate"
7. **Copy the token** (starts with `xapp-`) - this is your App-Level Token

#### 3.3 Configure OAuth Permissions

1. Go to "OAuth & Permissions"
2. Scroll to "Bot Token Scopes"
3. Add these scopes:
   - `app_mentions:read`
   - `chat:write`
   - `channels:read`
   - `channels:history`
   - `groups:read`
   - `groups:history`
4. Scroll up and click "Install to Workspace"
5. Authorize the app
6. **Copy the Bot User OAuth Token** (starts with `xoxb-`)

#### 3.4 Subscribe to Events

1. Go to "Event Subscriptions"
2. Toggle "Enable Events" to ON
3. Under "Subscribe to bot events", add:
   - `app_mention`
   - `message.channels`
   - `message.groups` (if using private channels)
4. Click "Save Changes"

#### 3.5 Enter in Setup Wizard

In the setup wizard's Slack step:
1. Paste your App-Level Token (xapp-...)
2. Paste your Bot User OAuth Token (xoxb-...)
3. Enter channel names or IDs:
   - Admin Channel: Where admin commands work (e.g., "music-admin")
   - Standard Channel: Where users request music (e.g., "music")
4. Click "Validate Tokens" to verify
5. Click "Next"

**Tip:** For large workspaces (100+ channels), use channel IDs instead of names. Find IDs by right-clicking channel → "View channel details" → copy ID from bottom.

### 4. Configure Sonos

#### Option A: Auto-Discovery (Recommended)

1. Click "Discover Sonos Devices"
2. Wait a few seconds
3. Select your Sonos speaker from the list
4. Click "Next"

#### Option B: Manual Entry

1. Find your Sonos IP address:
   - Open Sonos app
   - Settings → System → About My System
   - Note the IP address
2. Enter IP in "Or Enter IP Address Manually"
3. Click "Next"

**Troubleshooting:**
- If discovery finds nothing, ensure Sonos is on same network
- Check firewall allows UDP port 1900 (SSDP)
- Try manual entry if discovery fails

### 5. Configure Spotify

#### 5.1 Create Spotify App

1. Go to https://developer.spotify.com/dashboard
2. Log in with your Spotify account
3. Click "Create an app"
4. Fill in:
   - App name: "SlackONOS" (or your choice)
   - App description: "Music bot for Slack"
   - Redirect URI: Not needed for this use case
5. Accept terms and click "Create"
6. Click on your app
7. **Copy Client ID**
8. Click "Show Client Secret" and **copy it**

#### 5.2 Enter in Setup Wizard

1. Paste Client ID
2. Paste Client Secret
3. Select your market/country (where your Spotify account is registered)
4. Click "Validate Credentials" to verify
5. Click "Next"

### 6. Configure Discord (Optional)

Skip this step if you only want Slack support.

#### 6.1 Create Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Name it (e.g., "SlackONOS")
4. Go to "Bot" section
5. Click "Add Bot"
6. Under "Privileged Gateway Intents", enable:
   - ✅ Message Content Intent
7. **Copy the token** (click "Reset Token" if needed)

#### 6.2 Invite Bot to Server

1. Go to "OAuth2" → "URL Generator"
2. Select scope: `bot`
3. Select permissions:
   - Send Messages
   - Read Messages/View Channels
   - Read Message History
   - Add Reactions
4. Copy the generated URL
5. Open URL in browser and select your server
6. Authorize

#### 6.3 Get Channel IDs

1. In Discord, enable Developer Mode:
   - User Settings → Advanced → Developer Mode
2. Right-click on channels where bot should work
3. Click "Copy Channel ID"
4. Collect all channel IDs

#### 6.4 Enter in Setup Wizard

1. Paste Discord bot token
2. Enter channel IDs (comma-separated)
3. Enter admin role names (comma-separated, e.g., "DJ, Admin")
4. Click "Validate Token" to verify
5. Click "Next"

### 7. Review and Save

1. Review your configuration summary
2. Verify all required fields are filled
3. Click "Save Configuration"
4. Wait for success message

### 8. Restart SlackONOS

1. Stop SlackONOS (Ctrl+C in terminal)
2. Start it again: `node index.js`
3. You should see:
   ```
   [info] ✅ Successfully connected to Slack via Socket Mode
   [info] ✅ Voting module initialized
   ```

### 9. Invite Bot to Channels

In Slack:
```
/invite @SlackONOS
```

Do this for both your admin channel and music channel.

## Verification

Test that everything works:

1. **Slack:** Send `@SlackONOS current` in your music channel
2. **Sonos:** Check logs for connection success
3. **Spotify:** Try `add song name` command
4. **Discord:** If configured, test commands in Discord channels

## Updating Configuration

To update your configuration later:

1. Start SlackONOS
2. Open setup wizard: `http://localhost:8181/setup`
3. Make changes
4. Save and restart

Or edit `config/config.json` manually and restart.

## Next Steps

- Read [README.md](README.md) for command reference
- Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) if you have issues
- See [AI_FEATURE.md](AI_FEATURE.md) for AI natural language setup
- See [SOUNDCRAFT.md](SOUNDCRAFT.md) for mixer integration

## Advanced Configuration

### Environment Variables

You can override config with environment variables:

```bash
SONOS=192.168.1.100 \
SLACK_APP_TOKEN=xapp-... \
TOKEN=xoxb-... \
node index.js
```

### Docker Setup

```bash
docker run -d \
  -p 8181:8181 \  # HTTP (redirectar)
  -p 8443:8443 \  # HTTPS (faktiska förfrågningar)
  -v /path/to/config:/app/config \
  htilly/slackonos:latest
```

Then access setup wizard at:
- HTTP: `http://localhost:8181/setup` (redirects to HTTPS if SSL is enabled)
- HTTPS: `https://localhost:8443/setup` (if SSL certificates are configured)

## Support

- **Documentation:** See other .md files in repository
- **Issues:** Open an issue on GitHub
- **Questions:** Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

