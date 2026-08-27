import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDeadlineIntelligence } from './deadline-intelligence.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'brightspace-deadline-intelligence-'));
try {
  const courseDir = path.join(tmp, 'course');
  await fs.mkdir(courseDir, { recursive: true });
  await fs.writeFile(path.join(courseDir, '_course_status.json'), JSON.stringify({
    assignments: {
      overviewText: 'Homework #1\nHomework #2',
      items: [
        { id: '501', text: 'Homework #1' },
        { id: '502', text: 'Homework #2' }
      ]
    },
    quizzes: { overviewText: '', detailPages: [] },
    calendar: { overviewText: '', events: [] }
  }));

  const term = { key: '2026-Fall', label: 'Fall 2026' };
  const manifest = { courses: [{ id: '1001', name: 'ISE 321', term, courseDir }] };
  const oldHw1 = {
    courseId: '1001', course: 'ISE 321', term, type: 'assignment', sourceId: '501', title: 'Homework #1',
    dueAt: '2026-09-09T03:59:00.000Z', dueDate: '2026-09-08', dueText: 'Due on Sep 8, 2026 11:59 PM', allDay: false,
    deadlineBasis: 'due', url: 'https://example.edu/assignment/501'
  };
  const newHw1 = { ...oldHw1, dueAt: '2026-09-11T03:59:00.000Z', dueDate: '2026-09-10', dueText: 'Due on Sep 10, 2026 11:59 PM' };
  const hw2 = {
    courseId: '1001', course: 'ISE 321', term, type: 'assignment', sourceId: '502', title: 'Homework #2',
    dueAt: '2026-09-13T03:59:00.000Z', dueDate: '2026-09-12', dueText: 'Due on Sep 12, 2026 11:59 PM', allDay: false,
    deadlineBasis: 'due', url: 'https://example.edu/assignment/502'
  };
  const completedAt = '2026-08-27T22:00:00.000Z';

  const baseline = await buildDeadlineIntelligence({
    previousUpcoming: null,
    currentDeadlines: [newHw1],
    currentUpcoming: [newHw1],
    manifest,
    completedAt
  });
  assert.equal(baseline.baseline, true);
  assert.deepEqual(baseline.changes, []);

  const changedAndAdded = await buildDeadlineIntelligence({
    previousUpcoming: { generatedAt: '2026-08-27T21:00:00.000Z', items: [oldHw1] },
    currentDeadlines: [newHw1, hw2],
    currentUpcoming: [newHw1, hw2],
    manifest,
    completedAt
  });
  assert.equal(changedAndAdded.baseline, false);
  assert.equal(changedAndAdded.changes.length, 2);
  assert.equal(changedAndAdded.changes.find(x => x.title === 'Homework #1')?.kind, 'deadline-changed');
  assert.equal(changedAndAdded.changes.find(x => x.title === 'Homework #1')?.before?.dueDate, '2026-09-08');
  assert.equal(changedAndAdded.changes.find(x => x.title === 'Homework #1')?.after?.dueDate, '2026-09-10');
  assert.equal(changedAndAdded.changes.find(x => x.title === 'Homework #2')?.kind, 'deadline-added');

  const removed = await buildDeadlineIntelligence({
    previousUpcoming: { generatedAt: '2026-08-27T21:00:00.000Z', items: [oldHw1] },
    currentDeadlines: [],
    currentUpcoming: [],
    manifest,
    completedAt
  });
  assert.equal(removed.changes.length, 1);
  assert.equal(removed.changes[0].kind, 'deadline-removed');
  assert.equal(removed.changes[0].title, 'Homework #1');

  await fs.writeFile(path.join(courseDir, '_course_status.json'), JSON.stringify({
    assignments: { overviewText: '', items: [] },
    quizzes: { overviewText: '', detailPages: [] },
    calendar: { overviewText: '', events: [] }
  }));
  const disappeared = await buildDeadlineIntelligence({
    previousUpcoming: { generatedAt: '2026-08-27T21:00:00.000Z', items: [oldHw1] },
    currentDeadlines: [],
    currentUpcoming: [],
    manifest,
    completedAt
  });
  assert.deepEqual(disappeared.changes, [], 'an item disappearing entirely must not be mislabeled as a removed deadline');

  console.log('Deadline intelligence self-test: PASS');
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
