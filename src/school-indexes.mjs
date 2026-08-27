import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, writeJson, writeText } from './utils.mjs';
import { buildDeadlineIntelligence } from './deadline-intelligence.mjs';

const MONTHS = new Map([
  ['jan', 0], ['january', 0], ['feb', 1], ['february', 1], ['mar', 2], ['march', 2],
  ['apr', 3], ['april', 3], ['may', 4], ['jun', 5], ['june', 5], ['jul', 6], ['july', 6],
  ['aug', 7], ['august', 7], ['sep', 8], ['sept', 8], ['september', 8], ['oct', 9],
  ['october', 9], ['nov', 10], ['november', 10], ['dec', 11], ['december', 11]
]);

const MONTH_PATTERN = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const MONTH_DATE_RE = new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?(?:\\s+(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(AM|PM)?)?`, 'i');
const NUMERIC_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?)?/i;

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

function oneLine(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function localDateParts(date) {
  const yyyy = String(date.getFullYear()).padStart(4, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseClock(hourRaw, minuteRaw, ampmRaw) {
  let hour = Number(hourRaw || 0);
  const minute = Number(minuteRaw || 0);
  const ampm = String(ampmRaw || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

export function parseBrightspaceDate(text, fallbackYear = null) {
  const value = oneLine(text);
  let match = value.match(MONTH_DATE_RE);
  if (match) {
    const month = MONTHS.get(match[1].toLowerCase());
    const day = Number(match[2]);
    const year = Number(match[3] || fallbackYear);
    if (month == null || !day || !year) return null;
    const hasTime = Boolean(match[4]);
    const { hour, minute } = parseClock(match[4], match[5], match[6]);
    const date = new Date(year, month, day, hasTime ? hour : 23, hasTime ? minute : 59, hasTime ? 0 : 59, 0);
    if (Number.isNaN(date.getTime())) return null;
    return {
      dueAt: hasTime ? date.toISOString() : null,
      dueDate: localDateParts(date),
      sortTime: date.getTime(),
      allDay: !hasTime,
      raw: match[0]
    };
  }

  match = value.match(NUMERIC_DATE_RE);
  if (match) {
    const month = Number(match[1]) - 1;
    const day = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const hasTime = Boolean(match[4]);
    const { hour, minute } = parseClock(match[4], match[5], match[6]);
    const date = new Date(year, month, day, hasTime ? hour : 23, hasTime ? minute : 59, hasTime ? 0 : 59, 0);
    if (Number.isNaN(date.getTime())) return null;
    return {
      dueAt: hasTime ? date.toISOString() : null,
      dueDate: localDateParts(date),
      sortTime: date.getTime(),
      allDay: !hasTime,
      raw: match[0]
    };
  }
  return null;
}

function labeledDeadline(text, fallbackYear, allowEndDate = true) {
  const value = oneLine(text);
  const labels = [
    { basis: 'due', re: /\b(?:Due(?:\s+on|\s+Date)?|Deadline)\s*[:\-]?\s*/ig },
    ...(allowEndDate ? [{ basis: 'end', re: /\bEnd\s+Date\s*[:\-]?\s*/ig }] : [])
  ];
  for (const label of labels) {
    label.re.lastIndex = 0;
    let match;
    while ((match = label.re.exec(value))) {
      const candidate = value.slice(match.index + match[0].length, match.index + match[0].length + 100);
      const parsed = parseBrightspaceDate(candidate, fallbackYear);
      if (parsed) return { ...parsed, basis: label.basis, dueText: `${match[0].trim()} ${parsed.raw}`.trim() };
    }
  }
  return null;
}

function nearbyDate(text, fallbackYear) {
  const parsed = parseBrightspaceDate(text, fallbackYear);
  return parsed ? { ...parsed, basis: 'calendar', dueText: parsed.raw } : null;
}

function titleKey(value = '') {
  return oneLine(value)
    .toLowerCase()
    .replace(/\b(?:due|deadline|assignment|quiz|event)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitleCandidate(value = '') {
  const text = oneLine(value);
  if (!text || text.length > 180) return '';
  if (/^(?:due|due date|deadline|end date|start date|available|availability|attempts?|score|evaluation status|attachments?|no category)$/i.test(text)) return '';
  if (/^(?:course home|content|assignments|exams\s*\/\s*quizzes|quizzes|discussions|class progress|grades|learner resources|announcements|more|listen)$/i.test(text)) return '';
  if (parseBrightspaceDate(text)) return '';
  return text;
}

function segmentForTitle(text, title, allTitles = []) {
  const source = String(text || '');
  if (!source || !title) return '';
  const lower = source.toLowerCase();
  const start = lower.indexOf(String(title).toLowerCase());
  if (start < 0) return '';
  let end = Math.min(source.length, start + 1400);
  for (const candidate of allTitles) {
    if (!candidate || candidate === title) continue;
    const idx = lower.indexOf(String(candidate).toLowerCase(), start + title.length);
    if (idx >= 0 && idx < end) end = idx;
  }
  return source.slice(start, end);
}

function lineContextForTitle(text, title, radius = 7) {
  const lines = String(text || '').split(/\r?\n/).map(oneLine).filter(Boolean);
  const idx = lines.findIndex(line => line.toLowerCase().includes(String(title || '').toLowerCase()));
  if (idx < 0) return '';
  return lines.slice(Math.max(0, idx - radius), Math.min(lines.length, idx + radius + 1)).join('\n');
}

function previousPlausibleTitle(lines, index) {
  for (let i = index - 1; i >= Math.max(0, index - 7); i--) {
    const candidate = cleanTitleCandidate(lines[i]);
    if (candidate) return candidate;
  }
  return '';
}

function genericLabeledDeadlines(text, type, course, fallbackUrl = null) {
  const lines = String(text || '').split(/\r?\n/).map(oneLine).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/\b(?:Due(?:\s+on|\s+Date)?|Deadline|End\s+Date)\b/i.test(lines[i])) continue;
    const parsed = labeledDeadline(lines.slice(i, Math.min(lines.length, i + 3)).join(' '), course.term?.year, true);
    if (!parsed) continue;
    const title = previousPlausibleTitle(lines, i);
    if (!title) continue;
    out.push(makeDeadline(course, type, title, parsed, fallbackUrl, null, 'overview'));
  }
  return out;
}

function makeDeadline(course, type, title, parsed, url, sourceId, source) {
  return {
    id: `${course.id}:${type}:${sourceId || titleKey(title) || 'item'}:${parsed.dueAt || parsed.dueDate}`,
    courseId: String(course.id),
    course: course.name,
    term: course.term || null,
    type,
    title: oneLine(title) || 'Untitled item',
    dueAt: parsed.dueAt,
    dueDate: parsed.dueDate,
    dueText: parsed.dueText || parsed.raw,
    allDay: Boolean(parsed.allDay),
    deadlineBasis: parsed.basis,
    url: url || null,
    sourceId: sourceId || null,
    source
  };
}

function assignmentDeadlines(status, course) {
  const overview = status?.assignments?.overviewText || '';
  const items = Array.isArray(status?.assignments?.items) ? status.assignments.items : [];
  const details = Array.isArray(status?.assignments?.detailPages) ? status.assignments.detailPages : [];
  const titles = items.map(x => oneLine(x.text || x.title)).filter(Boolean);
  const out = [];

  for (const item of items) {
    const title = oneLine(item.text || item.title);
    if (!title) continue;
    const detail = details.find(d => String(d.key || '') === `assignment-${item.id}`) || details.find(d => oneLine(d.label).toLowerCase() === title.toLowerCase());
    const segment = segmentForTitle(overview, title, titles);
    const parsed = labeledDeadline(`${segment}\n${detail?.textPreview || ''}`, course.term?.year, true);
    if (!parsed) continue;
    out.push(makeDeadline(course, 'assignment', title, parsed, item.href || detail?.finalUrl, item.id, detail ? 'assignment-detail' : 'assignment-overview'));
  }

  out.push(...genericLabeledDeadlines(overview, 'assignment', course));
  return out;
}

function quizDeadlines(status, course) {
  const overview = status?.quizzes?.overviewText || '';
  const details = Array.isArray(status?.quizzes?.detailPages) ? status.quizzes.detailPages : [];
  const out = [];
  for (const detail of details) {
    const title = oneLine(detail.label || detail.title || detail.key);
    const parsed = labeledDeadline(detail.textPreview || '', course.term?.year, true);
    if (!parsed || !title) continue;
    out.push(makeDeadline(course, 'quiz', title, parsed, detail.finalUrl, detail.key, 'quiz-detail'));
  }
  out.push(...genericLabeledDeadlines(overview, 'quiz', course));
  return out;
}

function calendarDeadlines(status, course) {
  const overview = status?.calendar?.overviewText || '';
  const events = Array.isArray(status?.calendar?.events) ? status.calendar.events : [];
  const details = Array.isArray(status?.calendar?.detailPages) ? status.calendar.detailPages : [];
  const out = [];

  for (const event of events) {
    const title = oneLine(event.text || event.title);
    if (!title) continue;
    const detail = details.find(d => String(d.finalUrl || '') === String(event.href || '')) || details.find(d => oneLine(d.label).toLowerCase() === title.toLowerCase());
    const context = `${detail?.textPreview || ''}\n${lineContextForTitle(overview, title)}`;
    const parsed = labeledDeadline(context, course.term?.year, true) || nearbyDate(context, course.term?.year);
    if (!parsed) continue;
    out.push(makeDeadline(course, 'calendar', title, parsed, event.href || detail?.finalUrl, detail?.key || null, detail ? 'calendar-detail' : 'calendar-overview'));
  }
  return out;
}

function comparableTitles(a, b) {
  const ak = titleKey(a);
  const bk = titleKey(b);
  if (!ak || !bk) return false;
  return ak === bk || (ak.length >= 6 && bk.length >= 6 && (ak.includes(bk) || bk.includes(ak)));
}

function deadlinePriority(type) {
  if (type === 'assignment') return 3;
  if (type === 'quiz') return 2;
  return 1;
}

export function dedupeDeadlines(items) {
  const sorted = [...items].sort((a, b) => deadlinePriority(b.type) - deadlinePriority(a.type));
  const kept = [];
  for (const item of sorted) {
    const itemTime = item.dueAt ? Date.parse(item.dueAt) : new Date(`${item.dueDate}T23:59:59`).getTime();
    const duplicate = kept.find(existing => {
      if (existing.courseId !== item.courseId) return false;
      const existingTime = existing.dueAt ? Date.parse(existing.dueAt) : new Date(`${existing.dueDate}T23:59:59`).getTime();
      return Math.abs(existingTime - itemTime) <= 2 * 60 * 1000 && comparableTitles(existing.title, item.title);
    });
    if (!duplicate) kept.push(item);
  }
  return kept;
}

function sortDeadlineItems(items) {
  return [...items].sort((a, b) => {
    const at = a.dueAt ? Date.parse(a.dueAt) : new Date(`${a.dueDate}T23:59:59`).getTime();
    const bt = b.dueAt ? Date.parse(b.dueAt) : new Date(`${b.dueDate}T23:59:59`).getTime();
    return at - bt || `${a.course}|${a.title}`.localeCompare(`${b.course}|${b.title}`);
  });
}

function formatDeadlineMarkdown(index) {
  const lines = [
    '# Upcoming Deadlines',
    '',
    `Generated: ${index.generatedAt}`,
    `Active terms: ${(index.activeTerms || []).map(t => t.label || t.key).join(', ') || 'None'}`,
    `Upcoming items: ${index.count}`,
    ''
  ];
  if (!index.items.length) {
    lines.push('No upcoming dated assignments, quizzes, or calendar events were detected.');
    return `${lines.join('\n')}\n`;
  }

  let currentDate = null;
  for (const item of index.items) {
    if (item.dueDate !== currentDate) {
      currentDate = item.dueDate;
      lines.push(`## ${currentDate}`, '');
    }
    const when = item.dueAt
      ? new Date(item.dueAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : 'All day / no time shown';
    const type = item.type === 'calendar' ? 'Calendar' : item.type[0].toUpperCase() + item.type.slice(1);
    const link = item.url ? ` — ${item.url}` : '';
    lines.push(`- **${when}** — **${item.course}** — ${type}: ${item.title}${link}`);
  }
  return `${lines.join('\n')}\n`;
}

function changeCategory(type = '') {
  const t = String(type || '').toLowerCase();
  if (t === 'assets-index' || t === 'file') return 'technical';
  return 'student-facing';
}

function changeLabel(change) {
  const type = String(change.type || 'change');
  const map = {
    'assignments-list': 'Assignments',
    'assignments-detail': 'Assignment',
    'quizzes-list': 'Quizzes',
    'quizzes-detail': 'Quiz',
    'grades-list': 'Grades',
    'calendar-list': 'Calendar',
    'calendar-detail': 'Calendar event',
    'announcements-list': 'Announcements',
    'announcements-detail': 'Announcement',
    'discussions-list': 'Discussions',
    'discussions-detail': 'Discussion',
    'content-page': 'Content page',
    'content-module': 'Content module',
    'assets-index': 'Asset index',
    'file': 'Downloaded file'
  };
  return map[type] || type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeDigestChange(change) {
  return {
    action: change.action,
    category: changeCategory(change.type),
    courseId: change.courseId ? String(change.courseId) : null,
    course: change.course || null,
    termKey: change.termKey || null,
    type: change.type || null,
    label: changeLabel(change),
    id: change.id || null,
    title: oneLine(change.title || change.type || 'Change'),
    url: change.url || null,
    at: change.at || null
  };
}

export function buildSyncDigest(changes, mode, completedAt, activeTerms = [], deadlineChanges = []) {
  const seen = new Set();
  const normalized = [];
  for (const raw of changes || []) {
    if (!raw || !['added', 'updated'].includes(raw.action)) continue;
    const item = normalizeDigestChange(raw);
    const key = [item.action, item.courseId, item.type, item.id, item.title, item.url].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  normalized.sort((a, b) => `${a.course || ''}|${a.label}|${a.title}`.localeCompare(`${b.course || ''}|${b.label}|${b.title}`));
  const studentFacing = normalized.filter(x => x.category === 'student-facing');
  const technical = normalized.filter(x => x.category === 'technical');
  return {
    generatedAt: completedAt,
    syncMode: mode,
    activeTerms,
    summary: {
      total: normalized.length,
      added: normalized.filter(x => x.action === 'added').length,
      updated: normalized.filter(x => x.action === 'updated').length,
      studentFacing: studentFacing.length,
      technical: technical.length,
      deadlineChanges: deadlineChanges.length
    },
    changes: normalized,
    studentFacing,
    technical,
    deadlineChanges
  };
}

function formatDigestSection(lines, title, items) {
  lines.push(`## ${title}`, '');
  if (!items.length) {
    lines.push('None.', '');
    return;
  }
  let lastCourse = null;
  for (const item of items) {
    const course = item.course || 'School-wide';
    if (course !== lastCourse) {
      lastCourse = course;
      lines.push(`### ${course}`, '');
    }
    const url = item.url ? ` — ${item.url}` : '';
    lines.push(`- **${item.label}** — ${item.title}${url}`);
  }
  lines.push('');
}

function deadlineChangeLabel(kind) {
  if (kind === 'deadline-added') return 'New deadline';
  if (kind === 'deadline-removed') return 'Deadline removed';
  return 'Deadline changed';
}

function deadlineDisplay(snapshot) {
  if (!snapshot) return 'none';
  if (snapshot.dueAt) {
    return new Date(snapshot.dueAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }
  return snapshot.dueDate || snapshot.dueText || 'unknown';
}

function formatDeadlineChangeSection(lines, items) {
  lines.push('## Deadline changes', '');
  let lastCourse = null;
  for (const item of items) {
    const course = item.course || 'School-wide';
    if (course !== lastCourse) {
      lastCourse = course;
      lines.push(`### ${course}`, '');
    }
    const label = deadlineChangeLabel(item.kind);
    const url = item.url ? ` — ${item.url}` : '';
    if (item.kind === 'deadline-added') {
      lines.push(`- **${label}** — ${item.title} — ${deadlineDisplay(item.after)}${url}`);
    } else if (item.kind === 'deadline-removed') {
      lines.push(`- **${label}** — ${item.title} — was ${deadlineDisplay(item.before)}${url}`);
    } else {
      lines.push(`- **${label}** — ${item.title} — ${deadlineDisplay(item.before)} → ${deadlineDisplay(item.after)}${url}`);
    }
  }
  lines.push('');
}

function formatDigestMarkdown(digest) {
  const lines = [
    '# Sync Digest',
    '',
    `Generated: ${digest.generatedAt}`,
    `Mode: ${digest.syncMode}`,
    `Changes: ${digest.summary.total} total (${digest.summary.added} added, ${digest.summary.updated} updated)`,
    `Deadline changes: ${digest.summary.deadlineChanges || 0}`,
    ''
  ];
  if (!digest.changes.length && !digest.deadlineChanges.length) {
    lines.push('No mirror or deadline changes were detected in this sync.', '');
    return lines.join('\n');
  }
  if (digest.deadlineChanges.length) formatDeadlineChangeSection(lines, digest.deadlineChanges);
  if (digest.changes.length) {
    formatDigestSection(lines, 'Added', digest.studentFacing.filter(x => x.action === 'added'));
    formatDigestSection(lines, 'Updated', digest.studentFacing.filter(x => x.action === 'updated'));
    if (digest.technical.length) formatDigestSection(lines, 'Technical mirror changes', digest.technical);
  }
  return lines.join('\n');
}

async function writeIndexSet(dir, upcoming, digest) {
  await ensureDir(dir);
  await Promise.all([
    writeJson(path.join(dir, 'upcoming.json'), upcoming),
    writeText(path.join(dir, 'upcoming.md'), formatDeadlineMarkdown(upcoming)),
    writeJson(path.join(dir, 'sync-digest.json'), digest),
    writeText(path.join(dir, 'sync-digest.md'), formatDigestMarkdown(digest))
  ]);
}

export async function writeSchoolIndexes(config, manifest, changes, mode, completedAt) {
  const schoolDir = path.join(config.outputDir, '_school');
  const previousUpcoming = await readJson(path.join(schoolDir, 'upcoming.json'), null);
  const asOf = new Date(completedAt).getTime();
  const all = [];

  for (const course of manifest.courses || []) {
    const status = await readJson(path.join(course.courseDir, '_course_status.json'), null);
    if (!status) continue;
    const courseMeta = {
      id: String(course.id),
      name: course.name,
      term: course.term || null
    };
    all.push(...assignmentDeadlines(status, courseMeta));
    all.push(...quizDeadlines(status, courseMeta));
    all.push(...calendarDeadlines(status, courseMeta));
  }

  const allDeadlines = dedupeDeadlines(all);
  const upcomingItems = sortDeadlineItems(allDeadlines.filter(item => {
    const time = item.dueAt ? Date.parse(item.dueAt) : new Date(`${item.dueDate}T23:59:59`).getTime();
    return Number.isFinite(time) && time >= asOf - 60 * 1000;
  }));

  const upcoming = {
    schemaVersion: 1,
    generatedAt: completedAt,
    asOf: completedAt,
    activeTerms: manifest.activeTerms || [],
    count: upcomingItems.length,
    items: upcomingItems
  };
  const deadlineIntelligence = await buildDeadlineIntelligence({
    previousUpcoming,
    currentDeadlines: allDeadlines,
    currentUpcoming: upcomingItems,
    manifest,
    completedAt
  });
  const deadlineChanges = deadlineIntelligence.changes;
  const digest = buildSyncDigest(changes, mode, completedAt, manifest.activeTerms || [], deadlineChanges);
  await writeIndexSet(schoolDir, upcoming, digest);

  for (const term of manifest.activeTerms || []) {
    const termUpcomingItems = upcomingItems.filter(item => item.term?.key === term.key);
    const termUpcoming = { ...upcoming, activeTerms: [term], count: termUpcomingItems.length, items: termUpcomingItems };
    const termDigest = buildSyncDigest(
      (changes || []).filter(x => x.termKey === term.key),
      mode,
      completedAt,
      [term],
      deadlineChanges.filter(x => x.termKey === term.key)
    );
    await writeIndexSet(path.join(schoolDir, term.key), termUpcoming, termDigest);
  }

  const currentFile = path.join(schoolDir, 'current.json');
  const current = await readJson(currentFile, {});
  await writeJson(currentFile, {
    ...current,
    upcomingFile: '_school/upcoming.json',
    upcomingMarkdownFile: '_school/upcoming.md',
    syncDigestFile: '_school/sync-digest.json',
    syncDigestMarkdownFile: '_school/sync-digest.md'
  });

  return { upcoming, digest, deadlineChanges };
}
