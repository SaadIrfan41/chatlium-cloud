/**
 * Checks the web app's sign-in and sign-out against a running dev server and Floci (Step 1.10):
 * cookie attributes, session size, the signed-in page, and sign-out's Origin and CSRF checks.
 *   pnpm --filter @chatlium/web dev            (in another terminal)
 *   pnpm --filter @chatlium/dev-tools web:auth-check
 *
 * Prints cookie names and attributes only, never values.
 */
import { z } from 'zod';

const env = z
  .object({
    APP_BASE_URL: z.url(),
    DEV_USER_A_EMAIL: z.string().min(1),
    DEV_USER_A_PASSWORD: z.string().min(1),
  })
  .parse(process.env, { reportInput: false });

const out = (line: string): void => void process.stdout.write(`${line}\n`);
const app = (path: string): URL => new URL(path, env.APP_BASE_URL);

class Jar {
  private readonly cookies = new Map<string, string>();
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  absorb(response: Response, label?: string): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = raw.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (label !== undefined) {
        out(
          `${label.padEnd(9)} Set-Cookie ${name}=<${value.length} chars>;${attributes.join(';')}`,
        );
      }
      if (value === '' || /expires=thu, 01 jan 1970/i.test(raw)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }
  get(name: string): string | undefined {
    return [...this.cookies].find(([k]) => k.includes(name))?.[1];
  }
}

async function request(
  jar: Jar,
  url: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  label?: string,
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: { ...init.headers, cookie: jar.header() },
  });
  jar.absorb(response, label);
  return response;
}

function location(response: Response, base: URL): URL {
  const value = response.headers.get('location');
  if (value === null) {
    throw new Error(`expected a redirect from ${base.pathname}, got HTTP ${response.status}`);
  }
  return new URL(value, base);
}

const appJar = new Jar();
const idpJar = new Jar();
const form = { 'content-type': 'application/x-www-form-urlencoded' };

// Sign in through the app, exactly as a browser would.
const login = await request(appJar, app('/api/auth/login'), {}, 'login');
const authorize = location(login, app('/api/auth/login'));
const signInForm = location(await request(idpJar, authorize), authorize);
const formHtml = await (await request(idpJar, signInForm)).text();
const idpCsrf = /name="_csrf" value="([^"]+)"/.exec(formHtml)?.[1] ?? '';
const submitted = await request(idpJar, signInForm, {
  method: 'POST',
  headers: form,
  body: new URLSearchParams({
    _csrf: idpCsrf,
    username: env.DEV_USER_A_EMAIL,
    password: env.DEV_USER_A_PASSWORD,
  }).toString(),
});
const callback = await request(appJar, location(submitted, signInForm), {}, 'callback');
out(`callback  -> HTTP ${callback.status} ${location(callback, app('/')).pathname}`);
out(`session cookie size: ${appJar.get('session')?.length ?? 0} bytes (browser limit 4096)`);

const dashboard = await request(appJar, app('/dashboard'));
const html = await dashboard.text();
out(`dashboard -> HTTP ${dashboard.status}, signed in: ${String(html.includes('signed in'))}`);
const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

const origin = { ...form, origin: new URL(env.APP_BASE_URL).origin };
const noOrigin = await request(appJar, app('/api/auth/logout'), {
  method: 'POST',
  headers: form,
  body: new URLSearchParams({ csrf }).toString(),
});
out(`sign-out without Origin        -> HTTP ${noOrigin.status} (expected 403)`);
const wrongCsrf = await request(appJar, app('/api/auth/logout'), {
  method: 'POST',
  headers: origin,
  body: new URLSearchParams({ csrf: 'wrong-token-wrong-token' }).toString(),
});
out(`sign-out with wrong CSRF token -> HTTP ${wrongCsrf.status} (expected 403)`);
const signOut = await request(
  appJar,
  app('/api/auth/logout'),
  { method: 'POST', headers: origin, body: new URLSearchParams({ csrf }).toString() },
  'sign-out',
);
out(
  `sign-out                       -> HTTP ${signOut.status} ${location(signOut, app('/')).pathname}`,
);
const after = await request(appJar, app('/dashboard'));
out(
  `dashboard after sign-out       -> HTTP ${after.status} ${after.headers.get('location') ?? ''}`,
);

const passed =
  callback.status === 303 &&
  dashboard.status === 200 &&
  noOrigin.status === 403 &&
  wrongCsrf.status === 403 &&
  signOut.status === 303 &&
  after.status === 307 &&
  appJar.get('session') === undefined;
out(passed ? 'OK: sign-in and sign-out behave as specified.' : 'FAILED');
process.exitCode = passed ? 0 : 1;
