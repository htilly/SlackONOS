# Troubleshooting Guide

Common issues and solutions for SlackONOS setup and operation.

## Setup Wizard Issues

### Can't Access Setup Wizard

**Problem:** Browser shows "Connection refused" or can't reach `http://localhost:8181/setup`

**Solutions:**
- Make sure SlackONOS is running (`node index.js`)
- Check the port in logs - it should show `HTTP server listening on port 8181`
- If using Docker, ensure port 8181 is exposed: `-p 8181:8181`
- Try using the server's IP address instead of localhost: `http://YOUR_IP:8181/setup`
- Check firewall settings - port 8181 must be accessible

### Setup Wizard Shows "Not Found"

**Problem:** Setup page loads but shows 404

**Solutions:**
- Ensure `public/setup/` directory exists with `index.html`, `setup.css`, and `setup.js`
- Check file permissions
- Restart SlackONOS

## Slack Integration Issues

### "Missing Scope" Error

**Problem:** Bot responds with "missing_scope" errors

**Solutions:**
1. Go to https://api.slack.com/apps → Your App → OAuth & Permissions
2. Add required scopes:
   - `app_mentions:read`
   - `chat:write`
   - `channels:read`
   - `channels:history`
   - `groups:read`
   - `groups:history`
3. Click "Reinstall to Workspace"
4. Update `config.json` with new bot token (xoxb-...)

### Bot Not Responding

**Problem:** Bot doesn't respond to messages or mentions

**Solutions:**
- Ensure bot is invited to the channel: `/invite @SlackONOS`
- Check Socket Mode is enabled in Slack app settings
- Verify `slackAppToken` (xapp-...) is correct
- Verify `token` (xoxb-...) is correct
- Check logs for connection errors
- Ensure Event Subscriptions are enabled and `app_mention` and `message.channels` are subscribed

### Token Validation Fails

**Problem:** Setup wizard says tokens are invalid

**Solutions:**
- App token (xapp-...) must have `connections:write` scope
- Bot token (xoxb-...) must be from "Install App" → "Bot User OAuth Token"
- Make sure you copied the full token (they're long!)
- Check for extra spaces or newlines when pasting
- Reinstall app to workspace if token was regenerated

## Sonos Issues

### Can't Discover Sonos Devices

**Problem:** "Discover Sonos Devices" finds nothing

**Solutions:**
- Ensure Sonos speakers are powered on and connected to same network
- Check firewall - UDP port 1900 must be open for SSDP discovery
- Try entering IP address manually
- Find IP in Sonos app: Settings → System → About My System → IP Address
- Ensure Sonos and SlackONOS are on same network/subnet

### "Failed to connect to Sonos" Error

**Problem:** Startup shows Sonos connection error

**Solutions:**
- Verify Sonos IP address is correct in config
- Ensure Sonos is on same network as SlackONOS server
- Check firewall - port 1400 (TCP) must be accessible
- Try pinging Sonos IP: `ping SONOS_IP`
- Restart Sonos speaker
- Verify Sonos has internet access (for Spotify streaming)

## Spotify Issues

### "Invalid Credentials" Error

**Problem:** Spotify validation fails in setup wizard

**Solutions:**
- Verify Client ID and Secret are correct (no extra spaces)
- Check Spotify app is not deleted or disabled
- Ensure app is active in https://developer.spotify.com/dashboard
- Try regenerating Client Secret
- Check app has necessary permissions enabled

### Songs Don't Play

**Problem:** Songs are added to queue but don't play

**Solutions:**
- Verify Sonos is connected to Spotify account
- Check Sonos can play Spotify (test in Sonos app)
- Ensure Spotify account is active and not expired
- Check market/country code matches your Spotify account region
- Verify Sonos speaker is selected and not in standby

## Discord Issues

### Bot Doesn't Join Server

**Problem:** Discord bot doesn't appear online

**Solutions:**
- Verify Discord token is correct
- Check bot has "Send Messages" and "Read Message History" permissions
- Ensure bot is invited with correct OAuth2 URL
- See [DISCORD.md](DISCORD.md) for complete setup

### Bot Not Responding in Discord

**Problem:** Bot is online but doesn't respond

**Solutions:**
- Verify channel IDs are correct in config
- Enable Developer Mode in Discord to get channel IDs
- Check bot has permissions in those channels
- Ensure `discordChannels` array contains valid channel IDs
- Check logs for Discord connection errors

## Configuration Issues

### Config File Not Found

**Problem:** Error about missing `config/config.json`

**Solutions:**
- Run setup wizard to create config automatically
- Or manually copy `config/config.json.example` to `config/config.json`
- Ensure `config/` directory exists
- Check file permissions

### Changes Not Taking Effect

**Problem:** Updated config but changes don't apply

**Solutions:**
- **Restart SlackONOS** after changing config
- Verify JSON syntax is valid (use JSON validator)
- Check for typos in config keys
- Ensure no trailing commas in JSON

## Network Issues

### Can't Connect to Services

**Problem:** General connectivity issues

**Solutions:**
- Check server has internet access
- Verify DNS resolution works
- Check firewall rules
- Test with: `curl https://api.slack.com/api/auth.test`
- For Docker: ensure network mode allows external access

### Port Already in Use

**Problem:** "EADDRINUSE: address already in use" on port 8181

**Solutions:**
- Change `webPort` in config to different port (e.g., 8182)
- Or stop other service using port 8181
- Find what's using port: `lsof -i :8181` (Mac/Linux) or `netstat -ano | findstr :8181` (Windows)

## Docker Issues

### Setup Wizard Not Accessible in Docker

**Problem:** Can't reach setup wizard from host

**Solutions:**
- Ensure port mappings: `-p 8181:8181` (HTTP) and `-p 8443:8443` (HTTPS)
- Use host IP instead of localhost: `http://HOST_IP:8181/setup`
- Check Docker network configuration
- Verify container is running: `docker ps`

### Config Not Persisting

**Problem:** Config changes lost after container restart

**Solutions:**
- Ensure volume mount: `-v /host/path:/app/config`
- Verify volume path is correct
- Check file permissions on host
- Don't use `--rm` flag if you want persistence

## Still Having Issues?

1. Check the logs - they usually show what's wrong
2. Review the relevant setup guide:
   - [SLACK.md](SLACK.md) for Slack issues
   - [DISCORD.md](DISCORD.md) for Discord issues
   - [INSTALL](INSTALL) for installation issues
3. Open an issue on GitHub with:
   - Error messages from logs
   - Your configuration (remove sensitive tokens!)
   - Steps to reproduce

