[![Build Status](https://github.com/htilly/SlackONOS/workflows/Node.js%20CI/badge.svg)](https://github.com/htilly/SlackONOS/actions?query=workflow%3A%22Node.js+CI%22)
[![Known Vulnerabilities](https://snyk.io/test/github/htilly/SlackONOS/badge.svg)](https://snyk.io/test/github/htilly/SlackONOS)
![Tests](https://github.com/htilly/SlackONOS/workflows/Run%20Tests/badge.svg)
![Coverage](https://github.com/htilly/SlackONOS/workflows/Test%20and%20Coverage/badge.svg)


# SlackONOS - Democratic Music Bot for Discord & Slack

**Control Your Sonos Speakers with Community Voting**

A democratic music bot for Discord and Slack that lets teams control Sonos speakers with Spotify integration. Features community voting, democratic skip tracking with "gong" commands, and seamless multi-platform support.

🎵 **Perfect for:** Offices, shared spaces, gaming communities, Discord servers, and music lovers who want fair queue control

✨ **Key Features:**
- 🤖 **AI Natural Language** - Talk naturally! "@bot play the best songs by Queen" (NEW!)
- 🗳️ **Democratic Voting** - Community decides what plays next with vote-to-play system
- 🔔 **Gong System** - Skip tracks democratically when enough users vote to gong
- 🎮 **Discord Support** - Full emoji reaction voting (🎵 to vote, 🔔 to gong)
- 💬 **Slack Integration** - Modern Socket Mode support with channel-based permissions
- 🎶 **Spotify Integration** - Search and queue tracks, albums, and playlists
- 👥 **Multi-Platform** - Run Discord and Slack simultaneously on one Sonos system
- 🎯 **Role-Based Permissions** - Admin controls for flush, volume, and queue management
- 🚫 **Gong Ban System** - Tracks voted down become immune to re-queuing

*Screenshot*

![ScreenShot](http://raw.github.com/htilly/zenmusic/master/doc/images/Screenshot.png)

## License & Commercial Use

SlackONOS is licensed under the **GNU Affero General Public License v3 (AGPL-3.0-or-later)**.

- You may use, modify and redistribute this software under the terms of the AGPL-3.0 license.
- If you run a modified version as a network service, you must make the corresponding source code available to users.
- Commercial entities that wish to use SlackONOS without AGPL obligations (e.g. closed-source forks or proprietary integrations) may contact the author to discuss **separate commercial licensing**.

See the `LICENSE` file for full details.

## Quick Start

**What You Need:**
1. A Sonos speaker configured with Spotify
2. A Slack bot token **OR** Discord bot token (or both!)
3. A server running Node.js
4. Static IP address for your Sonos speaker
5. Spotify Developer credentials (Client ID & Secret) from https://developer.spotify.com/dashboard/applications

**Docker Installation (Recommended)**

```yaml
services:
  slackonos:
    container_name: slackonos
    image: htilly/slackonos:latest
    restart: unless-stopped
    volumes:
      - /PATH_TO_CONFIG_FOLDER:/app/config
```

📖 **[Complete Discord Setup Guide](DISCORD.md)** - Step-by-step Discord bot configuration

---

## How It Works

SlackONOS is a democratic music bot that gives communities fair control over shared Sonos speakers. Instead of one person controlling the music, everyone can participate through voting and democratic skip features.

**Uses [node-sonos](https://github.com/bencevans/node-sonos) for Sonos control.**

### Platform Support
- ✅ **Slack** - Modern Socket Mode with channel-based admin permissions
- ✅ **Discord** - Full support with role-based admin + emoji reaction voting
- 🎵 **Shared Queue** - Both platforms control the same Sonos speaker simultaneously
- 🗳️ **Cross-Platform Democracy** - Gong and vote systems work across all platforms

### Network Requirements

**Firewall Settings:**
- Server must reach Sonos on port **1400 (TCP)**
- Sonos must have internet access for Spotify streaming
- Recommended: Static IP for Sonos speaker

**Configuration**
You must provide the token of your Slack bot and the IP of your Sonos in either config.json (see config.json.example), as arguments or as environment variables.
Examples:
```bash
node index.js --legacySlackBotToken "MySlackBotToken" --sonos "192.168.0.1"
```
or
```bash
legacySlackBotToken="MySlackBotToken" sonos="192.168.0.1" node index.js
```
You can also provide any of the other variables from config.json.example as arguments or environment variables.
The blacklist can be provided as either an array in config.json, or as a comma-separated string when using arguments or environment variables.

**Channel Configuration (Important for Large Workspaces)**

SlackONOS uses two channels: `adminChannel` (for admin commands) and `standardChannel` (for regular users).

**For workspaces with 100+ channels:** Use channel IDs instead of channel names to avoid Slack API rate limits during startup.

- **Channel names** (default): `"adminChannel": "music-admin"` → Bot scans all channels to find ID (slow, but **auto-upgrades to IDs after first run**)
- **Channel IDs** (recommended): `"adminChannel": "C01ABC123XY"` → Direct lookup (instant)

**🎉 NEW: Auto-save Feature**

If you configure channel names, SlackONOS will automatically update your `config.json` with the discovered IDs after the first successful startup. This means:
- **First startup**: Slow (1-3 minutes in large workspaces)
- **All future startups**: Instant (uses saved IDs)

**Manual Configuration (Optional)**

You can also manually set channel IDs to skip the first slow startup.

**How to find Channel IDs:**
1. In Slack web/desktop, right-click the channel
2. Select "View channel details"
3. Scroll to bottom, copy the Channel ID (format: `C` + 9+ alphanumeric characters)

Example config.json:
```json
{
  "adminChannel": "C01ABC123XY",
  "standardChannel": "C987DEF654",
  ...
}
```

Logo for the bot in #Slack can be found at "doc/images/ZenMusic.png

**⚠️ BREAKING CHANGES (v2.0+)**

**Socket Mode Migration**

As of v2.0, SlackONOS has migrated from the deprecated RTM API to **Socket Mode** for improved reliability and performance. This requires new configuration:

**Required Changes:**
1. **New App-Level Token Required**: You MUST create an app-level token (starts with `xapp-`) in your Slack app settings
2. **Socket Mode Must Be Enabled**: Enable Socket Mode in your Slack app configuration
3. **Updated Configuration**: Both `slackAppToken` (app-level) and `token` (bot token, `xoxb-`) are now required

**Migration Steps:**

1. Go to https://api.slack.com/apps/YOUR_APP_ID/socket-mode
2. Enable Socket Mode
3. Generate an app-level token with `connections:write` scope
4. Add the token to your `config.json`:
   ```json
   {
     "slackAppToken": "xapp-1-A0...",
     "token": "xoxb-123...",
     ...
   }
   ```

**Legacy Bot Token Support**

⚠️ Legacy bot tokens are **deprecated** and no longer supported as of v2.0. You must migrate to Socket Mode.

- Legacy bots can [no longer be created](https://api.slack.com/changelog/2024-09-legacy-custom-bots-classic-apps-deprecation)
- If you were using `legacySlackBotToken`, you must create a new Slack app and configure it with Socket Mode
- The `useLegacyBot` configuration option has been removed

**Architectural Improvements (v2.0)**

SlackONOS v2.0 includes significant architectural improvements:

- **Modular Design**: Slack and Spotify integrations are now separate, clean modules (`slack.js`, `spotify-async.js`)
- **Non-Blocking Operations**: All Spotify API calls use async/await with native `fetch`, eliminating blocking operations
- **Declarative Command Registry**: Commands are defined in a clean, maintainable registry instead of large switch statements
- **Improved Error Handling**: Centralized error handling and logging for better debugging
- **Robust Event Handling**: Better filtering and processing of Slack events
- **Network Resilience**: Increased ping timeouts to handle network latency better

**What can it do?**

### 🤖 AI Natural Language (NEW!)

**Talk to the bot naturally** by mentioning it in Slack or Discord! No need to remember exact commands.

**Examples:**
- `@SlackONOS play the best songs by U2` → Queues U2's top tracks
- `@bot add Forever Young` → Adds the song to queue
- `@SlackONOS what's playing?` → Shows current track
- `@bot skip this terrible song` → Gongs the current track
- `@SlackONOS show me the queue` → Lists all queued tracks

**🎉 Batch Add with Smart Themes (NEW!):**
- `@SlackONOS add some christmas music` → Adds 5 holiday tracks
- `@bot play a few summer hits` → Queues summer beach songs
- `@SlackONOS give me 10 80s classics` → Adds ten 80s hits
- `@bot spela lite partylåtar` → Queues party music (works in Swedish!)

**Quantity Words:**
| Phrase | Tracks Added |
|--------|--------------|
| "a couple", "ett par" | 2 |
| "a few", "några" | 3-4 |
| "some", "lite", "several" | 5 |
| "many", "lots", "massa" | 8 |
| "10", "fifteen", etc. | Exact number |

**Smart Theme Boosters:**
The AI automatically enhances searches based on detected themes:

| Theme | Triggers | Search Enhancement |
|-------|----------|-------------------|
| 🎄 Christmas | `jul`, `xmas`, `christmas` | +christmas holiday |
| 🎉 Party | `party`, `fest`, `dansband` | +party upbeat |
| 😌 Chill | `chill`, `relax`, `lugn`, `mysig` | +chill mellow |
| 💪 Workout | `workout`, `gym`, `träning` | +workout energetic |
| ☀️ Summer | `sommar`, `summer`, `beach` | +summer beach hits |
| 📼 80s | `80s`, `80-tal`, `eighties` | +80s classic hits |
| 💿 90s | `90s`, `90-tal`, `nineties` | +90s classic hits |
| 🎸 Rock | `rock`, `metal` | +rock classic |
| 🎵 Pop | `pop`, `hits` | +pop hits |
| 🕺 Disco | `disco`, `funk` | +disco dance funk |
| 💕 Ballads | `ballad`, `kärleks`, `love` | +ballad love romantic |
| 🎤 Hip-hop | `hip hop`, `rap`, `hiphop` | +hip hop rap hits |
| 🤠 Country | `country`, `nashville` | +country hits |
| 🎷 Jazz | `jazz`, `blues` | +jazz blues classic |
| 🎻 Classical | `klassisk`, `classical`, `opera` | +classical orchestra |
| 🌴 Reggae | `reggae`, `ska`, `caribbean` | +reggae caribbean |
| 🎧 Indie | `indie`, `alternative` | +indie alternative |
| 🔊 EDM | `edm`, `electro`, `house`, `techno` | +electronic dance |
| 💃 Latin | `latin`, `salsa`, `bachata` | +latin dance |
| 🇸🇪 Swedish | `svensk`, `swedish` | +swedish svenska |
| 👶 Kids | `barnlåt`, `kids`, `children` | +children kids |

**Auto-Play Behavior:**
- If music is **playing**: New tracks are added to the queue
- If music is **stopped**: Queue is cleared, tracks added, and playback starts automatically

### 🌟 Seasonal & Venue Themes (NEW!)

The AI automatically knows the current season and can suggest themed music!

**Seasonal Awareness:**
The bot detects the current month and adjusts music suggestions:

| Season | Period | Themes |
|--------|--------|--------|
| 🎄 Winter/Holiday | December - Jan 6 | Christmas, holiday classics |
| 🎃 Halloween | Oct 15-31 | Spooky, horror soundtracks |
| ☀️ Summer | June - August | Beach vibes, feel-good hits |
| 🌸 Spring | March - May | Uplifting, fresh vibes |
| 💕 Valentine's | Feb 10-14 | Love songs, romantic ballads |
| 🍂 Autumn | Sept - Nov (early) | Cozy, acoustic, nostalgic |
| ❄️ Winter | Jan 7+, Feb | Cozy, chill, warming |

**Example:** In December, asking for "add some seasonal music" will automatically queue Christmas tracks!

**Venue/Default Theme:**
Configure a default theme for your venue that subtly influences all bulk music requests:

```
setconfig defaultTheme lounge
setconfig themePercentage 30
```

| Setting | Values | Description |
|---------|--------|-------------|
| `defaultTheme` | `lounge`, `club`, `office`, `cafe`, etc. | Base music style for your venue |
| `themePercentage` | 0-100 | Percentage of tracks matching venue theme |

**How it works:**
When you request "100 christmas songs" with `defaultTheme: lounge` and `themePercentage: 30`:
- ~70 christmas songs (what you asked for)
- ~30 lounge-style tracks (venue atmosphere)

This ensures your venue's vibe is always maintained, even during themed requests!

**How it works:**
- Powered by OpenAI GPT-4o-mini for accurate command parsing
- Understands natural language in multiple languages (Swedish, English, etc.)
- Falls back to regular commands if AI is disabled
- Optional feature - works without AI if no API key is provided

**Setup:**
1. Get an OpenAI API key from https://platform.openai.com/api-keys
2. Add to `config.json`: `"openaiApiKey": "sk-proj-..."`
3. That's it! Start mentioning the bot naturally

**Note:** AI parsing only activates when you @mention the bot with text that doesn't start with a known command. Regular commands (like `add song name`) still work instantly without AI.

---

### Democratic Music Control

**Community Queue Management:**
The bot queues song requests and plays them in order. If enough people dislike the current track, they can use the "**gong**" command to democratically skip it.

### User Commands

**Music Control:**
* `add <song/artist/album>` - Add music to the queue and start playing
* `search <text>` - Search for tracks without adding to queue
* `bestof <artist>` - Queue the top 10 tracks by an artist
* `current` - Show currently playing track with time remaining
* `list` - Display the current queue
* `status` - Show playback status

**Democratic Features:**
* `gong` - Vote to skip the current track (requires multiple votes)
* `vote <track number>` - Vote to move a queued track up in priority
* `gongcheck` - See current gong votes and who voted
* `votecheck` - See current vote counts for tracks
* `volume` - View current volume level

**Discord Emoji Reactions:**
* 🎵 - Vote for a track (click on "Added..." messages)
* 🔔 - Gong/skip a track (click on "Added..." messages)

### Admin Commands

**Queue Management:**
* `flush` - Clear the entire queue
* `next` - Skip to next track immediately
* `previous` - Go back to previous track
* `shuffle` - Shuffle the playlist

**Playback Control:**
* `play` - Resume playback
* `stop` - Stop playback
* `setvolume <number>` - Set volume (0-100)

**System:**
* `blacklist add <@user>` - Prevent user from adding songs
* `blacklist remove <@user>` - Restore user permissions
* `blacklist list` - Show blacklisted users
* `setconfig` - View/change runtime settings (gongLimit, voteLimit, defaultTheme, etc.)
* `configdump` - Show all current configuration values including AI theme context
* `aiunparsed [N]` - Show last N unparsed AI commands (default: 10)
    
---

## Use Cases

**Perfect for:**
- 🏢 **Office Environments** - Democratic music control for shared workspaces
- 🎮 **Discord Communities** - Music bot for gaming servers and communities
- 🏠 **Shared Living Spaces** - Fair queue management for roommates
- 🎉 **Events & Parties** - Let guests control the music democratically
- ☕ **Cafes & Lounges** - Customer-influenced playlists with admin oversight

---

## Installation & Setup

For detailed installation instructions, see the [INSTALL](INSTALL) file.

For Discord-specific setup, see the **[Discord Setup Guide](DISCORD.md)**.

**Wiki:** https://github.com/htilly/zenmusic/wiki

---

## Contributing

Contributions are welcome! Please feel free to submit pull requests, report bugs, or suggest features.

**Development:**
- Run tests: `npm test`
- Docker build: `docker build -t slackonos .`
- See [TESTING.md](TESTING.md) for test workflow information

---

## OpenAI Debugging

Use this section to quickly diagnose AI-related issues.

- **Enable/Disable AI:** Set `openaiApiKey` in `config/config.json`. Remove it to disable AI (direct commands still work).
- **Startup Validation:** On boot, the bot validates the API key by sending a tiny request.
  - ✅ `AI natural language parsing enabled with OpenAI (API key validated)`
  - ❌ `Invalid OpenAI API key format - must start with "sk-"`
  - ❌ `OpenAI API key is invalid or unauthorized (401)`
  - ❌ `OpenAI API quota exceeded (429)` → Check billing: https://platform.openai.com/account/billing
  - ❌ `Cannot connect to OpenAI API` → Network/connectivity
- **Runtime Errors:**
  - `AI parsing error: 429 ... quota exceeded` → AI disabled automatically; bot continues with direct commands
  - `AI parsing returned null` → Low confidence or API failure; try clearer phrasing or use direct command
- **Logs to look for:**
  - `Incoming MENTION from ...` → Message routed to AI parser
  - `✨ AI parsed: "..." → add [...]/bestof [...] (95%)` → Parsed successfully
  - `AI add: applied boosters [christmas holiday] → query "..."` → Theme detected and search enhanced
  - `AI add: deduplicated 50 → 32 unique, selecting top 5` → Duplicates filtered out
  - `AI add: current state = stopped` → Auto-play mode activated
  - `AI disabled, falling back to standard processing` → No key or validation failed
- **Admin Commands:**
  - `aiunparsed` - View recent commands that AI couldn't parse (useful for training/debugging)
  - `configdump` - View all current config values including AI settings
- **Common Pitfalls:**
  - Duplicate handling in Slack: we ignore `message` events containing `<@bot>` and only process `app_mention` to prevent doubles.
  - Natural language like `"One med U2"` is sanitized to `"One U2"` to improve Spotify matching.
  - Batch-add deduplicates tracks by normalized name (removes "- Single Edit", "Remaster", etc.)
- **Cost Notes:** Uses GPT-4o-mini; typical requests are very cheap (~$0.0001/request). Direct commands never call AI.

---

## Keywords

Discord music bot, Slack music bot, Sonos Discord integration, democratic music voting, office music bot, Spotify Discord controller, Sonos Slack bot, community music control, democratic skip, vote-to-play, gaming server music, shared speaker control

---

**Feedback Welcome!**

Please drop a comment or send a PM if you use this bot! Contributions and improvements are much appreciated!


**KnownBugs**

~~* Validate add / unique track doesn´t work. I.e - You can add same track 10 times in a row.~~
~~* Vote does not move track in queue.~~
 
**ToDo**

* Code cleaning! =)
* Simple "view" window of what is happening in the channel. I.e. - Put on big-screen of what is happening in #music
* Backend DB
* Text-to-speech. 
* Now playing. Announce when starting a new song.
* When asking for "Stat" show most played songs and most active users.
* When local playlist is empty -> fallback and start playing "$playlist", i.e. Spotify topp 100.
* Limit consecutive song additions by non-admin
* Delete range of songs from queue
* Implement some code-testing

**DONE**
* Vote to flush entire queue
* New vote system including votecheck
* Restrict songs already in the queue
* Now works with latest async version of node-sonos.
* Add spotify playlist
* Added "bestof" - Add the topp 10 tracks by selected artist.
* Added gongcheck - Thanks to "Warren Harding"
* Added blacklist function. Enter usernames in "blacklist.txt".
* Updated 'node-sonos' with getQueue and addSpotify. See: https://github.com/bencevans/node-sonos/commit/bfb995610c8aa20bda09e370b0f5d31ba0caa6a0
* Added new function, search.
* Added new function, Append. Reuse the old queue and add new track to the end of it.
* Admin: Delete entire queue.
* Regularly delete the entries from the queue when the song has been played.
   * When adding a new track, do the following logic:
        * Check "status". (fixed.. sort of..)   
        * If "playing", do a "list". Delete all songs in the queue with lower number than the current track. Then add song to queue.
        * If "sleep" clear queue, add song to queue and do "play".
* Add clear-queue functionality.
* Fix queue function.
* Fix GONG function. If X Gongs within X sec then next.
* Admin commands from i.e."swe-music-admin".
* Vote - If +1 in slack then move in queue. (sort of)
* Ask "what is playing".
* 
