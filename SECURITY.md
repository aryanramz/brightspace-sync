# Security and release checklist

Brightspace Sync operates inside an authenticated student session. Treat local browser state and mirrored course data as sensitive.

## Never commit

- `.brightspace-profile/`
- `BrightspaceMirror/`
- `config.json`
- `.env` or `.env.*`
- copied browser cookies, storage-state exports, or SSO tokens
- diagnostic bundles that have not been manually reviewed and redacted

## Authentication model

The crawler reuses a dedicated persistent Chromium profile. Supported Windows auto-detection covers Brave, Google Chrome, and Microsoft Edge; another compatible Chromium executable can be configured manually.

Passwords are not required in `config.json` or environment variables. Browser password-manager assistance is optional and best-effort; normal SSO/MFA remains the supported fallback.

v2.4.1 does not export Playwright `storageState` to a separate plaintext JSON file. Session persistence stays inside the dedicated Chromium profile. If the legacy `_brightspace-auth-state.json` file from v2.4.0 exists, the crawler removes it automatically. The browser profile itself remains sensitive and should be protected like any authenticated browser profile.

## Read-focused write protection

Authentication must be allowed to complete normally, so the network guard is installed only after Brightspace authentication succeeds.

After authentication the guard:

- blocks `PUT`, `PATCH`, and `DELETE`
- blocks same-origin form/document `POST` requests
- blocks POST targets or bodies that look state-changing, such as submit/save/delete/upload/update actions
- allows read-like Brightspace POST/RPC/XHR traffic that does not match those write indicators
- does not interfere with cross-origin SSO/session-refresh POSTs

This substantially reduces the risk of accidental state changes, but it is not a proof that the application is mathematically read-only. Simply visiting LMS pages can update server-side metadata such as viewed state or last-visited timestamps.

## Repository privacy checks

Before publishing a release:

1. Run `git status --ignored` and confirm the browser profile, mirror, and local config are ignored.
2. Run `git ls-files` and confirm none of those sensitive paths are tracked.
3. Run `npm run security-selftest` to scan the current working tree for known credential formats, institution-email patterns, student-ID-like fields, personal Windows profile paths, and unsafe public defaults.
4. Run `npm run history-security-selftest` from a full Git checkout to verify the sensitive runtime paths were never committed and scan every reachable commit for common secret/academic-PII patterns.
5. If sensitive material was ever committed, removing it in a later commit is **not enough**. Rewrite Git history before publishing and rotate any exposed credentials/tokens.

GitHub Actions performs both the current-tree security check and a full-history check before release-quality changes are merged.

## Dependency and portability controls

- Runtime dependencies are pinned and committed in `package-lock.json`.
- CI and setup use `npm ci` for reproducible installs.
- Linux CI runs syntax and functional/security self-tests on Node.js 20 and 22.
- A `windows-latest` CI job runs the environment doctor and launches an installed Chromium browser through Playwright using a temporary persistent profile.

The Windows browser smoke test validates packaging/browser compatibility on a clean hosted Windows environment. It does not replace real testing against every institution's Brightspace and SSO deployment.

## Reporting security issues

Do not include real credentials, cookies, SSO tokens, grades, private student information, or copyrighted course files in a public GitHub issue. Use a minimal redacted reproduction.
