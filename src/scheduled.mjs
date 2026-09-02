import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { exists } from './utils.mjs';
import { loadAppConfig } from './config.mjs';
import { applicationEntry } from './runtime-paths.mjs';

const APP_VERSION = '2.4.1';

async function lastFullSync(outputDir, stateDir) {
  const files = [
    path.join(stateDir, 'state.json'),
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
  const { config, paths } = await loadAppConfig();
  const fullIntervalDays = Math.max(1, Number(config.schedule?.fullIntervalDays ?? 7));
  const lastFull = await lastFullSync(config.outputDir, config.stateDir);
  const decision = chooseMode(lastFull, fullIntervalDays);

  console.log(`Brightspace Sync v${APP_VERSION} — SCHEDULED`);
  console.log(`Weekly Full interval: ${fullIntervalDays} day(s)`);
  console.log(`Last successful Full: ${lastFull || 'none found'}`);
  console.log(`Scheduled decision: ${decision.mode.toUpperCase()} (${decision.reason})`);
  console.log('Manual QUICK_SYNC.cmd and FULL_SYNC.cmd remain unchanged.\n');

  const child = spawn(process.execPath, [applicationEntry('src/index.mjs', paths), `--mode=${decision.mode}`], {
    cwd: paths.appRoot,
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
