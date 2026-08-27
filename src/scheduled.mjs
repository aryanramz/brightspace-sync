import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { absoluteFrom, exists } from './utils.mjs';

const APP_VERSION = '2.2.0-rc.1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const EXAMPLE_FILE = path.join(ROOT, 'config.example.json');

async function loadSchedulerConfig() {
  const source = await exists(CONFIG_FILE) ? CONFIG_FILE : EXAMPLE_FILE;
  const raw = JSON.parse(await fs.readFile(source, 'utf8'));
  return {
    outputDir: absoluteFrom(ROOT, raw.outputDir || './BrightspaceMirror'),
    fullIntervalDays: Math.max(1, Number(raw.schedule?.fullIntervalDays ?? 7))
  };
}

async function lastFullSync(outputDir) {
  const files = [
    path.join(outputDir, '_school', 'current.json'),
    path.join(outputDir, '_system', 'state.json')
  ];

  for (const file of files) {
    if (!(await exists(file))) continue;
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      const value = data?.sync?.lastFullSync ?? data?.lastFullSync;
      if (value && Number.isFinite(Date.parse(value))) return value;
    } catch {
      // Ignore an unreadable status file and try the next source.
    }
  }
  return null;
}

function chooseMode(lastFull, intervalDays) {
  if (!lastFull) return { mode: 'full', reason: 'no successful Full Sync is recorded yet' };
  const ageMs = Date.now() - Date.parse(lastFull);
  const dueMs = intervalDays * 24 * 60 * 60 * 1000;
  if (ageMs >= dueMs) {
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    return { mode: 'full', reason: `last Full Sync was ${ageDays.toFixed(1)} days ago` };
  }
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return { mode: 'quick', reason: `last Full Sync was ${ageDays.toFixed(1)} days ago` };
}

async function run() {
  const config = await loadSchedulerConfig();
  const lastFull = await lastFullSync(config.outputDir);
  const decision = chooseMode(lastFull, config.fullIntervalDays);

  console.log(`Brightspace Sync v${APP_VERSION} — SCHEDULED`);
  console.log(`Weekly Full interval: ${config.fullIntervalDays} day(s)`);
  console.log(`Last successful Full: ${lastFull || 'none found'}`);
  console.log(`Scheduled decision: ${decision.mode.toUpperCase()} (${decision.reason})`);
  console.log('Manual QUICK_SYNC.cmd and FULL_SYNC.cmd remain unchanged.\n');

  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.mjs'), `--mode=${decision.mode}`], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: false
  });

  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => {
      if (signal) resolve(1);
      else resolve(exitCode ?? 1);
    });
  });
  process.exitCode = code;
}

run().catch(error => {
  console.error(`\nERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
});
