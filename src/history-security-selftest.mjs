import { execFileSync } from 'node:child_process';

function git(args, { allowNoMatch = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowNoMatch && error.status === 1) return '';
    throw error;
  }
}

const forbiddenPaths = ['.brightspace-profile', 'BrightspaceMirror', 'config.json', '.env'];
for (const forbidden of forbiddenPaths) {
  const commits = git(['log', '--all', '--format=%H', '--', forbidden], { allowNoMatch: true });
  if (commits) throw new Error(`Sensitive path exists in Git history: ${forbidden}`);
}

const commits = git(['rev-list', '--all']).split(/\r?\n/).filter(Boolean);
if (!commits.length) throw new Error('Could not enumerate Git history.');

const approvedInstitutionHosts = new Set([
  'mycourses.stonybrook.edu',
  'sso.cc.stonybrook.edu'
]);

const stonyBrookEducationDomain = 'stonybrook.' + 'edu';
const approvedSyntheticAuthFixtureUrls = new Set([
  `http://mycourses.${stonyBrookEducationDomain}`,
  `https://mycourses.${stonyBrookEducationDomain}.evil.test`,
  `http://sso.cc.${stonyBrookEducationDomain}/login`,
  `https://sso.cc.${stonyBrookEducationDomain}.evil.test/login`
]);

function institutionUrlCandidates(line) {
  return line.match(/https?:\/\/[^\s'"`<>()\[\]{},;]+\.edu(?:[^\s'"`<>()\[\]{},;]*)?/gi) || [];
}

function containsOnlyApprovedInstitutionUrls(line) {
  const candidates = institutionUrlCandidates(line);
  if (!candidates.length) return false;
  return candidates.every(candidate => {
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:'
        && approvedInstitutionHosts.has(url.hostname.toLowerCase())
        && !url.username
        && !url.password
        && !url.search
        && !url.hash;
    } catch {
      return false;
    }
  });
}

function containsOnlyKnownSyntheticAuthFixtures(line) {
  if (!/^[0-9a-f]+:src[\\/]auth-selftest\.mjs:\d+:/i.test(line)) return false;
  const candidates = institutionUrlCandidates(line);
  return candidates.length > 0 && candidates.every(candidate => approvedSyntheticAuthFixtureUrls.has(candidate));
}

function isAllowedInstitutionUrlLine(line) {
  return /example\.edu/i.test(line)
    || containsOnlyKnownSyntheticAuthFixtures(line)
    || containsOnlyApprovedInstitutionUrls(line);
}

const knownFixtureProbe = `0000000:src/auth-selftest.mjs:1:'http://mycourses.${stonyBrookEducationDomain}'`;
if (!containsOnlyKnownSyntheticAuthFixtures(knownFixtureProbe)) {
  throw new Error('History security self-test did not recognize the exact synthetic authentication fixture.');
}
const unrelatedCredentialProbe = "0000000:src/auth-selftest.mjs:999:'https://real-user:real-secret@" + "school.edu/login'";
if (isAllowedInstitutionUrlLine(unrelatedCredentialProbe)) {
  throw new Error('History security self-test allowed an unrelated credential-bearing authentication URL.');
}

const patterns = [
  ['AWS access key', 'AKIA[0-9A-Z]{16}'],
  ['GitHub personal/access token', 'gh[pousr]_[A-Za-z0-9_]{20,}'],
  ['OpenAI-style API key', 'sk-[A-Za-z0-9_-]{20,}'],
  ['Google API key', 'AIza[0-9A-Za-z_-]{30,}'],
  ['private key material', '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'],
  ['institution email address', '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.edu'],
  ['student-ID-like field', '(student|empl|banner)[ _-]?(id|number).{0,24}[=: ]+[0-9]{7,12}'],
  ['institution-specific .edu URL', 'https?://[A-Za-z0-9.-]+\\.edu([^A-Za-z0-9.-]|$)']
];

for (const [name, pattern] of patterns) {
  const output = git(['grep', '-I', '-n', '-E', '-e', pattern, ...commits], { allowNoMatch: true });
  if (!output) continue;

  const suspicious = output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(line => {
      if (name === 'institution-specific .edu URL' && isAllowedInstitutionUrlLine(line)) return false;
      return true;
    });

  if (suspicious.length) {
    const preview = suspicious.slice(0, 5).join('\n');
    throw new Error(`Git history contains ${name}:\n${preview}`);
  }
}

console.log(`History security self-test: PASS (${commits.length} commit(s) scanned; sensitive runtime paths absent from all history).`);
