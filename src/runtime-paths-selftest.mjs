import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyDirectoryTransactionalIfMissing, CURRENT_CONFIG_VERSION, loadAppConfig } from './config.mjs';
import { applicationEntry, resolveRuntimePaths } from './runtime-paths.mjs';

async function listTree(root) {
  const found = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      found.push(path.relative(root, full).replace(/\\/g, '/'));
      if (entry.isDirectory()) await walk(full);
    }
  }
  await walk(root);
  return found.sort();
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'brightspace-runtime-paths-'));
try {
  const userHome = path.join(tmp, 'User');
  const localAppData = path.join(userHome, 'AppData', 'Local');
  const appRoot = path.join(tmp, 'Program Files', 'Brightspace Sync');
  const legacyMirror = path.join(appRoot, 'LegacyMirror');
  await fs.mkdir(path.join(appRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'config.example.json'), JSON.stringify({
    baseUrl: 'https://your-school.brightspace.com',
    outputDir: '',
    drivePublish: { enabled: false, destination: '' }
  }, null, 2));
  await fs.writeFile(path.join(appRoot, 'config.json'), JSON.stringify({
    baseUrl: 'https://example.brightspace.com',
    outputDir: './LegacyMirror',
    profileDir: './CustomProfile',
    drivePublish: { enabled: true, destination: 'G:\\My Drive\\Brightspace Mirror' }
  }, null, 2));
  await fs.mkdir(path.join(appRoot, 'CustomProfile'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'CustomProfile', 'Cookies'), 'legacy-session');
  await fs.mkdir(path.join(legacyMirror, '_system'), { recursive: true });
  await fs.writeFile(path.join(legacyMirror, '_system', 'state.json'), '{"lastFullSync":"legacy"}');
  await fs.writeFile(path.join(legacyMirror, '_system', 'drive_publish_state.json'), '{"files":{}}');

  const before = await listTree(appRoot);
  const runtime = {
    appRoot,
    env: { LOCALAPPDATA: localAppData, USERPROFILE: userHome },
    platform: 'win32',
    homeDir: userHome
  };
  const first = await loadAppConfig({ mode: 'quick', runtime });
  const expectedDataDir = path.join(localAppData, 'Brightspace Sync');
  assert.equal(first.paths.dataDir, expectedDataDir);
  assert.equal(first.config.configFile, path.join(expectedDataDir, 'config.json'));
  assert.equal(first.config.profileDir, path.join(expectedDataDir, 'BrowserProfile'));
  assert.equal(first.config.stateDir, path.join(expectedDataDir, 'state'));
  assert.equal(first.config.logsDir, path.join(expectedDataDir, 'logs'));
  assert.equal(first.config.outputDir, legacyMirror);
  assert.equal(first.config.drivePublish.enabled, true, 'an existing explicit Drive choice must be preserved');
  assert.equal(await fs.readFile(path.join(first.config.profileDir, 'Cookies'), 'utf8'), 'legacy-session');
  assert.equal((await fs.readFile(path.join(first.config.stateDir, 'state.json'), 'utf8')).includes('legacy'), true);
  await fs.access(path.join(first.config.stateDir, 'drive_publish_state.json'));
  const migratedRaw = JSON.parse(await fs.readFile(first.config.configFile, 'utf8'));
  assert.equal(migratedRaw.configVersion, CURRENT_CONFIG_VERSION);
  assert.equal(migratedRaw.outputDir, legacyMirror, 'legacy relative mirror paths must retain their meaning');
  assert.equal(Object.hasOwn(migratedRaw, 'profileDir'), false, 'profile location is now owned by the runtime');
  assert.deepEqual(await listTree(appRoot), before, 'runtime initialization must not write application files');
  assert.equal(applicationEntry('src/index.mjs', first.paths), path.join(appRoot, 'src', 'index.mjs'));

  const second = await loadAppConfig({ mode: 'full', runtime });
  assert.equal(second.migrations.length, 0, 'runtime migration must be idempotent');

  const transactionSource = path.join(tmp, 'Transaction Source');
  const transactionTarget = path.join(tmp, 'Transaction Data', 'BrowserProfile');
  await fs.mkdir(path.join(transactionSource, 'Default'), { recursive: true });
  await fs.writeFile(path.join(transactionSource, 'Default', 'Cookies'), 'complete-session');
  await assert.rejects(copyDirectoryTransactionalIfMissing(transactionSource, transactionTarget, {
    copy: async (_source, staging) => {
      await fs.mkdir(staging, { recursive: true });
      await fs.writeFile(path.join(staging, 'partial-only'), 'interrupted');
      throw new Error('simulated interrupted profile copy');
    }
  }), /simulated interrupted profile copy/);
  await assert.rejects(fs.access(transactionTarget), 'an interrupted copy must not create the final profile');
  await fs.access(`${transactionTarget}.migrating`);
  assert.equal(await fs.readFile(path.join(transactionSource, 'Default', 'Cookies'), 'utf8'), 'complete-session');

  assert.equal(await copyDirectoryTransactionalIfMissing(transactionSource, transactionTarget), true);
  assert.equal(await fs.readFile(path.join(transactionTarget, 'Default', 'Cookies'), 'utf8'), 'complete-session');
  await assert.rejects(fs.access(path.join(transactionTarget, 'partial-only')), 'retry must discard partial staging data');
  await assert.rejects(fs.access(`${transactionTarget}.migrating`), 'successful rename must consume staging');
  await fs.mkdir(`${transactionTarget}.migrating`, { recursive: true });
  await fs.writeFile(path.join(`${transactionTarget}.migrating`, 'stale'), 'stale');
  assert.equal(await copyDirectoryTransactionalIfMissing(transactionSource, transactionTarget), false, 'completed migration must be idempotent');
  await assert.rejects(fs.access(`${transactionTarget}.migrating`), 'an idempotent retry must clean stale staging');
  assert.equal(await fs.readFile(path.join(transactionSource, 'Default', 'Cookies'), 'utf8'), 'complete-session');

  const unverifiedTarget = path.join(tmp, 'Unverified Data', 'BrowserProfile');
  await fs.mkdir(unverifiedTarget, { recursive: true });
  await fs.writeFile(path.join(unverifiedTarget, 'partial-only'), 'pre-transactional partial copy');
  assert.equal(await copyDirectoryTransactionalIfMissing(transactionSource, unverifiedTarget, {
    replaceUnverifiedTarget: true
  }), true);
  assert.equal(await fs.readFile(path.join(unverifiedTarget, 'Default', 'Cookies'), 'utf8'), 'complete-session');
  await assert.rejects(fs.access(path.join(unverifiedTarget, 'partial-only')), 'an unverified partial final profile must be replaced');
  await assert.rejects(fs.access(`${unverifiedTarget}.incomplete`), 'successful repair must remove its incomplete backup');

  const freshAppRoot = path.join(tmp, 'Fresh App');
  const freshHome = path.join(tmp, 'Fresh User');
  const freshLocalAppData = path.join(freshHome, 'AppData', 'Local');
  await fs.mkdir(freshAppRoot, { recursive: true });
  await fs.copyFile(path.join(appRoot, 'config.example.json'), path.join(freshAppRoot, 'config.example.json'));
  const fresh = await loadAppConfig({
    runtime: {
      appRoot: freshAppRoot,
      env: { LOCALAPPDATA: freshLocalAppData, USERPROFILE: freshHome },
      platform: 'win32',
      homeDir: freshHome
    }
  });
  assert.equal(fresh.config.outputDir, path.join(freshHome, 'Documents', 'Brightspace Mirror'));
  assert.equal(fresh.config.baseUrl, '', 'a generated user config must require setup of baseUrl');
  assert.equal(fresh.config.drivePublish.enabled, false, 'Drive publishing must be opt-in for a new user');
  assert.equal(fresh.config.drivePublish.destination, '');
  const freshRaw = JSON.parse(await fs.readFile(fresh.config.configFile, 'utf8'));
  assert.equal(freshRaw.configVersion, CURRENT_CONFIG_VERSION);
  assert.equal(freshRaw.baseUrl, '');
  const bundledExample = JSON.parse(await fs.readFile(path.join(freshAppRoot, 'config.example.json'), 'utf8'));
  assert.equal(bundledExample.baseUrl, 'https://your-school.brightspace.com');

  const mirrorOverride = path.join(tmp, 'Managed Mirror');
  const withMirrorOverride = await loadAppConfig({
    runtime: {
      ...runtime,
      env: {
        ...runtime.env,
        BRIGHTSPACE_SYNC_MIRROR_DIR: mirrorOverride
      }
    }
  });
  assert.equal(withMirrorOverride.config.outputDir, mirrorOverride, 'environment mirror override must beat configured outputDir');
  const preservedLegacyConfig = JSON.parse(await fs.readFile(withMirrorOverride.config.configFile, 'utf8'));
  assert.equal(preservedLegacyConfig.outputDir, legacyMirror, 'an environment override must not rewrite the saved mirror choice');

  const overridden = resolveRuntimePaths({
    appRoot: freshAppRoot,
    env: {
      USERPROFILE: freshHome,
      LOCALAPPDATA: freshLocalAppData,
      BRIGHTSPACE_SYNC_DATA_DIR: path.join(tmp, 'Custom Data'),
      BRIGHTSPACE_SYNC_MIRROR_DIR: mirrorOverride
    },
    platform: 'win32',
    homeDir: freshHome
  });
  assert.equal(overridden.dataDir, path.join(tmp, 'Custom Data'));
  assert.equal(overridden.mirrorDirOverride, mirrorOverride);

  console.log('Runtime paths self-test: PASS');
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
