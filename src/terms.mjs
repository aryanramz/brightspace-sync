const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'];

function seasonName(value = '') {
  const lower = String(value).trim().toLowerCase();
  return SEASONS.find(x => x.toLowerCase() === lower) || null;
}

export function parseTerm(value = '') {
  const text = String(value || '');
  const match = text.match(/\b(Winter|Spring|Summer|Fall)\s+(20\d{2})\b/i);
  if (!match) return null;
  const season = seasonName(match[1]);
  const year = Number(match[2]);
  if (!season || !Number.isInteger(year)) return null;
  return {
    season,
    year,
    label: `${season} ${year}`,
    key: `${year}-${season}`
  };
}

export function parseTermKey(value = '') {
  const text = String(value || '').trim();
  let match = text.match(/^(20\d{2})[-_ ](Winter|Spring|Summer|Fall)$/i);
  if (match) return parseTerm(`${match[2]} ${match[1]}`);
  return parseTerm(text);
}

export function termSortValue(term) {
  if (!term) return -Infinity;
  const order = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
  return Number(term.year) * 10 + (order[term.season] ?? -1);
}

export function compareTerms(a, b) {
  return termSortValue(a) - termSortValue(b);
}

export function termWindow(term) {
  if (!term) return null;
  const y = Number(term.year);
  switch (term.season) {
    // Winter 2027 is treated as the intersession centered on Jan 2027.
    case 'Winter':
      return { start: new Date(y - 1, 11, 15), end: new Date(y, 1, 15) };
    case 'Spring':
      return { start: new Date(y, 0, 1), end: new Date(y, 4, 31, 23, 59, 59, 999) };
    case 'Summer':
      return { start: new Date(y, 4, 15), end: new Date(y, 7, 20, 23, 59, 59, 999) };
    case 'Fall':
      return { start: new Date(y, 7, 1), end: new Date(y, 11, 31, 23, 59, 59, 999) };
    default:
      return null;
  }
}

export function inferCalendarTerm(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month >= 8) return parseTerm(`Fall ${year}`);
  if (month >= 5) return parseTerm(`Summer ${year}`);
  return parseTerm(`Spring ${year}`);
}

function uniqueTerms(terms) {
  const map = new Map();
  for (const term of terms.filter(Boolean)) map.set(term.key, term);
  return [...map.values()].sort(compareTerms);
}

function upcomingWithin(term, now, days) {
  const window = termWindow(term);
  if (!window) return false;
  const delta = window.start.getTime() - now.getTime();
  return delta >= 0 && delta <= days * 86400000;
}

export function chooseActiveTerms(courses, config = {}, now = new Date()) {
  const discovered = uniqueTerms(courses.map(c => c.term));
  if (!discovered.length) return [];

  // Explicit v2 override supports either "Fall 2026" or "2026-Fall".
  if (Array.isArray(config.activeTerms) && config.activeTerms.length) {
    const wanted = new Set(config.activeTerms.map(parseTermKey).filter(Boolean).map(t => t.key));
    const selected = discovered.filter(t => wanted.has(t.key));
    if (selected.length) return selected;
  }

  // Backward-compatible single-term override from old config.json.
  if (config.currentTerm) {
    const legacy = parseTermKey(config.currentTerm);
    if (legacy) {
      const selected = discovered.filter(t => t.key === legacy.key);
      if (selected.length) return selected;
    }
  }

  if (config.includePastCourses) return discovered;

  const upcomingDays = Number(config.includeUpcomingTermDays ?? 21);
  const selected = discovered.filter(term => {
    const window = termWindow(term);
    if (!window) return false;
    return (now >= window.start && now <= window.end) || upcomingWithin(term, now, upcomingDays);
  });
  if (selected.length) return selected;

  // If the school calendar falls outside our broad date windows, prefer the
  // inferred current term when it is present, otherwise the newest discovered
  // term. This prevents a future D2L calendar tweak from yielding zero courses.
  const inferred = inferCalendarTerm(now);
  const inferredMatch = discovered.find(t => t.key === inferred?.key);
  if (inferredMatch) return [inferredMatch];
  return [discovered[discovered.length - 1]];
}

export function enrichCoursesWithTerms(courses) {
  return courses.map(course => ({
    ...course,
    term: parseTerm(course.name)
  }));
}

export function filterCoursesToActiveTerms(courses, activeTerms) {
  if (!activeTerms?.length) return courses.filter(c => !c.term);
  const keys = new Set(activeTerms.map(t => t.key));
  return courses.filter(course => course.term && keys.has(course.term.key));
}
