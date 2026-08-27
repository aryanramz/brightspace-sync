# Brightspace Sync

Brightspace Sync is a read-focused authenticated crawler and incremental course-mirroring pipeline for D2L Brightspace.

It uses a persistent Chromium/Brave browser profile to reuse an authenticated Brightspace session, discovers courses dynamically, captures student-visible course data, maintains a term-scoped local mirror, tracks changes, and can optionally publish the mirror to a Google Drive for desktop folder for downstream search or AI workflows.

> This project is unofficial and is not affiliated with, endorsed by, or supported by D2L or any educational institution. Users are responsible for complying with their institution's policies, applicable terms of service, and copyright rules.

## Highlights

- Persistent browser-based authentication with normal SSO/MFA when required
- Dynamic course discovery
- Quick and Full synchronization modes
- Term-aware historical archive structure
- Change detection that normalizes common Brightspace UI noise
- Student-visible assignments, quizzes, grades, announcements, calendar, discussions, and course content
- Selective asset downloading with configurable size limits
- Incremental Google Drive for desktop publishing
- Shared process locking to prevent overlapping sync/publish operations
- Smart scheduled sync: Quick normally, Full after the configured interval
- Windows launchers and Task Scheduler friendly operation
- Local status, manifest, and change metadata for downstream tooling

## What it is

A typical flow is:

```text
Brightspace
    ↓
Playwright + persistent Brave/Chromium profile
    ↓
Course discovery and read-focused crawling
    ↓
Structured local mirror
    ↓
Change detection and term archive
    ↓
Optional incremental Drive publish
    ↓
Search, archival, or AI tooling
```

This is closer to an authenticated synchronization pipeline than a one-off scraper.

## Important safety notes

Brightspace Sync is designed to avoid submissions, edits, and other intentional state-changing operations. However, visiting Brightspace pages can still update normal platform metadata such as viewed state or "Last Visited" information.

Do not commit or share:

- `.brightspace-profile/` — browser cookies, sessions, and potentially saved-login information
- `BrightspaceMirror/` — private student/course content
- `config.json` — local machine configuration
- logs or exported data that contain private academic information

These paths are ignored by the included `.gitignore`.

## Requirements

- Windows 10 or 11
- Node.js 20+
- Brave Browser or another compatible Chromium browser
- Access to a Brightspace environment through a normal student account
- Optional: Google Drive for desktop if using Drive publishing

## Quick start

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy the example configuration:

   ```powershell
   Copy-Item config.example.json config.json
   ```

3. Edit `config.json` and set at minimum:

   ```json
   {
     "baseUrl": "https://your-school.brightspace.com"
   }
   ```

4. Run the login setup helper:

   ```text
   SETUP_LOGIN.cmd
   ```

   Sign into your institution normally. SSO and MFA remain under your institution's control. Brightspace Sync does not require your password in code or configuration.

5. Run a Full sync first:

   ```text
   FULL_SYNC.cmd
   ```

6. Use Quick syncs for normal daily updates:

   ```text
   QUICK_SYNC.cmd
   ```

## Authentication model

The crawler uses a dedicated persistent Chromium profile under:

```text
.brightspace-profile/
```

If a valid Brightspace/SSO session exists, syncs can usually continue without another login.

If the session expires, the browser may require you to complete login and MFA manually. `SETUP_LOGIN.cmd` opens the same dedicated profile so you can establish or refresh authentication without storing credentials in project files.

The project does not require username or password fields in `config.json`.

## Sync modes

### Quick Sync

Designed for routine use. It checks high-value changing areas such as:

- assignments
- quizzes
- grades
- calendar
- announcements

It intentionally skips the deepest Content/module/discussion crawling for speed.

### Full Sync

Performs a deeper crawl including course Content/modules, discussions, and supported assets.

The scheduled launcher can automatically choose between Quick and Full based on the age of the last successful Full sync.

## Mirror layout

The mirror uses a term-scoped schema:

```text
BrightspaceMirror/
├── 2026-Fall/
│   ├── Course A [123456]/
│   └── Course B [234567]/
├── 2027-Spring/
├── _school/
└── _system/
```

### Term folders

Contain full per-course mirror trees.

### `_school/`

Contains lightweight cross-course summaries and current-term indexes.

### `_system/`

Contains crawler schema, state, migration, debug, and publishing metadata. `_system/` is not published to Drive by default.

## Google Drive publishing

Drive publishing is optional and disabled by default in `config.example.json`.

The intended model is Google Drive for desktop in streaming or mirrored mode. Brightspace Sync copies the local mirror into a mounted Drive path rather than implementing OAuth itself.

The publisher is incremental:

- copies new/changed files
- leaves unchanged files alone
- removes only files it previously published that were later removed locally
- does not purge unrelated user files
- verifies tracked files during Full publishing

To publish manually:

```text
PUBLISH_TO_DRIVE.cmd
```

## Scheduling

`SCHEDULED_SYNC.cmd` chooses a mode automatically:

- Quick if the last successful Full sync is newer than the configured interval
- Full once the configured Full interval has elapsed

This works well with a single daily Windows Task Scheduler task because a missed weekly Full is not permanently skipped just because the computer was offline at a specific scheduled time.

## Assets

The crawler can download common course assets such as:

- PDF
- DOC/DOCX
- PPT/PPTX
- XLS/XLSX
- text files
- images
- archives
- caption files such as VTT/SRT

Large video/audio binaries are index-only by default. Asset behavior and size limits are configurable.

## Development checks

Run the included self-tests:

```powershell
npm run selftest
npm run publish-selftest
npm run lock-selftest
npm run security-selftest
```

The CI workflow runs supported checks on Node.js 20 and 22.

## Privacy and security

See [SECURITY.md](SECURITY.md).

The short version:

- credentials do not belong in source code or config
- browser profile/session state stays local
- mirrored course material stays local unless the user explicitly publishes it elsewhere
- local private paths are gitignored
- users should inspect `git status` before every public push

## Scope and compatibility

Brightspace deployments differ between institutions, and D2L can change its frontend without notice. This project is based on browser automation rather than an official D2L integration, so selectors may require maintenance over time.

The crawler is intended for content visible to the signed-in user. It is not intended to bypass permissions, access restricted content, automate submissions, or evade institutional authentication controls.

## License

No open-source license has been selected yet. Until a license is added, normal copyright rules apply.
