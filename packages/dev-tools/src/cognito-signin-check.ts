/**
 * Walks the hosted (managed login) sign-in flow against Floci exactly as a browser would, and
 * checks that it ends with a redirect to the callback carrying an authorization code (build
 * guide 1.9 "Done when"). It then redeems the code once, as the server will in Step 1.10, and
 * checks the ID token's issuer, audience, token_use and nonce.
 *   pnpm --filter @chatlium/dev-tools cognito:check
 *
 * Prints no secrets, passwords or tokens.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

const env = z
  .object({
    AWS_ENDPOINT_URL: z.url(),
    APP_BASE_URL: z.url(),
    COGNITO_CLIENT_ID: z.string().min(1),
    COGNITO_CLIENT_SECRET: z.string().min(1),
    COGNITO_ISSUER: z.url(),
    DEV_USER_A_EMAIL: z.string().min(1),
    DEV_USER_A_PASSWORD: z.string().min(1),
  })
  .parse(process.env, { reportInput: false });

const out = (line: string): void => void process.stdout.write(`${line}\n`);
const base64url = (bytes: Buffer): string => bytes.toString('base64url');

const callback = new URL('/api/auth/callback', env.APP_BASE_URL).toString();
const verifier = base64url(randomBytes(48));
const challenge = base64url(createHash('sha256').update(verifier).digest());
const state = base64url(randomBytes(16));
const nonce = base64url(randomBytes(16));

const cookies = new Map<string, string>();
function remember(response: Response): void {
  for (const header of response.headers.getSetCookie()) {
    const [pair = ''] = header.split(';');
    const index = pair.indexOf('=');
    if (index > 0) {
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}
const cookieHeader = (): string => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

async function request(
  url: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: { ...init.headers, cookie: cookieHeader() },
  });
  remember(response);
  return response;
}

// 1. The browser is sent to the authorize endpoint (the app's /api/auth/login does this in 1.10).
const authorize = new URL('/cognito-idp/oauth2/authorize', env.AWS_ENDPOINT_URL);
authorize.search = new URLSearchParams({
  response_type: 'code',
  client_id: env.COGNITO_CLIENT_ID,
  redirect_uri: callback,
  scope: 'openid email profile',
  state,
  nonce,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();
const toLogin = await request(authorize);
const loginLocation = toLogin.headers.get('location');
if (toLogin.status < 300 || toLogin.status >= 400 || loginLocation === null) {
  throw new Error(`authorize did not redirect to the sign-in form (HTTP ${toLogin.status})`);
}
const loginUrl = new URL(loginLocation, authorize);
out(`1. authorize        -> HTTP ${toLogin.status} redirect to ${loginUrl.pathname}`);

// 2. The hosted sign-in form, with its CSRF token.
const form = await request(loginUrl);
const html = await form.text();
const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
if (csrf === undefined) {
  throw new Error(`sign-in form has no CSRF token (HTTP ${form.status})`);
}
out(`2. sign-in form     -> HTTP ${form.status}, CSRF token present`);

// 3. The user submits their email and password.
const submitted = await request(loginUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    _csrf: csrf,
    username: env.DEV_USER_A_EMAIL,
    password: env.DEV_USER_A_PASSWORD,
  }).toString(),
});
const redirect = submitted.headers.get('location');
if (redirect === null) {
  throw new Error(`sign-in did not redirect (HTTP ${submitted.status}); wrong password?`);
}
const landed = new URL(redirect, loginUrl);
const code = landed.searchParams.get('code');
const returnedState = landed.searchParams.get('state');
const reachedCallback = `${landed.origin}${landed.pathname}` === callback;
out(
  `3. submit password  -> HTTP ${submitted.status} redirect to ${landed.origin}${landed.pathname}` +
    `?code=<${code?.length ?? 0} chars>&state=${returnedState === state ? '<matches>' : '<MISMATCH>'}`,
);
if (!reachedCallback || code === null || returnedState !== state) {
  throw new Error('FAILED: the redirect did not reach the callback with a code and the same state');
}

// 4. Beyond the guide: redeem the code once, as the server will (Step 1.10).
const token = await fetch(new URL('/cognito-idp/oauth2/token', env.AWS_ENDPOINT_URL), {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Basic ${Buffer.from(`${env.COGNITO_CLIENT_ID}:${env.COGNITO_CLIENT_SECRET}`).toString('base64')}`,
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callback,
    code_verifier: verifier,
  }).toString(),
});
const tokens = z
  .object({ id_token: z.string(), access_token: z.string(), refresh_token: z.string() })
  .parse(await token.json());
const payload: unknown = JSON.parse(
  Buffer.from(tokens.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
);
const claims = z
  .object({
    iss: z.string(),
    aud: z.string(),
    token_use: z.string(),
    nonce: z.string(),
    exp: z.number(),
  })
  .parse(payload);
const checks = {
  iss: claims.iss === env.COGNITO_ISSUER,
  aud: claims.aud === env.COGNITO_CLIENT_ID,
  token_use: claims.token_use === 'id',
  nonce: claims.nonce === nonce,
  exp: claims.exp * 1000 > Date.now(),
};
out(
  `4. redeem code      -> HTTP ${token.status}; ID token ${Object.entries(checks)
    .map(([claim, ok]) => `${claim} ${ok ? 'ok' : 'WRONG'}`)
    .join(', ')}`,
);
if (Object.values(checks).includes(false)) {
  throw new Error('FAILED: ID token claims do not match');
}
out('OK: hosted sign-in redirects to the callback with an authorization code.');
