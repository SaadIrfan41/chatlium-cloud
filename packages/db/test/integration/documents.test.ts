import { DOCUMENT_FAILURE_REASONS } from '@chatlium/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createPendingDocument,
  findDocument,
  findDocumentForJob,
  markDocumentFailed,
  markDocumentUploaded,
  type Database,
} from '../../src/index.ts';
import {
  seedMembership,
  seedUser,
  seedWorkspace,
  startMigratedDatabase,
  type MigratedDatabase,
} from './fixture.ts';

// Build guide 2.2: the document lifecycle helpers, as chatlium_app with RLS enforced.

let fixture: MigratedDatabase;
let app: Database;
let a: { workspaceId: string; userId: string };
let b: { workspaceId: string; userId: string };

beforeAll(async () => {
  fixture = await startMigratedDatabase();
  app = createDatabase(fixture.appUrl);
  const [workspaceA, workspaceB] = await Promise.all([
    seedWorkspace(fixture.admin, 'A'),
    seedWorkspace(fixture.admin, 'B'),
  ]);
  const [userA, userB] = await Promise.all([
    seedUser(fixture.admin, 'sub-a', 'a@chatlium.test'),
    seedUser(fixture.admin, 'sub-b', 'b@chatlium.test'),
  ]);
  await seedMembership(fixture.admin, workspaceA, userA, 'operator');
  await seedMembership(fixture.admin, workspaceB, userB, 'operator');
  a = { workspaceId: workspaceA, userId: userA };
  b = { workspaceId: workspaceB, userId: userB };
});

afterAll(async () => {
  await app.close();
  await fixture.stop();
});

const input = { title: 'Refunds', contentType: 'text/plain', sizeBytes: 42 } as const;

describe('documents', () => {
  it('creates a pending document whose S3 key is derived from the workspace and document IDs', async () => {
    const document = await createPendingDocument(app.db, a, input);

    expect(document).toMatchObject({ ...input, status: 'pending', workspaceId: a.workspaceId });
    expect(document.s3Key).toBe(`workspaces/${a.workspaceId}/documents/${document.id}`);
  });

  it('moves pending to uploaded exactly once', async () => {
    const document = await createPendingDocument(app.db, a, input);

    const first = await markDocumentUploaded(app.db, a, document.id);
    const second = await markDocumentUploaded(app.db, a, document.id);

    expect([first, second]).toEqual([true, false]);
    expect((await findDocument(app.db, a, document.id))?.status).toBe('uploaded');
  });

  it('does not move a ready document back to uploaded', async () => {
    const document = await createPendingDocument(app.db, a, input);
    await fixture.admin.query("UPDATE documents SET status = 'ready' WHERE id = $1", [document.id]);

    expect(await markDocumentUploaded(app.db, a, document.id)).toBe(false);
    expect((await findDocument(app.db, a, document.id))?.status).toBe('ready');
  });

  it("neither finds nor marks another workspace's document", async () => {
    const document = await createPendingDocument(app.db, a, input);

    expect(await findDocument(app.db, b, document.id)).toBeUndefined();
    expect(await markDocumentUploaded(app.db, b, document.id)).toBe(false);
    expect((await findDocument(app.db, a, document.id))?.status).toBe('pending');
  });

  it('refuses a non-positive size', async () => {
    // Drizzle wraps the PostgreSQL error; the violated constraint is on its cause.
    await expect(
      createPendingDocument(app.db, a, { ...input, sizeBytes: 0 }),
    ).rejects.toMatchObject({
      cause: { constraint: 'documents_size_bytes_positive' },
    });
  });

  it('starts with no failure reason', async () => {
    const document = await createPendingDocument(app.db, a, input);

    expect(document.failureReason).toBeNull();
  });
});

/** A document of workspace A in status `uploaded`, as the worker receives it. */
async function uploadedDocument(): Promise<string> {
  const document = await createPendingDocument(app.db, a, input);
  await markDocumentUploaded(app.db, a, document.id);
  return document.id;
}

describe('documents, as the indexing worker (no user)', () => {
  it('finds a document by workspace alone, and not from another workspace', async () => {
    const id = await uploadedDocument();

    expect(await findDocumentForJob(app.db, { workspaceId: a.workspaceId }, id)).toMatchObject({
      id,
      status: 'uploaded',
    });
    expect(await findDocumentForJob(app.db, { workspaceId: b.workspaceId }, id)).toBeUndefined();
  });

  it('marks an uploaded document failed with its reason, once', async () => {
    const id = await uploadedDocument();
    const job = { workspaceId: a.workspaceId };

    const first = await markDocumentFailed(app.db, job, id, 'no_text_layer');
    const second = await markDocumentFailed(app.db, job, id, 'unreadable_pdf');

    expect([first, second]).toEqual([true, false]);
    expect(await findDocumentForJob(app.db, job, id)).toMatchObject({
      status: 'failed',
      failureReason: 'no_text_layer',
    });
  });

  it('marks only uploaded documents failed, not pending or ready ones', async () => {
    const job = { workspaceId: a.workspaceId };
    const pending = await createPendingDocument(app.db, a, input);
    const ready = await uploadedDocument();
    await fixture.admin.query("UPDATE documents SET status = 'ready' WHERE id = $1", [ready]);

    expect(await markDocumentFailed(app.db, job, pending.id, 'object_missing')).toBe(false);
    expect(await markDocumentFailed(app.db, job, ready, 'object_missing')).toBe(false);
    expect((await findDocumentForJob(app.db, job, pending.id))?.status).toBe('pending');
    expect(await findDocumentForJob(app.db, job, ready)).toMatchObject({
      status: 'ready',
      failureReason: null,
    });
  });

  it("does not mark another workspace's document failed", async () => {
    const id = await uploadedDocument();

    expect(await markDocumentFailed(app.db, { workspaceId: b.workspaceId }, id, 'too_large')).toBe(
      false,
    );
    expect((await findDocumentForJob(app.db, { workspaceId: a.workspaceId }, id))?.status).toBe(
      'uploaded',
    );
  });

  it('accepts every reason in the contracts list', async () => {
    const job = { workspaceId: a.workspaceId };
    for (const reason of DOCUMENT_FAILURE_REASONS) {
      // oxlint-disable-next-line no-await-in-loop -- one document per reason, in order
      const id = await uploadedDocument();
      // oxlint-disable-next-line no-await-in-loop -- see above
      expect(await markDocumentFailed(app.db, job, id, reason)).toBe(true);
    }
  });

  it('refuses a reason outside the list, and a reason on a document that has not failed', async () => {
    const id = await uploadedDocument();

    await expect(
      fixture.admin.query(
        "UPDATE documents SET status = 'failed', failure_reason = 'disk_on_fire' WHERE id = $1",
        [id],
      ),
    ).rejects.toMatchObject({ constraint: 'documents_failure_reason_valid' });
    await expect(
      fixture.admin.query("UPDATE documents SET failure_reason = 'too_large' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ constraint: 'documents_failure_reason_valid' });
  });
});
