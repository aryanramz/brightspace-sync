import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const LOCK_FILE_NAME = '.brightspace-sync.lock';

function pidIsRunning(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but this process cannot signal it.
    return error?.code === 'EPERM';
  }
}

async function readLock(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function createExclusiveLock(file, payload) {
  const handle = await fs.open(file, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

export async function acquireSyncLock(root, { mode = 'sync', staleAfterHours = 24 } = {}) {
  const lockFile = path.join(root, LOCK_FILE_NAME);
  const token = randomUUID();
  const payload = {
    schemaVersion: 1,
    token,
    pid: process.pid,
    mode,
    hostname: os.hostname(),
    startedAt: new Date().toISOString()
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await createExclusiveLock(lockFile, payload);
      let released = false;
      return {
        acquired: true,
        lockFile,
        payload,
        async release() {
          if (released) return;
          released = true;
          const current = await readLock(lockFile);
          if (current?.token !== token) return;
          await fs.unlink(lockFile).catch(() => {});
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    const existing = await readLock(lockFile);
    const startedMs = Date.parse(existing?.startedAt || '');
    const ageMs = Number.isFinite(startedMs) ? Date.now() - startedMs : Infinity;
    const staleByAge = ageMs > Number(staleAfterHours) * 60 * 60 * 1000;
    const running = pidIsRunning(existing?.pid);

    if (!running || staleByAge) {
      await fs.unlink(lockFile).catch(() => {});
      continue;
    }

    return {
      acquired: false,
      lockFile,
      existing,
      reason: 'another-run-active',
      async release() {}
    };
  }

  return {
    acquired: false,
    lockFile,
    existing: await readLock(lockFile),
    reason: 'lock-contention',
    async release() {}
  };
}

export function describeActiveLock(lock) {
  const existing = lock?.existing || {};
  const mode = existing.mode || 'sync';
  const pid = existing.pid || '?';
  const started = existing.startedAt || 'unknown time';
  return `${mode} (PID ${pid}, started ${started})`;
}
