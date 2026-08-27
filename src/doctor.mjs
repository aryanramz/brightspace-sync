import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

console.log(`Node: ${process.version}`);
console.log(`Platform: ${process.platform} ${process.arch}`);

try {
  const pkg = JSON.parse(await fsPromises.readFile(path.resolve('package.json'), 'utf8'));
  console.log(`Project: ${pkg.name} ${pkg.version}`);
} catch {
  console.log('Project: package.json not found from current directory');
}

const candidates = [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
].filter(Boolean);

const brave = candidates.find(p => fs.existsSync(p));
console.log(brave ? `Brave: ${brave}` : 'Brave: NOT FOUND');
console.log('Config: set browserExecutablePath in config.json only if Brave is installed somewhere non-standard.');
