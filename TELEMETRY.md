# Telemetry

SlackONOS includes optional, privacy-focused telemetry to help track basic usage statistics.

## Analytics Platform

Telemetry uses [PostHog](https://posthog.com/), an open-source product analytics platform with:
- **Privacy-focused**: GDPR/CCPA compliant
- **Self-hostable**: Can run your own instance
- **Anonymous tracking**: No PII collected
- **Rich analytics**: Unique users, trends, breakdowns

## What's Collected

When enabled, the following anonymous data is sent:

### All Events
- **Instance ID**: SHA256 hash of hostname (anonymous, stable identifier) - used as `distinctId`
- **OS Platform**: e.g., `linux`, `darwin`, `win32`
- **OS Release**: Kernel version
- **Node Version**: e.g., `v22.21.1`

### Event: `startup`
Sent when the application starts.
- **App Version**: From `package.json`
- **Release Version**: Git tag or commit SHA

### Event: `heartbeat`
Sent every 24 hours while running.
- **App Version**: Current version
- **Release Version**: Current release
- **Uptime Hours**: Hours since startup
- **Uptime Days**: Days since startup

### Event: `shutdown`
Sent on graceful shutdown (SIGINT/SIGTERM).
- **App Version**: Current version
- **Release Version**: Current release
- **Total Runtime Hours**: Total hours before shutdown
- **Total Runtime Days**: Total days before shutdown

### Automatic PostHog Properties
PostHog automatically enriches events with:
- Timestamp
- User agent

**No personally identifiable information (PII) is collected.** No IP addresses are stored, and no usernames, Slack/Discord data, or music preferences are transmitted.

## Privacy & Compliance

- **No cookies or tracking scripts** (server-side only)
- **Anonymous instance IDs** (hashed hostname)
- **No user behavior tracking** (only system events)
- **Fail-silent** (errors never crash the app)
- **Batched events** (PostHog SDK handles buffering and retry)

Compatible with GDPR, CCPA, and other privacy regulations.

## Configuration

### API Key
Default API key is included, but you can use your own PostHog instance:

**Via config file (`config/config.json`):**
```json
{
  "telemetryApiKey": "phc_YOUR_PROJECT_API_KEY"
}
```

**Via environment variable:**
```bash
TELEMETRY_API_KEY=phc_YOUR_PROJECT_API_KEY
```


## Disabling Telemetry

Telemetry is **enabled by default** but can be easily disabled.

**Via admin command (easiest):**
```
setconfig telemetryEnabled false
```

**Via environment variable:**
```bash
TELEMETRY_ENABLED=false npm start
```

**Via config file:**
Edit `config/config.json` and add:
```json
{
  "telemetryEnabled": false
}
```

No data will be sent when disabled.


## Technical Implementation

### Dependencies
- `posthog-node`: Official PostHog Node.js SDK

### Event Flow
1. Application starts → `trackStartup()` called
2. PostHog SDK batches event and sends asynchronously
3. Every 24 hours → `trackHeartbeat()` called
4. On shutdown → `trackShutdown()` + `shutdown()` to flush pending events

### Graceful Shutdown
The telemetry module ensures events are flushed before exit:
```javascript
await telemetry.trackShutdown(version, release);
await telemetry.shutdown(); // Flush pending events
```

This prevents data loss during container restarts or deployments.
