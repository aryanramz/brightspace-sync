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

`BRIGHTSPACE_SYNC_DATA_DIR` and `BRIGHTSPACE_SYNC_MIRROR_DIR` can override the normal roots for controlled testing or managed deployments. They are not required for a normal install.

## Backward compatibility

On first run, if the per-user configuration does not yet exist, the runtime looks for a legacy `config.json` beside the application. It copies that config to the new location and converts a relative `outputDir` to the equivalent absolute path.

The legacy `profileDir` setting is used as a migration source and then removed from the new config. The runtime owns the current browser-profile location so application updates cannot redirect the session back into `Program Files`.

When the new destinations are absent, the runtime also copies recognized legacy data:

- `.brightspace-profile` or a repo-relative configured profile to `BrowserProfile`
- `_system/state.json` or legacy `_sync_state.json` to `state\state.json`
- `_system/drive_publish_state.json` to `state\drive_publish_state.json`
- per-course `_sync_state.json` data into `state\courses\<course-id>.json` as each course is next synchronized

Migration does not overwrite an existing destination and does not delete the legacy source. Repeated startup is idempotent. Applied actions are recorded in `state\runtime-migrations.json`.

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
