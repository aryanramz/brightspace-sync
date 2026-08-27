import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { publishMirrorToDrive } from './publish.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-publish-test-'));
const src = path.join(tmp, 'BrightspaceMirror');
const dst = path.join(tmp, 'Drive', 'Brightspace Mirror');
await fs.mkdir(path.join(src, '2026-Fall', 'Example Course [1]'), { recursive: true });
await fs.mkdir(path.join(src, '_school'), { recursive: true });
await fs.mkdir(path.join(src, '_system'), { recursive: true });
await fs.writeFile(path.join(src, '2026-Fall', 'Example Course [1]', 'page.txt'), 'hello');
await fs.writeFile(path.join(src, '_school', 'current.json'), '{"ok":true}');
await fs.writeFile(path.join(src, '_system', 'secret.txt'), 'do not publish');

const config = {
  outputDir: src,
  systemDir: path.join(src, '_system'),
  drivePublish: { enabled: true, destination: dst, deleteRemoved: true, verifyDestinationOnFull: true }
};

let r = await publishMirrorToDrive(config, 'quick');
assert.equal(r.copied, 2);
assert.equal(await fs.readFile(path.join(dst, '2026-Fall', 'Example Course [1]', 'page.txt'), 'utf8'), 'hello');
assert.equal(await fs.readFile(path.join(dst, '_school', 'current.json'), 'utf8'), '{"ok":true}');
await assert.rejects(fs.access(path.join(dst, '_system', 'secret.txt')));

r = await publishMirrorToDrive(config, 'quick');
assert.equal(r.copied, 0);
assert.equal(r.unchanged, 2);

await new Promise(resolve => setTimeout(resolve, 20));
await fs.writeFile(path.join(src, '2026-Fall', 'Example Course [1]', 'page.txt'), 'hello2');
r = await publishMirrorToDrive(config, 'quick');
assert.equal(r.copied, 1);

await fs.unlink(path.join(src, '_school', 'current.json'));
r = await publishMirrorToDrive(config, 'quick');
assert.equal(r.deleted, 1);
await assert.rejects(fs.access(path.join(dst, '_school', 'current.json')));

console.log('Drive publish self-test: PASS');
await fs.rm(tmp, { recursive: true, force: true });
