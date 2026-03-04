# Security

## Dependency vulnerabilities

We use **npm overrides** in `package.json` to pin security-patched versions of transitive dependencies. No `npm audit fix --force` is used (that would downgrade packages and risk breaking changes).

### Current overrides

| Package | Pinned to | Reason |
|--------|-----------|--------|
| `serialize-javascript` | ^7.0.4 | RCE fix (RegExp.flags / Date.prototype.toISOString) |
| `undici` | ^6.23.0 | Unbounded decompression (Content-Encoding) |
| `diff` | ^8.0.3 | DoS in parsePatch/applyPatch |
| `ip` | ^2.0.1 | SSRF fix in `isPublic` |

### Known npm audit false positive: `ip` (via `sonos`)

**Alert:** “ip SSRF improper categorization in isPublic” (e.g. Dependabot #60)

- **Cause:** The `sonos` package ([node-sonos](https://github.com/bencevans/node-sonos)) depends on `ip`.
- **Actual state:** We override `ip` to **2.0.1**, which includes the fix. `sonos@1.14.3` also ships with `ip@2.0.1`.
- **Why it still appears:** The advisory is written against “all versions of ip when required by sonos”, so npm/Dependabot still report it even though the installed version is patched.
- **Action:** None required. This is a **known false positive**; no extra “force update” or downgrade is needed.

We have **not** run `npm audit fix --force`; that would downgrade e.g. `sonos`, `mocha`, or `discord.js` and could break the app. Only non-breaking, security-patched overrides are used.
