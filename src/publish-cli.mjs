import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { absoluteFrom, exists } from './utils.mjs';
import { publishMirrorToDrive } from './publish.mjs';
import { acquireSyncLock, describeActiveLock } from './sync-lock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const EXAMPLE_FILE = path.join(ROOT, 'config.example.json');

async function runPublish() {
  const source = await exists(CONFIG_FILE) ? CONFIG_FILE : EXAMPLE_FILE;
  const raw = JSON.parse(await fs.readFile(source, 'utf8'));
  const config = {
    ...raw,
    outputDir: absoluteFrom(ROOT, raw.outputDir || './BrightspaceMirror'),
    systemDir: path.join(absoluteFrom(ROOT, raw.outputDir || './BrightspaceMirror'), '_system')
  };
  const result = await publishMirrorToDrive(config, 'manual');
  if (result.skipped) {
    console.log(`Drive publish skipped: ${result.reason}.`);
    if (result.destination) console.log(`Destination: ${result.destination}`);
    return;
  }
  console.log(`Drive publish complete: ${result.copied} copied, ${result.deleted} deleted, ${result.unchanged} unchanged, ${result.failed} failed.`);
  console.log(`Destination: ${result.destination}`);
  console.log(`Duration: ${result.durationSeconds}s`);
  if (result.failed) process.exitCode = 2;
}

async function main() {
  const lock = await acquireSyncLock(ROOT, { mode: 'publish' });
  if (!lock.acquired) {
    console.log(`Another Brightspace operation is already running: ${describeActiveLock(lock)}.`);
    console.log('Manual Drive publish was skipped so it cannot copy a partially-updated mirror.');
    return;
  }
  try {
    await runPublish();
  } finally {
    await lock.release();
  }
}

main().catch(error => {
  console.error(`\nERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
});
