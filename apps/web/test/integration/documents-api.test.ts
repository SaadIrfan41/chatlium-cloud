import { createSessionStore, createWorkspaceGuard, CSRF_HEADER } from '@chatlium/auth';
import { MAX_DOCUMENT_BYTES, type IndexingJob } from '@chatlium/contracts';
import { createSealer } from '@chatlium/crypto';
import { createDatabase, findMembershipRole, type Database } from '@chatlium/db';
import {
  seedMembership,
  seedUser,
  seedWorkspace,
  startMigratedDatabase,
  type MigratedDatabase,
} from '@chatlium/db/testing';
import { createS3Storage } from '@chatlium/storage';
import { FLOCI_REGION, startFloci, type StartedFloci } from '@chatlium/storage/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDocumentApi, type DocumentApi } from '../../src/server/api/documents.ts';

// Build guide 2.2 against a migrated Postgres (as chatlium_app, RLS enforced) and a Floci that
// verifies S3 signatures like AWS.

const APP_ORIGIN = 'http://localhost:3000';
const CSRF = 'csrf-token-0123456789abcdef';
const BUCKET = 'chatlium-documents-it';

const sessions = createSessionStore({
  sealer: createSealer('integration-test-sealing-secret-0123456789', 'session'),
  cookieName: 'chatlium_session',
  ttlSeconds: 3600,
});

let fixture: MigratedDatabase;
let floci: StartedFloci;
let app: Database;
let api: DocumentApi;
let workspaceA: string;
let workspaceB: string;
let operatorA: string;
let outsider: string;
const published: IndexingJob[] = [];

beforeAll(async () => {
  [fixture, floci] = await Promise.all([startMigratedDatabase(), startFloci()]);
  await floci.createBucket(BUCKET);
  app = createDatabase(fixture.appUrl);
  api = createDocumentApi({
    guard: createWorkspaceGuard({
      sessions,
      lookupRole: (userId, workspaceId) => findMembershipRole(app.db, userId, workspaceId),
    }),
    db: app.db,
    storage: createS3Storage({ bucket: BUCKET, region: FLOCI_REGION, endpoint: floci.endpoint }),
    indexingQueue: {
      publish: (job) => {
        published.push(job);
        return Promise.resolve({ messageId: `m-${String(published.length)}`, duplicate: false });
      },
    },
    appOrigin: APP_ORIGIN,
  });

  workspaceA = await seedWorkspace(fixture.admin, 'Acme Support');
  workspaceB = await seedWorkspace(fixture.admin, 'Beta Help Desk');
  operatorA = await seedUser(fixture.admin, 'sub-operator-a', 'operator.a@chatlium.test');
  outsider = await seedUser(fixture.admin, 'sub-outsider', 'outsider@chatlium.test');
  await seedMembership(fixture.admin, workspaceA, operatorA, 'operator');
});

afterAll(async () => {
  await app.close();
  await Promise.all([fixture.stop(), floci.stop()]);
});

beforeEach(() => {
  published.length = 0;
});

async function sessionCookie(userId: string): Promise<string> {
  const sealed = await sessions.seal({
    userId,
    cognitoSub: `sub-for-${userId}`,
    email: 'someone@chatlium.test',
    csrf: CSRF,
    idTokenExpiresAt: Math.floor(Date.now() / 1000) + 600,
  });
  return `chatlium_session=${sealed}`;
}

interface PostOptions {
  readonly as?: string;
  readonly body?: string;
  readonly headers?: Record<string, string>;
}

/** A POST as a signed-in dashboard would send it: same origin, CSRF header, JSON. */
async function post(options: PostOptions = {}): Promise<Request> {
  const headers: Record<string, string> = {
    origin: APP_ORIGIN,
    [CSRF_HEADER]: CSRF,
    'content-type': 'application/json',
    ...options.headers,
  };
  if (options.as !== undefined) {
    headers['cookie'] = await sessionCookie(options.as);
  }
  return new Request(`${APP_ORIGIN}/api/x`, {
    method: 'POST',
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

const createdBody = z.object({
  document: z.object({
    id: z.uuid(),
    title: z.string(),
    status: z.literal('pending'),
    contentType: z.string(),
    sizeBytes: z.number(),
  }),
  upload: z.object({
    url: z.url(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});

const content = new TextEncoder().encode('# Refunds\n\nRefunds are issued within 14 days.\n');

async function createDocument(overrides: Record<string, unknown> = {}) {
  const response = await api.createDocument(
    await post({
      as: operatorA,
      body: JSON.stringify({
        title: 'Refund policy',
        contentType: 'text/markdown',
        sizeBytes: content.byteLength,
        ...overrides,
      }),
    }),
    workspaceA,
  );
  expect(response.status).toBe(201);
  return createdBody.parse(await response.json());
}

async function statusOf(documentId: string): Promise<string | undefined> {
  const result = await fixture.admin.query<{ status: string }>(
    'SELECT status FROM documents WHERE id = $1',
    [documentId],
  );
  return result.rows[0]?.status;
}

async function observe(response: Response) {
  return { status: response.status, body: await response.text() };
}

describe('document upload (Done when: upload through the presigned URL, marked uploaded)', () => {
  it('creates a pending document, uploads through the presigned URL, confirms it as uploaded', async () => {
    const created = await createDocument();
    expect(created.document).toMatchObject({
      title: 'Refund policy',
      status: 'pending',
      contentType: 'text/markdown',
      sizeBytes: content.byteLength,
    });
    expect(created.upload.url).toContain(
      `workspaces/${workspaceA}/documents/${created.document.id}`,
    );
    expect(await statusOf(created.document.id)).toBe('pending');

    const put = await fetch(created.upload.url, {
      method: 'PUT',
      headers: created.upload.headers,
      body: content,
    });
    expect(put.status).toBe(200);

    const confirmed = await api.confirmUpload(
      await post({ as: operatorA }),
      workspaceA,
      created.document.id,
    );
    expect(confirmed.status).toBe(202);
    expect(await confirmed.json()).toMatchObject({
      document: { id: created.document.id, status: 'uploaded' },
    });
    expect(await statusOf(created.document.id)).toBe('uploaded');
    expect(published).toEqual([
      {
        jobId: `index:${created.document.id}`,
        workspaceId: workspaceA,
        documentId: created.document.id,
      },
    ]);
  });

  it('a second confirm re-sends the same indexing job, not a new one', async () => {
    const created = await createDocument();
    await fetch(created.upload.url, {
      method: 'PUT',
      headers: created.upload.headers,
      body: content,
    });

    await api.confirmUpload(await post({ as: operatorA }), workspaceA, created.document.id);
    const again = await api.confirmUpload(
      await post({ as: operatorA }),
      workspaceA,
      created.document.id,
    );

    expect(again.status).toBe(202);
    expect(published.map((job) => job.jobId)).toEqual([
      `index:${created.document.id}`,
      `index:${created.document.id}`,
    ]);
  });

  it('confirm before the upload is refused and the document stays pending', async () => {
    const created = await createDocument();

    const response = await api.confirmUpload(
      await post({ as: operatorA }),
      workspaceA,
      created.document.id,
    );

    expect(await observe(response)).toEqual({ status: 409, body: '{"error":"upload_missing"}' });
    expect(await statusOf(created.document.id)).toBe('pending');
    expect(published).toEqual([]);
  });

  it('S3 refuses an upload whose size differs from the declared size', async () => {
    const created = await createDocument({ sizeBytes: content.byteLength - 1 });

    const put = await fetch(created.upload.url, {
      method: 'PUT',
      headers: created.upload.headers,
      body: content,
    });
    const confirmed = await api.confirmUpload(
      await post({ as: operatorA }),
      workspaceA,
      created.document.id,
    );

    expect(put.status).toBeGreaterThanOrEqual(400);
    expect(confirmed.status).toBe(409);
    expect(await statusOf(created.document.id)).toBe('pending');
  });

  // S3 already refuses these through the presigned URL; confirm checks again in case an object
  // reached the key some other way.
  it.each([
    ['another content type', content, 'text/html'],
    ['another size', new TextEncoder().encode('shorter'), 'text/markdown'],
  ])('confirm refuses an object with %s and keeps the document pending', async (_c, body, type) => {
    const created = await createDocument();
    await floci.putObject(
      BUCKET,
      `workspaces/${workspaceA}/documents/${created.document.id}`,
      body,
      type,
    );

    const response = await api.confirmUpload(
      await post({ as: operatorA }),
      workspaceA,
      created.document.id,
    );

    expect(await observe(response)).toEqual({ status: 422, body: '{"error":"upload_mismatch"}' });
    expect(await statusOf(created.document.id)).toBe('pending');
    expect(published).toEqual([]);
  });

  it('confirming an already indexed (ready) document changes nothing and enqueues nothing', async () => {
    const created = await createDocument();
    await fixture.admin.query("UPDATE documents SET status = 'ready' WHERE id = $1", [
      created.document.id,
    ]);

    const response = await api.confirmUpload(
      await post({ as: operatorA }),
      workspaceA,
      created.document.id,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ document: { status: 'ready' } });
    expect(published).toEqual([]);
  });
});

describe('document upload: request validation', () => {
  it.each([
    ['a type that is not allowed', { contentType: 'text/html' }, 'contentType must be one of'],
    ['a size over the limit', { sizeBytes: MAX_DOCUMENT_BYTES + 1 }, 'sizeBytes must be at most'],
    ['an empty title', { title: ' ' }, 'title is required'],
    ['a field the client may not set', { s3Key: 'workspaces/other/x' }, 'Unrecognized key'],
  ])('refuses %s with 422', async (_case, override, problem) => {
    const response = await api.createDocument(
      await post({
        as: operatorA,
        body: JSON.stringify({
          title: 'Doc',
          contentType: 'text/plain',
          sizeBytes: 10,
          ...override,
        }),
      }),
      workspaceA,
    );

    expect(response.status).toBe(422);
    const body = z
      .object({ error: z.literal('invalid_request'), problems: z.array(z.string()) })
      .parse(await response.json());
    expect(body.problems.join(' ')).toContain(problem);
  });

  const tooLarge = { status: 413, body: '{"error":"payload_too_large"}' };
  const oversized = JSON.stringify({ title: 'x'.repeat(5000) });

  it('refuses a body whose declared length is over the limit, without reading it', async () => {
    const response = await api.createDocument(
      await post({
        as: operatorA,
        body: JSON.stringify({ title: 'Doc', contentType: 'text/plain', sizeBytes: 10 }),
        headers: { 'content-length': '999999' },
      }),
      workspaceA,
    );

    expect(await observe(response)).toEqual(tooLarge);
  });

  it('stops reading a streamed body with no declared length once it passes the limit', async () => {
    const base = await post({ as: operatorA });
    const headers = new Headers(base.headers);
    headers.delete('content-length');
    // A body that never ends: the request only finishes if reading stops at the limit.
    const chunk = new TextEncoder().encode(oversized.slice(0, 512));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    // A stream body needs `duplex`, which the DOM RequestInit type does not declare yet.
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers,
      body: endless,
      duplex: 'half',
    };
    const request = new Request(base.url, init);
    expect(request.headers.get('content-length')).toBeNull();

    expect(await observe(await api.createDocument(request, workspaceA))).toEqual(tooLarge);
  });

  it('refuses a body that is not JSON', async () => {
    const wrongType = await api.createDocument(
      await post({ as: operatorA, body: 'title=x', headers: { 'content-type': 'text/plain' } }),
      workspaceA,
    );
    const broken = await api.createDocument(
      await post({ as: operatorA, body: '{"title":' }),
      workspaceA,
    );

    expect(wrongType.status).toBe(415);
    expect(broken.status).toBe(400);
  });
});

describe('document upload: authorization', () => {
  const validBody = JSON.stringify({ title: 'Doc', contentType: 'text/plain', sizeBytes: 10 });

  it('refuses a write without the CSRF token or from another origin, as a plain 403', async () => {
    const noToken = await api.createDocument(
      await post({ as: operatorA, body: validBody, headers: { [CSRF_HEADER]: '' } }),
      workspaceA,
    );
    const otherOrigin = await api.createDocument(
      await post({ as: operatorA, body: validBody, headers: { origin: 'https://evil.example' } }),
      workspaceA,
    );

    expect(await observe(noToken)).toEqual({ status: 403, body: '{"error":"forbidden"}' });
    expect(await observe(otherOrigin)).toEqual({ status: 403, body: '{"error":"forbidden"}' });
  });

  it('a non-member gets the same 403 as for a workspace that does not exist', async () => {
    const notMember = await observe(
      await api.createDocument(await post({ as: outsider, body: validBody }), workspaceA),
    );
    const noWorkspace = await observe(
      await api.createDocument(
        await post({ as: operatorA, body: validBody }),
        '0195d6a4-ffff-7fff-bfff-ffffffffffff',
      ),
    );

    expect(notMember).toEqual({ status: 403, body: '{"error":"forbidden"}' });
    expect(noWorkspace).toEqual(notMember);
  });

  it('confirming a document of another workspace looks exactly like a missing one', async () => {
    const created = await createDocument();
    await seedMembership(fixture.admin, workspaceB, operatorA, 'operator');

    const otherWorkspace = await observe(
      await api.confirmUpload(await post({ as: operatorA }), workspaceB, created.document.id),
    );
    const missing = await observe(
      await api.confirmUpload(
        await post({ as: operatorA }),
        workspaceB,
        '0195d6a4-ffff-7fff-bfff-ffffffffffff',
      ),
    );
    const malformed = await observe(
      await api.confirmUpload(await post({ as: operatorA }), workspaceB, 'not-a-uuid'),
    );

    expect(otherWorkspace).toEqual({ status: 404, body: '{"error":"document_not_found"}' });
    expect(missing).toEqual(otherWorkspace);
    expect(malformed).toEqual(otherWorkspace);
  });

  it('refuses a request without a session', async () => {
    const response = await api.createDocument(await post({ body: validBody }), workspaceA);

    expect(response.status).toBe(401);
  });
});
