import {
  AUTHENTICATED_BRIGHTSPACE_SELECTOR,
  institutionAdapterForBaseUrl,
  isTrustedBrightspaceUrl
} from './auth-adapters.mjs';
import { authenticationAttentionError } from './auth-attention.mjs';

async function isAuthenticated(page, configuredBaseUrl) {
  if (!isTrustedBrightspaceUrl(page.url(), configuredBaseUrl)) return false;
  try { return await page.locator(AUTHENTICATED_BRIGHTSPACE_SELECTOR).count() > 0; } catch { return false; }
}

export async function makeChromiumPageVisible(context, page) {
  try {
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await session.detach().catch(() => {});
  } catch {}
  await page.bringToFront().catch(() => {});
}

export async function authenticateWithInstitutionAdapter({
  page,
  context,
  config,
  credentialProvider,
  makeVisible = () => makeChromiumPageVisible(context, page),
  log = console,
  timeoutMs = config.auth?.manualLoginTimeoutMs ?? 10 * 60 * 1000,
  pollMs = 1200,
  allowAutomatic = true
}) {
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => {});
  if (await isAuthenticated(page, config.baseUrl)) {
    log.log('Existing Brightspace session found — continuing without credential access.');
    return { authenticated: true, credentialRetrieved: false, humanEscalation: false };
  }

  const adapter = institutionAdapterForBaseUrl(config.baseUrl);
  const automatic = Boolean(adapter && allowAutomatic && config.auth?.automaticLoginEnabled);
  let credentialRetrieved = false;
  let humanEscalation = false;
  let submitted = false;
  let handoffInitiated = false;

  if (!automatic) {
    await makeVisible();
    humanEscalation = true;
    log.log('Brightspace login is required. Complete sign-in and any MFA challenge in the visible browser.');
  }

  const started = Date.now();
  while (Date.now() - started < Number(timeoutMs)) {
    if (await isAuthenticated(page, config.baseUrl)) {
      log.log('Brightspace authentication completed — continuing.');
      return { authenticated: true, credentialRetrieved, humanEscalation };
    }

    if (automatic) {
      const inspection = await adapter.inspectPage(page);
      if (inspection.state === 'authenticated') {
        return { authenticated: true, credentialRetrieved, humanEscalation };
      }
      if (inspection.state === 'unexpected') {
        throw authenticationAttentionError('Automatic sign-in stopped at an unexpected authentication host. Use Refresh Login.');
      }
      if (inspection.state === 'brightspace-wait') {
        throw authenticationAttentionError('The Stony Brook institutional sign-in control was not recognized. Use Refresh Login.');
      }
      if (inspection.state === 'institution-login') {
        if (handoffInitiated) {
          throw authenticationAttentionError('The Stony Brook institutional sign-in handoff did not complete. Use Refresh Login.');
        }
        try {
          await adapter.beginSsoHandoff(page);
        } catch {
          throw authenticationAttentionError('The Stony Brook institutional sign-in handoff could not be completed. Use Refresh Login.');
        }
        handoffInitiated = true;
      } else if (inspection.state === 'mfa') {
        if (!humanEscalation) {
          await makeVisible();
          humanEscalation = true;
          log.log('Duo or another human approval is required in the visible browser. Automatic sign-in will not bypass it.');
        }
      } else if (inspection.state === 'login-form' && !submitted) {
        let credential;
        try {
          credential = await credentialProvider.read(adapter.credentialTarget);
          credentialRetrieved = true;
          if (!credential?.username || !credential?.password) {
            throw new Error('missing credential');
          }
          await adapter.fillAndSubmit(page, credential);
          submitted = true;
          log.log('Stored Windows credential submitted to the trusted institution sign-in page.');
        } catch {
          throw authenticationAttentionError('Automatic sign-in could not use the saved Windows credential. Open Settings or use Refresh Login.');
        } finally {
          if (credential) {
            credential.username = '';
            credential.password = '';
            credential = null;
          }
        }
      }
    }

    await page.waitForTimeout(pollMs);
  }
  throw authenticationAttentionError('Timed out waiting for Brightspace authentication. Use Refresh Login.');
}
