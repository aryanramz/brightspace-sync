# Windows distribution foundation

This milestone prepares Brightspace Sync for a conventional per-machine Windows installation without building the final installer.

## Storage contract

Application files are treated as immutable. Code, bundled defaults, dependencies, and launchers may be installed under `Program Files` in a later milestone. Runtime commands do not create configuration, session, state, lock, mirror, or log files in that directory.

Per-user private runtime data uses:

```text
%LOCALAPPDATA%\Brightspace Sync\
  config.json                 User configuration
  BrowserProfile\             Chromium cookies and session data
  state\                      Sync, course, publish, lock, and migration state
  logs\                       Reserved application/installer log root
```

The mirror is separate and user-selectable through `outputDir`. A blank value resolves to the current user's `Documents\Brightspace Mirror`. Relative paths in the new per-user config resolve from `%LOCALAPPDATA%\Brightspace Sync`; absolute paths are recommended for clarity.

`BRIGHTSPACE_SYNC_DATA_DIR` can override the normal per-user data root for controlled testing or managed deployments. A non-empty `BRIGHTSPACE_SYNC_MIRROR_DIR` is authoritative for the effective mirror path: it overrides `outputDir` without rewriting the saved configuration. When it is absent, the configured `outputDir` and existing legacy path-preservation behavior apply normally. Neither environment variable is required for a normal install.

## Configuration schema and persistence

Per-user configuration declares `"configVersion": 1`. A configuration without `configVersion` is schema v0 and is migrated through an ordered migration table to v1. Each migration advances exactly one supported schema boundary so later releases can add v1 → v2, v2 → v3, and subsequent steps without replacing the migration model.

The v0 → v1 migration retains all known and unknown keys, adds `configVersion`, and removes only settings with an explicit deprecation path such as `profileDir` after its browser-profile migration completes. If a configuration declares a version newer than the application supports, startup stops with a clear upgrade-required error and leaves that file unchanged.

Critical JSON is persisted through same-directory unique temporary files. Brightspace Sync writes and flushes the complete temporary file, closes it, and then replaces the destination by rename. An ordinary write or replacement failure removes the temporary file when possible and leaves the previous valid destination intact. This atomic path is used for `config.json`, `state\runtime-migrations.json`, and the small global, course, and Drive runtime-state files. Ordinary mirror content retains its existing content-aware writer so unchanged mirror files keep their timestamps.

## Initialization serialization

First-run creation and migration are serialized by `state\.brightspace-sync-init.lock`, which is separate from the normal sync/publish lock. `loadAppConfig()` holds the initialization lock while creating or versioning config, migrating the legacy profile and runtime state, and updating the migration log, then releases it in guaranteed cleanup before normal sync or publish work proceeds.

A competing process waits for up to 30 seconds and polls every 100 ms by default. A same-host lock whose PID is still running is never removed based on age. A same-host lock with a dead PID is recoverable immediately; malformed or foreign-host locks become recoverable only after one hour. If the bounded wait expires, startup fails with the lock owner and start time instead of stealing the active lock. Because initialization is released before any later operation acquires another lock, the initialization and sync/publish locks do not form a lock-order cycle.

## Backward compatibility

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

`src/launcher.mjs` is the stable command dispatcher. It resolves entry points from its own installed application path, not the caller's working directory. Supported commands are `quick`, `full`, `publish`, `scheduled`, `setup-login`, and `doctor`.

The `.cmd`, PowerShell, and npm entry points all delegate through this launcher. Scheduled sync resolves the child sync entry through the same application-root abstraction. Runtime wrappers fail with a reinstall/setup message if packaged dependencies are missing; they never attempt to modify the installed application tree.

## Google Drive choice

New configs set `drivePublish.enabled` to `false` and leave `destination` blank. Publishing runs only after the user explicitly enables it and selects a Google Drive for desktop folder. An explicit choice from a legacy config is preserved during migration.

## Portable packaged-runtime contract

`npm run build:windows-bundle` creates the intermediate x64 application bundle under `dist\Brightspace Sync`. It is a portable packaging proof, not the public installer or a `Setup.exe`.

The bundle contains a private, checksum-verified Node.js 24.20.0 x64 runtime at `runtime\node.exe`. Node 24 is used because Node 20 reached end of life in March 2026; Node 24 remains supported LTS. The packaged `Brightspace Sync.cmd` resolves both the private runtime and `app\src\launcher.mjs` relative to its own location, so it does not use `node` from `PATH` or depend on the caller's working directory. End users do not need Node.js, npm, Git, or a source checkout, and the launcher does not require PowerShell execution-policy changes.

The packaged application tree contains only runtime source, the generic example configuration, application/runtime licenses, and locked production dependencies. Playwright's JavaScript runtime is installed with lifecycle scripts and browser downloads disabled. Chromium is not bundled: the current runtime continues to use an installed Edge, Chrome, or Brave browser.

The package layout is:

```text
dist\Brightspace Sync\
  Brightspace Sync.cmd
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

Application files remain immutable at runtime. Configuration, browser session, state, locks, and logs continue to use `%LOCALAPPDATA%\Brightspace Sync`, subject to the existing `BRIGHTSPACE_SYNC_DATA_DIR` override. The mirror remains separate and user-selectable, including through `BRIGHTSPACE_SYNC_MIRROR_DIR`.

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
- During installer/setup UI work, resolve the actual Windows Documents known folder rather than deriving it from the user home; Documents may be redirected through OneDrive, enterprise policy, or another custom location.
- Provide safe discovery and migration of an older source checkout during installation, including an option for the user to select the old installation when it cannot be found automatically.
- Treat an `outputDir` change as an explicit relocation operation. Offer choices to use a new location or move the existing mirror, and preserve runtime-state and Drive-publishing behavior correctly.
- Consider both per-user/no-admin and per-machine installation. Do not hard-code a `Program Files`-only installation unless that decision is made explicitly later.
- Keep the mirror user-selectable and allow setup to choose a specific school-folder location instead of forcing the default Documents path. Google Drive publishing remains a separate, optional destination.

### Installer and release-phase work

The following work remains intentionally deferred to later milestones:

- first-run/setup UI
- settings UI
- Start Menu shortcuts
- scheduling UI and Task Scheduler integration
- repair behavior
- uninstall behavior
- choices to preserve or delete user data during uninstall
- clean Windows VM installation testing
- legacy upgrade testing
- repair testing
- uninstall testing
- code signing
- optional automatic updates

No installer artifact should be published until the applicable install, upgrade, repair, and uninstall flows pass end-to-end testing.
