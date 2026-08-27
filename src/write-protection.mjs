function normalizeBody(body = '') {
  try { return decodeURIComponent(String(body).replace(/\+/g, ' ')); }
  catch { return String(body); }
}

const ACTION_WORDS = /(?:^|[\/_?&=.:-])(submit|upload|save|delete|remove|create|update|publish|reply|postmessage|attempt|enroll|unenroll|withdraw|rate|grade)(?:$|[\/_?&=.:-])/i;
const BODY_ACTIONS = /(?:^|[&"'\s])(?:action|cmd|command|operation|event|submit|save|delete|remove|create|update|publish|reply|upload|attempt)\s*[=:]\s*["']?(?:submit|save|delete|remove|create|update|publish|reply|upload|attempt)/i;

export function classifyWriteRequest(request, baseUrl) {
  const method = String(request.method?.() || '').toUpperCase();
  if (!method || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return { block: false, reason: 'read-method' };

  if (['PUT', 'PATCH', 'DELETE'].includes(method)) {
    return { block: true, reason: `${method} requests are blocked` };
  }

  if (method !== 'POST') return { block: true, reason: `${method} is not an allowed crawler method` };

  let url;
  let baseOrigin;
  try {
    url = new URL(request.url());
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    return { block: true, reason: 'unparseable POST target' };
  }

  // SSO/token-refresh flows can involve another origin. This guard is installed
  // only after the user is authenticated, so cross-origin POSTs are left alone
  // to avoid breaking legitimate session refreshes controlled by the school.
  if (url.origin !== baseOrigin) return { block: false, reason: 'cross-origin POST' };

  const resourceType = String(request.resourceType?.() || '').toLowerCase();
  if (resourceType === 'document') {
    return { block: true, reason: 'same-origin POST form/navigation blocked after authentication' };
  }

  const target = `${url.pathname}${url.search}`;
  if (ACTION_WORDS.test(target)) {
    return { block: true, reason: 'POST target looks state-changing' };
  }

  const body = normalizeBody(request.postData?.() || '').slice(0, 200000);
  if (BODY_ACTIONS.test(body)) {
    return { block: true, reason: 'POST body looks state-changing' };
  }

  // Brightspace uses POST for some read-only RPC/XHR calls (for example course
  // selector payloads). Those remain allowed unless they match the guards above.
  return { block: false, reason: 'read-like Brightspace POST/RPC' };
}

export async function installWriteProtection(context, baseUrl, { log = console } = {}) {
  await context.route('**/*', async route => {
    const verdict = classifyWriteRequest(route.request(), baseUrl);
    if (verdict.block) {
      const request = route.request();
      log.warn?.(`Blocked potential Brightspace write: ${request.method()} ${request.url()} (${verdict.reason})`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}
