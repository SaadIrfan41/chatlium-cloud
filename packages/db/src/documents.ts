import {
  documentObjectKey,
  type DocumentContentType,
  type DocumentFailureReason,
} from '@chatlium/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { documents } from './schema.ts';
import { withWorkspace, type WorkspaceContext } from './tenant.ts';

/** Web requests always act for a user inside a workspace (ADR 0003). */
export interface UserInWorkspace {
  readonly workspaceId: string;
  readonly userId: string;
}

export type DocumentStatus = (typeof documents.status.enumValues)[number];

export interface DocumentRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly status: DocumentStatus;
  readonly s3Key: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly failureReason: DocumentFailureReason | null;
}

const columns = {
  id: documents.id,
  workspaceId: documents.workspaceId,
  title: documents.title,
  status: documents.status,
  s3Key: documents.s3Key,
  contentType: documents.contentType,
  sizeBytes: documents.sizeBytes,
  failureReason: documents.failureReason,
};

/** A job carries a workspace validated at ingestion, but no user (ADR 0003, amendments §4). */
export interface JobWorkspace {
  readonly workspaceId: string;
}

/** Workers act for the workspace only, never as a user. */
function jobContext(job: JobWorkspace): WorkspaceContext {
  return { workspaceId: job.workspaceId };
}

/**
 * Inserts a document in status `pending` and returns it. The S3 key is derived from the
 * workspace and document IDs, never from anything the uploader supplies.
 */
export async function createPendingDocument(
  db: NodePgDatabase,
  context: UserInWorkspace,
  input: {
    readonly title: string;
    readonly contentType: DocumentContentType;
    readonly sizeBytes: number;
  },
): Promise<DocumentRecord> {
  return withWorkspace(db, context, async (tx) => {
    // The ID is needed for the key, so take it from PostgreSQL first (time-ordered UUIDv7).
    const generated = await tx.execute<{ id: string }>(sql`SELECT uuidv7()::text AS id`);
    const id = generated.rows[0]?.id;
    if (id === undefined) {
      throw new Error('uuidv7() returned no row');
    }
    const [row] = await tx
      .insert(documents)
      .values({
        id,
        workspaceId: context.workspaceId,
        title: input.title,
        status: 'pending',
        s3Key: documentObjectKey(context.workspaceId, id),
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      })
      .returning(columns);
    if (row === undefined) {
      throw new Error('document insert returned no row');
    }
    return row;
  });
}

/** One document of the workspace, or undefined (also for another workspace's document). */
export async function findDocument(
  db: NodePgDatabase,
  context: UserInWorkspace,
  documentId: string,
): Promise<DocumentRecord | undefined> {
  const rows = await withWorkspace(db, context, (tx) =>
    tx
      .select(columns)
      .from(documents)
      .where(and(eq(documents.workspaceId, context.workspaceId), eq(documents.id, documentId)))
      .limit(1),
  );
  return rows[0];
}

/**
 * Moves a document from `pending` to `uploaded`. Returns false if it was not pending, so two
 * concurrent confirms cannot both win.
 */
export async function markDocumentUploaded(
  db: NodePgDatabase,
  context: UserInWorkspace,
  documentId: string,
): Promise<boolean> {
  const rows = await withWorkspace(db, context, (tx) =>
    tx
      .update(documents)
      .set({ status: 'uploaded' })
      .where(
        and(
          eq(documents.workspaceId, context.workspaceId),
          eq(documents.id, documentId),
          eq(documents.status, 'pending'),
        ),
      )
      .returning({ id: documents.id }),
  );
  return rows.length === 1;
}

/** The indexing worker's view of one document, or undefined if the workspace has no such one. */
export async function findDocumentForJob(
  db: NodePgDatabase,
  job: JobWorkspace,
  documentId: string,
): Promise<DocumentRecord | undefined> {
  const rows = await withWorkspace(db, jobContext(job), (tx) =>
    tx.select(columns).from(documents).where(eq(documents.id, documentId)).limit(1),
  );
  return rows[0];
}

/**
 * Moves an uploaded document to `failed` and records why. Returns false if it was not in status
 * `uploaded` (already indexed, already failed, or not this workspace's), so a redelivered job
 * cannot overwrite an earlier outcome.
 */
export async function markDocumentFailed(
  db: NodePgDatabase,
  job: JobWorkspace,
  documentId: string,
  reason: DocumentFailureReason,
): Promise<boolean> {
  const rows = await withWorkspace(db, jobContext(job), (tx) =>
    tx
      .update(documents)
      .set({ status: 'failed', failureReason: reason })
      .where(and(eq(documents.id, documentId), eq(documents.status, 'uploaded')))
      .returning({ id: documents.id }),
  );
  return rows.length === 1;
}
