# Security

## Dependency vulnerabilities

We use **npm overrides** in `package.json` to pin security-patched versions of transitive dependencies. No `npm audit fix --force` is used (that would downgrade packages and risk breaking changes).

### Current overrides

| Package | Pinned to | Reason |
|--------|-----------|--------|
| `serialize-javascript` | ^7.0.5 | RCE fix (RegExp.flags / Date.prototype.toISOString) |
| `undici` | ^7.0.0 | Unbounded decompression (Content-Encoding) |
| `diff` | ^8.0.3 | DoS in parsePatch/applyPatch |
| `ip` | ^2.0.1 | Latest available `ip` release; see accepted audit finding below |

### Accepted npm audit finding: `ip` (via `sonos`)

**Alert:** “ip SSRF improper categorization in isPublic” (e.g. Dependabot #60)

- **Cause:** The `sonos` package ([node-sonos](https://github.com/bencevans/node-sonos)) depends on `ip`.
- **Actual state:** We override `ip` to **2.0.1**, which is the latest published `ip` version, but the current advisory still marks `<=2.0.1` as affected and lists no patched version.
- **Local exposure:** `sonos` uses `ip.address('public')` to choose a local listener address. SlackONOS does not use `ip.isPublic()`/`ip.isPrivate()` to authorize attacker-controlled URLs or IP addresses.
- **Action:** Do **not** run `npm audit fix --force`; npm currently suggests downgrading `sonos` to `0.6.1`, which is a breaking downgrade. Track upstream `sonos`/`ip` updates, or replace/fork `sonos` if audit-clean production builds become mandatory.

We have **not** run `npm audit fix --force`; that would downgrade e.g. `sonos`, `mocha`, or `discord.js` and could break the app. Only non-breaking, security-patched overrides are used.
