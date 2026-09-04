import fs from 'node:fs/promises';
import path from 'node:path';
import { loadAppConfig } from './config.mjs';
import { inspectSyncLock } from './sync-lock.mjs';

export const DESKTOP_STATUS_SCHEMA_VERSION = 1;

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function isFile(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function normalizedTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function safeOperationLabel(mode) {
  switch (String(mode || '').toLowerCase()) {
    case 'quick': return 'Quick Sync';
    case 'full': return 'Full Sync';
    case 'publish': return 'Drive Publish';
    case 'scheduled': return 'Scheduled Sync';
    default: return 'Brightspace operation';
  }
}

async function activeOperation(paths) {
  const lock = await inspectSyncLock(paths.lockDir);
  return lock.active ? safeOperationLabel(lock.existing?.mode) : null;
}

async function applicationVersion(paths) {
  const pkg = await readJson(path.join(paths.appRoot, 'package.json'));
  if (typeof pkg?.version !== 'string' || !pkg.version) {
    throw new Error('Application package version is unavailable.');
  }
  return pkg.version;
}

export async function getDesktopStatus({ runtime = {} } = {}) {
  const { config, paths } = await loadAppConfig({ mode: 'full', runtime });
  const [appVersion, configExists, profileExists, state, operation] = await Promise.all([
    applicationVersion(paths),
    isFile(paths.configFile),
    isDirectory(paths.profileDir),
    readJson(path.join(paths.stateDir, 'state.json'), {}),
    activeOperation(paths)
  ]);
  const baseUrlConfigured = Boolean(config.baseUrl);

  return {
    schemaVersion: DESKTOP_STATUS_SCHEMA_VERSION,
    appVersion,
    status: operation ? 'running' : 'ready',
    configExists,
    configured: baseUrlConfigured,
    baseUrlConfigured,
    mirrorDir: config.outputDir,
    logsDir: paths.logsDir,
    dataDir: paths.dataDir,
    profileExists,
    lastSync: normalizedTimestamp(state?.lastSuccessfulSync),
    activeOperation: operation
  };
}
