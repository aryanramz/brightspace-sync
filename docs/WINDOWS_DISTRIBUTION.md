# CourseMirror — for D2L Brightspace: Windows distribution foundation

This milestone prepares CourseMirror for a conventional Windows installation without building the final installer. The planned default per-user application location is `%LOCALAPPDATA%\Programs\CourseMirror\`; private runtime data remains separate at `%LOCALAPPDATA%\CourseMirror\`.

CourseMirror is published by **aryanramz** at `https://github.com/aryanramz/coursemirror`. CourseMirror is an unofficial third-party utility for D2L Brightspace. It is not affiliated with or endorsed by D2L Corporation.

## Storage contract

Application files are treated as immutable. Code, bundled defaults, dependencies, and launchers may be installed under `Program Files` in a later milestone. Runtime commands do not create configuration, session, state, lock, mirror, or log files in that directory.

Per-user private runtime data uses:

```text
%LOCALAPPDATA%\CourseMirror\
  config.json                 User configuration
  BrowserProfile\             Chromium cookies and session data
  state\                      Sync, course, publish, lock, and migration state
  logs\                       Reserved application/installer log root
```

The mirror is separate and user-selectable through `outputDir`. A blank value resolves to the current user's `Documents\CourseMirror`. Relative paths in the new per-user config resolve from `%LOCALAPPDATA%\CourseMirror`; absolute paths are recommended for clarity.

`COURSEMIRROR_DATA_DIR` can override the normal per-user data root for controlled testing or managed deployments. A non-empty `COURSEMIRROR_MIRROR_DIR` is authoritative for the effective mirror path: it overrides `outputDir` without rewriting the saved configuration. The former `BRIGHTSPACE_SYNC_DATA_DIR` and `BRIGHTSPACE_SYNC_MIRROR_DIR` names remain accepted as lower-priority compatibility aliases. When no mirror override is present, the configured `outputDir` and existing legacy path-preservation behavior apply normally. None of these variables is required for a normal install.

## Configuration schema and persistence

Per-user configuration declares `"configVersion": 1`. A configuration without `configVersion` is schema v0 and is migrated through an ordered migration table to v1. Each migration advances exactly one supported schema boundary so later releases can add v1 → v2, v2 → v3, and subsequent steps without replacing the migration model.

The v0 → v1 migration retains all known and unknown keys, adds `configVersion`, and removes only settings with an explicit deprecation path such as `profileDir` after its browser-profile migration completes. If a configuration declares a version newer than the application supports, startup stops with a clear upgrade-required error and leaves that file unchanged.

Critical JSON is persisted through same-directory unique temporary files. CourseMirror writes and flushes the complete temporary file, closes it, and then replaces the destination by rename. An ordinary write or replacement failure removes the temporary file when possible and leaves the previous valid destination intact. This atomic path is used for `config.json`, `state\runtime-migrations.json`, and the small global, course, and Drive runtime-state files. Ordinary mirror content retains its existing content-aware writer so unchanged mirror files keep their timestamps.

## Initialization serialization

First-run creation and migration are serialized by `state\.coursemirror-init.lock`, which is separate from the normal sync/publish lock. `loadAppConfig()` holds the initialization lock while creating or versioning config, migrating the legacy profile and runtime state, and updating the migration log, then releases it in guaranteed cleanup before normal sync or publish work proceeds.

A competing process waits for up to 30 seconds and polls every 100 ms by default. A same-host lock whose PID is still running is never removed based on age. A same-host lock with a dead PID is recoverable immediately; malformed or foreign-host locks become recoverable only after one hour. If the bounded wait expires, startup fails with the lock owner and start time instead of stealing the active lock. Because initialization is released before any later operation acquires another lock, the initialization and sync/publish locks do not form a lock-order cycle.

## Backward compatibility

Before normal initialization, a default Windows installation checks the former `%LOCALAPPDATA%\Brightspace Sync` private runtime root. If it contains meaningful data and `%LOCALAPPDATA%\CourseMirror` does not, the complete config, BrowserProfile, state, and logs tree is copied to a uniquely named staging directory and promoted atomically only after the copy is complete. The old root is never deleted, the selected mirror path is preserved, and the actual school mirror is not moved. A completion marker makes retries idempotent. If both roots contain meaningful independent data, migration stops with a deterministic manual-review conflict rather than merging or overwriting either root. Explicit data-directory overrides do not trigger this automatic product-root migration.

On first run, if the per-user configuration does not yet exist, the runtime looks for a legacy `config.json` beside the application. It copies that config to the new location and converts a relative `outputDir` to the equivalent absolute path.

The legacy `profileDir` setting is used as a migration source and then removed from the new config. The runtime owns the current browser-profile location so application updates cannot redirect the session back into `Program Files`. Profile migration copies into `BrowserProfile.migrating` first and atomically renames it only after the complete copy succeeds. An interrupted staging copy is discarded and recopied on retry, while the legacy source remains unchanged.

When the new destinations are absent, the runtime also copies recognized legacy data:

- `.brightspace-profile` or a repo-relative configured profile to `BrowserProfile`
- `_system/state.json` or legacy `_sync_state.json` to `state\state.json`
- `_system/drive_publish_state.json` to `state\drive_publish_state.json`
- per-course `_sync_state.json` data into `state\courses\<course-id>.json` as each course is next synchronized

Migration does not overwrite an existing destination and does not delete the legacy source. Repeated startup is idempotent. Applied actions are recorded in `state\runtime-migrations.json`.

Legacy per-course `_sync_state.json` files remain in the local mirror for rollback but are excluded from Google Drive publishing.

## Launcher contract

`src/launcher.mjs` is the stable command dispatcher. It resolves entry points from its own installed application path, not the caller's working directory. Supported commands are `quick`, `full`, `publish`, `scheduled`, `setup-login`, `refresh-login`, `doctor`, and the machine-readable `status --json` and `settings` desktop contracts.

The `.cmd`, PowerShell, and npm entry points all delegate through this launcher. Scheduled sync resolves the child sync entry through the same application-root abstraction. Runtime wrappers fail with a reinstall/setup message if packaged dependencies are missing; they never attempt to modify the installed application tree.

## Google Drive choice

New configs set `drivePublish.enabled` to `false` and leave `destination` blank. Publishing runs only after the user explicitly enables it and selects a Google Drive for desktop folder. An explicit choice from a legacy config is preserved during migration.

## Portable packaged-runtime contract

`npm run build:windows-bundle` creates the intermediate x64 application bundle under `dist\CourseMirror`. It is a portable packaging proof, not the public installer or a `Setup.exe`.

The bundle contains a private, checksum-verified Node.js 24.20.0 x64 runtime at `runtime\node.exe`. Node 24 is used because Node 20 reached end of life in March 2026; Node 24 remains supported LTS. The packaged `CourseMirror.cmd` resolves both the private runtime and `app\src\launcher.mjs` relative to its own location, so it does not use `node` from `PATH` or depend on the caller's working directory. End users do not need Node.js, npm, Git, or a source checkout, and the launcher does not require PowerShell execution-policy changes.

The packaged application tree contains only runtime source, the generic example configuration, application/runtime licenses, and locked production dependencies. Playwright's JavaScript runtime is installed with lifecycle scripts and browser downloads disabled. Chromium is not bundled: the current runtime continues to use an installed Edge, Chrome, or Brave browser.

The package layout is:

```text
dist\CourseMirror\
  CourseMirror.exe
  CourseMirror.exe.config
  CourseMirror Credential Helper.exe
  CourseMirror Credential Helper.exe.config
  CourseMirror.cmd
  bundle-manifest.json
  runtime\
    node.exe
    NODE_LICENSE.txt
  app\
    package.json
    config.example.json
    LICENSE
    src\
    node_modules\
```

Application files remain immutable at runtime. Configuration, browser session, state, locks, and logs continue to use `%LOCALAPPDATA%\CourseMirror`, subject to the `COURSEMIRROR_DATA_DIR` override. The mirror remains separate and user-selectable, including through `COURSEMIRROR_MIRROR_DIR`.

## Windows desktop control panel (Milestone 2B.1)

The control panel targets **.NET Framework 4.8 WinForms**. Microsoft's [.NET Framework system requirements](https://learn.microsoft.com/en-us/dotnet/framework/get-started/system-requirements) list supported Windows 10 and Windows 11 releases with .NET Framework 4.8 or 4.8.1, so this produces a small native desktop executable without adding a separate modern .NET Desktop Runtime prerequisite. A modern framework-dependent WinForms build would require that separate runtime, while a modern self-contained build would materially increase the application and installer footprint; see Microsoft's [.NET deployment overview](https://learn.microsoft.com/en-us/dotnet/core/deploying/). .NET Framework WinForms also supports the Windows interoperability needed by later Credential Manager and Task Scheduler milestones.

The GUI is intentionally a thin Windows shell. C# owns controls, user interaction, hidden process launching, safe bounded result display, Explorer folder opening, and a non-sensitive control-panel activity log. The existing Node application remains authoritative for configuration and migration, runtime and mirror paths, locking, status, and synchronization.

The versioned status command is:

```text
runtime\node.exe app\src\launcher.mjs status --json
```

Its schema version 1 response contains only GUI-safe state:

```json
{
  "schemaVersion": 1,
  "appVersion": "2.4.1",
  "status": "ready",
  "configExists": true,
  "configured": false,
  "baseUrlConfigured": false,
  "mirrorDir": "<Node-resolved path>",
  "logsDir": "<Node-resolved path>",
  "dataDir": "<Node-resolved path>",
  "profileExists": true,
  "lastSync": null,
  "activeOperation": null
}
```

It never returns configuration contents, URLs, cookies, credentials, tokens, or browser-session data. Calling status performs the same serialized runtime initialization as other Node commands, so the GUI does not reproduce configuration or path logic in C#.

Quick Sync and Full Sync invoke `quick` and `full` through the packaged `runtime\node.exe` and `app\src\launcher.mjs`. Standard output, standard error, and the exit code are captured with no console window. The UI displays only a concise bounded outcome, disables both sync buttons while a GUI operation is active, and relies on the existing Node sync lock for cross-process protection. After a run, it refreshes the structured status to obtain the authoritative last-successful-sync timestamp.

The open control panel refreshes backend status approximately every five seconds and when activated, skipping rather than overlapping an in-progress status request. Quick and Full also perform an immediate status preflight before launch. Desktop status uses the sync lock's shared read-only inspection API, so live, dead-PID, foreign, malformed, and aged locks follow the same stale classification as normal lock acquisition without status acquiring or deleting the lock.

Failed GUI syncs append a bounded entry to the Node-resolved `logs\backend-failures.log`. Only the timestamp, operation, exit code, and sanitized standard-error tail are retained. URLs, credential-like fields, authorization/cookie values, and recognized key/token formats are redacted; standard output is never written to this log or shown in the main window.

Open Mirror and View Logs use the paths from the status response. C# does not derive `%LOCALAPPDATA%` or the mirror location. Missing directories are reported without silently creating them.

## First-run setup and Settings (Milestone 2B.2)

When `status --json` reports `configured: false`, the control panel automatically opens the shared **Set up CourseMirror** form. Cancelling leaves the per-user configuration unconfigured and keeps Quick Sync and Full Sync disabled. Saving does not trigger login or synchronization; it refreshes status and enables sync commands only after Node reports the application configured. The Settings button opens the same form with current values.

The GUI obtains settings from:

```text
runtime\node.exe app\src\launcher.mjs settings --json
```

Schema version 1 exposes only `configured`, `baseUrl`, the effective `mirrorDir`, `mirrorOverrideActive`, optional Drive `enabled`/`destination` fields, and non-secret authentication availability/enabled flags. It never exposes usernames, passwords, credentials, cookies, tokens, browser-session data, profile contents, or unrelated configuration. Saves use `settings save --json`; the versioned non-secret JSON request is written to standard input and never placed in command-line arguments, environment variables, or logs. Node performs HTTPS URL normalization and validation, validates absolute paths and protected-path separation, merges the supported fields into the existing schema, preserves unexposed settings, and atomically replaces `config.json` under the existing initialization lock.

Fresh setup suggests `CourseMirror` under the actual Windows Documents known folder returned by `.NET`, so redirected OneDrive or policy-controlled Documents locations are respected. The user may edit or browse to any suitable absolute school-folder location. Private runtime data remains under the Node-resolved data directory and is never placed inside or moved with the mirror.

Changing a non-empty existing mirror requires an explicit choice:

- **Move existing mirror** asks Node to relocate the course files. Empty destinations are allowed; non-empty destinations are rejected instead of overwritten. Same-volume moves use a filesystem rename, while cross-volume moves stage a complete copy before promotion. The config switches only after the move succeeds, and handled failures roll the filesystem back and retain the old configured path.
- **Use new location** updates `outputDir` and deliberately leaves the old mirror untouched.
- **Cancel** makes no configuration change.

If the old mirror is absent or effectively empty, an ordinary save is sufficient. A `COURSEMIRROR_MIRROR_DIR` environment override remains authoritative: Settings shows the effective path read-only, rejects a misleading different path, and does not rewrite the saved `outputDir`.

Google Drive publishing remains off by default. Enabling **Publish mirror to Google Drive** requires a separate absolute filesystem destination, intended for a Google Drive for desktop folder. Disabling publishing permits an empty destination. This feature uses the existing `drivePublish.enabled` and `drivePublish.destination` keys; it does not add Google OAuth or publish private runtime data.

For development, build the native executable with:

```powershell
npm run build:windows-control-panel
```

The primary integration path is the portable bundle:

```powershell
npm run build:windows-bundle
npm run windows-bundle-selftest
& '.\dist\CourseMirror\CourseMirror.exe'
```

The standalone build output can target an already-built bundle by setting `COURSEMIRROR_DEV_BUNDLE_ROOT` to the absolute `dist\CourseMirror` directory before launching it. Normal packaged launches leave this development override unset and locate the private Node runtime relative to the GUI executable.

## Secure institutional authentication (Milestone 2B.3)

Persistent Chromium-session login remains the generic default. CourseMirror never implements a generic password-field search or automatic form filler. Institution-specific automatic sign-in is opt-in and is available only through an explicit adapter; the initial adapter supports the exact Brightspace host `mycourses.stonybrook.edu` and retrieves credentials only after the browser reaches the exact HTTPS SSO origin `https://sso.cc.stonybrook.edu`. HTTP, lookalike, and unexpected hosts stop automatic filling without retrieving a credential.

The Settings form shows **Automatically sign me in when my session expires**, Username, and Password only for the supported Stony Brook site. The password is stored as a Windows Generic Credential under the canonical target `CourseMirror:institution:stony-brook`; the former `Brightspace Sync:institution:stony-brook` target remains a read-compatible migration source and is removed after a successful canonical write or deletion. It is never written to `config.json`, the mirror, Drive, state, logs, command arguments, environment variables, or desktop JSON responses. Existing passwords are never displayed. A blank password preserves the saved password only when the username is unchanged; entering a password replaces it. Disabling automatic sign-in or choosing **Remove saved sign-in** deletes the saved credential when Settings is saved. `config.json` stores only the non-secret `auth.automaticLoginEnabled` flag.

The bundled `CourseMirror Credential Helper.exe` is a narrowly scoped .NET Framework helper around Windows Credential Manager. The packaged Node process launches it without a console and exchanges a bounded, versioned request through a randomly named local named pipe. Credentials are not placed in process arguments, standard streams, environment variables, or temporary files. Helper failures return a fixed non-secret diagnostic.

Normal sync first tests the persistent profile. A valid session continues without opening Credential Manager. The persistent sync browser is always headed so a human login or MFA challenge can be restored reliably; the existing background/headless preference starts that real window minimized, as does automatic institutional sign-in. Ordinary foreground mode is not minimized. When Stony Brook automatic sign-in is enabled, the adapter clicks only the exact recognized institutional SAML handoff on the trusted Brightspace origin. After the browser reaches the exact trusted SSO origin, Node requests the credential, fills only the adapter's exact selectors, submits once, and clears its short-lived credential object. Duo and other human challenges are never bypassed; the minimized browser is restored only when human action is required, and the same session continues after approval.

**Refresh Login** now runs `refresh-login` through the private packaged Node runtime. It acquires the existing operation lock, opens the same persistent browser profile visibly, navigates to the safe normalized Brightspace URL, waits for manual SSO/MFA completion, verifies the authenticated Brightspace state, closes cleanly, and refreshes control-panel status. The backend subprocess remains hidden; only the interactive browser is shown.

This first adapter intentionally depends on the currently recognized Stony Brook Brightspace login control and SSO page structure. Authenticated state requires both the trusted configured Brightspace origin and Brightspace UI evidence. Unexpected authentication states or handoff destinations fail closed and direct the user to Refresh Login. Future adapter changes must be reviewed against the live institutional flow without weakening exact-origin validation. Credential Manager protects credentials for the signed-in Windows account; it is not intended to defend against malicious code already running as that same user.

## Windows background scheduling (Milestone 2B.4)

Automatic sync is off by default and remains an explicit user choice in the shared first-run/Settings form. The existing config schema now retains:

```json
{
  "schedule": {
    "enabled": false,
    "intervalHours": 6,
    "fullIntervalDays": 7
  }
}
```

The UI accepts a recurrence from 1–24 hours and a Full Sync interval from 1–30 days. A legacy `schedule` object containing only `fullIntervalDays` remains valid in memory with scheduling disabled and the six-hour default; reading it does not rewrite the config, and unknown schedule keys are preserved on save.

When enabled, CourseMirror owns exactly one task under `\CourseMirror`. Its name is `Scheduled Sync - <current-user-SID>`, derived from the stable Windows security identifier rather than the renameable account name. Each Windows account therefore addresses only its own managed task. It is registered for that same SID with **interactive-token** logon and least privilege, so it runs only while that user is signed in and stores no Windows password. The task does not wake the computer, runs on battery, starts when a missed trigger becomes available, and ignores a second trigger while an instance is already active. Its action contains only the canonical installed `CourseMirror.exe` path and the fixed argument `--scheduled-run`; SID, URL, mirror, Drive, credential, and other settings never appear in the action arguments.

Settings also checks only the current SID's exact former `\Brightspace Sync\Scheduled Sync - <Windows SID>` task. On the next successful scheduling reconciliation it creates or updates the canonical CourseMirror task as requested and removes that exact legacy task. Snapshot/rollback covers both identities; tasks for other SIDs and unrelated tasks are never touched.

`--scheduled-run` is handled before the control-panel mutex or WinForms startup. The WinExe launches the private packaged Node runtime and fixed `scheduled` launcher command without a console, waits for completion, and returns its exit code. Node chooses Full when no successful Full Sync is recorded or the configured Full interval has elapsed; otherwise it chooses Quick. Malformed status is treated conservatively as requiring Full. The existing Node operation lock remains the final concurrency authority, and a scheduled overlap returns a distinct safe status rather than starting a second crawler.

The sync browser remains headed so login or MFA can be completed, but a scheduled launch starts minimized. A valid persistent session completes without user interaction. An authentication failure returns a dedicated non-secret result, records only `refresh-login-required`, and creates a private state latch. Later scheduled triggers stop before launching a browser or reading a credential until successful Refresh Login, a successful manual Quick/Full Sync, or an intentional authentication/credential update clears the latch. The latch contains no account, URL, credential, token, cookie, or form data and never enters the mirror or Drive.

Settings treats an enabled schedule, cadence change, or disable operation as one coordinated Task Scheduler/config transaction. It snapshots the current user's exact managed task, applies the requested registration first, then saves config through the existing Node transaction. A required task-registration failure leaves config unchanged; a config failure restores the exact prior task definition. Credential and scheduling changes use the same rollback path, and any incomplete rollback is surfaced as requiring manual review. When config is already disabled, Task Scheduler unavailability does not block unrelated URL, mirror, Drive, or authentication saves. A stale task is safe because the Node scheduled entry point checks `schedule.enabled` before syncing; Settings shows a nonfatal review warning and reconciles the stale task once Task Scheduler becomes available again.

Opening Settings compares the current user's task with the current binary path, cadence, interactive-token logon, least privilege, battery/wake policy, fixed action, and indefinite lifetime policy. `ExecutionTimeLimit` is `PT0S`, repetition has no finite duration, and the trigger has no `EndBoundary`, leaving CourseMirror's own operation/authentication timeouts and lock lifecycle authoritative. A finite or otherwise altered task is repaired on the next successful Save. Disabling removes only the current SID's exact managed task and leaves other users' and unrelated Task Scheduler entries untouched.

Scheduled outcomes append to the private Node-resolved `logs\scheduled.log`. The file is bounded to 64 KiB and contains only timestamp, selected mode, exit code, and a fixed high-level category, including `refresh-login-required`. It never contains crawler output, page content, URLs, usernames, credentials, tokens, cookies, or raw errors.

Automated tests use a mock Task Scheduler service to prove idempotent create/update/delete, exact-definition rollback, combined credential rollback, reconciliation, and partial-failure reporting without altering a developer or hosted runner's real task library. The packaged Windows test exercises the actual `CourseMirror.exe --scheduled-run` → private Node path with isolated external data and no configured site, proving the no-UI/no-console entry point without contacting Brightspace. A real disposable Task Scheduler registration test is intentionally not part of routine CI because it would mutate host-level scheduled-task state.

## Windows installer build foundation (Milestone 2C.1)

The installer consumes the already-verified portable bundle at `dist\CourseMirror`; it does not compile raw application source. The supported chain is:

```text
npm run build:windows-bundle
    -> dist\CourseMirror\
npm run build:windows-installer
    -> dist\installer\CourseMirror-<version>-Setup.exe
    -> dist\installer\CourseMirror-<version>-Setup.exe.sha256
```

The application and installer version both come from `package.json`. The build validates that the portable manifest and packaged application agree with that version before invoking Inno Setup. The SHA-256 sidecar uses lowercase hexadecimal, two spaces, and the setup filename.

Local installer builds require **Inno Setup 7.1.0 x64 exactly**. Install that compiler separately and either let the build locate a normal Inno Setup 7 installation or set `ISCC_PATH` to its `ISCC.exe`. The normal local build never downloads or installs developer tooling. From a Windows source checkout:

```powershell
npm ci --ignore-scripts
npm run build:windows-bundle
$env:ISCC_PATH = 'C:\path\to\Inno Setup 7\ISCC.exe' # optional
npm run build:windows-installer
```

CI obtains the immutable official `innosetup-7.1.0-x64.exe` release asset, verifies its pinned SHA-256 and valid Authenticode signature, installs it into runner-temporary storage, and uses the same installer build entry point. Ordinary branch and pull-request CI uploads the result only as the short-lived `coursemirror-installer-development` artifact; it is not an official GitHub Release.

The generated setup is English-only, per-user, and requires no elevation. It installs to the fixed `%LOCALAPPDATA%\Programs\CourseMirror\` location and keeps the existing private `%LOCALAPPDATA%\CourseMirror\` runtime data separate. It creates exactly one direct Start Menu application shortcut, offers an optional desktop shortcut that is off by default, and offers to launch CourseMirror on completion. Application settings, login, mirror, Drive, and scheduling remain in the application's existing first-run experience rather than the installer wizard.

The supported baseline is Windows 10 version 22H2 (build 19045) or later on x64 hardware, including Windows 11 x64. The setup blocks 32-bit Windows and ARM64. It requires .NET Framework 4.8 or newer; when missing, it stops and offers to open Microsoft's official download page rather than installing .NET silently. The portable bundle supplies the private Node runtime and Playwright library but no Chromium browser.

2C.1 installers are intentionally unsigned development/test artifacts. Code signing, release publication, installer-aware active-operation handling, lifecycle maintenance, upgrade/repair policy, uninstall data choices, update checks, and clean-VM qualification remain later milestones. Users should not be instructed to weaken Windows Defender or SmartScreen.

## Deferred / Later Improvements

The items below are **non-blocking**. They are not required before moving to installer and UI work, and they do not prevent the Windows distribution foundation from being considered complete.

### Accepted current tradeoffs

- **Browser-profile recovery:** In the rare case where an unverified `BrowserProfile` is moved to `.incomplete`, its replacement migration fails, and the legacy source later becomes unavailable, the backup is not automatically promoted. This is acceptable because legacy data is preserved and normal retries are safe.
- **PID reuse:** A reused PID on the same host could conservatively make an initialization or sync lock appear active until timeout. This fails safe instead of risking theft of an active lock.
- **Foreign or malformed initialization locks:** These intentionally remain protected for the configured stale period, currently one hour, before recovery.
- **Atomic-write directory durability:** Atomic JSON writes flush and sync the temporary file itself. Node does not provide a portable Windows mechanism for syncing the parent directory.
- **Orphaned atomic temporary files:** A hard crash can leave uniquely named `.tmp-*` files. They neither replace nor corrupt the real destination.

### Future enhancement tasks

- Add more defensive browser-profile recovery that can restore or promote `.incomplete` when the replacement and subsequent legacy-source retry are unavailable.
- Consider making the foreign or malformed initialization-lock stale period configurable, and add maintenance cleanup for stale orphan `.tmp-*` files.
- Provide safe discovery and migration of an older source checkout during installation, including an option for the user to select the old installation when it cannot be found automatically.
- Consider both per-user/no-admin and per-machine installation. Do not hard-code a `Program Files`-only installation unless that decision is made explicitly later.
- Consider crash-recovery journaling for the very small interruption windows during a same-volume rename or a staged cross-volume mirror relocation. Handled filesystem/configuration failures already roll back and retain the old configuration.

### Installer and release-phase work

The following work remains intentionally deferred to later milestones:

- repair behavior
- uninstall behavior
- choices to preserve or delete user data during uninstall
- clean Windows VM installation testing
- legacy upgrade testing
- repair testing
- uninstall testing
- code signing
- optional automatic updates

Future installer metadata must use product name `CourseMirror`, publisher `aryanramz`, default install directory `%LOCALAPPDATA%\Programs\CourseMirror\`, main executable `CourseMirror.exe`, credential helper `CourseMirror Credential Helper.exe`, and setup filename `CourseMirror-<version>-Setup.exe`. The permanent Inno Setup App ID remains `7E264BC7-FCBE-4BF2-9A24-E342C533A770`; it must not change during the rename.

Additional institution adapters and changes required by future SSO page revisions remain later enhancements. Installer, upgrade, repair, uninstall, signing, and release behavior remain part of Milestone 2C.

No installer artifact should be published until the applicable install, upgrade, repair, and uninstall flows pass end-to-end testing.
