import { classifyWriteRequest } from './write-protection.mjs';

const BASE = 'https://brightspace.example.edu';

function request({ method = 'GET', url = `${BASE}/d2l/home`, resourceType = 'xhr', postData = '' } = {}) {
  return {
    method: () => method,
    url: () => url,
    resourceType: () => resourceType,
    postData: () => postData
  };
}

function expect(label, input, expectedBlock) {
  const result = classifyWriteRequest(request(input), BASE);
  if (result.block !== expectedBlock) {
    throw new Error(`${label}: expected block=${expectedBlock}, got block=${result.block} (${result.reason})`);
  }
}

expect('GET is allowed', { method: 'GET' }, false);
expect('PUT is blocked', { method: 'PUT' }, true);
expect('PATCH is blocked', { method: 'PATCH' }, true);
expect('DELETE is blocked', { method: 'DELETE' }, true);
expect('same-origin POST document is blocked', { method: 'POST', resourceType: 'document' }, true);
expect('read-like course selector RPC is allowed', {
  method: 'POST',
  url: `${BASE}/d2l/lp/courseSelector/6606/LoadMore`,
  resourceType: 'xhr',
  postData: 'pageNum=2'
}, false);
expect('submit-looking POST endpoint is blocked', {
  method: 'POST',
  url: `${BASE}/d2l/lms/dropbox/user/submit.d2l`,
  resourceType: 'xhr'
}, true);
expect('state-changing POST body is blocked', {
  method: 'POST',
  url: `${BASE}/d2l/rpc`,
  resourceType: 'xhr',
  postData: 'action=submit'
}, true);
expect('cross-origin SSO POST is not interfered with', {
  method: 'POST',
  url: 'https://sso.example.edu/token',
  resourceType: 'xhr',
  postData: 'grant_type=refresh_token'
}, false);

console.log('Write-protection self-test: PASS');
