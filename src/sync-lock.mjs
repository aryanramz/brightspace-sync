import { acquireProcessLock, describeProcessLock, inspectProcessLock } from './process-lock.mjs';

const LOCK_FILE_NAME = '.brightspace-sync.lock';
const DEFAULT_STALE_AFTER_HOURS = 24;

export async function acquireSyncLock(root, { mode = 'sync', staleAfterHours = DEFAULT_STALE_AFTER_HOURS } = {}) {
  return acquireProcessLock(root, {
    fileName: LOCK_FILE_NAME,
    mode,
    staleAfterMs: Number(staleAfterHours) * 60 * 60 * 1000
  });
}

export async function inspectSyncLock(root, { staleAfterHours = DEFAULT_STALE_AFTER_HOURS } = {}) {
  return inspectProcessLock(root, {
    fileName: LOCK_FILE_NAME,
    staleAfterMs: Number(staleAfterHours) * 60 * 60 * 1000
  });
}

export function describeActiveLock(lock) {
  return describeProcessLock(lock);
}
