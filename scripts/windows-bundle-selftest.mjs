import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_BUNDLE = path.join(ROOT, 'dist', 'Brightspace Sync');
const TEXT_EXTENSIONS = new Set(['.cmd', '.json', '.mjs', '.js', '.cjs', '.txt', '.md']);

async function requireFile(file, label) {
  let stat;
  try { stat = await fs.stat(file); } catch {}
  assert.equal(stat?.isFile(), true, `${label} is missing: ${file}`);
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

if (process.platform !== 'win32') throw new Error('The Windows bundle self-test must run on Windows.');
await requireFile(path.join(SOURCE_BUNDLE, 'Brightspace Sync.cmd'), 'built launcher');
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
  await fs.mkdir(path.dirname(portableRoot), { recursive: true });
  await fs.mkdir(unrelatedCwd, { recursive: true });
  await fs.mkdir(browserTempDir, { recursive: true });
  await fs.cp(SOURCE_BUNDLE, portableRoot, { recursive: true });

  const privateNode = path.join(portableRoot, 'runtime', 'node.exe');
  const launcher = path.join(portableRoot, 'Brightspace Sync.cmd');
  const appRoot = path.join(portableRoot, 'app');
  const manifest = JSON.parse(await fs.readFile(path.join(portableRoot, 'bundle-manifest.json'), 'utf8'));
  const isolatedEnv = {
    ...process.env,
    PATH: '',
    USERPROFILE: userHome,
    LOCALAPPDATA: path.join(userHome, 'AppData', 'Local'),
    BRIGHTSPACE_SYNC_DATA_DIR: dataDir,
    BRIGHTSPACE_SYNC_MIRROR_DIR: mirrorDir,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    TEMP: browserTempDir,
    TMP: browserTempDir
  };

  const pathNode = await run(process.env.ComSpec, ['/d', '/s', '/c', 'node --version'], {
    cwd: unrelatedCwd,
    env: isolatedEnv,
    label: 'PATH isolation probe'
  });
  assert.notEqual(pathNode.code, 0, 'ordinary node must be unavailable through PATH during the portable test');

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
  const doctor = await run(process.env.ComSpec, ['/d', '/c', doctorWrapper], {
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

  const packagedBrowserModule = path.join(appRoot, 'src', 'browser.mjs');
  const packagedPlaywrightModule = path.join(appRoot, 'node_modules', 'playwright', 'index.mjs');
  await requireFile(packagedBrowserModule, 'packaged browser-detection implementation');
  await requireFile(packagedPlaywrightModule, 'packaged Playwright module');
  const browserLaunchProbe = [
    "import { pathToFileURL } from 'node:url';",
    "const detector = await import(pathToFileURL(process.env.BRIGHTSPACE_SYNC_PACKAGED_BROWSER_MODULE).href);",
    "const playwright = await import(pathToFileURL(process.env.BRIGHTSPACE_SYNC_PACKAGED_PLAYWRIGHT_MODULE).href);",
    'const detected = detector.findChromiumExecutable();',
    'let browser;',
    'try {',
    '  browser = await playwright.chromium.launch({ executablePath: detected.path, headless: true });',
    '  const page = await browser.newPage();',
    "  await page.goto('about:blank');",
    "  if (page.url() !== 'about:blank') throw new Error(`Unexpected page URL: ${page.url()}`);",
    '  console.log(JSON.stringify({',
    '    browserName: detected.name,',
    '    browserPath: detected.path,',
    '    nodeExecutable: process.execPath,',
    '    playwrightModule: process.env.BRIGHTSPACE_SYNC_PACKAGED_PLAYWRIGHT_MODULE,',
    '    pageUrl: page.url()',
    '  }));',
    '} finally {',
    '  if (browser) await browser.close();',
    '}'
  ].join('\n');
  const browserLaunch = await run(privateNode, ['--input-type=module', '-e', browserLaunchProbe], {
    cwd: unrelatedCwd,
    env: {
      ...isolatedEnv,
      BRIGHTSPACE_SYNC_PACKAGED_BROWSER_MODULE: packagedBrowserModule,
      BRIGHTSPACE_SYNC_PACKAGED_PLAYWRIGHT_MODULE: packagedPlaywrightModule
    },
    label: 'packaged headless browser launch'
  });
  assert.equal(browserLaunch.code, 0, `${browserLaunch.stdout}\n${browserLaunch.stderr}`);
  const browserResult = JSON.parse(browserLaunch.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(['Microsoft Edge', 'Google Chrome', 'Brave'].includes(browserResult.browserName), true, `unsupported browser detected: ${browserResult.browserName}`);
  assert.equal(path.resolve(browserResult.nodeExecutable).toLowerCase(), path.resolve(privateNode).toLowerCase(), 'browser probe must run with packaged private Node');
  assert.equal(path.resolve(browserResult.playwrightModule).toLowerCase(), path.resolve(packagedPlaywrightModule).toLowerCase(), 'browser probe must load packaged Playwright');
  assert.equal(browserResult.pageUrl, 'about:blank');
  assert.deepEqual(await snapshotTree(portableRoot), before, 'packaged browser launch must not modify the application bundle');
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

  console.log('Windows portable bundle self-test: PASS');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
