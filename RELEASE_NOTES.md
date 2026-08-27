# v2.2.0-rc.1

Public-release candidate focused on portability and privacy.

## Changes from v2.1

- Replaced the institution-specific URL in `config.example.json` with a generic Brightspace placeholder.
- Removed a hardcoded institution org-unit ID from course discovery.
- Generalized institution-specific comments and course-folder normalization wording.
- Added Winter-term cleanup support to the course-name canonicalizer.
- Disabled Google Drive publishing by default for new public installs.
- Disabled saved-browser-credential auto-submit by default for new public installs; manual SSO/MFA remains the reliable fallback.
- Expanded `.gitignore` and the security self-test.
- Rewrote the README for public installation, limitations, privacy, and architecture.
- Added `SECURITY.md`.

No migration is required for an existing local install. Existing `config.json`, `.brightspace-profile/`, and `BrightspaceMirror/` remain local and are not replaced by the release files.
