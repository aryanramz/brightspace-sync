import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function modulesIn(directory) {
  return (await fs.readdir(path.join(root, directory)))
    .filter(name => name.endsWith('.mjs'))
    .map(name => path.join(root, directory, name));
}

async function check(file) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Syntax check failed: ${file}`)));
  });
}

for (const file of [...await modulesIn('src'), ...await modulesIn('scripts')]) await check(file);
console.log('JavaScript syntax check: PASS');
