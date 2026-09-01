import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, exists, writeJson } from './utils.mjs';
import { resolveConfiguredPath, resolveRuntimePaths } from './runtime-paths.mjs';

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function readConfigJson(file, label) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${label} at ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} at ${file}: ${error.message}`);
  }
}

async function copyIfMissing(source, target) {
  if (!(await exists(source)) || await exists(target)) return false;
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
  return true;
}

async function copyDirectoryIfMissing(source, target) {
  if (!(await exists(source)) || await exists(target)) return false;
  await ensureDir(path.dirname(target));
  await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
  return true;
}

function adaptLegacyConfig(raw, paths) {
  const next = { ...raw };
  if (next.outputDir) {
    next.outputDir = resolveConfiguredPath(next.outputDir, {
      relativeTo: paths.appRoot,
      fallback: paths.defaultMirrorDir
    });
  }
  if (next.browserExecutablePath && !path.isAbsolute(next.browserExecutablePath)) {
    next.browserExecutablePath = path.resolve(paths.appRoot, next.browserExecutablePath);
  }
  if (next.drivePublish?.destination && !path.isAbsolute(next.drivePublish.destination)) {
    next.drivePublish = {
      ...next.drivePublish,
      destination: path.resolve(paths.appRoot, next.drivePublish.destination)
    };
  }
  next.drivePublish = {
    ...(next.drivePublish || {}),
    enabled: next.drivePublish?.enabled ?? false
  };
  return next;
}

async function recordRuntimeMigrations(paths, actions) {
  if (!actions.length) return;
  const prior = await readJson(paths.migrationLogFile, { migrations: [] });
  const migrations = Array.isArray(prior?.migrations) ? prior.migrations : [];
  migrations.push({ at: new Date().toISOString(), actions });
  await writeJson(paths.migrationLogFile, { migrations: migrations.slice(-50) });
}

async function prepareUserConfig(paths, actions) {
  await ensureDir(paths.dataDir);
  await ensureDir(paths.stateDir);
  await ensureDir(paths.logsDir);

  if (await exists(paths.configFile)) return readConfigJson(paths.configFile, 'user configuration');

  if (await exists(paths.legacyConfigFile)) {
    const legacy = await readConfigJson(paths.legacyConfigFile, 'legacy configuration');
    const migrated = adaptLegacyConfig(legacy, paths);
    await writeJson(paths.configFile, migrated);
    actions.push({ action: 'copy-legacy-config', from: paths.legacyConfigFile, to: paths.configFile });
    return migrated;
  }

  const example = await readConfigJson(paths.bundledConfigFile, 'bundled example configuration');
  const initial = { ...example };
  delete initial.profileDir;
  initial.drivePublish = {
    ...(initial.drivePublish || {}),
    enabled: false
  };
  await writeJson(paths.configFile, initial);
  actions.push({ action: 'create-user-config', from: paths.bundledConfigFile, to: paths.configFile });
  return initial;
}

async function migrateLegacyProfile(raw, paths, actions) {
  const configuredLegacyProfile = raw.profileDir
    ? resolveConfiguredPath(raw.profileDir, { relativeTo: paths.appRoot, fallback: path.join(paths.appRoot, '.brightspace-profile') })
    : null;
  const candidates = [configuredLegacyProfile, path.join(paths.appRoot, '.brightspace-profile')]
    .filter((value, index, all) => value && all.indexOf(value) === index);

  for (const source of candidates) {
    if (await copyDirectoryIfMissing(source, paths.profileDir)) {
      actions.push({ action: 'copy-legacy-browser-profile', from: source, to: paths.profileDir });
      break;
    }
  }
  await ensureDir(paths.profileDir);
}

async function removeDeprecatedProfileSetting(raw, paths, actions) {
  if (!Object.hasOwn(raw, 'profileDir')) return raw;
  const next = { ...raw };
  delete next.profileDir;
  await writeJson(paths.configFile, next);
  actions.push({ action: 'remove-deprecated-profile-setting', file: paths.configFile });
  return next;
}

async function migrateLegacyState(outputDir, paths, actions) {
  const candidates = [
    [path.join(outputDir, '_system', 'state.json'), path.join(paths.stateDir, 'state.json')],
    [path.join(outputDir, '_system', 'drive_publish_state.json'), path.join(paths.stateDir, 'drive_publish_state.json')],
    [path.join(outputDir, '_sync_state.json'), path.join(paths.stateDir, 'state.json')]
  ];
  for (const [source, target] of candidates) {
    if (await copyIfMissing(source, target)) {
      actions.push({ action: 'copy-legacy-runtime-state', from: source, to: target });
    }
  }
}

export async function loadAppConfig({ mode = 'full', runtime = {} } = {}) {
  const paths = resolveRuntimePaths(runtime);
  const actions = [];
  let raw = await prepareUserConfig(paths, actions);

  // profileDir was part of pre-installer config. It is used only as a migration
  // source; current versions always keep the authenticated profile in user data.
  await migrateLegacyProfile(raw, paths, actions);
  raw = await removeDeprecatedProfileSetting(raw, paths, actions);

  const outputDir = resolveConfiguredPath(raw.outputDir, {
    relativeTo: paths.dataDir,
    fallback: paths.defaultMirrorDir
  });
  await migrateLegacyState(outputDir, paths, actions);
  await recordRuntimeMigrations(paths, actions);

  const config = {
    ...raw,
    syncMode: mode,
    incrementalSync: raw.incrementalSync ?? true,
    captureNetwork: raw.captureNetwork ?? false,
    writeChangeLog: raw.writeChangeLog ?? true,
    writeUpdateDiagnostics: raw.writeUpdateDiagnostics ?? true,
    activeTerms: Array.isArray(raw.activeTerms) ? raw.activeTerms : [],
    includeUpcomingTermDays: Number(raw.includeUpcomingTermDays ?? 21),
    quickSections: Array.isArray(raw.quickSections) ? raw.quickSections : ['assignments', 'quizzes', 'grades', 'calendar', 'announcements'],
    quickDetailSections: Array.isArray(raw.quickDetailSections) ? raw.quickDetailSections : ['announcements'],
    quickAssetDownloadSections: Array.isArray(raw.quickAssetDownloadSections) ? raw.quickAssetDownloadSections : ['announcements'],
    dynamicWaitMs: mode === 'quick' ? Number(raw.quickDynamicWaitMs ?? 1200) : Number(raw.dynamicWaitMs ?? 2200),
    auth: {
      autoSubmitSavedBrowserCredentials: raw.auth?.autoSubmitSavedBrowserCredentials ?? true,
      manualLoginTimeoutMs: Number(raw.auth?.manualLoginTimeoutMs ?? 10 * 60 * 1000)
    },
    drivePublish: {
      enabled: raw.drivePublish?.enabled ?? false,
      destination: raw.drivePublish?.destination
        ? resolveConfiguredPath(raw.drivePublish.destination, { relativeTo: paths.dataDir, fallback: '' })
        : '',
      deleteRemoved: raw.drivePublish?.deleteRemoved ?? true,
      verifyDestinationOnFull: raw.drivePublish?.verifyDestinationOnFull ?? true,
      retryAttempts: Number(raw.drivePublish?.retryAttempts ?? 4),
      retryDelayMs: Number(raw.drivePublish?.retryDelayMs ?? 700)
    },
    assetPolicy: {
      downloadDocuments: true,
      downloadImages: true,
      downloadTranscripts: true,
      downloadArchives: true,
      downloadVideo: false,
      downloadAudio: false,
      maxDownloadBytes: 25 * 1024 * 1024,
      indexExternalAssets: true,
      ...(raw.assetPolicy || {})
    },
    baseUrl: String(raw.baseUrl || '').replace(/\/$/, ''),
    browserExecutablePath: raw.browserExecutablePath
      ? resolveConfiguredPath(raw.browserExecutablePath, { relativeTo: paths.dataDir, fallback: '' })
      : '',
    outputDir,
    profileDir: paths.profileDir,
    stateDir: paths.stateDir,
    logsDir: paths.logsDir,
    configFile: paths.configFile,
    appRoot: paths.appRoot
  };

  return { config, paths, migrations: actions };
}
