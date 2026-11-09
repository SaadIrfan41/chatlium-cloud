import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createPendingDocument,
  findDocument,
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
});
