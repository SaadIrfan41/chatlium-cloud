import {
  documentObjectKey,
  MAX_DOCUMENT_BYTES,
  type DocumentContentType,
} from '@chatlium/contracts';
import { createDatabase, findDocumentForJob, type Database } from '@chatlium/db';
import { seedWorkspace, startMigratedDatabase, type MigratedDatabase } from '@chatlium/db/testing';
import { createS3Storage, type ObjectStorage } from '@chatlium/storage';
import { FLOCI_REGION, startFloci, type StartedFloci } from '@chatlium/storage/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractUploadedDocument } from '../../src/index.ts';
import { buildPdf, VECTOR_ONLY_PAGE } from '../pdf-fixtures.ts';

// Build guide 2.3, Done when: a failed extraction sets the document status to `failed` with a
// reason. Real Postgres (as chatlium_app, RLS enforced) and a real S3 API (Floci).

const BUCKET = 'chatlium-documents-test';

let database: MigratedDatabase;
let floci: StartedFloci;
let app: Database;
let storage: ObjectStorage;
let workspaceId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
  [database, floci] = await Promise.all([startMigratedDatabase(), startFloci()]);
  await floci.createBucket(BUCKET);
  app = createDatabase(database.appUrl);
  storage = createS3Storage({ bucket: BUCKET, region: FLOCI_REGION, endpoint: floci.endpoint });
  [workspaceId, otherWorkspaceId] = await Promise.all([
    seedWorkspace(database.admin, 'Extraction'),
    seedWorkspace(database.admin, 'Other'),
  ]);
});

afterAll(async () => {
  await app.close();
  await Promise.all([database.stop(), floci.stop()]);
});

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * An uploaded document whose stored object holds `body`, or with no object when `body` is
 * undefined. Seeded as the superuser, standing in for the web app's create and confirm steps.
 */
async function uploaded(contentType: string, body: Uint8Array | undefined): Promise<string> {
  const result = await database.admin.query<{ id: string }>(
    `INSERT INTO documents (workspace_id, title, status, s3_key, content_type, size_bytes)
     VALUES ($1, 'Doc', 'uploaded', 'placeholder/' || gen_random_uuid(), $2, $3) RETURNING id`,
    [workspaceId, contentType, body?.byteLength ?? 1],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error('document insert returned no id');
  }
  const key = documentObjectKey(workspaceId, id);
  await database.admin.query('UPDATE documents SET s3_key = $1 WHERE id = $2', [key, id]);
  if (body !== undefined) {
    await floci.putObject(BUCKET, key, body, contentType);
  }
  return id;
}

async function run(documentId: string, inWorkspace = workspaceId) {
  return extractUploadedDocument({ db: app.db, storage }, { workspaceId: inWorkspace, documentId });
}

async function stored(documentId: string) {
  return findDocumentForJob(app.db, { workspaceId }, documentId);
}

const failures: readonly (readonly [
  string,
  DocumentContentType | 'image/png',
  Uint8Array,
  string,
])[] = [
  ['text declared as a PDF', 'application/pdf', encode('not a pdf'), 'type_mismatch'],
  ['a PDF declared as text', 'text/plain', buildPdf([{ lines: ['Hidden PDF.'] }]), 'type_mismatch'],
  ['a PDF with no text layer', 'application/pdf', buildPdf([VECTOR_ONLY_PAGE]), 'no_text_layer'],
  ['text that is not UTF-8', 'text/plain', new Uint8Array([0xff, 0xfe, 0x41]), 'invalid_utf8'],
  ['JSON that does not parse', 'application/json', encode('{oops'), 'invalid_json'],
  ['an unsupported stored type', 'image/png', encode('png?'), 'type_mismatch'],
];

describe('extractUploadedDocument', () => {
  it('returns the text of a valid document and leaves its status alone', async () => {
    const id = await uploaded('text/markdown', encode('# Returns\n\nWithin 30 days.\n'));

    const result = await run(id);

    expect(result).toMatchObject({
      status: 'extracted',
      text: '# Returns\n\nWithin 30 days.\n',
      document: { id },
    });
    expect(await stored(id)).toMatchObject({ status: 'uploaded', failureReason: null });
  });

  it('extracts a PDF with a text layer', async () => {
    const id = await uploaded(
      'application/pdf',
      buildPdf([{ lines: ['Support hours are 9 to 5.'] }]),
    );

    expect(await run(id)).toMatchObject({ status: 'extracted', text: 'Support hours are 9 to 5.' });
  });

  it.each(failures)('marks %s failed with %s', async (_, contentType, body, reason) => {
    const id = await uploaded(contentType, body);

    expect(await run(id)).toEqual({ status: 'failed', reason });
    expect(await stored(id)).toMatchObject({ status: 'failed', failureReason: reason });
  });

  it('marks a document whose object is gone failed with object_missing', async () => {
    const id = await uploaded('text/plain', undefined);

    expect(await run(id)).toEqual({ status: 'failed', reason: 'object_missing' });
    expect(await stored(id)).toMatchObject({ status: 'failed', failureReason: 'object_missing' });
  });

  it('fails an object over the upload limit with too_large without downloading it', async () => {
    const id = await uploaded('text/plain', new Uint8Array(MAX_DOCUMENT_BYTES + 1).fill(0x61));
    const headOnly = {
      head: (key: string) => storage.head(key),
      get: () => Promise.reject(new Error('an oversized object must not be downloaded')),
    };

    const result = await extractUploadedDocument(
      { db: app.db, storage: headOnly },
      { workspaceId, documentId: id },
    );

    expect(result).toEqual({ status: 'failed', reason: 'too_large' });
    expect(await stored(id)).toMatchObject({ status: 'failed', failureReason: 'too_large' });
  });

  it('skips a document that already failed, keeping the first reason', async () => {
    const id = await uploaded('application/pdf', encode('not a pdf'));
    await run(id);

    expect(await run(id)).toEqual({ status: 'skipped' });
    expect(await stored(id)).toMatchObject({ failureReason: 'type_mismatch' });
  });

  it('reports skipped, not failed, when another delivery recorded an outcome first', async () => {
    const id = await uploaded('text/plain', undefined);
    // Another delivery of the same job fails the document while this one is checking storage.
    const racing = {
      head: async (key: string) => {
        await database.admin.query(
          "UPDATE documents SET status = 'failed', failure_reason = 'too_large' WHERE id = $1",
          [id],
        );
        return storage.head(key);
      },
      get: (key: string) => storage.get(key),
    };

    const result = await extractUploadedDocument(
      { db: app.db, storage: racing },
      { workspaceId, documentId: id },
    );

    expect(result).toEqual({ status: 'skipped' });
    expect(await stored(id)).toMatchObject({ status: 'failed', failureReason: 'too_large' });
  });

  it('skips a document that is not uploaded yet', async () => {
    const id = await uploaded('text/plain', encode('hello there'));
    await database.admin.query("UPDATE documents SET status = 'pending' WHERE id = $1", [id]);

    expect(await run(id)).toEqual({ status: 'skipped' });
  });

  it("skips a job naming another workspace's document, and changes nothing", async () => {
    const id = await uploaded('application/pdf', encode('not a pdf'));

    expect(await run(id, otherWorkspaceId)).toEqual({ status: 'skipped' });
    expect(await stored(id)).toMatchObject({ status: 'uploaded', failureReason: null });
  });
});
