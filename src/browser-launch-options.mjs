import { institutionAdapterForBaseUrl } from './auth-adapters.mjs';

export function buildSyncBrowserLaunchOptions(config, executablePath) {
  const automaticInstitutionLogin = Boolean(
    config.auth?.automaticLoginEnabled && institutionAdapterForBaseUrl(config.baseUrl)
  );
  const startMinimized = Boolean(config.headless) || automaticInstitutionLogin;
  return {
    executablePath,
    // A real window must exist so manual login or MFA can be brought forward.
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    args: [
      '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
      ...(startMinimized ? ['--start-minimized'] : [])
    ]
  };
}
