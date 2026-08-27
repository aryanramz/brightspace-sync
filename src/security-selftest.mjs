import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignore = await fs.readFile(path.join(ROOT, '.gitignore'), 'utf8');
for (const required of ['.brightspace-profile/', 'BrightspaceMirror/', 'config.json', '.env']) {
  if (!ignore.includes(required)) throw new Error(`.gitignore is missing sensitive path: ${required}`);
}

const example = JSON.parse(await fs.readFile(path.join(ROOT, 'config.example.json'), 'utf8'));
const exampleText = JSON.stringify(example).toLowerCase();
for (const forbidden of ['"password"', '"passwd"', '"secret"', '"username"']) {
  if (exampleText.includes(forbidden)) throw new Error(`config.example.json contains a credential-like field: ${forbidden}`);
}
if (/https?:\/\/(?:mycourses\.)?[a-z0-9.-]+\.edu/i.test(String(example.baseUrl || ''))) {
  throw new Error('config.example.json must not ship with a real institution .edu Brightspace URL.');
}

const secretPatterns = [
  { name: 'Windows user-profile path', re: /C:\\Users\\[^\\\s]+/i },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'OpenAI-style API key', re: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub personal token', re: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'private key material', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ }
];

async function walk(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.brightspace-profile', 'BrightspaceMirror'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

for (const file of await walk(ROOT)) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
  for (const pattern of secretPatterns) {
    if (pattern.re.test(text)) throw new Error(`${path.relative(ROOT, file)} contains ${pattern.name}.`);
  }
}

console.log('Security self-test: PASS (sensitive local paths are ignored; public defaults are generic; no common secret patterns detected).');
