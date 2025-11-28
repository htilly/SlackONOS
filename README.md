[![Build Status](https://github.com/htilly/zenmusic/workflows/Node.js%20CI/badge.svg)](https://github.com/htilly/zenmusic/actions?query=workflow%3A%22Node.js+CI%22)
[![Known Vulnerabilities](https://snyk.io/test/github/htilly/zenmusic/badge.svg)](https://snyk.io/test/github/htilly/zenmusic)


# SlackONOS
**Slack / Sonos / Spotify / Node.js - Control Sonos through #Slack**


*Screenshot*

![ScreenShot](http://raw.github.com/htilly/zenmusic/master/doc/images/Screenshot.png)



(&#x1F534;) *** config.json MUST be moved to config folder.*** (&#x1F534;)

**What is it?**

It´s a #slack-bot that control Sonos (and spotify). Highly democratic bot :)
Uses https://github.com/bencevans/node-sonos to controll Sonos.

**What do I need in order to get it to work?**

1: A Sonos player (configured with Spotify).  
2: A slack-bot configured in #Slack  
3: A server running node.js  
4: Know the IP of your Sonos. Preferably a static one.  
5: A valid spotify account with Client ID & Client Secret. Head over to:   https://developer.spotify.com/dashboard/applications to set it up. Enter the data in the config.json file.  

**Installation**

DOCKER COMPOSE

(you must point to the config.json, example can be found [here](https://github.com/htilly/zenmusic/blob/master/config/config.json.example))

```
services:
slackonos:
  container_name: slackonos
  image: htilly/slackonos:latest
  restart: unless-stopped
  volumes:
    - /PATH_TO_CONFIG_FILE_FOLDER:/app/config
```


**Firewall settings**

Server running the index.js needs to be able to talk to the Sonos on port 1400 (TCP)
Sonos needs to be configured and setup with Spotify and have access to internet.


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

It will queue you requests and play it..  However if X amount of people for any strange reason doesn't like the current track, it will listen to the command "**gong**" and eventually skip to the next track.

It also future some admin commands like "setvolume", "next", "stop" etc.

List of commands (just type help in the channel)

* `help` : this list 
* `current` : list current track
* `search` _text_ : search for a track, does NOT add it to the queue
* `add` _text_ : Add song to the queue and start playing if idle.
* `append` _text_ : Append a song to the previous playlist and start playing the same list again.
* `gong` : The current track is bad! Vote for skipping this track
* `gongcheck` : How many gong votes there are currently, as well as who has GONGED.
* `vote` _exactSongTitle_ : Vote for a specific song title in the queue.
* `volume` : view current volume
* `list` : list current queue
* `status` : show the current status

**ADMIN FUNCTIONS**

* `flush` : flush the current queue
* `setvolume` _number_ : sets volume
* `play` : play track
* `stop` : stop life
* `next` : play next track
* `previous` : play previous track
* `shuffle` : shuffles playlist
    
**Info**

Please use it to get some music in the office / home. 

We would appreciate if you drop a comment or send a pm... and please feel free to add / change stuff!! Much appreciated!

**Installation**

For installation, see the file INSTALL.

Or have a look at the Wiki.
https://github.com/htilly/zenmusic/wiki


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
