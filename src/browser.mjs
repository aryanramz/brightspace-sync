import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function candidate(name, executablePath) {
  return executablePath ? { name, path: executablePath } : null;
}

export function chromiumBrowserCandidates(configuredPath = '') {
  const local = process.env.LOCALAPPDATA;
  const pf = process.env.PROGRAMFILES;
  const pfx86 = process.env['PROGRAMFILES(X86)'];

  return [
    candidate('Configured Chromium browser', configuredPath),

    candidate('Brave', local && path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')),
    candidate('Brave', pf && path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')),
    candidate('Brave', pfx86 && path.join(pfx86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')),

    candidate('Google Chrome', local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    candidate('Google Chrome', pf && path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    candidate('Google Chrome', pfx86 && path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe')),

    candidate('Microsoft Edge', pf && path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    candidate('Microsoft Edge', pfx86 && path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    candidate('Microsoft Edge', local && path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  ].filter(Boolean);
}

export function findChromiumExecutable(configuredPath = '') {
  const found = chromiumBrowserCandidates(configuredPath).find(item => fs.existsSync(item.path));
  if (found) return found;

  throw new Error(
    'No supported Chromium browser was found. Install Brave, Google Chrome, or Microsoft Edge, '
    + 'or set browserExecutablePath in config.json to a compatible Chromium executable.'
  );
}
