import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ensureDir,
  extensionFromContentType,
  filenameFromDisposition,
  isLikelyDownload,
  safeName,
  shortHash,
  writeBufferIfChanged,
  writeJson,
  writeText
} from './utils.mjs';

function recordChange(config, change) {
  if (!config?._changes || !change || change.action === 'unchanged') return;
  const term = change.courseId ? config?._courseTermById?.[String(change.courseId)] : null;
  config._changes.push({
    at: new Date().toISOString(),
    ...(term ? { termKey: term.key, term: term.label } : {}),
    ...change
  });
}

function combinedAction(actions) {
  if (actions.includes('added')) return 'added';
  if (actions.includes('updated')) return 'updated';
  return 'unchanged';
}

async function readExistingText(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}

function simpleLineDiff(before = '', after = '', maxMiddleLines = 500) {
  const a = String(before).replace(/\r\n/g, '\n').split('\n');
  const b = String(after).replace(/\r\n/g, '\n').split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++;

  const aEnd = a.length - suffix;
  const bEnd = b.length - suffix;
  const oldMiddle = a.slice(prefix, aEnd);
  const newMiddle = b.slice(prefix, bEnd);
  const out = [
    `@@ old lines ${prefix + 1}-${Math.max(prefix + 1, aEnd)} -> new lines ${prefix + 1}-${Math.max(prefix + 1, bEnd)} @@`,
    `common prefix lines: ${prefix}`,
    `common suffix lines: ${suffix}`,
    ''
  ];

  const emit = (mark, lines) => {
    const shown = lines.slice(0, maxMiddleLines);
    for (const line of shown) out.push(`${mark}${line}`);
    if (lines.length > shown.length) out.push(`${mark}... [${lines.length - shown.length} more line(s) omitted from diff; full before/after files are saved]`);
  };
  emit('-', oldMiddle);
  emit('+', newMiddle);
  return out.join('\n');
}

function jsonChanges(beforeText, afterText, limit = 300) {
  let before;
  let after;
  try { before = JSON.parse(beforeText); after = JSON.parse(afterText); } catch { return []; }
  const changes = [];
  const walk = (a, b, pathName) => {
    if (changes.length >= limit) return;
    if (Object.is(a, b)) return;
    const aObj = a && typeof a === 'object';
    const bObj = b && typeof b === 'object';
    if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) {
      changes.push({ path: pathName || '$', before: a, after: b });
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n && changes.length < limit; i++) walk(a[i], b[i], `${pathName || '$'}[${i}]`);
      return;
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      if (changes.length >= limit) break;
      const child = pathName ? `${pathName}.${key}` : `$.${key}`;
      if (!(key in a)) changes.push({ path: child, before: '[missing]', after: b[key] });
      else if (!(key in b)) changes.push({ path: child, before: a[key], after: '[missing]' });
      else walk(a[key], b[key], child);
    }
  };
  walk(before, after, '$');
  return changes;
}

async function writeUpdateDiagnostic(config, meta, files) {
  if (!config?.writeUpdateDiagnostics || !config?._runId) return null;
  const changed = Object.entries(files).filter(([, pair]) => pair.before !== null && String(pair.before) !== String(pair.after));
  if (!changed.length) return null;

  config._diagnosticSequence = (config._diagnosticSequence || 0) + 1;
  const seq = String(config._diagnosticSequence).padStart(4, '0');
  const slug = safeName(`${meta?.courseId || 'global'}-${meta?.type || 'page'}-${meta?.id || ''}-${meta?.title || ''}`, 'update').slice(0, 110);
  const changesRoot = config.changesDir || path.join(config.outputDir, '_system', 'changes');
  const diagDir = path.join(changesRoot, 'diagnostics', config._runId, `${seq}-${slug}`);
  await ensureDir(diagDir);

  const changedFiles = [];
  let jsonFieldChanges = [];
  for (const [name, pair] of changed) {
    const safe = safeName(name, 'snapshot');
    const beforeFile = `before-${safe}`;
    const afterFile = `after-${safe}`;
    const diffFile = `diff-${safe}.txt`;
    await fs.writeFile(path.join(diagDir, beforeFile), String(pair.before), 'utf8');
    await fs.writeFile(path.join(diagDir, afterFile), String(pair.after), 'utf8');
    await fs.writeFile(path.join(diagDir, diffFile), simpleLineDiff(pair.before, pair.after), 'utf8');
    changedFiles.push({ name, before: beforeFile, after: afterFile, diff: diffFile });
    if (/\.json$/i.test(name)) jsonFieldChanges.push(...jsonChanges(pair.before, pair.after));
  }

  const diagnostic = {
    generatedAt: new Date().toISOString(),
    change: meta,
    changedFiles,
    jsonFieldChanges,
    note: 'Raw before/after semantic snapshots are saved here. HTML is diagnostic only and is not used for incremental change detection.'
  };
  await fs.writeFile(path.join(diagDir, 'diagnostic.json'), JSON.stringify(diagnostic, null, 2), 'utf8');
  return {
    path: path.relative(config.outputDir, diagDir).replace(/\\/g, '/'),
    changedFiles: changedFiles.map(x => x.name),
    jsonFieldChanges: jsonFieldChanges.slice(0, 50)
  };
}

const FALLBACK_ROUTES = {
  content: id => `/d2l/le/content/${id}/Home`,
  assignments: id => `/d2l/lms/dropbox/user/folders_list.d2l?ou=${id}`,
  quizzes: id => `/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${id}`,
  discussions: id => `/d2l/le/${id}/discussions/List`,
  grades: id => `/d2l/lms/grades/my_grades/main.d2l?ou=${id}`,
  calendar: id => `/d2l/le/calendar/${id}`,
  announcements: id => `/d2l/lms/news/main.d2l?ou=${id}`
};

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(value = '') {
  return decodeHtml(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeCourseName(value, id) {
  const v = stripTags(value || '').replace(/^[-–—\s]+/, '').replace(/\s+/g, ' ').trim();
  return v && !/^course home$/i.test(v) ? v : `Course ${id}`;
}

function addCourse(map, id, name, baseUrl, source) {
  id = String(id || '').trim();
  if (!/^\d+$/.test(id)) return;
  const normalized = normalizeCourseName(name, id);
  const existing = map.get(id);
  const score = (n) => {
    let s = n.length;
    if (/\b(Fall|Spring|Summer|Winter)\s+20\d{2}\b/i.test(n)) s += 1000;
    if (/^[A-Z]{2,5}\s*\d{3}/.test(n)) s += 500;
    if (/^Course \d+$/.test(n)) s -= 1000;
    return s;
  };
  if (!existing || score(normalized) > score(existing.name)) {
    map.set(id, {
      id,
      name: normalized,
      homeUrl: new URL(`/d2l/home/${id}`, baseUrl).href,
      discoveredFrom: source
    });
  }
}

function discoverFromJson(value, map, baseUrl, source = 'course-selector-json') {
  if (typeof value === 'string') {
    // Brightspace RPC payloads often embed the actual Course Selector markup
    // inside JSON strings. Parse those strings as markup too.
    if (/\/d2l\/home\/\d+/i.test(value)) discoverFromMarkup(value, map, baseUrl, source);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const x of value) discoverFromJson(x, map, baseUrl, source);
    return;
  }

  const keys = Object.keys(value);
  const getKey = (...names) => {
    const k = keys.find(key => names.some(n => key.toLowerCase() === n.toLowerCase()));
    return k ? value[k] : undefined;
  };

  const id = getKey('OrgUnitId', 'orgUnitId', 'Id', 'id');
  const name = getKey('Name', 'name', 'Title', 'title', 'DisplayName', 'displayName');
  const href = getKey('Href', 'href', 'Url', 'url', 'Link', 'link');

  if (id && name) addCourse(map, id, name, baseUrl, source);
  if (typeof href === 'string') {
    const m = href.match(/\/d2l\/home\/(\d+)/i);
    if (m) addCourse(map, m[1], name || '', baseUrl, source);
  }

  for (const child of Object.values(value)) discoverFromJson(child, map, baseUrl, source);
}

function discoverFromMarkup(raw, map, baseUrl, source = 'course-selector-markup') {
  const variants = [String(raw || '')];
  // Some Brightspace deployments return the selector as a D2L RPC payload with escaped HTML.
  // Unescape only what is needed for reliable href/text matching.
  if (variants[0].includes('\\"') || variants[0].includes('\\r') || variants[0].includes('\\u')) {
    variants.push(
      variants[0]
        .replace(/\\"/g, '"')
        .replace(/\\r\\n|\\n|\\r/g, '\n')
        .replace(/\\u0026/gi, '&')
        .replace(/\\u003c/gi, '<')
        .replace(/\\u003e/gi, '>')
    );
  }

  for (const markup of variants) {
    // Prefer the actual course anchor text. This is much more reliable than
    // looking at nearby title attributes in the selector payload.
    const anchorRe = /<a\b[^>]*href=["'](?:https?:\/\/[^"']+)?\/d2l\/home\/(\d+)[^"']*["'][^>]*>([\s\S]{0,800}?)<\/a>/gi;
    let match;
    while ((match = anchorRe.exec(markup))) {
      addCourse(map, match[1], stripTags(match[2]), baseUrl, source);
    }

    // Fallback for markup where the name is in an adjacent title/aria-label attribute.
    const homeRe = /\/d2l\/home\/(\d+)/gi;
    while ((match = homeRe.exec(markup))) {
      const id = match[1];
      const start = Math.max(0, match.index - 1200);
      const end = Math.min(markup.length, match.index + 1800);
      const window = markup.slice(start, end);
      const attrs = [...window.matchAll(/(?:title|aria-label)=["']([^"']{3,300})["']/gi)].map(m => stripTags(m[1]));
      const likely = attrs.find(x => /\b(Fall|Spring|Summer|Winter)\s+20\d{2}\b/i.test(x)) || attrs.sort((a, b) => b.length - a.length)[0] || '';
      addCourse(map, id, likely, baseUrl, source);
    }
  }
}

function selectorPayloadUrls(baseUrl) {
  return [
    new URL('/d2l/api/lp/1.47/enrollments/myenrollments/', baseUrl).href,
    new URL('/d2l/api/lp/1.46/enrollments/myenrollments/', baseUrl).href,
    new URL('/d2l/api/lp/1.45/enrollments/myenrollments/', baseUrl).href
  ];
}

async function discoverViaApis(context, map, baseUrl) {
  for (const url of selectorPayloadUrls(baseUrl)) {
    try {
      const response = await context.request.get(url, { timeout: 15000 });
      if (!response.ok()) continue;
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (parsed) discoverFromJson(parsed, map, baseUrl, 'enrollments-api');
      else discoverFromMarkup(text, map, baseUrl, 'enrollments-api-markup');
      if (map.size) break;
    } catch {}
  }
}

async function discoverViaHomeDom(page, map, baseUrl) {
  const links = await page.locator('a[href*="/d2l/home/"]').evaluateAll(nodes => nodes.map(a => ({ href: a.getAttribute('href') || '', text: (a.innerText || a.textContent || '').trim(), title: a.getAttribute('title') || '', aria: a.getAttribute('aria-label') || '' })) ).catch(() => []);
  for (const link of links) {
    const m = link.href.match(/\/d2l\/home\/(\d+)/i);
    if (m) addCourse(map, m[1], link.text || link.aria || link.title, baseUrl, 'home-dom');
  }
}

async function discoverViaSelectorNetwork(page, map, baseUrl, snapshotDir, config) {
  const responses = [];
  const handler = async response => {
    const url = response.url();
    if (!/course|orgunit|enroll|selector/i.test(url)) return;
    try {
      const ct = response.headers()['content-type'] || '';
      if (!/json|html|text|d2l/i.test(ct)) return;
      const text = await response.text();
      if (!/\/d2l\/home\/\d+|OrgUnitId|orgUnitId/i.test(text)) return;
      responses.push({ url, status: response.status(), contentType: ct, text: text.slice(0, 2_000_000) });
      try {
        const parsed = JSON.parse(text);
        discoverFromJson(parsed, map, baseUrl, 'selector-network-json');
      } catch {
        discoverFromMarkup(text, map, baseUrl, 'selector-network-markup');
      }
    } catch {}
  };
  page.on('response', handler);
  try {
    const candidates = [
      'd2l-navigation-s-course-menu',
      'd2l-navigation-main-header',
      '[data-testid*="course"]',
      'button[aria-label*="course" i]',
      'button[title*="course" i]'
    ];
    for (const selector of candidates) {
      const locator = page.locator(selector).first();
      if (!(await locator.count().catch(() => 0))) continue;
      await locator.click({ force: true }).catch(() => {});
      await page.waitForTimeout(config.dynamicWaitMs || 1800);
      if (map.size) break;
    }
  } finally {
    page.off('response', handler);
  }
  if (responses.length) await writeJson(path.join(snapshotDir, '_course-selector-responses.json'), responses.map(r => ({ ...r, text: r.text.slice(0, 50000) })));
}

export async function discoverCourses(page, context, baseUrl, snapshotDir, config) {
  const map = new Map();
  await discoverViaHomeDom(page, map, baseUrl);
  await discoverViaApis(context, map, baseUrl);
  if (!map.size) await discoverViaSelectorNetwork(page, map, baseUrl, snapshotDir, config);

  // Last-chance parse of the current page source catches server-rendered selector markup.
  if (!map.size) {
    const html = await page.content().catch(() => '');
    discoverFromMarkup(html, map, baseUrl, 'home-html');
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function waitForAuthenticatedHome(page, baseUrl, navigationTimeoutMs = 45000, auth = {}) {
  const manualTimeout = Number(auth?.manualLoginTimeoutMs || 10 * 60 * 1000);
  const autoSubmit = Boolean(auth?.autoSubmitSavedBrowserCredentials);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs }).catch(() => {});
  const started = Date.now();
  while (Date.now() - started < manualTimeout) {
    const url = page.url();
    const body = await page.locator('body').innerText().catch(() => '');
    const authenticated = /\/d2l\//i.test(url) && !/login|signin|saml|adfs|shibboleth|duo/i.test(url) && !/sign in|log in/i.test(body.slice(0, 2000));
    if (authenticated) {
      console.log('Existing Brightspace session found — continuing without login.');
      return;
    }

    if (autoSubmit) {
      const password = page.locator('input[type="password"]').first();
      if (await password.count().catch(() => 0)) {
        const autofilled = await password.evaluate(el => {
          try { return el.matches(':-webkit-autofill'); } catch { return false; }
        }).catch(() => false);
        if (autofilled) {
          const form = password.locator('xpath=ancestor::form[1]');
          const button = form.locator('button[type="submit"], input[type="submit"], button').first();
          if (await button.count().catch(() => 0)) {
            await button.click().catch(() => {});
            console.log('Saved Brave credentials detected via browser autofill — submitted the login form.');
            await page.waitForTimeout(1200);
            continue;
          }
        }
      }
    }

    if (Date.now() - started < 3000) console.log('Brightspace login is required. Complete your normal SSO/MFA flow in the browser window; the crawler will continue automatically afterward.');
    await page.waitForTimeout(1000);
  }
  throw new Error(`Brightspace login did not complete within ${Math.round(manualTimeout / 60000)} minute(s).`);
}

export async function buildCourseNav(course, baseUrl) {
  const nav = {};
  for (const [section, makePath] of Object.entries(FALLBACK_ROUTES)) nav[section] = new URL(makePath(course.id), baseUrl).href;
  return nav;
}

function semanticText(text = '') {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeCommonNoise(text = '') {
  return semanticText(text)
    .replace(/^\s*Listen\s*$/gim, '')
    .replace(/^\s*More\s*$/gim, '')
    .replace(/^\s*Last Visited.*$/gim, '')
    .replace(/javascript:void\(0\);?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function pageSemanticSnapshot(page) {
  const title = await page.title().catch(() => '');
  const text = normalizeCommonNoise(await page.locator('body').innerText().catch(() => ''));
  return { title, text, url: page.url() };
}

export async function savePageSnapshot(page, dir, stem = 'page', config = null, changeMeta = null) {
  await ensureDir(dir);
  const htmlFile = path.join(dir, `${stem}.html`);
  const textFile = path.join(dir, `${stem}.txt`);
  const jsonFile = path.join(dir, `${stem}.json`);

  const beforeText = await readExistingText(textFile);
  const beforeJson = await readExistingText(jsonFile);
  const semantic = await pageSemanticSnapshot(page);
  const nextText = semantic.text;
  const nextJson = JSON.stringify(semantic, null, 2);
  const textAction = await writeText(textFile, nextText);
  const jsonAction = await writeText(jsonFile, nextJson);
  const action = combinedAction([textAction, jsonAction]);
  const html = await page.content().catch(() => '');
  // HTML is kept for debugging, but it is intentionally not part of the
  // incremental-change decision because Brightspace injects dynamic markup.
  await writeText(htmlFile, html);

  let diagnostic = null;
  if (action === 'updated' && config) {
    diagnostic = await writeUpdateDiagnostic(config, changeMeta || { type: 'page', title: semantic.title, url: semantic.url }, {
      [`${stem}.txt`]: { before: beforeText, after: nextText },
      [`${stem}.json`]: { before: beforeJson, after: nextJson }
    });
  }
  return { action, text: semantic.text, title: semantic.title, finalUrl: semantic.url, diagnostic };
}

async function saveCalendarListSnapshot(page, dir, stem, courseId, config, changeMeta) {
  await ensureDir(dir);
  const textFile = path.join(dir, `${stem}.txt`);
  const jsonFile = path.join(dir, `${stem}.json`);
  const htmlFile = path.join(dir, `${stem}.html`);
  const beforeText = await readExistingText(textFile);
  const beforeJson = await readExistingText(jsonFile);

  const links = await extractLinks(page).catch(() => []);
  const events = [];
  const seen = new Set();
  for (const link of links) {
    const key = sectionDetailKey('calendar', link.href, courseId, config.baseUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    events.push({ key, label: normalizeCommonNoise(link.text || link.title || key), url: canonicalizeUrl(link.href, config.baseUrl) || link.href });
  }
  events.sort((a, b) => a.key.localeCompare(b.key));
  const title = await page.title().catch(() => '');
  const semanticTextValue = events.map(e => `${e.key}\n${e.label}\n${e.url}`).join('\n\n');
  const semanticJson = { title, url: page.url(), events };
  const nextJson = JSON.stringify(semanticJson, null, 2);
  const textAction = await writeText(textFile, semanticTextValue);
  const jsonAction = await writeText(jsonFile, nextJson);
  const action = combinedAction([textAction, jsonAction]);
  await writeText(htmlFile, await page.content().catch(() => ''));

  let diagnostic = null;
  if (action === 'updated' && config) {
    diagnostic = await writeUpdateDiagnostic(config, changeMeta || { type: 'calendar-list', title, url: page.url() }, {
      [`${stem}.txt`]: { before: beforeText, after: semanticTextValue },
      [`${stem}.json`]: { before: beforeJson, after: nextJson }
    });
  }
  return { action, text: semanticTextValue, title, finalUrl: page.url(), diagnostic };
}

async function saveAssignmentsListSnapshot(page, dir, stem, courseId, config, changeMeta) {
  await ensureDir(dir);
  const textFile = path.join(dir, `${stem}.txt`);
  const jsonFile = path.join(dir, `${stem}.json`);
  const htmlFile = path.join(dir, `${stem}.html`);
  const beforeText = await readExistingText(textFile);
  const beforeJson = await readExistingText(jsonFile);

  const links = await extractLinks(page).catch(() => []);
  const rows = [];
  const seen = new Set();
  for (const link of links) {
    const key = sectionDetailKey('assignments', link.href, courseId, config.baseUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, label: normalizeCommonNoise(link.text || link.title || key), url: canonicalizeUrl(link.href, config.baseUrl) || link.href });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  const title = await page.title().catch(() => '');
  const semanticTextValue = rows.map(e => `${e.key}\n${e.label}\n${e.url}`).join('\n\n');
  const semanticJson = { title, url: page.url(), assignments: rows };
  const nextJson = JSON.stringify(semanticJson, null, 2);
  const textAction = await writeText(textFile, semanticTextValue);
  const jsonAction = await writeText(jsonFile, nextJson);
  const action = combinedAction([textAction, jsonAction]);
  await writeText(htmlFile, await page.content().catch(() => ''));

  let diagnostic = null;
  if (action === 'updated' && config) {
    diagnostic = await writeUpdateDiagnostic(config, changeMeta || { type: 'assignments-list', title, url: page.url() }, {
      [`${stem}.txt`]: { before: beforeText, after: semanticTextValue },
      [`${stem}.json`]: { before: beforeJson, after: nextJson }
    });
  }
  return { action, text: semanticTextValue, title, finalUrl: page.url(), diagnostic };
}

async function saveAnnouncementsListSnapshot(page, dir, stem, courseId, config, changeMeta) {
  await ensureDir(dir);
  const textFile = path.join(dir, `${stem}.txt`);
  const jsonFile = path.join(dir, `${stem}.json`);
  const htmlFile = path.join(dir, `${stem}.html`);
  const beforeText = await readExistingText(textFile);
  const beforeJson = await readExistingText(jsonFile);

  const links = await extractLinks(page).catch(() => []);
  const rows = [];
  const seen = new Set();
  for (const link of links) {
    const key = sectionDetailKey('announcements', link.href, courseId, config.baseUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, label: normalizeCommonNoise(link.text || link.title || key), url: canonicalizeUrl(link.href, config.baseUrl) || link.href });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  const title = await page.title().catch(() => '');
  const semanticTextValue = rows.map(e => `${e.key}\n${e.label}\n${e.url}`).join('\n\n');
  const semanticJson = { title, url: page.url(), announcements: rows };
  const nextJson = JSON.stringify(semanticJson, null, 2);
  const textAction = await writeText(textFile, semanticTextValue);
  const jsonAction = await writeText(jsonFile, nextJson);
  const action = combinedAction([textAction, jsonAction]);
  await writeText(htmlFile, await page.content().catch(() => ''));

  let diagnostic = null;
  if (action === 'updated' && config) {
    diagnostic = await writeUpdateDiagnostic(config, changeMeta || { type: 'announcements-list', title, url: page.url() }, {
      [`${stem}.txt`]: { before: beforeText, after: semanticTextValue },
      [`${stem}.json`]: { before: beforeJson, after: nextJson }
    });
  }
  return { action, text: semanticTextValue, title, finalUrl: page.url(), diagnostic };
}

export async function attachNetworkCapture(page, dir, baseUrl, enabled = true) {
  if (!enabled) return async () => {};
  await ensureDir(dir);
  let seq = 0;
  const pending = new Set();
  const handler = response => {
    const job = (async () => {
      try {
        const url = response.url();
        if (new URL(url).origin !== new URL(baseUrl).origin) return;
        const type = response.request().resourceType();
        const ct = response.headers()['content-type'] || '';
        if (!['xhr', 'fetch', 'document'].includes(type) && !/json|html|text/i.test(ct)) return;
        const text = await response.text().catch(() => '');
        const id = String(++seq).padStart(4, '0');
        await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ url, status: response.status(), resourceType: type, contentType: ct, body: text.slice(0, 2_000_000) }, null, 2), 'utf8');
      } catch {}
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
  };
  page.on('response', handler);
  return async () => {
    page.off('response', handler);
    await Promise.allSettled([...pending]);
  };
}

async function extractLinks(page) {
  return page.locator('a[href]').evaluateAll(nodes => nodes.map(a => ({ href: a.href, text: (a.innerText || a.textContent || '').trim(), title: a.getAttribute('title') || '' })));
}

function canonicalizeUrl(raw, baseUrl) {
  if (!raw) return null;
  try {
    const u = new URL(raw, baseUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(d2l_|_?cb|cache|timestamp|ts)$/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return null; }
}

function contentUrlBelongs(url, courseId, baseUrl) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.origin !== new URL(baseUrl).origin) return false;
    const p = u.pathname;
    return new RegExp(`/d2l/le/content/${courseId}/`, 'i').test(p)
      || (p.includes('/d2l/le/content/') && u.searchParams.get('ou') === String(courseId));
  } catch { return false; }
}

function assetKind(url, contentType = '') {
  const lowerUrl = String(url).toLowerCase();
  const ct = String(contentType).toLowerCase();
  if (/\.(vtt|srt)(?:$|[?#])/i.test(lowerUrl) || /text\/vtt|application\/x-subrip/.test(ct)) return 'transcript';
  if (/video\//.test(ct) || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(lowerUrl)) return 'video';
  if (/audio\//.test(ct) || /\.(mp3|m4a|wav|ogg)(?:$|[?#])/i.test(lowerUrl)) return 'audio';
  if (/image\//.test(ct) || /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(lowerUrl)) return 'image';
  if (/\.(zip|7z|rar|tar|gz)(?:$|[?#])/i.test(lowerUrl) || /application\/(zip|x-7z-compressed|x-rar-compressed)/.test(ct)) return 'archive';
  if (/pdf|msword|officedocument|powerpoint|excel|spreadsheet|text\/plain|text\/csv/.test(ct)
      || /\.(pdf|docx?|pptx?|xlsx?|csv|txt|rtf)(?:$|[?#])/i.test(lowerUrl)) return 'document';
  return 'other';
}

function shouldDownloadAsset(kind, policy, sectionConfig) {
  if (sectionConfig?._allowAssetDownloadsInCurrentSection === false) return false;
  if (kind === 'video') return Boolean(policy.downloadVideo);
  if (kind === 'audio') return Boolean(policy.downloadAudio);
  if (kind === 'transcript') return policy.downloadTranscripts !== false;
  if (kind === 'image') return policy.downloadImages !== false;
  if (kind === 'archive') return policy.downloadArchives !== false;
  if (kind === 'document') return policy.downloadDocuments !== false;
  return false;
}

async function filenameForResponse(response, url) {
  const headers = response.headers();
  const disposition = headers['content-disposition'] || '';
  const contentType = headers['content-type'] || '';
  let name = filenameFromDisposition(disposition);
  if (!name) {
    try { name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'file'); } catch { name = 'file'; }
  }
  if (!path.extname(name)) name += extensionFromContentType(contentType);
  return safeName(name, `file-${shortHash(url)}`);
}

async function fetchAsset(context, url, outDir, policy, sectionConfig) {
  const result = { url, downloaded: false };
  try {
    const response = await context.request.get(url, { timeout: sectionConfig.downloadTimeoutMs || 60000 });
    result.status = response.status();
    result.contentType = response.headers()['content-type'] || '';
    result.kind = assetKind(url, result.contentType);
    result.name = await filenameForResponse(response, url);
    const length = Number(response.headers()['content-length'] || 0);
    result.size = length || null;

    if (!response.ok()) { result.skipReason = `HTTP ${response.status()}`; return result; }
    if (!shouldDownloadAsset(result.kind, policy, sectionConfig)) { result.skipReason = 'policy-index-only'; return result; }
    const max = Number(policy.maxDownloadBytes || 25 * 1024 * 1024);
    if (length && length > max) { result.skipReason = `content-length>${max}`; return result; }

    const body = await response.body();
    result.size = body.length;
    if (body.length > max) { result.skipReason = `body>${max}`; return result; }
    await ensureDir(outDir);
    const file = path.join(outDir, result.name);
    const action = await writeBufferIfChanged(file, body);
    result.downloaded = true;
    result.localFile = result.name;
    result.action = action;
    return result;
  } catch (error) {
    result.skipReason = error.message;
    return result;
  }
}

async function syncVisibleResources(page, context, outDir, manifestFile, baseUrl, downloadTimeoutMs, config) {
  const links = await extractLinks(page).catch(() => []);
  const urls = new Map();
  for (const link of links) {
    const u = canonicalizeUrl(link.href, baseUrl);
    if (!u) continue;
    if (isLikelyDownload(u) || /viewcontent|download|content\/enforced|file/i.test(u)) urls.set(u, link.text || link.title || '');
  }
  const media = await page.locator('video[src], audio[src], source[src], track[src]').evaluateAll(nodes => nodes.map(n => ({ url: n.src || n.getAttribute('src') || '', label: n.getAttribute('label') || n.getAttribute('title') || '' }))).catch(() => []);
  for (const item of media) {
    const u = canonicalizeUrl(item.url, baseUrl);
    if (u) urls.set(u, item.label || '');
  }

  const policy = config.assetPolicy || {};
  const assets = [];
  const downloads = [];
  for (const [url, label] of urls) {
    let record;
    try {
      const sameOrigin = new URL(url).origin === new URL(baseUrl).origin;
      if (!sameOrigin) {
        if (policy.indexExternalAssets !== false) assets.push({ url, label, kind: assetKind(url, ''), downloaded: false, skipReason: 'external-index-only' });
        continue;
      }
      record = await fetchAsset(context, url, outDir, policy, { ...config, downloadTimeoutMs });
      if (!record.name && label) record.name = label;
      assets.push(record);
      if (record.downloaded) downloads.push({ url, file: record.localFile, action: record.action });
    } catch (error) {
      assets.push({ url, label, downloaded: false, skipReason: error.message, kind: assetKind(url, '') });
    }
  }

  const beforeManifest = await readExistingText(manifestFile);
  const nextManifest = JSON.stringify(assets, null, 2);
  const manifestAction = await writeText(manifestFile, nextManifest);
  let manifestDiagnostic = null;
  if (manifestAction === 'updated' && config) {
    manifestDiagnostic = await writeUpdateDiagnostic(config, { type: 'assets-index', title: path.basename(manifestFile), url: page.url() }, {
      [path.basename(manifestFile)]: { before: beforeManifest, after: nextManifest }
    });
  }
  return { assets, downloads, assetAction: manifestAction, diagnostic: manifestDiagnostic };
}

async function crawlInteractiveContentModules(page, context, course, contentDir, config) {
  const moduleLinks = page.locator('a[href^="javascript:"]');
  const count = Math.min(await moduleLinks.count().catch(() => 0), Number(config.maxInteractiveModulesPerCourse || 80));
  const discoveredUrls = [];
  let visitedModules = 0;
  for (let i = 0; i < count; i++) {
    const link = moduleLinks.nth(i);
    const label = normalizeCommonNoise(await link.innerText().catch(() => '')) || `module-${i + 1}`;
    if (!label || /^listen$|^more$/i.test(label)) continue;
    await link.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
    visitedModules += 1;
    const moduleKey = `${String(visitedModules).padStart(3, '0')}-${safeName(label).slice(0, 80)}`;
    const moduleDir = path.join(contentDir, 'Modules', moduleKey);
    const changeMeta = { courseId: course.id, course: course.name, type: 'content-module', id: moduleKey, title: label, url: page.url() };
    const snapshot = await savePageSnapshot(page, moduleDir, 'page', config, changeMeta);
    recordChange(config, { action: snapshot.action, ...changeMeta, diagnostic: snapshot.diagnostic });
    const assets = await syncVisibleResources(page, context, path.join(moduleDir, 'Files'), path.join(moduleDir, 'assets.json'), config.baseUrl, config.downloadTimeoutMs, config);
    recordChange(config, { action: assets.assetAction, courseId: course.id, course: course.name, type: 'assets-index', id: moduleKey, title: label, url: page.url() });
    for (const d of assets.downloads) recordChange(config, { action: d.action, courseId: course.id, course: course.name, type: 'file', title: d.file, url: d.url });
    const links = await extractLinks(page).catch(() => []);
    for (const item of links) {
      const u = canonicalizeUrl(item.href, config.baseUrl);
      if (contentUrlBelongs(u, course.id, config.baseUrl)) discoveredUrls.push(u);
    }
  }
  await writeJson(path.join(contentDir, '_modules.json'), { modules: visitedModules, discoveredUrls: [...new Set(discoveredUrls)] });
  return { modules: visitedModules, urls: [...new Set(discoveredUrls)] };
}

export async function crawlContent(page, context, course, contentUrl, courseDir, config) {
  const contentDir = path.join(courseDir, 'Content');
  await ensureDir(contentDir);
  const queue = [contentUrl];
  const visited = new Set();
  const index = [];
  let interactiveDone = false;
  let interactiveModules = 0;

  while (queue.length && visited.size < Number(config.maxContentPagesPerCourse || 300)) {
    const url = canonicalizeUrl(queue.shift(), config.baseUrl);
    if (!url || visited.has(url) || !contentUrlBelongs(url, course.id, config.baseUrl)) continue;
    visited.add(url);
    const pageKey = String(visited.size).padStart(4, '0');
    const snapshotDir = path.join(contentDir, 'Pages');
    const networkDir = path.join(contentDir, '_network', pageKey);
    const stopCapture = attachNetworkCapture(page, networkDir, config.baseUrl, config.captureNetwork !== false);

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => null);
    await page.waitForTimeout(config.dynamicWaitMs || 1800);

    const title = await page.title().catch(() => '');
    const changeMeta = { courseId: course.id, course: course.name, type: 'content-page', id: pageKey, title, url: page.url() };
    const snapshot = await savePageSnapshot(page, snapshotDir, pageKey, config, changeMeta);
    const snapshotAction = snapshot.action;
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const pageAssets = await syncVisibleResources(page, context, path.join(contentDir, 'Files'), path.join(snapshotDir, `${pageKey}.assets.json`), config.baseUrl, config.downloadTimeoutMs, config);
    const pageDownloads = pageAssets.downloads;
    recordChange(config, { action: snapshotAction, ...changeMeta, diagnostic: snapshot.diagnostic });
    recordChange(config, { action: pageAssets.assetAction, courseId: course.id, course: course.name, type: 'assets-index', id: pageKey, title, url: page.url() });
    for (const d of pageDownloads) recordChange(config, { action: d.action, courseId: course.id, course: course.name, type: 'file', title: d.file, url: d.url });
    index.push({ pageKey, requestedUrl: url, finalUrl: page.url(), status: response?.status?.() ?? null, title, action: snapshotAction, downloads: pageDownloads.length, assets: pageAssets.assets.length, textPreview: bodyText.slice(0, 1000) });

    // Classic Brightspace Content uses JavaScript-only module tree links. A URL-only
    // crawler sees the tree but never enters those modules. Click each module once,
    // snapshot the rendered module, and collect the real topic URLs it reveals.
    if (!interactiveDone && /\/d2l\/le\/content\/\d+\/Home/i.test(url)) {
      interactiveDone = true;
      const interactive = await crawlInteractiveContentModules(page, context, course, contentDir, config).catch(() => ({ modules: 0, urls: [] }));
      interactiveModules = interactive.modules;
      for (const next of interactive.urls) if (!visited.has(next)) queue.push(next);
    }

    const links = await extractLinks(page);
    for (const link of links) {
      const next = canonicalizeUrl(link.href, config.baseUrl);
      if (contentUrlBelongs(next, course.id, config.baseUrl) && !visited.has(next)) queue.push(next);
    }

    await stopCapture();
  }

  await writeJson(path.join(contentDir, '_index.json'), index);
  return { pages: visited.size, interactiveModules };
}


function sectionDetailKey(section, rawUrl, courseId, baseUrl) {
  try {
    const u = new URL(rawUrl, baseUrl);
    if (u.origin !== new URL(baseUrl).origin) return null;
    const p = u.pathname;

    if (section === 'assignments' && /\/d2l\/lms\/dropbox\/user\/folder_submit_files\.d2l$/i.test(p)) {
      if (u.searchParams.get('ou') !== String(courseId)) return null;
      const db = u.searchParams.get('db');
      return db ? `assignment-${db}` : null;
    }

    if (section === 'announcements') {
      const m = p.match(new RegExp(`/d2l/le/news/${courseId}/(\\d+)/view$`, 'i'));
      return m ? `announcement-${m[1]}` : null;
    }

    if (section === 'discussions') {
      const m = p.match(new RegExp(`/d2l/le/${courseId}/discussions/topics/(\\d+)/View$`, 'i'));
      return m ? `topic-${m[1]}` : null;
    }

    if (section === 'calendar') {
      const m = p.match(new RegExp(`/d2l/le/calendar/${courseId}/event/(\\d+)`, 'i'));
      return m ? `event-${m[1]}` : null;
    }

    if (section === 'quizzes') {
      // Read only quiz summary/results pages. Never navigate to quiz start/attempt URLs.
      if (/start|attempt|take_quiz|quiz_start/i.test(`${p}${u.search}`)) return null;
      if (!/\/d2l\/lms\/quizzing\/user\//i.test(p)) return null;
      const qi = u.searchParams.get('qi') || u.searchParams.get('quizId') || u.searchParams.get('quizid');
      if (qi && (u.searchParams.get('ou') === String(courseId) || !u.searchParams.get('ou'))) return `quiz-${qi}`;
    }
  } catch {}
  return null;
}

async function crawlSectionDetails(page, context, course, section, links, sectionDir, config) {
  const targets = new Map();
  for (const link of links) {
    const key = sectionDetailKey(section, link.href, course.id, config.baseUrl);
    if (key && !targets.has(key)) targets.set(key, { key, url: link.href, label: link.text || link.title || key });
  }

  const limit = Number(config.maxSectionDetailPagesPerCourse || 120);
  const index = [];
  for (const target of [...targets.values()].slice(0, limit)) {
    console.log(`    ${section} detail: ${target.label}`);
    const detailDir = path.join(sectionDir, 'Details', safeName(target.key));
    const networkDir = path.join(detailDir, '_network');
    const stopCapture = attachNetworkCapture(page, networkDir, config.baseUrl, config.captureNetwork !== false);
    const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => null);
    await page.waitForTimeout(config.dynamicWaitMs || 1800);
    const changeMeta = { courseId: course.id, course: course.name, type: `${section}-detail`, id: target.key, title: target.label, url: page.url() };
    const snapshot = await savePageSnapshot(page, detailDir, 'page', config, changeMeta);
    const snapshotAction = snapshot.action;
    recordChange(config, { action: snapshotAction, ...changeMeta, diagnostic: snapshot.diagnostic });
    const assets = await syncVisibleResources(page, context, path.join(detailDir, 'Files'), path.join(detailDir, 'assets.json'), config.baseUrl, config.downloadTimeoutMs, config);
    const downloads = assets.downloads;
    recordChange(config, { action: assets.assetAction, courseId: course.id, course: course.name, type: 'assets-index', id: target.key, title: target.label, url: page.url() });
    for (const d of downloads) recordChange(config, { action: d.action, courseId: course.id, course: course.name, type: 'file', title: d.file, url: d.url });
    const bodyText = await page.locator('body').innerText().catch(() => '');
    index.push({
      key: target.key,
      label: target.label,
      requestedUrl: target.url,
      finalUrl: page.url(),
      status: response?.status?.() ?? null,
      title: await page.title().catch(() => ''),
      action: snapshotAction,
      downloads: downloads.length,
      textPreview: bodyText.slice(0, 1500)
    });
    await stopCapture();
  }

  if (index.length) await writeJson(path.join(sectionDir, 'Details', '_index.json'), index);
  return index;
}

export async function syncSection(page, context, course, section, url, courseDir, config) {
  const quickDetailSections = Array.isArray(config.quickDetailSections) ? config.quickDetailSections : ['announcements'];
  const quickAssetSections = Array.isArray(config.quickAssetDownloadSections) ? config.quickAssetDownloadSections : ['announcements'];
  const sectionConfig = {
    ...config,
    _allowAssetDownloadsInCurrentSection: config.syncMode !== 'quick' || quickAssetSections.includes(section)
  };

  const dir = path.join(courseDir, safeName(section));
  const networkDir = path.join(dir, '_network');
  const stopCapture = attachNetworkCapture(page, networkDir, config.baseUrl, config.captureNetwork !== false);

  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => null);
  await page.waitForTimeout(config.dynamicWaitMs || 1800);

  const status = response?.status?.() ?? null;
  const changeMeta = { courseId: course.id, course: course.name, type: `${section}-list`, title: section, url: page.url() };
  const snapshot = section === 'calendar'
    ? await saveCalendarListSnapshot(page, dir, 'page', course.id, sectionConfig, changeMeta)
    : section === 'assignments'
      ? await saveAssignmentsListSnapshot(page, dir, 'page', course.id, sectionConfig, changeMeta)
      : section === 'announcements'
        ? await saveAnnouncementsListSnapshot(page, dir, 'page', course.id, sectionConfig, changeMeta)
        : await savePageSnapshot(page, dir, 'page', sectionConfig, changeMeta);
  const snapshotAction = snapshot.action;
  recordChange(config, { action: snapshotAction, ...changeMeta, diagnostic: snapshot.diagnostic });
  const links = await extractLinks(page).catch(() => []);
  const assets = await syncVisibleResources(page, context, path.join(dir, 'Files'), path.join(dir, 'assets.json'), config.baseUrl, config.downloadTimeoutMs, sectionConfig);
  const downloads = assets.downloads;
  recordChange(config, { action: assets.assetAction, courseId: course.id, course: course.name, type: 'assets-index', title: section, url: page.url() });
  for (const d of downloads) recordChange(config, { action: d.action, courseId: course.id, course: course.name, type: 'file', title: d.file, url: d.url });
  const listFinalUrl = page.url();
  const listTitle = await page.title().catch(() => '');
  await stopCapture();

  const shouldCrawlDetails = config.syncMode !== 'quick' || quickDetailSections.includes(section);
  const details = shouldCrawlDetails
    ? await crawlSectionDetails(page, context, course, section, links, dir, sectionConfig)
    : [];

  return {
    section,
    requestedUrl: url,
    finalUrl: listFinalUrl,
    status,
    title: listTitle,
    action: snapshotAction,
    assets: assets.assets.length,
    downloads: downloads.length,
    detailPages: details.length,
    detailCrawl: shouldCrawlDetails
  };
}
