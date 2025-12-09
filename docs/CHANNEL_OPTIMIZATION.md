# Channel Lookup Optimization Guide

## Problem

In large Slack workspaces (100+ channels), SlackONOS performs a **full channel scan** at startup to find the channel IDs for `adminChannel` and `standardChannel`. This:

- Triggers Slack API rate limits (HTTP 429)
- Delays bot startup by 1-3 minutes
- Makes hundreds of unnecessary API calls

**Example logs from a large workspace:**
```
[2025-12-01 07:51:10] info: Response status for fetching channels: 200
[2025-12-01 07:51:11] info: Response status for fetching channels: 200
...
[2025-12-01 07:51:13] info: Response status for fetching channels: 429
[2025-12-01 07:51:13] warn: Rate limit hit! Retrying after 30 seconds...
```

## Solution

**🎉 NEW: Auto-save Feature (v1.6.0+)**

SlackONOS now **automatically saves channel IDs** to your `config.json` after the first successful lookup! This means:

- **First startup with channel names**: Slow (1-3 minutes in large workspaces)
- **All future startups**: Instant (uses auto-saved IDs)

**No manual configuration needed!** Just use channel names and let the bot upgrade your config automatically.

### Auto-save Logs
```
[2025-12-01 08:00:05] info: Fetched 1247 channels total
[2025-12-01 08:00:05] info: Admin channelID: C01ABC123XY
[2025-12-01 08:00:05] info: Standard channelID: C987DEF654
[2025-12-01 08:00:05] info: ✅ Auto-saved channel IDs to config.json for faster future startups
[2025-12-01 08:00:05] info:    Updated: "music-admin" → "C01ABC123XY"
[2025-12-01 08:00:05] info:    Updated: "music" → "C987DEF654"
[2025-12-01 08:00:05] info:    Next restart will be instant (no channel lookup needed)
```

### Before Auto-save (Slow - Full Workspace Scan)
```json
{
  "adminChannel": "music-admin",
  "standardChannel": "music"
}
```
→ Bot scans all workspace channels at startup (100+ API calls)

### After Auto-save (Fast - Direct Lookup)
```json
{
  "adminChannel": "C01ABC123XY",
  "standardChannel": "C987DEF654"
}
```
→ Bot uses IDs directly (0 API calls, instant startup)

## Manual Configuration (Optional)

Want to skip the first slow startup? You can manually set channel IDs.
1. Right-click the channel in Slack
2. Select **"View channel details"**
3. Scroll to the bottom
4. Copy the **Channel ID** (format: `C` + 9+ alphanumeric characters)

### Method 2: Slack API Explorer
1. Go to https://api.slack.com/methods/conversations.list/test
2. Select your workspace
3. Click "Test Method"
4. Find your channel in the JSON response
5. Copy the `id` field

### Method 3: Web URL
1. Open the channel in Slack web
2. Look at the browser URL: `https://app.slack.com/client/T123.../C01ABC123XY`
3. The part starting with `C` is your channel ID

## Verification

After updating your config, check the logs at startup:

### With Channel IDs (Optimized)
```
[2025-12-01 08:00:01] info: Admin channel (in config): C01ABC123XY
[2025-12-01 08:00:01] info: Standard channel (in config): C987DEF654
[2025-12-01 08:00:01] info: Using channel IDs directly from config (no lookup needed)
[2025-12-01 08:00:01] info: Admin channelID: C01ABC123XY
[2025-12-01 08:00:01] info: Standard channelID: C987DEF654
```
✅ **Instant startup, no API calls**

### With Channel Names (Slow)
```
[2025-12-01 08:00:01] info: Admin channel (in config): music-admin
[2025-12-01 08:00:01] info: Standard channel (in config): music
[2025-12-01 08:00:01] warn: Channel names detected in config - performing lookup (slow in large workspaces)
[2025-12-01 08:00:01] warn: Consider using channel IDs directly in config to avoid rate limits
[2025-12-01 08:00:02] info: Response status for fetching channels: 200
...
```
⚠️ **Slow startup, many API calls, potential rate limiting**

## Benefits

- **Instant startup** - No channel scanning
- **No rate limits** - Zero conversations.list API calls
- **Better reliability** - Direct ID lookup always works
- **Works in any workspace** - Small or large (1000+ channels)

## Migration Checklist

- [ ] Find your admin channel ID
- [ ] Find your standard channel ID  
- [ ] Update `config/config.json` with both IDs
- [ ] Restart SlackONOS
- [ ] Verify logs show "Using channel IDs directly from config"
- [ ] Enjoy instant startup! 🎉
