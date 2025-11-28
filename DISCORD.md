# Discord Integration for SlackONOS

SlackONOS now supports Discord alongside Slack! You can run both simultaneously or just Discord.

## Features

- ✅ All music commands work on Discord
- ✅ Voting system (gong, vote, flush)
- ✅ Shared Sonos queue between Slack and Discord
- ✅ Emoji reactions support
- ✅ Multi-channel support

## Setup

### 1. Create Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Give it a name (e.g., "SlackONOS")
4. Go to "Bot" section
5. Click "Add Bot"
6. Under "Privileged Gateway Intents", enable:
   - ✅ Message Content Intent
   - ✅ Server Members Intent (optional)
7. Copy the bot token

### 2. Invite Bot to Server

1. Go to "OAuth2" → "URL Generator"
2. Select scopes:
   - ✅ `bot`
3. Select bot permissions:
   - ✅ Send Messages
   - ✅ Read Messages/View Channels
   - ✅ Read Message History
   - ✅ Add Reactions
4. Copy the generated URL and open in browser
5. Select your server and authorize

### 3. Get Channel IDs

1. Enable Developer Mode in Discord:
   - User Settings → Advanced → Developer Mode
2. Right-click on the channel(s) you want the bot to work in
3. Click "Copy Channel ID"

### 4. Configure SlackONOS

Add to your `config/config.json`:

```json
{
  "discordToken": "YOUR_BOT_TOKEN_HERE",
  "discordChannels": ["CHANNEL_ID_1", "CHANNEL_ID_2"]
}
```

### 5. Start the Bot

```bash
npm install  # Installs discord.js
node index.js
```

You should see:
```
✅ Slack connection established.
🎮 Discord client connecting...
✅ Discord bot logged in as SlackONOS#1234
```

## Usage

### Commands

All commands work the same as in Slack:

```
add bohemian rhapsody
bestof queen
pause
play
volume 50
gong
vote
list
```

### Mentions

You can mention the bot or just use commands directly:
```
@SlackONOS add everlong
add everlong
```

### Platform-Specific Behavior

- **Slack:** Uses reactions for interactive votes
- **Discord:** Uses emoji reactions (coming soon!)
- **Shared Queue:** Music added from either platform goes to same Sonos queue

## Troubleshooting

### Bot doesn't respond

- Check bot has "Read Messages" permission in channel
- Verify channel ID is in `discordChannels` array
- Check logs for connection errors

### "Missing Access" error

- Ensure bot was invited with correct permissions
- Re-invite bot with updated permission URL

### Bot connects but doesn't see messages

- Enable "Message Content Intent" in Discord Developer Portal
- Bot → Privileged Gateway Intents → Message Content Intent

## Running Slack + Discord Simultaneously

Simply configure both:
- `slackAppToken`, `token` for Slack
- `discordToken`, `discordChannels` for Discord

The bot will connect to both and share the same Sonos queue!

## Discord-Only Mode

If you only want Discord (no Slack):
- Comment out Slack validation in `index.js` startup sequence
- Or just don't configure Slack tokens (will log warning but continue)

## Architecture

```
Discord Gateway
    ↓
discord.js module
    ↓
processInput() ← Shared command handler
    ↓
_slackMessage() (auto-detects platform)
    ↓
Discord Channel / Slack Channel
```

All business logic (Spotify, Sonos, voting) is shared between platforms!
