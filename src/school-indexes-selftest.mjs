import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSyncDigest, parseBrightspaceDate, writeSchoolIndexes } from './school-indexes.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'brightspace-school-indexes-'));
try {
  const courseDir = path.join(tmp, '2026-Fall', 'ISE 321 [1001]');
  await fs.mkdir(courseDir, { recursive: true });
  await fs.writeFile(path.join(courseDir, '_course_status.json'), JSON.stringify({
    assignments: {
      overviewText: 'Homework #1\nDue on Sep 8, 2026 11:59 PM\nAttachments',
      items: [{ id: '501', href: 'https://example.edu/assignment/501', text: 'Homework #1', title: '' }],
      detailPages: []
    },
    quizzes: {
      overviewText: 'Quiz 1\nDue Date: Sep 10, 2026 11:59 PM',
      detailPages: []
    },
    calendar: {
      overviewText: 'Sep 8, 2026 11:59 PM\nHomework #1 Due',
      events: [{ href: 'https://example.edu/calendar/77', text: 'Homework #1 Due', title: '' }],
      detailPages: []
    }
  }, null, 2));

  const parsed = parseBrightspaceDate('Due on Sep 8, 2026 11:59 PM', 2026);
  assert.equal(parsed?.dueDate, '2026-09-08');
  assert.ok(parsed?.dueAt);

  const term = { season: 'Fall', year: 2026, label: 'Fall 2026', key: '2026-Fall' };
  const manifest = {
    activeTerms: [term],
    courses: [{ id: '1001', name: 'ISE 321', term, courseDir }]
  };
  const changes = [
    { action: 'added', courseId: '1001', course: 'ISE 321', termKey: '2026-Fall', type: 'assignments-detail', id: 'assignment-501', title: 'Homework #1', url: 'https://example.edu/assignment/501' },
    { action: 'updated', courseId: '1001', course: 'ISE 321', termKey: '2026-Fall', type: 'quizzes-list', title: 'quizzes', url: 'https://example.edu/quizzes' },
    { action: 'updated', courseId: '1001', course: 'ISE 321', termKey: '2026-Fall', type: 'assets-index', title: 'assignments', url: 'https://example.edu/assignments' }
  ];

  await fs.mkdir(path.join(tmp, '_school'), { recursive: true });
  await fs.writeFile(path.join(tmp, '_school', 'current.json'), JSON.stringify({ generatedAt: 'before' }, null, 2));
  const completedAt = '2026-08-27T17:00:00.000Z';
  const result = await writeSchoolIndexes({ outputDir: tmp }, manifest, changes, 'quick', completedAt);

  assert.equal(result.upcoming.count, 2, 'assignment/calendar duplicate should collapse and quiz should remain');
  assert.deepEqual(result.upcoming.items.map(x => x.type), ['assignment', 'quiz']);
  assert.deepEqual(result.upcoming.items.map(x => x.dueDate), ['2026-09-08', '2026-09-10']);

  const upcoming = JSON.parse(await fs.readFile(path.join(tmp, '_school', 'upcoming.json'), 'utf8'));
  assert.equal(upcoming.count, 2);
  const upcomingMd = await fs.readFile(path.join(tmp, '_school', 'upcoming.md'), 'utf8');
  assert.match(upcomingMd, /Homework #1/);
  assert.match(upcomingMd, /Quiz 1/);

  const digest = JSON.parse(await fs.readFile(path.join(tmp, '_school', 'sync-digest.json'), 'utf8'));
  assert.equal(digest.summary.total, 3);
  assert.equal(digest.summary.studentFacing, 2);
  assert.equal(digest.summary.technical, 1);
  const digestMd = await fs.readFile(path.join(tmp, '_school', 'sync-digest.md'), 'utf8');
  assert.match(digestMd, /# Sync Digest/);
  assert.match(digestMd, /Homework #1/);

  const current = JSON.parse(await fs.readFile(path.join(tmp, '_school', 'current.json'), 'utf8'));
  assert.equal(current.upcomingFile, '_school/upcoming.json');
  assert.equal(current.syncDigestFile, '_school/sync-digest.json');

  const termUpcoming = JSON.parse(await fs.readFile(path.join(tmp, '_school', '2026-Fall', 'upcoming.json'), 'utf8'));
  assert.equal(termUpcoming.count, 2);

  const standaloneDigest = buildSyncDigest(changes, 'quick', completedAt, [term]);
  assert.equal(standaloneDigest.summary.added, 1);
  assert.equal(standaloneDigest.summary.updated, 2);

  console.log('School indexes self-test: PASS');
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
