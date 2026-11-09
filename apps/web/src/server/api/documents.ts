// Document upload (build guide 2.2). Framework-free, like workspaces.ts: no `server-only`, no `@/`.
//
//   POST /api/workspaces/:id/documents                 -> pending document + presigned PUT URL
//   PUT  <presigned URL>                                (browser to S3 directly)
//   POST /api/workspaces/:id/documents/:docId/confirm  -> checks the object, marks it uploaded,
//                                                         enqueues indexing
import { verifyStateChangingRequest, type WorkspaceGuard } from '@chatlium/auth';
import {
  createDocumentRequestSchema,
  indexingJobFor,
  MAX_CREATE_DOCUMENT_REQUEST_BYTES,
  MAX_DOCUMENT_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  type IndexingJob,
} from '@chatlium/contracts';
import {
  createPendingDocument,
  findDocument,
  markDocumentUploaded,
  type Database,
  type DocumentRecord,
} from '@chatlium/db';
import type { MessageQueue } from '@chatlium/queue';
import type { ObjectStorage } from '@chatlium/storage';
import { z } from 'zod';
import { handled, json, readJsonBody, RequestError } from './http.ts';

export interface DocumentApiDependencies {
  readonly guard: WorkspaceGuard;
  readonly db: Database['db'];
  readonly storage: ObjectStorage;
  readonly indexingQueue: Pick<MessageQueue<IndexingJob>, 'publish'>;
  /** The app's own origin, e.g. http://localhost:3000. Writes must come from it. */
  readonly appOrigin: string;
}

const documentIdSchema = z.uuid();

/** What the API shows of a document. The S3 key stays server-side. */
function view(document: DocumentRecord) {
  return {
    id: document.id,
    title: document.title,
    status: document.status,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
  };
}

export function createDocumentApi(dependencies: DocumentApiDependencies) {
  async function requireOperatorWrite(request: Request, workspaceId: string) {
    const member = await dependencies.guard.requireWorkspaceRole(request, workspaceId, 'operator');
    verifyStateChangingRequest(request, {
      origin: dependencies.appOrigin,
      csrfToken: member.user.csrf,
    });
    return { workspaceId: member.workspaceId, userId: member.user.userId };
  }

  return {
    /** Validates the declared title, type and size, creates a pending document, presigns a PUT. */
    createDocument(request: Request, workspaceId: string): Promise<Response> {
      return handled(async () => {
        const context = await requireOperatorWrite(request, workspaceId);
        const parsed = createDocumentRequestSchema.safeParse(
          await readJsonBody(request, MAX_CREATE_DOCUMENT_REQUEST_BYTES),
        );
        if (!parsed.success) {
          throw new RequestError(
            422,
            'invalid_request',
            parsed.error.issues.map((issue) => issue.message),
          );
        }

        const document = await createPendingDocument(dependencies.db, context, parsed.data);
        const upload = await dependencies.storage.presignPut(document.s3Key, {
          contentType: document.contentType,
          contentLength: document.sizeBytes,
          expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        });
        return json(
          {
            document: view(document),
            upload: {
              url: upload.url,
              method: upload.method,
              headers: upload.headers,
              expiresAt: upload.expiresAt.toISOString(),
            },
          },
          201,
        );
      });
    },

    /**
     * Checks that the object exists with the declared size and type, marks the document
     * `uploaded` and enqueues its indexing job. Confirming an already-uploaded document re-sends
     * the same job (same jobId), so a lost enqueue can be recovered by confirming again; the
     * indexing worker is idempotent on jobId.
     */
    confirmUpload(request: Request, workspaceId: string, documentId: string): Promise<Response> {
      return handled(async () => {
        const context = await requireOperatorWrite(request, workspaceId);
        const document = documentIdSchema.safeParse(documentId).success
          ? await findDocument(dependencies.db, context, documentId)
          : undefined;
        if (document === undefined) {
          throw new RequestError(404, 'document_not_found');
        }

        if (document.status === 'pending') {
          const stored = await dependencies.storage.head(document.s3Key);
          if (stored === undefined) {
            throw new RequestError(409, 'upload_missing');
          }
          if (
            stored.sizeBytes !== document.sizeBytes ||
            stored.sizeBytes > MAX_DOCUMENT_BYTES ||
            stored.contentType !== document.contentType
          ) {
            throw new RequestError(422, 'upload_mismatch');
          }
          await markDocumentUploaded(dependencies.db, context, document.id);
        }

        const current = await findDocument(dependencies.db, context, document.id);
        if (current?.status !== 'uploaded') {
          // Already ready (indexed) or failed: nothing to enqueue.
          return json({ document: current === undefined ? view(document) : view(current) });
        }
        // Phase 2 gap, fixed by the outbox in Phase 3 (build guide 3.3): the status change is
        // committed before this publish, so a crash in between leaves an `uploaded` document
        // without a job until the next confirm.
        await dependencies.indexingQueue.publish(indexingJobFor(context.workspaceId, current.id));
        return json({ document: view(current) }, 202);
      });
    },
  };
}

export type DocumentApi = ReturnType<typeof createDocumentApi>;
