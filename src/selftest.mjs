import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ensureMirrorLayout } from './migration.mjs';
import { chooseActiveTerms, enrichCoursesWithTerms } from './terms.mjs';

const courses = enrichCoursesWithTerms([
  { id: '1', name: 'Example Course A - Fall 2026' },
  { id: '2', name: 'Example Course B - Spring 2027' },
  { id: '3', name: 'Example Course C - Summer 2026' }
]);
assert.deepEqual(chooseActiveTerms(courses, {}, new Date('2026-08-26T12:00:00')).map(t => t.key), ['2026-Fall']);
assert.deepEqual(chooseActiveTerms(courses, {}, new Date('2026-12-20T12:00:00')).map(t => t.key), ['2026-Fall', '2027-Spring']);
assert.deepEqual(chooseActiveTerms(courses, { activeTerms: ['2027-Spring'] }, new Date('2026-08-26T12:00:00')).map(t => t.key), ['2027-Spring']);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'brightspace-v17-'));
try {
  const folder = path.join(root, 'Example Course A - Fall 2026 [10001]');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, '_course.json'), JSON.stringify({ id: '10001', name: 'Example Course A - Fall 2026' }));
  await fs.mkdir(path.join(root, '_changes'), { recursive: true });
  await fs.writeFile(path.join(root, '_changes', 'latest.json'), '{}');

  const first = await ensureMirrorLayout({ outputDir: root, currentTerm: null }, '1.7.0');
  assert.ok(first.actions.some(x => x.action === 'move-course-to-term'));
  await fs.access(path.join(root, '2026-Fall', 'Example Course A - Fall 2026 [10001]', '_course.json'));
  await fs.access(path.join(root, '_system', 'changes', 'latest.json'));

  const second = await ensureMirrorLayout({ outputDir: root, currentTerm: null }, '1.7.0');
  assert.equal(second.actions.length, 0);
  console.log('Brightspace Sync v2.2 self-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
