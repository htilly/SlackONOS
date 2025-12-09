# Quick Start Guide

Get SlackONOS up and running in 5 minutes!

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Start SlackONOS

```bash
node index.js
```

You'll see output like:
```
[info] Starting SlackONOS...
[info] 📻 HTTP server listening on port 8181
[info]    Setup wizard: http://YOUR_IP:8181/setup
```

## Step 3: Open Setup Wizard

Open your browser and navigate to:
- **Local:** `http://localhost:8181/setup`
- **Remote:** `http://YOUR_SERVER_IP:8181/setup`

## Step 4: Follow the Wizard

The setup wizard will guide you through:

1. **Welcome** - Overview of what you'll need
2. **Slack Setup** - Enter your Slack tokens
   - Get tokens from https://api.slack.com/apps
   - See [SLACK.md](SLACK.md) for detailed instructions
3. **Sonos Setup** - Connect to your speaker
   - Click "Discover Sonos Devices" to auto-find speakers
   - Or enter IP address manually
4. **Spotify Setup** - Connect to Spotify
   - Get credentials from https://developer.spotify.com/dashboard
   - Create a new app if needed
5. **Discord Setup** (Optional) - Add Discord support
   - Get token from https://discord.com/developers
   - See [DISCORD.md](DISCORD.md) for details
6. **Review & Complete** - Save your configuration

## Step 5: Restart SlackONOS

After saving your configuration:

1. Stop SlackONOS (Ctrl+C)
2. Start it again: `node index.js`
3. You should see connection messages:
   ```
   [info] ✅ Successfully connected to Slack via Socket Mode
   [info] ✅ Voting module initialized
   ```

## Step 6: Invite Bot to Channels

In Slack:
```
/invite @SlackONOS
```

Do this for both your admin channel and music channel.

## That's It! 🎉

Try these commands in Slack:
- `add song name` - Add music to queue
- `current` - See what's playing
- `list` - Show queue
- `gong` - Vote to skip current song

## Need Help?

- **Setup Issues:** See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Slack Setup:** See [SLACK.md](SLACK.md)
- **Discord Setup:** See [DISCORD.md](DISCORD.md)
- **Full Installation:** See [INSTALL](INSTALL)

## Docker Quick Start

```bash
docker run -d \
  -p 8181:8181 \  # HTTP (redirectar)
  -p 8443:8443 \  # HTTPS (faktiska förfrågningar)
  -v /path/to/config:/app/config \
  htilly/slackonos:latest
```

Then open `http://localhost:8181/setup` in your browser (will redirect to HTTPS if SSL is enabled).

