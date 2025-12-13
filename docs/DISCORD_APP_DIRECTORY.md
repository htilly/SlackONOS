# Discord App Directory Submission Guide

Guide for preparing SlackONOS for submission to the Discord App Directory.

## Overview

The Discord App Directory allows users to discover and install SlackONOS directly from Discord, making distribution much easier. Unlike Slack, Discord does **NOT** require OAuth redirect URLs or public endpoints, making it much simpler for self-hosted bots.

## Requirements

### Technical Requirements

1. **Bot Verification** ✅
   - Bot must be verified by Discord
   - Requires 75+ servers OR application for verification
   - Verification process: https://discord.com/developers/verification

2. **Bot Token** ✅
   - Already implemented - Discord uses direct bot tokens
   - No OAuth flow required (unlike Slack)
   - No public redirect URLs needed

3. **Bot Permissions** ✅
   - Already configured correctly:
     - Send Messages
     - Read Messages/View Channels
     - Read Message History
     - Add Reactions

4. **Privileged Gateway Intents** ✅
   - Message Content Intent (already enabled)
   - Server Members Intent (optional, for role-based permissions)

### Content Requirements

1. **Support Server** (REQUIRED)
   - Must be a Discord Community Server
   - Users can get support there
   - Must be set up before submission

2. **Media Carousel** (Optional but Recommended)
   - Up to 5 images or videos
   - Showcase bot functionality
   - Screenshots of setup wizard, bot in action, etc.

3. **External Links** (Optional)
   - Website, GitHub, social media
   - Documentation links

4. **Language Support**
   - List all supported languages
   - Currently: English (primary)

5. **Application Description** (REQUIRED)
   - Detailed description of functionality
   - Benefits for users
   - Feature highlights

6. **Privacy Policy** (REQUIRED)
   - Publicly accessible
   - Link from Developer Portal
   - Already exists: `docs/PRIVACY_POLICY.md`

7. **Terms of Service** (REQUIRED)
   - Publicly accessible
   - Link from Developer Portal
   - Already exists: `docs/TERMS_OF_SERVICE.md`

8. **Content Requirements**
   - Follow Discord Content Policy
   - No age-restricted content
   - No explicit material, violence, illegal goods, or gambling

## Current Status

### ✅ Already Implemented

- Bot token authentication (no OAuth needed)
- Required bot permissions
- Message Content Intent
- Privacy Policy (`docs/PRIVACY_POLICY.md`)
- Terms of Service (`docs/TERMS_OF_SERVICE.md`)
- Multi-platform support (Slack + Discord)
- Role-based permissions
- Community voting system

### ⚠️ Needs Preparation

- Bot verification (if <75 servers)
- Support server setup (Discord Community Server)
- Discovery profile completion
- Media carousel (screenshots/videos)
- Application description for Discovery

## Implementation Steps

### 1. Verify Your Bot

**If you have 75+ servers:**
- Verification is automatic
- Go to Developer Portal → Your App → Verification

**If you have <75 servers:**
1. Go to https://discord.com/developers/applications
2. Select your SlackONOS application
3. Go to "Verification" section
4. Click "Apply for Verification"
5. Fill out the verification form:
   - Bot description
   - Use case
   - Server count
   - Privacy policy URL
   - Terms of service URL
6. Wait for Discord review (typically 1-2 weeks)

### 2. Create Support Server

1. Create a new Discord server
2. Enable Community features:
   - Server Settings → Enable Community
   - Set up rules channel
   - Set up guidelines channel
3. Create support channels:
   - `#support` - General support
   - `#setup-help` - Setup assistance
   - `#bug-reports` - Bug reports
   - `#feature-requests` - Feature suggestions
4. Invite your bot to the server
5. Set appropriate permissions for bot

### 3. Prepare Discovery Profile

Go to Developer Portal → Your App → Discovery

**Required Fields:**

1. **Support Server**
   - Link to your Community Server
   - Must be set up as Community Server

2. **Application Description**
   ```
   SlackONOS is a democratic music bot that lets teams control Sonos speakers 
   through Discord and Slack. Features include:
   
   • Community voting system - Let your team decide what plays next
   • Democratic skip tracking - Vote to skip tracks with the "gong" system
   • Spotify integration - Search and queue tracks, albums, and playlists
   • AI-powered natural language - Talk naturally: "play the best songs by Queen"
   • Multi-platform support - Works with both Discord and Slack simultaneously
   • Role-based permissions - Admin controls for volume, queue, and playback
   • Soundcraft mixer integration - Control mixer volume from chat
   • Modern web interface - Beautiful setup wizard and admin panel
   
   Perfect for offices, shared spaces, gaming communities, and music lovers 
   who want fair queue control. Self-hosted for complete privacy and control.
   ```

**Optional Fields:**

3. **Media Carousel**
   - Screenshot 1: Setup wizard welcome screen
   - Screenshot 2: Bot in action (Discord channel)
   - Screenshot 3: Queue management
   - Screenshot 4: Voting interface
   - Screenshot 5: Admin panel

4. **External Links**
   - GitHub: https://github.com/htilly/SlackONOS
   - Documentation: Link to README or docs
   - Website (if available)

5. **Language Support**
   - English (primary)
   - Add more languages as they're added

### 4. Update Privacy Policy & Terms

Ensure both documents are:
- ✅ Publicly accessible (hosted on GitHub or website)
- ✅ Have correct "Last Updated" dates
- ✅ Include GitHub repository links
- ✅ Are linked from Developer Portal

**Privacy Policy URL:**
```
https://github.com/htilly/SlackONOS/blob/develop/docs/PRIVACY_POLICY.md
```

**Terms of Service URL:**
```
https://github.com/htilly/SlackONOS/blob/develop/docs/TERMS_OF_SERVICE.md
```

### 5. Enable Discovery

1. Go to Developer Portal → Your App → Discovery
2. Fill in all required fields
3. Review all information
4. Click "Enable Discovery"
5. Bot will appear in Discord App Directory

## Application Description Template

**Short Description (for listing):**
```
Democratic music bot for Sonos speakers with community voting
```

**Full Description (for Discovery profile):**
```
SlackONOS is a self-hosted music bot that lets teams control Sonos speakers 
through Discord and Slack with democratic voting. Perfect for offices, shared 
spaces, and music lovers who want fair queue control.

Key Features:
• Community voting - Team decides what plays next
• Democratic skip tracking - Vote to skip tracks
• Spotify integration - Search and queue music
• AI natural language - Talk naturally to the bot
• Multi-platform - Works with Discord and Slack
• Role-based permissions - Admin controls
• Soundcraft mixer support - Control mixer volume
• Modern web interface - Easy setup and admin panel

Self-hosted for complete privacy and control. Open source under AGPL-3.0.
```

## Screenshots Needed

1. **Setup Wizard** - Welcome screen showing platform selection
2. **Bot in Action** - Discord channel with bot responding to commands
3. **Queue Management** - List of queued tracks with voting
4. **Voting Interface** - Users voting on tracks
5. **Admin Panel** - Web interface showing configuration

**Screenshot Guidelines:**
- Minimum 1280x720 resolution
- Show real functionality, not mockups
- Include Discord UI in screenshots
- Highlight key features

## Checklist

### Pre-Submission

- [ ] Bot is verified (or verification application submitted)
- [ ] Support server created and configured as Community Server
- [ ] Privacy Policy is publicly accessible and up-to-date
- [ ] Terms of Service is publicly accessible and up-to-date
- [ ] All required bot permissions are configured
- [ ] Message Content Intent is enabled
- [ ] Bot works correctly in test servers

### Discovery Profile

- [ ] Support server link added
- [ ] Application description completed
- [ ] Media carousel prepared (5 images/videos)
- [ ] External links added (GitHub, docs, etc.)
- [ ] Language support listed
- [ ] Privacy Policy URL added
- [ ] Terms of Service URL added

### Content Review

- [ ] Description follows Discord Content Policy
- [ ] No age-restricted content
- [ ] Screenshots are appropriate
- [ ] All links work correctly
- [ ] Support server is active and helpful

### Final Steps

- [ ] Review all information in Discovery profile
- [ ] Test bot in multiple servers
- [ ] Ensure bot is stable and responsive
- [ ] Click "Enable Discovery"
- [ ] Monitor for any issues after going live

## Advantages Over Slack App Directory

Discord App Directory is **much simpler** for self-hosted bots:

| Feature | Discord | Slack |
|---------|---------|-------|
| OAuth Redirect URL | ❌ Not required | ✅ Required |
| Public Endpoints | ❌ Not required | ✅ Required |
| Tunnel Service | ❌ Not needed | ✅ Needed |
| Bot Token | ✅ Direct token | ✅ Socket Mode token |
| Setup Complexity | ✅ Simple | ⚠️ Complex |

## Resources

- [Discord App Directory Guidelines](https://support-dev.discord.com/hc/articles/6378525413143)
- [Discord Content Requirements](https://support-dev.discord.com/hc/en-us/articles/9489299950487)
- [Discord Verification Process](https://discord.com/developers/verification)
- [Discord Developer Portal](https://discord.com/developers/applications)

## Notes

- Discord App Directory is much easier than Slack for self-hosted bots
- No OAuth flow or public URLs needed
- Bot verification is the main requirement
- Support server must be a Community Server
- All content must follow Discord's Content Policy

## Next Steps

1. ✅ Research requirements (this document)
2. ⏳ Verify bot (if needed)
3. ⏳ Create support server
4. ⏳ Prepare Discovery profile content
5. ⏳ Update Privacy Policy and Terms with correct dates/links
6. ⏳ Create screenshots/media carousel
7. ⏳ Fill in Discovery profile
8. ⏳ Enable Discovery
9. ⏳ Monitor and respond to user feedback


