import fs from 'node:fs/promises';
import path from 'node:path';

function oneLine(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleKey(value = '') {
  return oneLine(value)
    .toLowerCase()
    .replace(/\b(?:due|deadline|assignment|quiz|event)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliases(item) {
  const courseId = String(item?.courseId || '');
  const type = String(item?.type || '');
  const out = [];
  if (item?.sourceId) out.push(`${courseId}|${type}|source:${String(item.sourceId)}`);
  const tk = titleKey(item?.title || '');
  if (tk) out.push(`${courseId}|${type}|title:${tk}`);
  return out;
}

function deadlineStamp(item) {
  return item?.dueAt || item?.dueDate || null;
}

function deadlineTime(item) {
  if (item?.dueAt) return Date.parse(item.dueAt);
  if (item?.dueDate) return new Date(`${item.dueDate}T23:59:59`).getTime();
  return NaN;
}

function deadlineSnapshot(item) {
  if (!item) return null;
  return {
    dueAt: item.dueAt || null,
    dueDate: item.dueDate || null,
    dueText: item.dueText || null,
    allDay: Boolean(item.allDay),
    deadlineBasis: item.deadlineBasis || null
  };
}

function itemIdentity(item) {
  return {
    courseId: String(item?.courseId || ''),
    course: item?.course || null,
    termKey: item?.term?.key || item?.termKey || null,
    type: item?.type || null,
    sourceId: item?.sourceId || null,
    title: oneLine(item?.title || 'Untitled item'),
    url: item?.url || null
  };
}

function addPresenceKey(set, courseId, type, sourceId, title) {
  if (sourceId) set.add(`${courseId}|${type}|source:${String(sourceId)}`);
  const tk = titleKey(title);
  if (tk) set.add(`${courseId}|${type}|title:${tk}`);
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function collectPresence(manifest) {
  const keys = new Set();
  const overview = new Map();

  for (const course of manifest?.courses || []) {
    const courseId = String(course.id || '');
    const status = await readJson(path.join(course.courseDir, '_course_status.json'), null);
    if (!status) continue;

    for (const item of status?.assignments?.items || []) {
      addPresenceKey(keys, courseId, 'assignment', item.id, item.text || item.title);
    }
    for (const detail of status?.quizzes?.detailPages || []) {
      addPresenceKey(keys, courseId, 'quiz', detail.key, detail.label || detail.title || detail.key);
    }
    for (const event of status?.calendar?.events || []) {
      addPresenceKey(keys, courseId, 'calendar', null, event.text || event.title);
    }

    overview.set(`${courseId}|assignment`, oneLine(status?.assignments?.overviewText || '').toLowerCase());
    overview.set(`${courseId}|quiz`, oneLine(status?.quizzes?.overviewText || '').toLowerCase());
    overview.set(`${courseId}|calendar`, oneLine(status?.calendar?.overviewText || '').toLowerCase());
  }

  return { keys, overview };
}

function findByAliases(index, item) {
  for (const key of aliases(item)) {
    const found = index.get(key);
    if (found) return found;
  }
  return null;
}

function buildAliasIndex(items) {
  const map = new Map();
  for (const item of items || []) {
    for (const key of aliases(item)) if (!map.has(key)) map.set(key, item);
  }
  return map;
}

function stillPresent(item, presence) {
  if (aliases(item).some(key => presence.keys.has(key))) return true;
  const tk = titleKey(item?.title || '');
  if (!tk) return false;
  const haystack = presence.overview.get(`${String(item.courseId || '')}|${String(item.type || '')}`) || '';
  return haystack.includes(tk);
}

function makeChange(kind, item, before, after) {
  return {
    kind,
    ...itemIdentity(item),
    before: deadlineSnapshot(before),
    after: deadlineSnapshot(after)
  };
}

export async function buildDeadlineIntelligence({ previousUpcoming, currentDeadlines, currentUpcoming, manifest, completedAt }) {
  const previousItems = Array.isArray(previousUpcoming?.items) ? previousUpcoming.items : [];
  if (!previousUpcoming?.generatedAt || !previousItems.length) {
    return { baseline: true, changes: [] };
  }

  const now = Date.parse(completedAt);
  const currentAllIndex = buildAliasIndex(currentDeadlines || []);
  const previousIndex = buildAliasIndex(previousItems);
  const presence = await collectPresence(manifest);
  const changes = [];
  const matchedCurrent = new Set();

  for (const previous of previousItems) {
    const current = findByAliases(currentAllIndex, previous);
    if (current) {
      for (const key of aliases(current)) matchedCurrent.add(key);
      if (deadlineStamp(previous) !== deadlineStamp(current)) {
        changes.push(makeChange('deadline-changed', current, previous, current));
      }
      continue;
    }

    const previousTime = deadlineTime(previous);
    if (Number.isFinite(previousTime) && previousTime >= now - 60 * 1000 && stillPresent(previous, presence)) {
      changes.push(makeChange('deadline-removed', previous, previous, null));
    }
  }

  for (const current of currentUpcoming || []) {
    if (findByAliases(previousIndex, current)) continue;
    if (aliases(current).some(key => matchedCurrent.has(key))) continue;
    changes.push(makeChange('deadline-added', current, null, current));
  }

  const seen = new Set();
  const deduped = [];
  for (const change of changes) {
    const key = [change.kind, change.courseId, change.type, change.sourceId || titleKey(change.title), change.before?.dueAt || change.before?.dueDate || '', change.after?.dueAt || change.after?.dueDate || ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(change);
  }

  deduped.sort((a, b) => `${a.course || ''}|${a.title}|${a.kind}`.localeCompare(`${b.course || ''}|${b.title}|${b.kind}`));
  return { baseline: false, changes: deduped };
}
