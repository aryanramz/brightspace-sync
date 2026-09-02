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

## Installer work intentionally deferred

The foundation is ready for packaging, but the final installer still needs product choices and installer-specific verification:

- choose the installer technology and whether Node is bundled
- install application files and dependencies under `Program Files`
- create Start menu shortcuts and optional scheduled-task UI
- provide configuration/mirror/Drive folder pickers
- implement signed upgrade/uninstall behavior that preserves `%LOCALAPPDATA%` and the mirror by default
- verify install, upgrade from a legacy checkout, repair, and uninstall in clean Windows virtual machines

No installer artifact should be published until those flows pass end-to-end tests.
