# Discord App Directory Submission Checklist

Complete checklist for submitting SlackONOS to the Discord App Directory.

## Pre-Submission Requirements

### ✅ Technical Requirements

#### Bot Configuration
- [ ] **Discord bot created** in Discord Developer Portal
- [ ] **Bot token** generated and tested
- [ ] **Client ID** noted for invite URL
- [ ] **Gateway Intents** configured:
  - [ ] Guilds (Standard) - Enabled
  - [ ] Guild Messages (Standard) - Enabled
  - [ ] Message Content (Privileged) - Enabled AND approved
  - [ ] Guild Message Reactions (Standard) - Enabled
- [ ] **Bot permissions** calculated: `274878024768`
- [ ] **Scopes** configured: `bot` and `applications.commands`

#### Bot Testing
- [ ] Bot successfully connects to Discord
- [ ] Bot responds to commands in test server
- [ ] Emoji reactions work (🎵 vote, 🔔 gong)
- [ ] Admin role permissions work correctly
- [ ] Direct Messages work for admin help
- [ ] No crashes or errors in basic usage
- [ ] Tested with multiple users
- [ ] Vote tracking works correctly
- [ ] Queue management works
- [ ] Spotify integration functional

### ✅ Content Requirements

#### Documentation
- [ ] **Privacy Policy** updated with Discord-specific language
  - File: `docs/PRIVACY_POLICY.md`
  - URL: `https://github.com/htilly/SlackONOS/blob/master/docs/PRIVACY_POLICY.md`
  - Accessible publicly on GitHub
- [ ] **Terms of Service** updated with Discord-specific language
  - File: `docs/TERMS_OF_SERVICE.md`
  - URL: `https://github.com/htilly/SlackONOS/blob/master/docs/TERMS_OF_SERVICE.md`
  - Accessible publicly on GitHub
- [ ] **Setup Guide** for Discord exists
  - File: `docs/discord/SETUP.md`
  - Step-by-step installation instructions
  - Configuration examples
  - Troubleshooting section

#### Support Infrastructure
- [ ] **Support Server** created and configured
  - Server name: SlackONOS Community (or similar)
  - Community features enabled
  - Channels created: #welcome, #support, #showcase, #announcements
  - Rules and guidelines posted
  - Permanent invite link generated: `https://discord.gg/___________`
  - At least 1-2 moderators assigned
- [ ] **GitHub Issues** enabled for bug reports
  - URL: `https://github.com/htilly/SlackONOS/issues`
- [ ] **Support email** or alternative contact method (optional)

### ✅ Discovery Profile Content

#### App Description
- [ ] **Short Description** (60 char max):
  ```
  Democratic music bot for Sonos with community voting 🎵
  ```
  Character count: 57 ✅

- [ ] **Long Description** (400 char max):
  ```
  Control Sonos speakers democratically! SlackONOS features:
  • 🗳️ Vote system - React with 🎵 to vote tracks up
  • 🔔 Gong system - React to skip unwanted tracks
  • 🎶 Spotify integration - Search tracks, albums, playlists
  • 🤖 AI commands - "play the best songs by Queen"
  • 🎯 Role-based admin controls
  • 🎨 Beautiful web interface

  Perfect for offices, gaming communities, and shared spaces where music choice should be democratic!
  ```
  Character count: 398 ✅

#### Tags & Categories
- [ ] **Primary Category:** Music
- [ ] **Additional Tags:**
  - [ ] Utility
  - [ ] Entertainment
  - [ ] Productivity
  - [ ] Fun

#### External Links
- [ ] **Homepage:** `https://github.com/htilly/SlackONOS`
- [ ] **Privacy Policy:** `https://github.com/htilly/SlackONOS/blob/master/docs/PRIVACY_POLICY.md`
- [ ] **Terms of Service:** `https://github.com/htilly/SlackONOS/blob/master/docs/TERMS_OF_SERVICE.md`
- [ ] **Support Server:** `https://discord.gg/___________` (your invite link)
- [ ] **Documentation (optional):** `https://github.com/htilly/SlackONOS#readme`

### ✅ Media Assets

#### Screenshots (1-5 required)
- [ ] **Screenshot 1: Bot in Action**
  - Discord channel showing music commands and responses
  - Resolution: 1280x720 or higher
  - Format: PNG or JPEG
  - Size: Under 10MB
  - Caption: "Add music to the queue with simple commands or natural language"

- [ ] **Screenshot 2: Emoji Voting System**
  - Message with 🎵 and 🔔 emoji reactions
  - Queue showing starred tracks with votes
  - Caption: "Vote tracks up with 🎵 reactions or skip with 🔔. Most popular songs play first!"

- [ ] **Screenshot 3: Admin Commands DM**
  - Direct Message showing admin help
  - Clean formatting visible
  - Caption: "Admins get advanced controls via Direct Message without cluttering the channel"

- [ ] **Screenshot 4: Web Admin Panel**
  - Admin interface showing Discord settings
  - Modern, clean UI visible
  - Caption: "Configure everything through a beautiful web interface"

- [ ] **Screenshot 5: Now Playing with Votes**
  - Queue with multiple tracks
  - Starred tracks showing vote counts
  - Caption: "See what's playing and what's next. Stars show democratic voting"

#### Video (optional, alternative to screenshots)
- [ ] 30-60 second demo video
- [ ] Resolution: 1920x1080
- [ ] Format: MP4, WebM, or MOV
- [ ] Shows: Search → Add → Vote → Play → Gong flow

### ✅ Code Quality

#### Repository
- [ ] **README.md** updated with Discord emphasis
- [ ] **LICENSE** file present (AGPL-3.0-or-later)
- [ ] **Code comments** clear and helpful
- [ ] **No sensitive data** in repository (tokens, passwords)
- [ ] **No hardcoded credentials** in code
- [ ] **.gitignore** properly configured
- [ ] **package.json** dependencies up to date
- [ ] **No known security vulnerabilities** (run `npm audit`)

#### Testing
- [ ] **All tests passing** (`npm test`)
- [ ] **No lint errors** in critical files
- [ ] **Memory leaks** addressed (track message cleanup)
- [ ] **Error handling** robust and graceful
- [ ] **Edge cases** considered (empty queue, no Sonos, etc.)

### ✅ Security & Privacy

#### Privileged Intent Justification
- [ ] **Message Content Intent** justified:
  - Required for: Reading commands and AI natural language parsing
  - Data handling: Processed in real-time, not stored
  - Privacy: No message content transmitted outside user's server
- [ ] **Prepared to answer Discord's questions** about data usage

#### Security Review
- [ ] **Tokens** never logged or displayed
- [ ] **Sensitive config** properly redacted in debug output
- [ ] **SQL injection** not applicable (no database)
- [ ] **XSS prevention** in web interface
- [ ] **HTTPS** available for web admin (self-signed or CA cert)
- [ ] **Rate limiting** respected for Discord API
- [ ] **Error messages** don't expose sensitive information

### ✅ Compliance

#### Discord Policies
- [ ] **Developer Terms of Service** reviewed and understood
  - URL: https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service
- [ ] **Developer Policy** reviewed and understood
  - URL: https://discord.com/developers/docs/policies-and-agreements/developer-policy
- [ ] **Community Guidelines** will be enforced in support server
  - URL: https://discord.com/guidelines
- [ ] **No policy violations:**
  - ✅ No spam functionality
  - ✅ No scraping user data
  - ✅ No selling/trading Discord accounts
  - ✅ No violating rate limits
  - ✅ No impersonation
  - ✅ No malicious code

#### Legal Compliance
- [ ] **GDPR** considerations addressed (self-hosted, user controls data)
- [ ] **CCPA** considerations addressed (no data sale, user access)
- [ ] **Copyright** respected (Spotify, music rights)
- [ ] **Open source license** clearly stated (AGPL-3.0-or-later)

## Submission Process

### Step 1: Prepare Application in Developer Portal

1. [ ] Go to https://discord.com/developers/applications
2. [ ] Select your application
3. [ ] Navigate to **App Directory**
4. [ ] Fill in **Discovery** section:
   - [ ] Short description
   - [ ] Long description
   - [ ] Tags
   - [ ] External links
5. [ ] Upload **Media** (screenshots/video)
6. [ ] Set **Privacy Policy URL**
7. [ ] Set **Terms of Service URL**
8. [ ] Add **Support Server** invite link

### Step 2: Request Privileged Intent

1. [ ] Navigate to **Bot** section in Developer Portal
2. [ ] Scroll to **Privileged Gateway Intents**
3. [ ] Enable **Message Content Intent**
4. [ ] If bot is in 75+ servers, fill out verification form:
   - [ ] Why you need the intent
   - [ ] How you handle data
   - [ ] Privacy measures
5. [ ] Wait for approval (can take 1-2 weeks)

### Step 3: Submit for Discovery Review

1. [ ] Navigate to **App Directory** → **Submit for Review**
2. [ ] Double-check all information is correct
3. [ ] Click **Submit**
4. [ ] Wait for email confirmation

### Step 4: Review Process

1. [ ] **Initial Review** (1-2 weeks)
   - Discord team reviews application
   - May ask clarifying questions
   - May request changes

2. [ ] **Respond to Feedback**
   - Answer questions promptly
   - Make requested changes
   - Resubmit if necessary

3. [ ] **Approval**
   - Bot appears in Discord App Directory
   - Users can discover and install directly

## Post-Approval Tasks

### Immediate Actions
- [ ] Test installation from App Directory
- [ ] Verify invite link works
- [ ] Check bot appears in search
- [ ] Update GitHub README with App Directory badge
- [ ] Announce on support server
- [ ] Post update on GitHub Discussions

### Marketing & Promotion
- [ ] Add Discord App Directory badge to README
  ```markdown
  [![Discord App Directory](https://img.shields.io/badge/Discord-App%20Directory-5865F2?logo=discord&logoColor=white)](https://discord.com/application-directory/YOUR_APP_ID)
  ```
- [ ] Announce on social media (Twitter, Reddit, etc.)
- [ ] Submit to other bot listing sites:
  - [ ] top.gg
  - [ ] discord.bots.gg
  - [ ] discordbotlist.com
- [ ] Create blog post or announcement (optional)

### Monitoring
- [ ] Monitor support server for new users
- [ ] Track installation analytics (if Discord provides)
- [ ] Respond to user feedback
- [ ] Fix reported bugs quickly
- [ ] Keep documentation up to date

## Common Issues & Solutions

### Privileged Intent Denied?
**Solution:** Provide more detailed explanation of why Message Content is needed:
- "Required for natural language command parsing via OpenAI API"
- "Commands like 'play best songs by Queen' need full message content"
- "All processing happens on user's self-hosted server"
- "No message content is stored or transmitted externally"

### Low Approval Rate?
**Solution:** Improve:
- Screenshot quality (higher resolution, better captions)
- Description clarity (emphasize unique features)
- Support infrastructure (active support server)
- Documentation completeness (clear setup guides)

### Bot Not Appearing in Search?
**Solution:**
- Wait 24-48 hours after approval
- Ensure bot is public (not team-only)
- Check tags are appropriate
- Verify no policy violations

### Users Report Installation Issues?
**Solution:**
- Clarify self-hosted requirement in description
- Add "Self-Hosted" tag to discovery profile
- Create installation video tutorial
- Improve README with clear prerequisites

## Resources

### Discord Documentation
- [App Directory Guidelines](https://discord.com/developers/docs/game-and-server-management/app-directory-guidelines)
- [Developer Terms](https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service)
- [Developer Policy](https://discord.com/developers/docs/policies-and-agreements/developer-policy)
- [Privileged Intents](https://discord.com/developers/docs/topics/gateway#privileged-intents)

### SlackONOS Documentation
- [Discord Setup Guide](https://github.com/htilly/SlackONOS/blob/master/docs/discord/SETUP.md)
- [Discovery Content](https://github.com/htilly/SlackONOS/blob/master/docs/discord/DISCOVERY_CONTENT.md)
- [Media Requirements](https://github.com/htilly/SlackONOS/blob/master/docs/discord/MEDIA_REQUIREMENTS.md)
- [Support Server Guide](https://github.com/htilly/SlackONOS/blob/master/docs/discord/SUPPORT_SERVER.md)

### Tools
- [Discord Permissions Calculator](https://discordapi.com/permissions.html)
- [Markdown Preview](https://markdownlivepreview.com/)
- [Image Compression](https://tinypng.com/)
- [Screenshot Annotation](https://www.figma.com/)

## Timeline Estimate

| Task | Time Required | Status |
|------|--------------|--------|
| Bot setup & testing | 2-4 hours | ⏳ |
| Documentation updates | 1-2 hours | ⏳ |
| Support server creation | 1-2 hours | ⏳ |
| Screenshot creation | 1-2 hours | ⏳ |
| Application submission | 30 minutes | ⏳ |
| Privileged intent approval | 1-2 weeks | ⏳ |
| Directory review | 1-2 weeks | ⏳ |
| **Total estimated time** | **3-4 weeks** | ⏳ |

## Final Pre-Submission Check

Before clicking "Submit":
- [ ] All checkboxes above are completed
- [ ] Bot is stable and tested
- [ ] Documentation is clear and accessible
- [ ] Support server is active
- [ ] Screenshots are professional
- [ ] Privacy Policy and ToS are accurate
- [ ] Privileged intent is approved (or ready to request)
- [ ] You understand this is a self-hosted bot (users need their own server)
- [ ] You're prepared to support users in the support server

## Questions?

- Review this checklist again
- Check Discord's official documentation
- Ask in Discord Developer server: https://discord.gg/discord-developers
- Open issue on GitHub: https://github.com/htilly/SlackONOS/issues

---

**Good luck with your submission!** 🎉

Once approved, SlackONOS will be discoverable by millions of Discord users looking for democratic music control!

