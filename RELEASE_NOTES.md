# v2.4.0

Deadline-change intelligence for cross-course deadline tracking.

## Highlights

- Compares normalized deadlines against the previous sync before the upcoming index is overwritten.
- Detects due-date and due-time changes with structured `before` and `after` values.
- Detects newly dated assignments, quizzes, and calendar-backed work.
- Detects deadline removal only when the item itself still exists, avoiding false positives when an item disappears entirely.
- Adds a dedicated **Deadline changes** section to `sync-digest.md`.
- Adds structured `deadlineChanges` entries and counts to `sync-digest.json`.
- Applies deadline intelligence to school-wide and active-term digests.
- Adds regression coverage for moved, added, removed, disappeared-item, and first-run baseline cases.
- Preserves clean unchanged Quick Sync behavior with zero deadline-change false positives.

## Validation

The deadline-intelligence self-test passes. A live unchanged Quick Sync produced 0 added, 0 updated, 33 upcoming deadlines, 0 deadline changes, 0 digest entries, and a successful incremental Google Drive publish.

No migration is required for existing installs. Existing `config.json`, `.brightspace-profile/`, and `BrightspaceMirror/` remain local and are not replaced by release files.

# v2.3.0

This release improves cross-course retrieval and eliminates recurring false-positive asset-index changes during unchanged Quick Sync runs.

## Highlights

- Added normalized cross-course upcoming-deadlines indexes in `_school/upcoming.json` and `_school/upcoming.md`.
- Added compact cross-course sync digests in `_school/sync-digest.json` and `_school/sync-digest.md`.
- Added term-scoped copies of both indexes under `_school/<term>/`.
- Added normalized deadline extraction for assignments, quizzes, and calendar events with duplicate suppression and chronological sorting.
- Separated student-facing changes from technical mirror changes in the sync digest.
- Fixed noisy `assets.json` rewrites caused by ordinary Brightspace navigation/UI links being treated as assets.
- Canonicalized and deterministically sorted asset-index entries for stable incremental comparisons.
- Added synthetic regression tests for school indexes and asset-index stability and wired both into CI.
- Expanded the synthetic sample mirror and README to document the new index outputs.
- Finalized runtime and launcher version labels for the stable release line.

## Validation

A repeated unchanged Quick Sync now reports zero Brightspace changes while preserving the normalized upcoming-deadline index. Google Drive publishing continues to run incrementally after index generation.

No migration is required for an existing local install. Existing `config.json`, `.brightspace-profile/`, and `BrightspaceMirror/` remain local and are not replaced by the release files.

---

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
