import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_BUNDLE = path.join(ROOT, 'dist', 'Brightspace Sync');
const TEXT_EXTENSIONS = new Set(['.cmd', '.config', '.json', '.mjs', '.js', '.cjs', '.txt', '.md', '.xml']);

async function requireFile(file, label) {
  let stat;
  try { stat = await fs.stat(file); } catch {}
  assert.equal(stat?.isFile(), true, `${label} is missing: ${file}`);
}

async function canonicalWindowsPath(value) {
  // Resolve filesystem aliases (including DOS 8.3 names), not just path syntax.
  return (await fs.realpath(value)).toLowerCase();
}

async function run(command, args, { cwd, env, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => reject(new Error(`${label} could not start: ${error.message}`)));
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function walkFiles(root) {
  const files = [];
  const stack = [''];
  while (stack.length) {
    const relativeDir = stack.pop();
    for (const entry of await fs.readdir(path.join(root, relativeDir), { withFileTypes: true })) {
      const relative = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) stack.push(relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function snapshotTree(root) {
  const snapshot = [];
  for (const relative of await walkFiles(root)) {
    const stat = await fs.stat(path.join(root, relative));
    snapshot.push({ relative, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return snapshot;
}

async function assertNoDeveloperPathsOrSensitiveContent(bundleRoot, files) {
  const forbiddenExactPaths = [ROOT, process.env.USERPROFILE, process.cwd()]
    .filter(Boolean)
    .flatMap(value => [String(value), String(value).replaceAll('\\', '/')] );
  const secretPatterns = [
    /AKIA[0-9A-Z]{16}/,
    /sk-[A-Za-z0-9_-]{20,}/,
    /gh[pousr]_[A-Za-z0-9_]{20,}/,
    /AIza[0-9A-Za-z_-]{30,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  ];
  for (const relative of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
    const text = await fs.readFile(path.join(bundleRoot, relative), 'utf8');
    for (const forbidden of forbiddenExactPaths) {
      assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, `${relative} contains a developer-machine path.`);
    }
    for (const pattern of secretPatterns) assert.equal(pattern.test(text), false, `${relative} contains sensitive material matching ${pattern}.`);
    const firstParty = relative === 'Brightspace Sync.cmd'
      || relative === 'bundle-manifest.json'
      || relative === path.join('app', 'package.json')
      || relative === path.join('app', 'config.example.json')
      || relative.startsWith(`app${path.sep}src${path.sep}`);
    if (firstParty) {
      assert.equal(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.edu\b/i.test(text), false, `${relative} contains an institution email address.`);
    }
  }
}

async function assertBinaryOmitsPaths(file, values) {
  const bytes = await fs.readFile(file);
  for (const value of values.filter(Boolean)) {
    const normalized = String(value);
    for (const encoding of ['utf8', 'utf16le']) {
      assert.equal(bytes.includes(Buffer.from(normalized, encoding)), false, `${path.basename(file)} contains a developer-machine path.`);
    }
  }
}

if (process.platform !== 'win32') throw new Error('The Windows bundle self-test must run on Windows.');
const systemRoot = process.env.SystemRoot || process.env.WINDIR;
if (!systemRoot) throw new Error('SystemRoot is unavailable; cannot construct the isolated Windows system PATH.');
const system32 = path.join(systemRoot, 'System32');
const systemComSpec = path.join(system32, 'cmd.exe');
const isolatedSystemPath = [system32, systemRoot].join(path.delimiter);
await requireFile(systemComSpec, 'Windows command processor');
await requireFile(path.join(SOURCE_BUNDLE, 'Brightspace Sync.cmd'), 'built launcher');
await requireFile(path.join(SOURCE_BUNDLE, 'Brightspace Sync.exe'), 'compiled Windows control panel');
await requireFile(path.join(SOURCE_BUNDLE, 'Brightspace Sync.exe.config'), 'Windows control-panel runtime configuration');
await requireFile(path.join(SOURCE_BUNDLE, 'runtime', 'node.exe'), 'private Node.js runtime');
await requireFile(path.join(SOURCE_BUNDLE, 'app', 'src', 'launcher.mjs'), 'packaged application launcher');
await requireFile(path.join(SOURCE_BUNDLE, 'app', 'node_modules', 'playwright', 'package.json'), 'packaged Playwright dependency');

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'brightspace-windows-bundle-selftest-'));
try {
  const portableRoot = path.join(temp, 'copied-portable-bundle', 'Brightspace Sync');
  const unrelatedCwd = path.join(temp, 'unrelated-working-directory');
  const userHome = path.join(temp, 'isolated-user');
  const dataDir = path.join(temp, 'isolated-runtime-data');
  const mirrorDir = path.join(temp, 'chosen-school-mirror');
  const browserTempDir = path.join(temp, 'ephemeral-browser-temp');
  const browserProfileDir = path.join(temp, 'ephemeral-browser-profile');
  await fs.mkdir(path.dirname(portableRoot), { recursive: true });
  await fs.mkdir(unrelatedCwd, { recursive: true });
  await fs.mkdir(mirrorDir, { recursive: true });
  await fs.mkdir(browserTempDir, { recursive: true });
  await fs.mkdir(browserProfileDir, { recursive: true });
  await fs.cp(SOURCE_BUNDLE, portableRoot, { recursive: true });

  const privateNode = path.join(portableRoot, 'runtime', 'node.exe');
  const controlPanel = path.join(portableRoot, 'Brightspace Sync.exe');
  const launcher = path.join(portableRoot, 'Brightspace Sync.cmd');
  const appRoot = path.join(portableRoot, 'app');
  const manifest = JSON.parse(await fs.readFile(path.join(portableRoot, 'bundle-manifest.json'), 'utf8'));
  assert.equal(manifest.entrypoint, 'Brightspace Sync.cmd', 'Milestone 2A command-line entrypoint must remain compatible');
  assert.equal(manifest.desktopEntrypoint, 'Brightspace Sync.exe');
  assert.equal(manifest.desktop?.technology, '.NET Framework 4.8 WinForms');
  assert.equal(manifest.desktop?.backendSchemaVersion, 1);
  const isolatedEnv = {
    ...process.env,
    PATH: isolatedSystemPath,
    USERPROFILE: userHome,
    LOCALAPPDATA: path.join(userHome, 'AppData', 'Local'),
    BRIGHTSPACE_SYNC_DATA_DIR: dataDir,
    BRIGHTSPACE_SYNC_MIRROR_DIR: mirrorDir,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    TEMP: browserTempDir,
    TMP: browserTempDir
  };
  const browserEnv = {
    ...process.env,
    PATH: isolatedSystemPath,
    BRIGHTSPACE_SYNC_DATA_DIR: dataDir,
    BRIGHTSPACE_SYNC_MIRROR_DIR: mirrorDir,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
  };

  assert.equal(browserEnv.PATH, isolatedSystemPath);
  assert.equal(browserEnv.USERPROFILE, process.env.USERPROFILE);
  assert.equal(browserEnv.LOCALAPPDATA, process.env.LOCALAPPDATA);
  if (process.env.TEMP !== undefined) assert.equal(browserEnv.TEMP, process.env.TEMP);
  if (process.env.TMP !== undefined) assert.equal(browserEnv.TMP, process.env.TMP);
  assert.equal(browserEnv.BRIGHTSPACE_SYNC_DATA_DIR, dataDir);
  assert.equal(browserEnv.BRIGHTSPACE_SYNC_MIRROR_DIR, mirrorDir);
  assert.equal(browserEnv.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');

  const pathNode = await run(systemComSpec, ['/d', '/s', '/c', 'node --version'], {
    cwd: unrelatedCwd,
    env: isolatedEnv,
    label: 'PATH isolation probe'
  });
  assert.notEqual(pathNode.code, 0, 'ordinary node must be unavailable through PATH during the portable test');
  const whereNode = await run(systemComSpec, ['/d', '/s', '/c', 'where node'], {
    cwd: unrelatedCwd,
    env: isolatedEnv,
    label: 'PATH Node lookup probe'
  });
  assert.notEqual(whereNode.code, 0, 'where node must fail under the isolated Windows system PATH');
  const whereTaskkill = await run(systemComSpec, ['/d', '/s', '/c', 'where taskkill.exe'], {
    cwd: unrelatedCwd,
    env: isolatedEnv,
    label: 'Windows taskkill lookup probe'
  });
  assert.equal(whereTaskkill.code, 0, `taskkill.exe must remain available under the isolated Windows system PATH: ${whereTaskkill.stderr}`);
  assert.equal(whereTaskkill.stdout.toLowerCase().includes(path.join(system32, 'taskkill.exe').toLowerCase()), true);
  console.log('Sanitized PATH probes: PASS (Node unavailable; taskkill.exe available)');

  const privateVersion = await run(privateNode, ['--version'], {
    cwd: unrelatedCwd,
    env: isolatedEnv,
    label: 'private Node.js version probe'
  });
  assert.equal(privateVersion.code, 0, privateVersion.stderr);
  assert.equal(privateVersion.stdout.trim(), `v${manifest.runtime.version}`);

  const dependencyProbe = [
    "const resolved = require.resolve('playwright', { paths: [process.env.BRIGHTSPACE_SYNC_PACKAGED_APP] });",
    "const playwright = require(resolved);",
    "if (!playwright.chromium) throw new Error('Playwright chromium API is unavailable');",
    'console.log(resolved);'
  ].join(' ');
  const dependency = await run(privateNode, ['-e', dependencyProbe], {
    cwd: unrelatedCwd,
    env: { ...isolatedEnv, BRIGHTSPACE_SYNC_PACKAGED_APP: appRoot },
    label: 'packaged production dependency probe'
  });
  assert.equal(dependency.code, 0, dependency.stderr);
  assert.equal(path.resolve(dependency.stdout.trim()).startsWith(path.join(appRoot, 'node_modules')), true);

  const before = await snapshotTree(portableRoot);
  const doctorWrapper = path.join(unrelatedCwd, 'invoke-packaged-doctor.cmd');
  await fs.writeFile(doctorWrapper, `@echo off\r\ncall "${launcher}" doctor\r\nexit /b %ERRORLEVEL%\r\n`, 'utf8');
  const doctor = await run(systemComSpec, ['/d', '/c', doctorWrapper], {
    cwd: unrelatedCwd,
    env: isolatedEnv,
    label: 'packaged doctor launcher'
  });
  assert.equal(doctor.code, 0, `${doctor.stdout}\n${doctor.stderr}`);
  assert.match(doctor.stdout, new RegExp(`Node: v${manifest.runtime.version.replaceAll('.', '\\.')}\\b`));
  assert.equal(doctor.stdout.includes(`Application: ${appRoot}`), true, 'packaged application root must resolve inside the copied bundle');
  assert.equal(doctor.stdout.includes(`Config: ${path.join(dataDir, 'config.json')}`), true);
  assert.equal(doctor.stdout.includes(`Mirror: ${mirrorDir}`), true);
  assert.deepEqual(await snapshotTree(portableRoot), before, 'packaged doctor must not modify the application bundle');

  const userConfigFile = path.join(dataDir, 'config.json');
  const userConfig = JSON.parse(await fs.readFile(userConfigFile, 'utf8'));
  userConfig.baseUrl = 'https://example.test';
  await fs.writeFile(userConfigFile, `${JSON.stringify(userConfig, null, 2)}\n`, 'utf8');

  const controlPanelSelfTestFile = path.join(temp, 'control-panel-self-test.json');
  const controlPanelEnv = { ...isolatedEnv };
  delete controlPanelEnv.BRIGHTSPACE_SYNC_DEV_BUNDLE_ROOT;
  const controlPanelSelfTest = await run(controlPanel, ['--self-test', controlPanelSelfTestFile], {
    cwd: unrelatedCwd,
    env: controlPanelEnv,
    label: 'packaged Windows control-panel backend bridge'
  });
  assert.equal(controlPanelSelfTest.code, 0, `${controlPanelSelfTest.stdout}\n${controlPanelSelfTest.stderr}`);
  const controlPanelResult = JSON.parse(await fs.readFile(controlPanelSelfTestFile, 'utf8'));
  const packagedLauncherModule = path.join(appRoot, 'src', 'launcher.mjs');
  assert.equal(controlPanelResult.schemaVersion, 1);
  assert.equal(controlPanelResult.applicationRootContainsSpaces, true, 'packaged GUI root must exercise path handling with spaces');
  assert.equal(await canonicalWindowsPath(controlPanelResult.applicationRoot), await canonicalWindowsPath(portableRoot));
  assert.equal(await canonicalWindowsPath(controlPanelResult.nodeExecutable), await canonicalWindowsPath(privateNode));
  assert.equal(await canonicalWindowsPath(controlPanelResult.processFileName), await canonicalWindowsPath(privateNode));
  assert.equal(await canonicalWindowsPath(controlPanelResult.quickProcessFileName), await canonicalWindowsPath(privateNode));
  assert.equal(await canonicalWindowsPath(controlPanelResult.fullProcessFileName), await canonicalWindowsPath(privateNode));
  assert.equal(await canonicalWindowsPath(controlPanelResult.launcherScript), await canonicalWindowsPath(packagedLauncherModule));
  assert.equal(await canonicalWindowsPath(controlPanelResult.workingDirectory), await canonicalWindowsPath(appRoot));
  assert.equal(controlPanelResult.processArguments, `"${controlPanelResult.launcherScript}" status --json`);
  assert.equal(controlPanelResult.quickProcessArguments, `"${controlPanelResult.launcherScript}" quick`);
  assert.equal(controlPanelResult.fullProcessArguments, `"${controlPanelResult.launcherScript}" full`);
  assert.equal(controlPanelResult.useShellExecute, false);
  assert.equal(controlPanelResult.createNoWindow, true);
  assert.equal(controlPanelResult.redirectStandardOutput, true);
  assert.equal(controlPanelResult.redirectStandardError, true);
  assert.equal(controlPanelResult.statusSchemaVersion, 1);
  assert.equal(await canonicalWindowsPath(controlPanelResult.statusDataDir), await canonicalWindowsPath(dataDir));
  assert.equal(await canonicalWindowsPath(controlPanelResult.statusMirrorDir), await canonicalWindowsPath(mirrorDir));
  assert.equal(await canonicalWindowsPath(controlPanelResult.statusLogsDir), await canonicalWindowsPath(path.join(dataDir, 'logs')));
  assert.equal(controlPanelResult.statusRefreshIntervalMilliseconds, 5000);
  assert.equal(controlPanelResult.initialButtonsEnabled, true, 'configured control panel must initially enable sync buttons');
  assert.equal(controlPanelResult.externalLockStartedDisablesButtons, true, 'an external live lock must disable sync buttons on refresh');
  assert.equal(controlPanelResult.externalLockFinishedReturnsReady, true, 'removing an external lock must return the same control panel to Ready');
  assert.equal(controlPanelResult.overlappingPollSkipped, true, 'a status poll must skip while another status refresh is active');
  assert.equal(controlPanelResult.maximumConcurrentStatusPolls, 1, 'status polls must never overlap');
  assert.equal(controlPanelResult.sanitizedDiagnosticMaximumCharacters, 4096);
  assert.equal(controlPanelResult.syntheticSecretsRemoved, true);
  assert.equal(controlPanelResult.failureLogCreated, true);
  assert.equal(controlPanelResult.failedGuiOperationLogged, true, 'a failed GUI operation must produce a diagnostic log entry');
  assert.equal(controlPanelResult.failureLogOmitsRawStdout, true);
  assert.equal(controlPanelResult.preflightActiveOperationBlockedLaunch, true, 'sync preflight must not launch while another operation is active');
  const failureLog = await fs.readFile(path.join(dataDir, 'logs', 'backend-failures.log'), 'utf8');
  for (const forbidden of ['ExampleSecret123', 'fake-token-value', 'fake-value', 'ticket=fake-secret', 'RAW_STDOUT_MUST_NOT_BE_WRITTEN']) {
    assert.equal(failureLog.includes(forbidden), false, `sanitized failure log retained forbidden synthetic value: ${forbidden}`);
  }
  assert.equal(failureLog.includes('[REDACTED'), true, 'failure log must retain a useful redacted diagnostic');
  assert.deepEqual(await snapshotTree(portableRoot), before, 'packaged control-panel bridge must not modify the application bundle');
  console.log('Packaged Windows control-panel bridge: PASS');
  userConfig.baseUrl = '';
  await fs.writeFile(userConfigFile, `${JSON.stringify(userConfig, null, 2)}\n`, 'utf8');

  const packagedBrowserModule = path.join(appRoot, 'src', 'browser.mjs');
  const packagedPlaywrightModule = path.join(appRoot, 'node_modules', 'playwright', 'index.mjs');
  await requireFile(packagedBrowserModule, 'packaged browser-detection implementation');
  await requireFile(packagedPlaywrightModule, 'packaged Playwright module');
  const browserLaunchProbe = [
    "import { pathToFileURL } from 'node:url';",
    "const detector = await import(pathToFileURL(process.env.BRIGHTSPACE_SYNC_PACKAGED_BROWSER_MODULE).href);",
    "const playwright = await import(pathToFileURL(process.env.BRIGHTSPACE_SYNC_PACKAGED_PLAYWRIGHT_MODULE).href);",
    'const detected = detector.findChromiumExecutable();',
    'const profileDir = process.env.BRIGHTSPACE_SYNC_BROWSER_PROFILE_DIR;',
    'let context;',
    'try {',
    '  context = await playwright.chromium.launchPersistentContext(profileDir, {',
    '    executablePath: detected.path,',
    '    headless: true,',
    "    args: ['--no-first-run', '--no-default-browser-check']",
    '  });',
    '  const page = context.pages()[0] || await context.newPage();',
    "  await page.goto('data:text/html,<title>Brightspace Sync Bundle Smoke</title><p>ok</p>');",
    '  const pageTitle = await page.title();',
    "  if (pageTitle !== 'Brightspace Sync Bundle Smoke') throw new Error(`Unexpected page title: ${pageTitle}`);",
    '  console.log(JSON.stringify({',
    '    browserName: detected.name,',
    '    browserPath: detected.path,',
    '    nodeExecutable: process.execPath,',
    '    playwrightModule: process.env.BRIGHTSPACE_SYNC_PACKAGED_PLAYWRIGHT_MODULE,',
    '    profileDir,',
    '    pageTitle,',
    '    pageUrl: page.url()',
    '  }));',
    '} finally {',
    '  if (context) await context.close();',
    '}'
  ].join('\n');
  const browserLaunch = await run(privateNode, ['--input-type=module', '-e', browserLaunchProbe], {
    cwd: unrelatedCwd,
    env: {
      ...browserEnv,
      BRIGHTSPACE_SYNC_PACKAGED_BROWSER_MODULE: packagedBrowserModule,
      BRIGHTSPACE_SYNC_PACKAGED_PLAYWRIGHT_MODULE: packagedPlaywrightModule,
      BRIGHTSPACE_SYNC_BROWSER_PROFILE_DIR: browserProfileDir
    },
    label: 'packaged headless browser launch'
  });
  assert.equal(browserLaunch.code, 0, `${browserLaunch.stdout}\n${browserLaunch.stderr}`);
  const browserResult = JSON.parse(browserLaunch.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(['Microsoft Edge', 'Google Chrome', 'Brave'].includes(browserResult.browserName), true, `unsupported browser detected: ${browserResult.browserName}`);
  assert.equal(await canonicalWindowsPath(browserResult.nodeExecutable), await canonicalWindowsPath(privateNode), 'browser probe must run with packaged private Node');
  assert.equal(await canonicalWindowsPath(browserResult.playwrightModule), await canonicalWindowsPath(packagedPlaywrightModule), 'browser probe must load packaged Playwright');
  assert.equal(await canonicalWindowsPath(browserResult.profileDir), await canonicalWindowsPath(browserProfileDir), 'browser must use the explicit test-owned profile');
  assert.equal(browserResult.pageTitle, 'Brightspace Sync Bundle Smoke');
  assert.match(browserResult.pageUrl, /^data:text\/html,/);
  assert.deepEqual(await snapshotTree(portableRoot), before, 'packaged browser launch must not modify the application bundle');
  await fs.rm(browserProfileDir, { recursive: true, force: true });
  await assert.rejects(fs.access(browserProfileDir), 'ephemeral browser profile must be removed after the launch');
  console.log(`Packaged browser launch: PASS (${browserResult.browserName}: ${browserResult.browserPath})`);

  await requireFile(path.join(dataDir, 'config.json'), 'external per-user config');
  const config = JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf8'));
  assert.equal(config.baseUrl, '');
  assert.equal(config.drivePublish?.enabled, false);
  for (const externalDir of ['BrowserProfile', 'state', 'logs']) {
    const stat = await fs.stat(path.join(dataDir, externalDir));
    assert.equal(stat.isDirectory(), true, `${externalDir} must be created outside the package`);
  }

  for (const forbidden of [
    path.join(appRoot, 'config.json'),
    path.join(appRoot, 'BrowserProfile'),
    path.join(appRoot, 'state'),
    path.join(appRoot, 'logs'),
    path.join(appRoot, 'Brightspace Mirror'),
    path.join(portableRoot, 'config.json'),
    path.join(portableRoot, 'BrowserProfile'),
    path.join(portableRoot, 'state'),
    path.join(portableRoot, 'logs')
  ]) await assert.rejects(fs.access(forbidden), `runtime path must not exist in package: ${forbidden}`);

  const packagedFiles = await walkFiles(portableRoot);
  assert.equal(packagedFiles.some(relative => relative.includes('.local-browsers')), false, 'bundle must not contain Playwright-downloaded browsers');
  assert.equal(packagedFiles.some(relative => /(?:^|[\\/])(?:config\.json|\.env|_sync_state\.json)$/i.test(relative)), false, 'bundle must not contain runtime configuration, secrets, or legacy state');
  assert.equal(packagedFiles.some(relative => /(?:^|[\\/])(?:BrowserProfile|\.brightspace-profile|BrightspaceMirror)(?:[\\/]|$)/i.test(relative)), false, 'bundle must not contain a browser profile or mirror');
  await assertNoDeveloperPathsOrSensitiveContent(portableRoot, packagedFiles);
  await assertBinaryOmitsPaths(controlPanel, [ROOT, process.env.USERPROFILE, process.cwd()]);

  console.log('Windows portable bundle self-test: PASS');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
