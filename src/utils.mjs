import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';

export function safeName(value, fallback = 'untitled') {
  const cleaned = String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 150);
  return cleaned || fallback;
}

export function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function currentBuffer(file) {
  try { return await fs.readFile(file); } catch { return null; }
}

export async function writeBufferIfChanged(file, value) {
  await ensureDir(path.dirname(file));
  const next = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '');
  const current = await currentBuffer(file);
  if (current && current.equals(next)) return 'unchanged';
  const action = current ? 'updated' : 'added';
  await fs.writeFile(file, next);
  return action;
}

export async function writeTextIfChanged(file, value) {
  return writeBufferIfChanged(file, Buffer.from(value ?? '', 'utf8'));
}

export async function writeJsonIfChanged(file, value) {
  return writeTextIfChanged(file, JSON.stringify(value, null, 2));
}

export async function writeJsonAtomic(file, value, {
  replace = (temporaryFile, destinationFile) => fs.rename(temporaryFile, destinationFile)
} = {}) {
  await ensureDir(path.dirname(file));
  const next = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const current = await currentBuffer(file);
  if (current && current.equals(next)) return 'unchanged';

  const action = current ? 'updated' : 'added';
  const temporaryFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp-${process.pid}-${crypto.randomUUID()}`
  );
  let handle;
  try {
    handle = await fs.open(temporaryFile, 'wx');
    await handle.writeFile(next);
    await handle.sync();
    await handle.close();
    handle = null;
    await replace(temporaryFile, file);
    return action;
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }
}

// Backward-compatible names. All crawler writes are now content-aware, so an
// unchanged file keeps its original mtime and Drive/rclone will not re-upload it.
export async function writeJson(file, value) {
  return writeJsonIfChanged(file, value);
}

export async function writeText(file, value) {
  return writeTextIfChanged(file, value ?? '');
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export function absoluteFrom(root, maybeRelative) {
  if (!maybeRelative) return root;
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(root, maybeRelative);
}

export function extensionFromContentType(contentType = '') {
  const t = contentType.split(';')[0].trim().toLowerCase();
  const map = {
    'application/pdf': '.pdf',
    'application/json': '.json',
    'application/zip': '.zip',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/msword': '.doc',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.ms-excel': '.xls',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp'
  };
  return map[t] || '';
}

export function filenameFromDisposition(disposition = '') {
  const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf) {
    try { return decodeURIComponent(utf[1].replace(/^"|"$/g, '')); } catch {}
  }
  const normal = disposition.match(/filename="?([^";]+)"?/i);
  return normal?.[1]?.trim() || '';
}

export function isLikelyDownload(url) {
  const u = url.toLowerCase();
  return /\.(pdf|docx?|pptx?|xlsx?|csv|txt|rtf|zip|png|jpe?g|gif|webp)(?:$|[?#])/i.test(u)
    || u.includes('viewcontent')
    || u.includes('download');
}
