# Discord App Directory Media Requirements

Visual assets required for Discord App Directory submission.

## Overview

Discord requires 1-5 media items (images or videos) showcasing your bot's features. These appear in the Discovery carousel and on your app's directory page.

## Required Screenshots (1-5 items)

### 1. Bot in Action - Discord Channel
**Purpose:** Show the bot responding to commands in a real Discord channel

**What to include:**
- Discord channel with SlackONOS responding to music commands
- Show commands like: `add Foo Fighters - Best of You`, `queue`, `nowplaying`
- Display queue with track titles and artists
- Include both user messages and bot responses
- Show natural flow of conversation

**Setup:**
1. Create a test Discord server
2. Add SlackONOS bot
3. Run commands: `add [track]`, `queue`, `nowplaying`
4. Take screenshot showing interaction

**Recommended size:** 1920x1080 or 1280x720

---

### 2. Emoji Voting System
**Purpose:** Demonstrate the democratic voting feature with emoji reactions

**What to include:**
- Message showing "Added track to queue" with emoji reactions
- Show 🎵 (music note) reactions for voting tracks up
- Show 🔔 (bell) reactions for gonging/skipping
- Display vote counts next to emojis
- Show ⭐ (star) on tracks with active votes in queue

**Setup:**
1. Add a track: `add Coldplay - Fix You`
2. React to the confirmation message with 🎵 emoji (multiple times from different accounts if possible)
3. Run `queue` command to show starred track
4. Take screenshot showing both reactions and queue

**Recommended size:** 1920x1080 or 1280x720

---

### 3. Admin Commands via DM
**Purpose:** Show admin-specific commands and Direct Message feature

**What to include:**
- Discord DM window showing admin help text
- Commands like: `flush`, `setvolume`, `debug`, `setconfig`
- Show that sensitive commands are sent privately
- Display clean, organized help message formatting

**Setup:**
1. Have DJ/Admin role assigned
2. Run `help` command in channel
3. Open DM from bot showing admin commands
4. Take screenshot of DM window with admin help

**Recommended size:** 1920x1080 or 1280x720

---

### 4. Web Admin Panel - Discord Settings
**Purpose:** Show the beautiful web interface for configuration

**What to include:**
- Admin panel at https://localhost:8443/admin
- Discord settings section visible at top
- Show fields: Discord Token, Discord Channels, Discord Admin Roles
- Display other settings (Spotify, Sonos) below
- Show clean, modern UI design

**Setup:**
1. Start SlackONOS
2. Navigate to https://localhost:8443/admin
3. Login with admin credentials
4. Scroll to show Discord settings
5. Take screenshot of admin panel

**Recommended size:** 1920x1080 or 1280x720

---

### 5. Now Playing with Vote Stars
**Purpose:** Show active queue management with democratic voting

**What to include:**
- `nowplaying` command output showing current track
- `queue` output showing multiple tracks
- Tracks with ⭐ stars indicating active votes
- Show vote counts (e.g., "⭐ 3 votes")
- Display track progress and playback status

**Setup:**
1. Add several tracks to queue
2. Vote on some tracks using 🎵 reactions
3. Start playback
4. Run `nowplaying` and `queue` commands
5. Take screenshot showing voted tracks with stars

**Recommended size:** 1920x1080 or 1280x720

---

## Video Option (Alternative to Screenshots)

**Length:** 30-60 seconds
**Format:** MP4, WebM, or MOV
**Resolution:** 1920x1080 (Full HD)

**Suggested Flow:**
1. **Intro (5s):** Show Discord server with SlackONOS bot
2. **Search & Add (10s):** Run `search Foo Fighters` → show results → `add 1`
3. **Voting (10s):** React with 🎵 emoji → show vote count increase
4. **Queue (10s):** Run `queue` command → show starred tracks
5. **Playback (10s):** Run `play` → show `nowplaying` with track info
6. **Gong (10s):** React with 🔔 emoji → show track skip
7. **Outro (5s):** Show bot name and feature highlights

---

## Screenshot Tips

### Composition
- **Clean Discord UI:** Hide unnecessary Discord elements (collapse member list if distracting)
- **Readable Text:** Ensure font size is large enough to read at thumbnail size
- **Contrast:** Use Discord dark theme for better contrast
- **Focus:** Highlight the relevant part of the screen (bot interaction area)

### Content
- **Real Data:** Use real song names, not test data (e.g., "Foo Fighters - Best of You", not "Test Track 1")
- **Realistic Usage:** Show how real users would interact
- **Clean Channel:** Remove any unrelated messages or spam
- **Professional Names:** Use appropriate server/channel names (e.g., "Music Room", not "Test Server 123")

### Technical
- **Resolution:** Minimum 1280x720, recommended 1920x1080
- **Format:** PNG or JPEG
- **File Size:** Under 10MB per image
- **Aspect Ratio:** 16:9 preferred

---

## Screenshot Tools

### Windows
- **Windows + Shift + S:** Snipping Tool (built-in)
- **ShareX:** Advanced screenshot tool with annotations
- **Greenshot:** Free screenshot tool

### macOS
- **Cmd + Shift + 4:** Screenshot selection (built-in)
- **Cmd + Shift + 5:** Screenshot with options (built-in)
- **CleanShot X:** Professional screenshot tool

### Linux
- **Flameshot:** Feature-rich screenshot tool
- **Spectacle:** KDE screenshot utility
- **GNOME Screenshot:** Built-in GNOME tool

### Discord-Specific
- **Lightshot:** Discord-friendly screenshot tool
- **Discord Screenshot:** Ctrl/Cmd + Shift + X (built-in, limited)

---

## Annotation & Editing

Consider adding annotations to clarify features:

### Arrows & Callouts
- Point to emoji reactions: "Vote with 🎵"
- Highlight vote counts: "3 users voted"
- Point to starred tracks: "Most voted track"

### Text Labels
- Label admin commands: "Admin-only commands"
- Explain features: "Democratic voting system"
- Highlight unique features: "AI natural language"

### Recommended Tools
- **Figma:** Free, browser-based design tool
- **Canva:** Easy annotation and text overlay
- **GIMP:** Free Photoshop alternative
- **Photoshop:** Professional editing (paid)

---

## Media Carousel Descriptions

When uploading to Discord Developer Portal, add descriptions for each image:

### Screenshot 1: Bot in Action
"Add music to the queue with simple commands or natural language. SlackONOS understands 'play Best of You by Foo Fighters' and finds it on Spotify."

### Screenshot 2: Emoji Voting
"Vote tracks up with 🎵 reactions or skip with 🔔. The most popular songs play first - true music democracy!"

### Screenshot 3: Admin DM
"Admins get advanced controls via Direct Message: flush queue, adjust volume, manage settings - without cluttering the channel."

### Screenshot 4: Web Admin Panel
"Configure everything through a beautiful web interface. Set up Discord, Slack, Sonos, and Spotify in minutes."

### Screenshot 5: Queue with Votes
"See what's playing and what's next. Stars show which tracks have votes, making the queue transparent and fair."

---

## Before Submission Checklist

- [ ] All screenshots are minimum 1280x720 resolution
- [ ] Images are under 10MB each
- [ ] No personal information visible (real names, emails, IPs)
- [ ] No inappropriate content in any messages
- [ ] Bot name clearly visible (SlackONOS)
- [ ] Commands and features are clear and understandable
- [ ] Discord UI is clean and professional
- [ ] Real music tracks used (not "Test Track 1")
- [ ] Captions written for each image
- [ ] Images demonstrate unique features (voting, AI, multi-platform)

---

## Alternative: Use Existing Screenshots

If you already have screenshots from the main README, consider:
- Adapting Slack screenshots to Discord (similar UI patterns)
- Creating Discord versions of existing screenshots
- Using setup wizard screenshots (platform-agnostic)

**Note:** Discord App Directory reviewers prefer seeing the bot IN DISCORD, not just configuration screens.

---

## Quick Start Guide

**Fastest way to get all 5 screenshots:**

1. **Setup (10 min):**
   - Create test Discord server
   - Add SlackONOS bot
   - Invite 1-2 friends to help with voting (or use alt accounts)

2. **Screenshot 1-2 (5 min):**
   - Add tracks: `add Foo Fighters - Best of You`
   - React with 🎵
   - Run `queue`
   - Take screenshots

3. **Screenshot 3 (2 min):**
   - Run `help` as admin
   - Open DM
   - Screenshot admin help

4. **Screenshot 4 (2 min):**
   - Open https://localhost:8443/admin
   - Screenshot Discord settings section

5. **Screenshot 5 (2 min):**
   - Run `nowplaying` and `queue`
   - Screenshot showing stars and votes

**Total time:** ~20 minutes

---

## Need Help?

- Check existing screenshots in `docs/images/` for inspiration
- Ask in support server for feedback on screenshots
- Review Discord's [App Directory Guidelines](https://discord.com/developers/docs/game-and-server-management/app-directory-guidelines)
- Look at approved bots in App Directory for examples

