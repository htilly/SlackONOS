# Discord Support Server Setup Guide

This guide will help you create and configure a public Discord support server for SlackONOS.

## Why a Support Server?

Discord App Directory requires a support server where users can:
- Get help setting up and using SlackONOS
- Report bugs and issues
- Share configurations and tips
- Connect with other users
- Receive updates and announcements

## Creating the Server

### Step 1: Create New Server

1. Open Discord
2. Click the **+** button in the server list (left sidebar)
3. Select **Create My Own**
4. Choose **For a community**
5. Name your server: **SlackONOS Community** (or similar)
6. Upload server icon (optional: use `docs/images/SlackONOS-Icon.jpg`)

### Step 2: Enable Community Features

1. Go to **Server Settings** → **Enable Community**
2. Read and accept Discord's Community Guidelines
3. Set **Default Notification Settings** to **Only @mentions**
4. Set **Explicit Media Content Filter** to **Scan media from all members**
5. Complete the community setup wizard

### Step 3: Create Channels

Create the following channels:

#### Text Channels

**📋 Information Category:**
- **#welcome** - Welcome message and getting started guide
- **#announcements** - Release updates and important news (admin-only posting)
- **#rules** - Server rules and code of conduct

**💬 Support Category:**
- **#support** - General help and troubleshooting
- **#setup-help** - Installation and configuration assistance
- **#slack-specific** - Slack platform questions
- **#discord-specific** - Discord platform questions

**🎨 Community Category:**
- **#showcase** - Share your SlackONOS setup and configurations
- **#feedback** - Feature requests and suggestions
- **#off-topic** - General chat and music discussions

**🔧 Development Category (Optional):**
- **#bug-reports** - Report bugs and issues
- **#pull-requests** - Discuss code contributions
- **#beta-testing** - Test new features

#### Voice Channels (Optional)

- **🎵 Music Testing** - Test your SlackONOS setup with others
- **🎤 Support Voice** - Live troubleshooting sessions

### Step 4: Set Up Roles

Create the following roles:

#### @Admin
- **Color:** Red (#FF0000)
- **Permissions:** Administrator
- **Purpose:** Server administrators and bot maintainers

#### @Moderator
- **Color:** Orange (#FFA500)
- **Permissions:** Manage Messages, Kick Members, Mute Members
- **Purpose:** Help moderate the community

#### @Contributor
- **Color:** Purple (#9B59B6)
- **Purpose:** Code contributors and active helpers

#### @Verified
- **Color:** Green (#2ECC71)
- **Purpose:** Verified users (use Discord's verification system)

### Step 5: Configure Auto-Moderation

1. Go to **Server Settings** → **AutoMod**
2. Enable **Block Profanity**
3. Enable **Block Mention Spam** (5 mentions in 10 seconds)
4. Create custom rule: **Block Common Bot Spam Phrases**
   - Add keywords: "discord.gg/", "free nitro", "boost server"

### Step 6: Set Up Welcome Screen

1. Go to **Server Settings** → **Welcome Screen**
2. Enable Welcome Screen
3. Set welcome message:

```
Welcome to SlackONOS Community! 🎵

Get help setting up your democratic music bot for Discord and Slack.

Start here:
• Read #rules and #welcome
• Need help? Ask in #support
• Share your setup in #showcase
• Report bugs in #bug-reports
```

4. Add recommended channels:
   - #welcome
   - #rules
   - #support
   - #showcase

## Channel Setup

### #welcome Channel

Pin this message:

```markdown
# Welcome to SlackONOS Community! 🎵

**What is SlackONOS?**
SlackONOS is a democratic music bot that lets communities control Sonos speakers through Discord or Slack. Vote on tracks, gong unwanted songs, and let everyone have a voice in the playlist!

**🚀 Getting Started**
1. Read the installation guide: https://github.com/htilly/SlackONOS#readme
2. Check out the Discord setup: https://github.com/htilly/SlackONOS/blob/master/docs/DISCORD.md
3. Need help? Ask in #support
4. Found a bug? Report in #bug-reports

**✨ Key Features**
• 🗳️ Democratic voting with emoji reactions
• 🔔 Community skip (gong) system
• 🤖 AI natural language commands
• 🎶 Spotify integration
• 🎯 Role-based permissions
• 👥 Multi-platform (Discord + Slack)

**📚 Resources**
• GitHub: https://github.com/htilly/SlackONOS
• Documentation: https://github.com/htilly/SlackONOS/tree/master/docs
• Issues: https://github.com/htilly/SlackONOS/issues

**💡 Need Help?**
Head to #support and tell us:
• What you're trying to do
• What error you're seeing
• Your platform (Discord/Slack/both)
• Your setup (Docker/Node.js/PM2)

Let's make music democratic! 🎉
```

### #rules Channel

Pin this message:

```markdown
# Server Rules 📜

**1. Be Respectful**
Treat everyone with respect. No harassment, hate speech, or personal attacks.

**2. Stay On Topic**
Keep discussions related to SlackONOS in appropriate channels. Use #off-topic for general chat.

**3. No Spam**
Don't spam messages, mentions, or links. This includes self-promotion and advertising.

**4. Get Help Properly**
• Use #support for questions
• Provide context (error messages, logs, setup details)
• Don't DM moderators unless asked
• Search existing messages before asking

**5. Report Issues on GitHub**
For bug reports and feature requests, use GitHub Issues: https://github.com/htilly/SlackONOS/issues

**6. Respect Privacy**
Don't share others' private information, API keys, or credentials.

**7. Follow Discord ToS**
Comply with Discord's Terms of Service and Community Guidelines.

**Consequences**
Violations may result in warnings, mutes, kicks, or bans depending on severity.

Questions? Ask in #support or contact @Admin.
```

### #announcements Channel

Pin this initial message:

```markdown
# 📣 Announcements

**Latest Release: v2.2.0**

New features:
• Discord Direct Message for admin help
• Improved Spotify search relevance
• Crossfade enabled by default
• Better vote tracking after queue reordering

**How to Update**
Docker:
`docker pull htilly/slackonos:latest`

Source:
`git pull && npm install`

**Stay Updated**
• Watch GitHub: https://github.com/htilly/SlackONOS
• Check releases: https://github.com/htilly/SlackONOS/releases
• Join this server for announcements

---

**Previous announcements below** ⬇️
```

### #support Channel

Pin this message:

```markdown
# Support Guidelines 🆘

**Before Asking**
1. Check the README: https://github.com/htilly/SlackONOS#readme
2. Search this channel for similar issues
3. Review docs: https://github.com/htilly/SlackONOS/tree/master/docs

**When Asking for Help**
Include:
• **Platform:** Discord, Slack, or both?
• **Setup:** Docker, PM2, or direct Node.js?
• **Problem:** What's not working?
• **Error:** Any error messages? (use \`\`\` code blocks)
• **Config:** Relevant config (redact tokens!)
• **Logs:** Recent log output (use https://pastebin.com for long logs)

**Example Good Question:**
> I'm running SlackONOS on Docker for Discord. When I try to add a track with `add Foo Fighters`, the bot responds but nothing is added to the queue. Logs show:
> ```
> [ERROR] Failed to queue track: Sonos device not reachable
> ```
> My Sonos IP is 192.168.1.100 and it's powered on. Any ideas?

**Example Bad Question:**
> Bot doesn't work help

**Response Times**
This is a community server. Please be patient - responses may take hours or days depending on volunteer availability.

**Need Immediate Help?**
Check GitHub Discussions: https://github.com/htilly/SlackONOS/discussions
```

## Server Settings

### Verification Level
**Settings** → **Moderation** → **Verification Level: Medium**
- Requires verified email
- Prevents spam bots

### Server Boost
Encourage boosting for perks:
- Better audio quality (if using voice)
- Custom server banner
- More emoji slots

## Create Permanent Invite Link

1. Click server name → **Invite People**
2. Click **Edit invite link**
3. Set **Expire After:** Never
4. Set **Max Number of Uses:** No limit
5. Copy the invite link

**Save this URL** - you'll need it for Discord App Directory submission!

Example: `https://discord.gg/abc123xyz`

## Bot Setup (Optional)

Consider adding utility bots:
- **MEE6** - Auto-moderation and leveling
- **Dyno** - Advanced moderation tools
- **Carl-bot** - Reaction roles and logging

## Moderation Best Practices

### Daily Tasks
- Monitor #support for new questions
- Check AutoMod logs
- Remove spam/inappropriate content
- Welcome new members

### Weekly Tasks
- Review feedback in #feedback
- Update #announcements with news
- Check for outdated pinned messages

### Monthly Tasks
- Review server rules and guidelines
- Analyze server insights (engagement, growth)
- Plan community events (if applicable)

## Community Engagement

### Regular Activities
- **Monthly updates:** Post release notes in #announcements
- **Showcase Saturday:** Encourage users to share setups
- **Feature Friday:** Highlight lesser-known features
- **Bug bounty:** Recognize users who report good bugs

### Recognition
Create custom emojis for:
- `:slackonos:` - SlackONOS logo
- `:vote:` - For voting discussions
- `:gong:` - For skip/gong discussions
- `:helper:` - Award to helpful community members

## Metrics to Track

Monitor server health:
- **Member count:** Growth rate
- **Active users:** Daily/weekly active
- **Support tickets:** Volume and resolution time
- **Engagement:** Messages per day
- **Retention:** Members leaving vs. joining

## Support Server URL

Once created, add your permanent invite link to:
1. Discord App Directory submission
2. README.md on GitHub
3. Privacy Policy and Terms of Service
4. Website (if applicable)

## Maintenance

### Regular Updates
- Keep #announcements current
- Update pinned messages with new info
- Archive old channels if needed
- Refresh rules based on community needs

### Seasonal Events
- Holiday themes (Christmas, Halloween)
- Anniversary celebrations
- Milestone recognition (1000 members, etc.)

## Troubleshooting

### Low Engagement?
- Post regular content in #announcements
- Ask questions in #feedback
- Share interesting setups in #showcase
- Be active yourself - lead by example

### Too Much Spam?
- Increase verification level
- Enable more AutoMod rules
- Add moderators
- Use Discord's built-in verification

### Toxic Behavior?
- Enforce rules consistently
- Use warnings before bans
- Document incidents
- Communicate clearly with offenders

## Next Steps

After server creation:
1. ✅ Create all channels and categories
2. ✅ Set up roles and permissions
3. ✅ Configure AutoMod
4. ✅ Write welcome and rules
5. ✅ Create permanent invite link
6. ✅ Add invite to App Directory submission
7. ✅ Announce server on GitHub
8. ✅ Invite initial moderators

## Resources

- [Discord Community Server Setup](https://support.discord.com/hc/en-us/articles/360047132851-Enabling-Your-Community-Server)
- [Discord Moderation Guide](https://discord.com/moderation)
- [Discord Server Templates](https://discord.com/templates)
- [Community Building Best Practices](https://discord.com/community)

---

**Questions?**
Open an issue: https://github.com/htilly/SlackONOS/issues

