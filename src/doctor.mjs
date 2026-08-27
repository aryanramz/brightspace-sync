import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { findChromiumExecutable } from './browser.mjs';

console.log(`Node: ${process.version}`);
console.log(`Platform: ${process.platform} ${process.arch}`);

let ok = true;
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error('Node check: FAIL (Node.js 20+ is required)');
  ok = false;
} else {
  console.log('Node check: PASS');
}

if (process.platform !== 'win32') {
  console.error('Platform check: FAIL (Brightspace Sync is currently supported on Windows 10/11 only)');
  ok = false;
} else {
  console.log('Platform check: PASS (Windows)');
}

try {
  const pkg = JSON.parse(await fsPromises.readFile(path.resolve('package.json'), 'utf8'));
  console.log(`Project: ${pkg.name} ${pkg.version}`);
} catch {
  console.error('Project check: FAIL (package.json not found from current directory)');
  ok = false;
}

let configuredPath = '';
try {
  const config = JSON.parse(await fsPromises.readFile(path.resolve('config.json'), 'utf8'));
  configuredPath = config.browserExecutablePath || '';
  console.log('Config: config.json found');
} catch {
  console.log('Config: config.json not present yet (setup will create it from config.example.json)');
}

try {
  const browser = findChromiumExecutable(configuredPath);
  console.log(`Browser check: PASS (${browser.name}: ${browser.path})`);
} catch (error) {
  console.error(`Browser check: FAIL (${error.message})`);
  ok = false;
}

if (!ok) process.exitCode = 1;
else console.log('Doctor: PASS');
