import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedReleaseArtifactNames,
  parseStableReleaseTag,
  releaseNotes,
  validateReleaseArtifacts,
  validateTagMatchesPackage
} from './release-validation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const workflow = await fs.readFile(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

assert.equal(packageJson.version, '2.4.1', 'Milestone 2C.3 must not bump the application version');
assert.equal(parseStableReleaseTag('v2.4.1'), '2.4.1');
for (const invalid of [
  '2.4.1', 'V2.4.1', 'v02.4.1', 'v2.04.1', 'v2.4.01', 'v2.4', 'v2.4.1.0',
  'v2.4.1-beta', 'v2.4.1+build', 'v2147483648.0.0', 'v2.4.1/unsafe'
]) assert.throws(() => parseStableReleaseTag(invalid), /release tag/i);
assert.equal(validateTagMatchesPackage('v2.4.1', packageJson.version), packageJson.version);
assert.throws(() => validateTagMatchesPackage('v2.4.2', packageJson.version), /does not match/);

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'coursemirror-release-contract-'));
try {
  const [installerName, checksumName] = expectedReleaseArtifactNames(packageJson.version);
  const installer = path.join(temp, installerName);
  const sidecar = path.join(temp, checksumName);
  await fs.writeFile(installer, 'synthetic installer fixture');
  const crypto = await import('node:crypto');
  const digest = crypto.createHash('sha256').update(await fs.readFile(installer)).digest('hex');
  await fs.writeFile(sidecar, `${digest}  ${installerName}`, 'ascii');
  const validated = await validateReleaseArtifacts(temp, packageJson.version);
  assert.equal(validated.checksumLine, `${digest}  ${installerName}`);
  assert.match(releaseNotes('v2.4.1', validated.checksumLine), new RegExp(digest));

  await fs.writeFile(sidecar, `${'0'.repeat(64)}  ${installerName}`, 'ascii');
  await assert.rejects(validateReleaseArtifacts(temp, packageJson.version), /SHA-256/);
  await fs.writeFile(sidecar, `${digest}  ${installerName}`, 'ascii');
  await fs.writeFile(path.join(temp, 'unexpected.txt'), 'unexpected');
  await assert.rejects(validateReleaseArtifacts(temp, packageJson.version), /exactly/);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

assert.match(workflow, /^on:\s*\n\s+push:\s*\n\s+tags:\s*\n\s+- ['"]v\*\.\*\.\*['"]/m);
assert.doesNotMatch(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:/);
assert.doesNotMatch(workflow, /\n\s+branches:/);
assert.match(workflow, /^permissions:\s*\n\s+contents: read/m);
assert.match(workflow, /publish:\s*[\s\S]*?permissions:\s*\n\s+contents: write/);
assert.match(workflow, /release-contract:\s*[\s\S]*?Reject malformed or mismatched release tags/);
assert.match(workflow, /test:\s*\n\s+needs: release-contract/);
assert.match(workflow, /windows-release-build:\s*[\s\S]*?needs:\s*\[release-contract, test, dependency-security, history-security\]/);
assert.match(workflow, /publish:\s*[\s\S]*?needs:\s*\[release-contract, test, dependency-security, history-security, windows-release-build\]/);
assert.match(workflow, /node-version: \[20\.x, 22\.x, 24\.20\.0\]/);
assert.match(workflow, /provision-inno-setup-ci\.ps1/);
assert.match(workflow, /npm run build:windows-installer/);
assert.match(workflow, /VersionInfo\.ProductVersion/);
assert.match(workflow, /Official installer product version mismatch/);
assert.match(workflow, /release-validation\.mjs --tag/);
assert.match(workflow, /gh release view/);
assert.match(workflow, /gh release create/);
assert.match(workflow, /--verify-tag/);
assert.doesNotMatch(workflow, /--draft|--prerelease/);
assert.match(workflow, /CourseMirror-\$version-Setup\.exe/);
assert.match(workflow, /CourseMirror-\$version-Setup\.exe\.sha256/);
assert.match(workflow, /npm run update-check-selftest/);
assert.match(workflow, /npm run release-pipeline-selftest/);

console.log('CourseMirror release-pipeline self-test passed.');
