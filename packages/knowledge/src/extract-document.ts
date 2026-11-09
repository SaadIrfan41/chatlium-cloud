// The indexing worker's first stage (build guide 2.3): read an uploaded document's object and
// extract its text. A document that cannot be extracted is marked `failed` with a reason here, so
// later stages only ever see text.
import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  type DocumentContentType,
  type DocumentFailureReason,
} from '@chatlium/contracts';
import {
  findDocumentForJob,
  markDocumentFailed,
  type Database,
  type DocumentRecord,
  type JobWorkspace,
} from '@chatlium/db';
import type { ObjectStorage } from '@chatlium/storage';
import { extractText } from './extractors/extract.ts';

export interface ExtractDocumentDependencies {
  readonly db: Database['db'];
  readonly storage: Pick<ObjectStorage, 'head' | 'get'>;
}

export type DocumentExtraction =
  | {
      readonly status: 'extracted';
      readonly document: DocumentRecord;
      readonly text: string;
      readonly pageOffsets: readonly number[];
    }
  /** The document was marked `failed` with this reason. */
  | { readonly status: 'failed'; readonly reason: DocumentFailureReason }
  /**
   * Nothing to do: the workspace has no such document, or it is not in status `uploaded` (for
   * example a redelivered job for a document that was already indexed or already failed).
   */
  | { readonly status: 'skipped' };

function isAllowedType(type: string): type is DocumentContentType {
  return (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(type);
}

export async function extractUploadedDocument(
  dependencies: ExtractDocumentDependencies,
  job: JobWorkspace & { readonly documentId: string },
): Promise<DocumentExtraction> {
  const document = await findDocumentForJob(dependencies.db, job, job.documentId);
  if (document?.status !== 'uploaded') {
    return { status: 'skipped' };
  }

  async function failWith(reason: DocumentFailureReason): Promise<DocumentExtraction> {
    const marked = await markDocumentFailed(dependencies.db, job, job.documentId, reason);
    // Another delivery of the same job got there first; its outcome stands.
    return marked ? { status: 'failed', reason } : { status: 'skipped' };
  }

  if (!isAllowedType(document.contentType)) {
    return failWith('type_mismatch');
  }
  // Check the stored size before downloading, so an oversized object is never read into memory.
  const stored = await dependencies.storage.head(document.s3Key);
  if (stored === undefined) {
    return failWith('object_missing');
  }
  if (stored.sizeBytes > MAX_DOCUMENT_BYTES) {
    return failWith('too_large');
  }

  const result = await extractText(
    await dependencies.storage.get(document.s3Key),
    document.contentType,
  );
  if (!result.ok) {
    return failWith(result.reason);
  }
  return { status: 'extracted', document, text: result.text, pageOffsets: result.pageOffsets };
}
