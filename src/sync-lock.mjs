import { acquireProcessLock, describeProcessLock } from './process-lock.mjs';

const LOCK_FILE_NAME = '.brightspace-sync.lock';

export async function acquireSyncLock(root, { mode = 'sync', staleAfterHours = 24 } = {}) {
  return acquireProcessLock(root, {
    fileName: LOCK_FILE_NAME,
    mode,
    staleAfterMs: Number(staleAfterHours) * 60 * 60 * 1000
  });
}

export function describeActiveLock(lock) {
  return describeProcessLock(lock);
}
