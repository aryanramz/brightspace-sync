import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { absoluteFrom, ensureDir, exists } from './utils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const EXAMPLE_FILE = path.join(ROOT, 'config.example.json');

function findBraveExecutable(configuredPath) {
  const candidates = [
    configuredPath,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
  ].filter(Boolean);
  for (const candidate of candidates) if (fsSync.existsSync(candidate)) return candidate;
  throw new Error('Brave Browser was not found. Install Brave, or set browserExecutablePath in config.json.');
}

const source = await exists(CONFIG_FILE) ? CONFIG_FILE : EXAMPLE_FILE;
const raw = JSON.parse(await fs.readFile(source, 'utf8'));
const profileDir = absoluteFrom(ROOT, raw.profileDir || './.brightspace-profile');
const baseUrl = String(raw.baseUrl || '').replace(/\/$/, '');
if (!baseUrl) throw new Error('baseUrl is missing from config.json.');
await ensureDir(profileDir);

const brave = findBraveExecutable(raw.browserExecutablePath);
console.log('Opening the dedicated Brightspace Sync Brave profile.');
console.log(`Profile: ${profileDir}`);
console.log(`Site:    ${baseUrl}`);
console.log('');
console.log('Sign in normally to establish an authenticated session in this dedicated profile.');
console.log('Saving the login in Brave is optional; automatic password-manager submission is best-effort only.');
console.log('If your institution offers a trusted/remembered MFA device option, choose it only if appropriate for your own device.');
console.log('Close this Brave window when you are done. Brightspace Sync does not require a password in config.json or source code.');
console.log('');

const child = spawn(brave, [`--user-data-dir=${profileDir}`, '--no-default-browser-check', baseUrl], {
  detached: true,
  stdio: 'ignore',
  windowsHide: false
});
child.unref();
