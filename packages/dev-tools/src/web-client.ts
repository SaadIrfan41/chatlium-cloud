/**
 * A minimal browser stand-in for the dev checks: a cookie jar, manual redirects, and the full
 * sign-in walk through the app and Floci's managed login. Never prints cookie values.
 */
export const out = (line: string): void => void process.stdout.write(`${line}\n`);

export class Jar {
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
  put(name: string, value: string): void {
    this.cookies.set(name, value);
  }
}

export async function request(
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

export function location(response: Response, base: URL): URL {
  const value = response.headers.get('location');
  if (value === null) {
    throw new Error(`expected a redirect from ${base.pathname}, got HTTP ${response.status}`);
  }
  return new URL(value, base);
}

export const FORM = { 'content-type': 'application/x-www-form-urlencoded' } as const;

/** Signs in through the app exactly as a browser would. Returns the app's cookie jar. */
export async function signIn(appBaseUrl: string, email: string, password: string): Promise<Jar> {
  const app = (path: string): URL => new URL(path, appBaseUrl);
  const appJar = new Jar();
  const idpJar = new Jar();
  const login = await request(appJar, app('/api/auth/login'));
  const authorize = location(login, app('/api/auth/login'));
  const signInForm = location(await request(idpJar, authorize), authorize);
  const formHtml = await (await request(idpJar, signInForm)).text();
  const idpCsrf = /name="_csrf" value="([^"]+)"/.exec(formHtml)?.[1] ?? '';
  const submitted = await request(idpJar, signInForm, {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({ _csrf: idpCsrf, username: email, password }).toString(),
  });
  const callback = await request(appJar, location(submitted, signInForm));
  if (callback.status !== 303 || appJar.get('session') === undefined) {
    throw new Error(`sign-in as ${email} failed: callback HTTP ${callback.status}`);
  }
  return appJar;
}
