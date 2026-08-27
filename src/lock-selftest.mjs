import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireSyncLock } from './sync-lock.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'brightspace-lock-selftest-'));
try {
  const first = await acquireSyncLock(root, { mode: 'quick' });
  if (!first.acquired) throw new Error('first lock was not acquired');

  const second = await acquireSyncLock(root, { mode: 'full' });
  if (second.acquired || second.reason !== 'another-run-active') throw new Error('second lock should have been blocked');

  await first.release();

  const third = await acquireSyncLock(root, { mode: 'publish' });
  if (!third.acquired) throw new Error('lock was not available after release');
  await third.release();

  const staleFile = path.join(root, '.brightspace-sync.lock');
  await fs.writeFile(staleFile, JSON.stringify({ pid: 99999999, mode: 'stale', startedAt: '2000-01-01T00:00:00.000Z' }));
  const recovered = await acquireSyncLock(root, { mode: 'quick' });
  if (!recovered.acquired) throw new Error('stale lock was not recovered');
  await recovered.release();

  console.log('Lock self-test passed.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
