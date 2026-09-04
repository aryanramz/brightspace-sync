import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureDir } from './utils.mjs';

function pidIsRunning(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function readSnapshot(file) {
  try {
    const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    let data = null;
    try { data = JSON.parse(raw); } catch {}
    return { raw, stat, data };
  } catch {
    return null;
  }
}

function snapshotAgeMs(snapshot, nowMs) {
  const startedMs = Date.parse(snapshot?.data?.startedAt || '');
  const basis = Number.isFinite(startedMs) ? startedMs : Number(snapshot?.stat?.mtimeMs || NaN);
  return Number.isFinite(basis) ? Math.max(0, nowMs - basis) : 0;
}

function isSafelyStale(snapshot, { hostname, staleAfterMs, nowMs }) {
  if (!snapshot) return false;
  const ownerHost = String(snapshot.data?.hostname || '');
  const ownerPid = Number(snapshot.data?.pid);
  if (ownerHost && ownerHost === hostname && Number.isInteger(ownerPid) && ownerPid > 0) {
    return !pidIsRunning(ownerPid);
  }
  return snapshotAgeMs(snapshot, nowMs) > staleAfterMs;
}

export async function inspectProcessLock(root, {
  fileName,
  staleAfterMs = 24 * 60 * 60 * 1000,
  nowMs = Date.now(),
  hostname = os.hostname()
}) {
  if (!fileName) throw new Error('A process lock fileName is required.');
  const lockFile = path.join(root, fileName);
  const snapshot = await readSnapshot(lockFile);
  if (!snapshot) {
    return { active: false, stale: false, lockFile, existing: null, reason: 'missing' };
  }

  const stale = isSafelyStale(snapshot, { hostname, staleAfterMs, nowMs });
  return {
    active: !stale,
    stale,
    lockFile,
    existing: snapshot.data,
    reason: stale ? 'stale' : 'active'
  };
}

async function removeIfUnchanged(file, snapshot) {
  if (!snapshot) return false;
  const current = await readSnapshot(file);
  if (!current || current.raw !== snapshot.raw) return false;
  try {
    await fs.unlink(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function createExclusiveLock(file, payload) {
  const handle = await fs.open(file, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function acquireProcessLock(root, {
  fileName,
  mode,
  waitMs = 0,
  pollMs = 100,
  staleAfterMs = 24 * 60 * 60 * 1000
}) {
  if (!fileName) throw new Error('A process lock fileName is required.');
  await ensureDir(root);
  const lockFile = path.join(root, fileName);
  const token = randomUUID();
  const hostname = os.hostname();
  const payload = {
    schemaVersion: 1,
    token,
    pid: process.pid,
    mode,
    hostname,
    startedAt: new Date().toISOString()
  };
  const boundedWaitMs = Math.max(0, Number(waitMs) || 0);
  const deadline = Date.now() + boundedWaitMs;

  while (true) {
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
          const current = await readSnapshot(lockFile);
          if (current?.data?.token !== token) return;
          await fs.unlink(lockFile).catch(() => {});
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    const existing = await readSnapshot(lockFile);
    if (isSafelyStale(existing, { hostname, staleAfterMs, nowMs: Date.now() })) {
      if (await removeIfUnchanged(lockFile, existing)) continue;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        acquired: false,
        lockFile,
        existing: existing?.data || null,
        reason: boundedWaitMs > 0 ? 'lock-timeout' : 'another-run-active',
        waitedMs: boundedWaitMs,
        async release() {}
      };
    }
    await delay(Math.min(Math.max(10, Number(pollMs) || 100), remainingMs));
  }
}

export function describeProcessLock(lock) {
  const existing = lock?.existing || {};
  const mode = existing.mode || 'operation';
  const pid = existing.pid || '?';
  const started = existing.startedAt || 'unknown time';
  return `${mode} (PID ${pid}, started ${started})`;
}
