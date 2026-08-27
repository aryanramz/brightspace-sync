# Security and release checklist

Brightspace Sync operates inside an authenticated student session. Treat local browser state and mirrored course data as sensitive.

## Never commit

- `.brightspace-profile/`
- `BrightspaceMirror/`
- `config.json`
- `.env` or `.env.*`
- copied browser cookies, storage-state exports, or SSO tokens
- diagnostic bundles that have not been manually reviewed and redacted

## Before making a repository public

1. Run `git status --ignored` and confirm the browser profile, mirror, and local config are ignored.
2. Run `git ls-files` and confirm none of those paths are tracked.
3. Search tracked files for personal paths, student IDs, email addresses, institution-specific secrets, OAuth tokens, cookies, and passwords.
4. Run `npm run security-selftest`.
5. If sensitive material was ever committed, removing it in a later commit is **not enough**. Rewrite Git history before publishing and rotate any exposed credentials/tokens.

## Authentication model

The crawler reuses a dedicated persistent Brave profile. Passwords are not required in `config.json` or environment variables. Browser password-manager assistance is optional and best-effort; manual SSO/MFA remains the supported fallback.

## Reporting security issues

Do not include real credentials, cookies, SSO tokens, grades, or copyrighted course files in a public GitHub issue. Use a minimal redacted reproduction.
