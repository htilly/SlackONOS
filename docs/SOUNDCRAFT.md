# Soundcraft Ui24R Integration

SlackONOS now supports controlling the volume on your Soundcraft Ui24R digital mixer directly from Slack/Discord!

## Features

- 🎛️ Control multiple mixer buses (master, aux, fx, or custom named channels)
- 🔊 Set volume levels from 0-100% via simple commands
- 🔌 WebSocket-based real-time connection to your mixer
- 🔄 Automatic reconnection if the connection drops
- 📝 Detailed logging for troubleshooting

## Configuration

Add the following settings to your `config/config.json`:

```json
{
  "soundcraftEnabled": true,
  "soundcraftIp": "192.168.1.100",
  "soundcraftChannels": ["master", "receptionen", "aux1"]
}
```

### Configuration Options

| Setting | Type | Description | Example |
|---------|------|-------------|---------|
| `soundcraftEnabled` | boolean | Enable/disable Soundcraft integration | `true` or `false` |
| `soundcraftIp` | string | IP address of your Ui24R mixer | `"192.168.1.100"` |
| `soundcraftChannels` | array | List of channel/bus names to control | `["master", "receptionen"]` |

### Channel Names

You can use any names you want for your channels. The following built-in channel types are automatically mapped:

- **`master`** - Controls the master fader
- **`aux1`, `aux2`, etc.** - Controls AUX buses (e.g., `aux1` = AUX 1)
- **`fx1`, `fx2`, etc.** - Controls FX buses

Custom named channels (like `"receptionen"`) are mapped to AUX buses by their position in the array (excluding `master`).

## Usage

### Set Volume on a Specific Channel

```
_setvolume receptionen 30
```

This sets the "receptionen" channel to 30% volume.

```
_setvolume master 50
```

This sets the master fader to 50% volume.

### Set Sonos Volume (Default Behavior)

If Soundcraft is disabled or you don't specify a channel name:

```
_setvolume 65
```

This sets the Sonos speaker volume to 65%.

### Get Help

If you provide an invalid command, the bot will show available Soundcraft channels:

```
_setvolume xyz 50
```

Response:
```
🤔 Invalid volume!

Sonos: `setvolume <number>`
Soundcraft: `setvolume <channel> <number>`

Available Soundcraft channels: `master`, `receptionen`
```

## Connection Details

The integration uses the [`soundcraft-ui-connection`](https://github.com/fmalcher/soundcraft-ui-connection) library to communicate with your Ui24R mixer via WebSocket.

### Network Requirements

- Your bot must be on the same network as the Ui24R mixer (or have network access to it)
- Default port: 80 (WebSocket)
- The mixer must be powered on and connected to the network

### Auto-Reconnection

If the connection to the mixer is lost (e.g., mixer is powered off or network interruption), the bot will:

1. Log a warning about the disconnection
2. Attempt to reconnect up to 5 times with a 5-second delay between attempts
3. Give up after 5 failed attempts (you'll need to restart the bot)

## Troubleshooting

### Bot won't connect to mixer

**Check the following:**

1. **Verify IP address**: Ensure `soundcraftIp` in your config is correct
   - You can find the mixer's IP on its display: `WiFi > Network Info`
   
2. **Network connectivity**: Ping the mixer from your bot's host machine:
   ```bash
   ping 192.168.1.100
   ```

3. **Firewall**: Ensure port 80 (WebSocket) is not blocked

4. **Mixer status**: Verify the mixer is powered on and showing the web interface IP

### Connection keeps dropping

- Check for network stability issues
- Ensure the mixer isn't going into standby mode
- Verify no other applications are competing for the WebSocket connection

### Channel not responding

1. **Verify channel name**: Check your `soundcraftChannels` config array
2. **Check logs**: Enable debug logging to see detailed connection info
3. **Test with master**: Try `_setvolume master 50` to verify basic functionality

## Example Configurations

### Simple Setup (Master Only)

```json
{
  "soundcraftEnabled": true,
  "soundcraftIp": "192.168.1.100",
  "soundcraftChannels": ["master"]
}
```

Commands:
- `_setvolume master 50` - Set master to 50%

### Multi-Zone Setup

```json
{
  "soundcraftEnabled": true,
  "soundcraftIp": "10.0.1.50",
  "soundcraftChannels": ["master", "bar", "lounge", "patio"]
}
```

Commands:
- `_setvolume master 60` - Set master to 60%
- `_setvolume bar 40` - Set bar zone to 40%
- `_setvolume lounge 55` - Set lounge zone to 55%
- `_setvolume patio 35` - Set patio zone to 35%

### Using Built-In Channel Types

```json
{
  "soundcraftEnabled": true,
  "soundcraftIp": "192.168.1.100",
  "soundcraftChannels": ["master", "aux1", "aux2", "fx1"]
}
```

Commands:
- `_setvolume master 70` - Set master to 70%
- `_setvolume aux1 45` - Set AUX 1 to 45%
- `_setvolume aux2 50` - Set AUX 2 to 50%
- `_setvolume fx1 30` - Set FX 1 to 30%

## Technical Details

### Implementation

- **File**: `soundcraft-handler.js`
- **Library**: `soundcraft-ui-connection` (npm)
- **Protocol**: WebSocket over HTTP (port 80)
- **Volume Range**: 0-100 (converted to 0.0-1.0 fader level internally)

### Logging

All Soundcraft operations are logged with timestamps:

```
[2025-12-01 10:40:32] info: Connecting to Soundcraft Ui24R at 192.168.1.100...
[2025-12-01 10:40:34] info: ✅ Successfully connected to Soundcraft Ui24R
[2025-12-01 10:40:34] info:    Configured channels: master, receptionen
[2025-12-01 10:41:15] info: Setting Soundcraft channel 'receptionen' to 30%
[2025-12-01 10:41:15] info: ✅ Soundcraft volume set successfully
```

## Contributing

Found a bug or want to add features? Check out the [main README](README.md) for contribution guidelines!

## License

Same license as SlackONOS (see [LICENSE](LICENSE))
