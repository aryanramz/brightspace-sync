export function normalizeBrightspaceBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return '';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.href.replace(/\/$/, '');
}
