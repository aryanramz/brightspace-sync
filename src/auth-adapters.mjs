export const STONY_BROOK_ADAPTER_ID = 'stony-brook';
export const STONY_BROOK_CREDENTIAL_TARGET = 'Brightspace Sync:institution:stony-brook';

const AUTHENTICATED_SELECTOR = '[data-prl*="/courseSelector/"], [data-cprl*="/courseSelector/"], a[href*="/d2l/home/"]';
const STONY_BROOK_USERNAME_SELECTOR = '#username';
const STONY_BROOK_PASSWORD_SELECTOR = '#password';
const STONY_BROOK_SUBMIT_SELECTOR = 'button[name="_eventId_proceed"], input[name="_eventId_proceed"], #login-button';

function safeUrl(value) {
  try { return new URL(value); } catch { return null; }
}

function exactHttpsHost(value, hostname) {
  const url = safeUrl(value);
  return Boolean(
    url
    && url.protocol === 'https:'
    && !url.username
    && !url.password
    && url.hostname.toLowerCase() === hostname
  );
}

function isDuoHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'duosecurity.com' || host.endsWith('.duosecurity.com');
}

async function count(page, selector) {
  try { return await page.locator(selector).count(); } catch { return 0; }
}

export const stonyBrookAdapter = Object.freeze({
  id: STONY_BROOK_ADAPTER_ID,
  displayName: 'Stony Brook University',
  brightspaceHost: 'mycourses.stonybrook.edu',
  trustedSsoOrigin: 'https://sso.cc.stonybrook.edu',
  credentialTarget: STONY_BROOK_CREDENTIAL_TARGET,

  supportsBaseUrl(baseUrl) {
    return exactHttpsHost(baseUrl, this.brightspaceHost);
  },

  isTrustedSsoUrl(value) {
    const url = safeUrl(value);
    return Boolean(
      url
      && url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.origin.toLowerCase() === this.trustedSsoOrigin
    );
  },

  isMfaUrl(value) {
    const url = safeUrl(value);
    return Boolean(url && url.protocol === 'https:' && !url.username && !url.password && isDuoHost(url.hostname));
  },

  async inspectPage(page) {
    const current = safeUrl(page.url());
    if (!current || current.protocol !== 'https:') return { state: 'unexpected' };

    if (current.hostname.toLowerCase() === this.brightspaceHost) {
      return (await count(page, AUTHENTICATED_SELECTOR)) > 0
        ? { state: 'authenticated' }
        : { state: 'brightspace-wait' };
    }

    if (this.isMfaUrl(current.href)) return { state: 'mfa' };
    if (!this.isTrustedSsoUrl(current.href)) return { state: 'unexpected' };

    const frames = typeof page.frames === 'function' ? page.frames() : [];
    if (frames.some(frame => this.isMfaUrl(frame.url()))) return { state: 'mfa' };
    const [usernameCount, passwordCount, submitCount] = await Promise.all([
      count(page, STONY_BROOK_USERNAME_SELECTOR),
      count(page, STONY_BROOK_PASSWORD_SELECTOR),
      count(page, STONY_BROOK_SUBMIT_SELECTOR)
    ]);
    return usernameCount === 1 && passwordCount === 1 && submitCount >= 1
      ? { state: 'login-form' }
      : { state: 'sso-wait' };
  },

  async fillAndSubmit(page, credential) {
    const assertTrustedOrigin = () => {
      if (!this.isTrustedSsoUrl(page.url())) throw new Error('Automatic sign-in stopped because the authentication origin is not trusted.');
    };
    assertTrustedOrigin();
    await page.locator(STONY_BROOK_USERNAME_SELECTOR).fill(credential.username);
    assertTrustedOrigin();
    await page.locator(STONY_BROOK_PASSWORD_SELECTOR).fill(credential.password);
    assertTrustedOrigin();
    await page.locator(STONY_BROOK_SUBMIT_SELECTOR).first().click();
  }
});

export function institutionAdapterForBaseUrl(baseUrl) {
  return stonyBrookAdapter.supportsBaseUrl(baseUrl) ? stonyBrookAdapter : null;
}

export const AUTHENTICATED_BRIGHTSPACE_SELECTOR = AUTHENTICATED_SELECTOR;
