/**
 * Step 2.2's manual check, against a running dev server, Floci and the seeded local database:
 *   pnpm --filter @chatlium/dev-tools s3:setup
 *   pnpm --filter @chatlium/web dev            (in another terminal)
 *   pnpm --filter @chatlium/dev-tools web:upload-check
 *
 * Signs in as test user A and uploads a document the way the dashboard will: create it, PUT the
 * bytes straight to S3 through the presigned URL (after the browser's CORS preflight), confirm
 * it, and check that the document is listed as `uploaded`. Also checks what must be refused.
 */
import { z } from 'zod';
import { out, request, signIn } from './web-client.ts';

const env = z
  .object({
    APP_BASE_URL: z.url(),
    DEV_USER_A_EMAIL: z.string().min(1),
    DEV_USER_A_PASSWORD: z.string().min(1),
  })
  .parse(process.env, { reportInput: false });

const app = (path: string): URL => new URL(path, env.APP_BASE_URL);
const appOrigin = new URL(env.APP_BASE_URL).origin;

const results: boolean[] = [];
function check(label: string, ok: boolean): void {
  results.push(ok);
  out(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

const jar = await signIn(env.APP_BASE_URL, env.DEV_USER_A_EMAIL, env.DEV_USER_A_PASSWORD);

// The dashboard renders the session's CSRF token (in the sign-out form); a page script sends it.
const dashboard = await (await request(jar, app('/dashboard'))).text();
const csrf = /name="csrf" value="([^"]+)"/.exec(dashboard)?.[1] ?? '';
check('dashboard carries a CSRF token', csrf.length > 0);

const workspaces = z
  .object({ workspaces: z.array(z.object({ id: z.uuid(), name: z.string() })) })
  .parse(await (await request(jar, app('/api/workspaces'))).json()).workspaces;
const workspace = workspaces[0];
if (workspace === undefined) {
  throw new Error('test user A has no workspace; run db:seed-dev first');
}
const documentsPath = `/api/workspaces/${workspace.id}/documents`;

const write = { origin: appOrigin, 'x-csrf-token': csrf, 'content-type': 'application/json' };
const content = new TextEncoder().encode(
  `# Shipping\n\nOrders ship within two working days. (upload check ${new Date().toISOString()})\n`,
);

const created = await request(jar, app(documentsPath), {
  method: 'POST',
  headers: write,
  body: JSON.stringify({
    title: 'Shipping policy',
    contentType: 'text/markdown',
    sizeBytes: content.byteLength,
  }),
});
const { document, upload } = z
  .object({
    document: z.object({ id: z.uuid(), status: z.string() }),
    upload: z.object({ url: z.url(), headers: z.record(z.string(), z.string()) }),
  })
  .parse(await created.json());
check(
  `POST ${documentsPath} -> ${String(created.status)}, status ${document.status}`,
  created.status === 201 && document.status === 'pending',
);
const uploadUrl = new URL(upload.url);
out(`presigned PUT goes to ${uploadUrl.origin}${uploadUrl.pathname} (query not shown)`);

const preflight = await fetch(upload.url, {
  method: 'OPTIONS',
  headers: {
    origin: appOrigin,
    'access-control-request-method': 'PUT',
    'access-control-request-headers': 'content-type',
  },
});
check(
  `CORS preflight from ${appOrigin} -> ${String(preflight.status)}, allows ${preflight.headers.get('access-control-allow-origin') ?? 'nobody'}`,
  preflight.ok && preflight.headers.get('access-control-allow-origin') === appOrigin,
);
const foreignPreflight = await fetch(upload.url, {
  method: 'OPTIONS',
  headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' },
});
check(
  `CORS preflight from another origin -> not allowed (${String(foreignPreflight.status)})`,
  foreignPreflight.headers.get('access-control-allow-origin') !== 'https://evil.example',
);

const early = await request(jar, app(`${documentsPath}/${document.id}/confirm`), {
  method: 'POST',
  headers: write,
});
check(
  `confirm before the upload -> ${String(early.status)} ${await early.text()}`,
  early.status === 409,
);

const tampered = await fetch(upload.url, {
  method: 'PUT',
  headers: { ...upload.headers, 'content-type': 'text/html' },
  body: content,
});
check(`PUT with a different content type -> ${String(tampered.status)}`, tampered.status === 403);

const put = await fetch(upload.url, {
  method: 'PUT',
  headers: { ...upload.headers, origin: appOrigin },
  body: content,
});
check(`PUT ${String(content.byteLength)} bytes to S3 -> ${String(put.status)}`, put.status === 200);

const noToken = await request(jar, app(`${documentsPath}/${document.id}/confirm`), {
  method: 'POST',
  headers: { ...write, 'x-csrf-token': 'wrong-token' },
});
check(`confirm with a wrong CSRF token -> ${String(noToken.status)}`, noToken.status === 403);

const confirmed = await request(jar, app(`${documentsPath}/${document.id}/confirm`), {
  method: 'POST',
  headers: write,
});
check(`confirm -> ${String(confirmed.status)} ${await confirmed.text()}`, confirmed.status === 202);

const listed = z
  .object({ documents: z.array(z.object({ id: z.uuid(), status: z.string() })) })
  .parse(await (await request(jar, app(documentsPath))).json())
  .documents.find((d) => d.id === document.id);
check(`listed as ${listed?.status ?? 'missing'}`, listed?.status === 'uploaded');

const passed = results.every(Boolean);
out(passed ? 'OK: document uploaded through the presigned URL and marked uploaded.' : 'FAILED');
process.exitCode = passed ? 0 : 1;
