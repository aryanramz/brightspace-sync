# v2.2.0

Initial public release focused on portability, privacy, and safe authenticated Brightspace synchronization.

## Highlights

- Persistent browser-session reuse with normal SSO/MFA when required.
- Dynamic Brightspace course discovery.
- Quick and Full synchronization modes.
- Term-scoped historical archives and change detection.
- Student-visible assignments, quizzes, grades, announcements, calendar, discussions, and course content.
- Selective asset downloading with configurable size limits.
- Optional incremental Google Drive for desktop publishing.
- Shared process locking and smart scheduled synchronization.
- Public-release security hardening and CI checks.
- MIT License.

## Changes from v2.1

- Replaced the institution-specific URL in `config.example.json` with a generic Brightspace placeholder.
- Removed a hardcoded institution org-unit ID from course discovery.
- Generalized institution-specific comments and course-folder normalization wording.
- Added Winter-term cleanup support to the course-name canonicalizer.
- Disabled Google Drive publishing by default for new public installs.
- Disabled saved-browser-credential auto-submit by default for new public installs; manual SSO/MFA remains the reliable fallback.
- Expanded `.gitignore` and the security self-test.
- Rewrote the README for public installation, limitations, privacy, and architecture.
- Added `SECURITY.md` and an MIT `LICENSE`.

No migration is required for an existing local install. Existing `config.json`, `.brightspace-profile/`, and `BrightspaceMirror/` remain local and are not replaced by the release files.
