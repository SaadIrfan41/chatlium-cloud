/**
 * Step 1.12's manual check, against a running dev server, Floci and the seeded local database:
 *   pnpm --filter @chatlium/dev-tools db:seed-dev
 *   pnpm --filter @chatlium/web dev            (in another terminal)
 *   pnpm --filter @chatlium/dev-tools web:workspace-check
 *
 * Signs in as each test user and checks that they see only their own workspace, can read its
 * documents, and get the same 403 for another tenant's workspace as for one that does not exist.
 */
import { z } from 'zod';
import { out, request, signIn, type Jar } from './web-client.ts';

const env = z
  .object({
    APP_BASE_URL: z.url(),
    DEV_USER_A_EMAIL: z.string().min(1),
    DEV_USER_A_PASSWORD: z.string().min(1),
    DEV_USER_B_EMAIL: z.string().min(1),
    DEV_USER_B_PASSWORD: z.string().min(1),
  })
  .parse(process.env, { reportInput: false });

const app = (path: string): URL => new URL(path, env.APP_BASE_URL);
const workspacesBody = z.object({
  workspaces: z.array(z.object({ id: z.uuid(), name: z.string(), role: z.string() })),
});
const documentsBody = z.object({ documents: z.array(z.object({ title: z.string() })) });
const NO_SUCH_WORKSPACE = '0195d6a4-ffff-7fff-bfff-ffffffffffff';

interface SignedIn {
  readonly email: string;
  readonly jar: Jar;
  readonly ownId: string | undefined;
}

const results: boolean[] = [];
function check(label: string, ok: boolean): void {
  results.push(ok);
  out(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

async function listOwn(email: string, password: string): Promise<SignedIn> {
  const jar = await signIn(env.APP_BASE_URL, email, password);
  const response = await request(jar, app('/api/workspaces'));
  const { workspaces } = workspacesBody.parse(await response.json());
  out(`${email} sees: ${workspaces.map((w) => `${w.name} (${w.role})`).join(', ') || 'nothing'}`);
  check(
    `${email}: GET /api/workspaces -> 200 with exactly one workspace`,
    response.status === 200 && workspaces.length === 1,
  );
  return { email, jar, ownId: workspaces[0]?.id };
}

const a = await listOwn(env.DEV_USER_A_EMAIL, env.DEV_USER_A_PASSWORD);
const b = await listOwn(env.DEV_USER_B_EMAIL, env.DEV_USER_B_PASSWORD);
check('the two users see different workspaces', a.ownId !== undefined && a.ownId !== b.ownId);

async function body(response: Response): Promise<string> {
  return `${String(response.status)} ${await response.text()}`;
}

/** `self` can read its own workspace, and gets one identical 403 for `other`'s and a missing one. */
async function crossCheck(self: SignedIn, other: SignedIn): Promise<void> {
  const own = await request(self.jar, app(`/api/workspaces/${self.ownId ?? ''}/documents`));
  const { documents } = documentsBody.parse(await own.json());
  check(
    `${self.email}: own workspace documents -> ${String(own.status)} (${documents.map((d) => d.title).join(', ')})`,
    own.status === 200 && documents.length > 0,
  );
  const [foreign, missing] = await Promise.all([
    request(self.jar, app(`/api/workspaces/${other.ownId ?? ''}/documents`)).then(body),
    request(self.jar, app(`/api/workspaces/${NO_SUCH_WORKSPACE}/documents`)).then(body),
  ]);
  check(`${self.email}: other tenant's workspace -> ${foreign}`, foreign.startsWith('403 '));
  check(`${self.email}: non-existent workspace   -> ${missing} (identical)`, missing === foreign);
}

await crossCheck(a, b);
await crossCheck(b, a);

const anonymous = await fetch(app('/api/workspaces'));
check(`no session: GET /api/workspaces -> ${String(anonymous.status)}`, anonymous.status === 401);

const passed = results.every(Boolean);
out(passed ? 'OK: each user sees only their own workspace.' : 'FAILED');
process.exitCode = passed ? 0 : 1;
