import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { absoluteFrom, ensureDir, exists } from './utils.mjs';
import { findChromiumExecutable } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const EXAMPLE_FILE = path.join(ROOT, 'config.example.json');

const source = await exists(CONFIG_FILE) ? CONFIG_FILE : EXAMPLE_FILE;
const raw = JSON.parse(await fs.readFile(source, 'utf8'));
const profileDir = absoluteFrom(ROOT, raw.profileDir || './.brightspace-profile');
const baseUrl = String(raw.baseUrl || '').replace(/\/$/, '');
if (!baseUrl) throw new Error('baseUrl is missing from config.json.');
await ensureDir(profileDir);

const browser = findChromiumExecutable(raw.browserExecutablePath);
console.log(`Opening the dedicated Brightspace Sync profile in ${browser.name}.`);
console.log(`Browser: ${browser.path}`);
console.log(`Profile: ${profileDir}`);
console.log(`Site:    ${baseUrl}`);
console.log('');
console.log('Sign in normally to establish an authenticated session in this dedicated browser profile.');
console.log('Saving the login in the browser password manager is optional; automatic password-manager submission is best-effort only.');
console.log('If your institution offers a trusted/remembered MFA device option, choose it only if appropriate for your own device.');
console.log('Close this browser window when you are done. Brightspace Sync does not require a password in config.json or source code.');
console.log('Session cookies remain inside the dedicated Chromium profile; no standalone cookie/state export is created.');
console.log('');

const child = spawn(browser.path, [`--user-data-dir=${profileDir}`, '--no-default-browser-check', baseUrl], {
  detached: true,
  stdio: 'ignore',
  windowsHide: false
});
child.unref();
