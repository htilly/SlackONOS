# Slack App Directory Submission Guide

Guide for preparing SlackONOS for submission to the Slack App Directory.

## Overview

The Slack App Directory allows users to discover and install SlackONOS directly from Slack, making distribution much easier. This guide covers the requirements and steps for submission.

## Requirements

### Technical Requirements

1. **Socket Mode Support** ✅
   - SlackONOS already uses Socket Mode (required for App Directory)
   - No public HTTP endpoints needed

2. **OAuth Flow** ⚠️
   - Currently uses workspace-specific tokens
   - May need to implement OAuth redirect flow for distributed apps
   - Each workspace gets its own installation

3. **App Manifest** 📝
   - Required for App Directory submission
   - Defines scopes, features, and metadata

4. **Privacy Policy** 📄
   - Required for App Directory
   - Must be publicly accessible

5. **Terms of Service** 📄
   - Required for App Directory
   - Must be publicly accessible

### Content Requirements

1. **App Listing**
   - Name, description, tagline
   - Feature highlights
   - Screenshots/videos
   - Support information
   - Category selection

2. **Support**
   - Support email or URL
   - Documentation links
   - GitHub repository (optional but recommended)

## Current Status

### ✅ Already Implemented

- Socket Mode support
- Workspace-specific configuration
- Required Slack scopes
- Event subscriptions

### ⚠️ Needs Implementation

- OAuth redirect flow (for App Directory installation)
- App manifest file
- Multi-workspace configuration storage
- Privacy policy
- Terms of service

## Implementation Steps

### 1. Create App Manifest

Create `app.manifest.json` with required configuration:

```json
{
  "display_information": {
    "name": "SlackONOS",
    "description": "Democratic music bot for controlling Sonos speakers with community voting",
    "background_color": "#667eea",
    "long_description": "SlackONOS lets teams control Sonos speakers with Spotify integration. Features community voting, democratic skip tracking, and seamless Slack integration."
  },
  "features": {
    "bot_user": {
      "display_name": "SlackONOS",
      "always_online": true
    },
    "socket_mode": true
  },
  "oauth_config": {
    "redirect_urls": [
      "https://your-domain.com/slack/oauth"
    ],
    "scopes": {
      "bot": [
        "app_mentions:read",
        "chat:write",
        "channels:read",
        "channels:history",
        "groups:read",
        "groups:history"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": [
        "app_mention",
        "message.channels",
        "message.groups"
      ]
    },
    "interactivity": {
      "is_enabled": false
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": true,
    "token_rotation_enabled": false
  }
}
```

### 2. Implement OAuth Flow

For App Directory distribution, you need an OAuth redirect handler:

**Required Endpoints:**
- `GET /slack/oauth` - OAuth initiation
- `GET /slack/oauth/callback` - OAuth callback handler

**Flow:**
1. User clicks "Add to Slack" in App Directory
2. Redirected to OAuth URL with `code` parameter
3. Exchange code for access token
4. Store workspace-specific configuration
5. Redirect to success page

### 3. Multi-Workspace Support

Currently, SlackONOS uses a single config file. For App Directory, you need:

- Workspace-specific config storage (database or file per workspace)
- Workspace ID tracking
- Per-workspace Sonos/Spotify configuration

**Options:**
- Use workspace ID as key in config storage
- Store configs in `config/workspaces/{workspace_id}.json`
- Or use a database (SQLite, PostgreSQL, etc.)

### 4. Create Privacy Policy

Create `docs/PRIVACY_POLICY.md` covering:
- What data is collected
- How data is used
- Data storage and security
- User rights
- Contact information

### 5. Create Terms of Service

Create `docs/TERMS_OF_SERVICE.md` covering:
- Service description
- User responsibilities
- Limitations of liability
- Intellectual property
- Termination

### 6. Prepare App Listing Content

**App Name:** SlackONOS

**Tagline:** Democratic music bot for Sonos speakers

**Description:**
```
Control your Sonos speakers with community voting! SlackONOS lets teams democratically manage music queues through Slack. Features include:

• Community voting system
• Democratic skip tracking (gong system)
• Spotify integration
• AI-powered natural language commands
• Multi-platform support (Slack & Discord)
• Soundcraft mixer integration

Perfect for offices, shared spaces, and music lovers who want fair queue control.
```

**Features:**
- Community voting
- Spotify integration
- AI natural language
- Multi-platform support

**Screenshots Needed:**
- Setup wizard interface
- Bot in action (Slack channel)
- Queue management
- Voting interface

## Submission Process

1. **Prepare App**
   - Complete all requirements above
   - Test OAuth flow thoroughly
   - Test with multiple workspaces

2. **Create App Listing**
   - Go to https://api.slack.com/apps
   - Click "Distribute App" → "App Directory"
   - Fill in listing information
   - Upload screenshots
   - Add support information

3. **Submit for Review**
   - Submit app for Slack review
   - Review typically takes 1-2 weeks
   - Respond to any feedback

4. **Post-Approval**
   - App appears in App Directory
   - Users can install directly
   - Monitor usage and support requests

## Considerations

### Self-Hosted vs. Cloud

**Current State:** Self-hosted (users run their own instance)

**For App Directory:**
- Option A: Keep self-hosted, but provide OAuth flow for easier setup
- Option B: Offer cloud-hosted version (requires infrastructure)
- Option C: Hybrid - self-hosted with cloud OAuth helper

**Recommendation:** Start with Option A - self-hosted with improved OAuth setup flow.

### Configuration Complexity

App Directory apps typically need:
- Simple installation (OAuth handles tokens)
- Per-workspace configuration
- User-friendly setup

**Current Challenge:** Sonos IP, Spotify credentials are workspace-specific but require manual entry.

**Solution:** 
- OAuth handles Slack tokens automatically
- Setup wizard still needed for Sonos/Spotify
- Can be accessed after installation via `/setup` endpoint

## Next Steps

1. ✅ Research requirements (this document)
2. ⏳ Create app manifest
3. ⏳ Implement OAuth flow
4. ⏳ Add multi-workspace support
5. ⏳ Create privacy policy
6. ⏳ Create terms of service
7. ⏳ Prepare app listing content
8. ⏳ Submit for review

## Resources

- [Slack App Directory Guidelines](https://api.slack.com/directory/guidelines)
- [App Developer Policy](https://api.slack.com/developer-policy)
- [OAuth for Apps](https://api.slack.com/authentication/oauth-v2)
- [Socket Mode](https://api.slack.com/apis/connections/socket)

## Notes

- Socket Mode is perfect for App Directory (no public endpoints needed)
- Current architecture is mostly compatible
- Main additions needed: OAuth flow and multi-workspace config
- Can maintain self-hosted model with App Directory distribution




