import { z } from 'zod';

/**
 * Upload limits (build guide 2.2). Changing a value here needs a test update.
 *
 * 10 MiB covers long policy documents and manuals, keeps extraction and embedding cost per
 * document bounded, and stays far below what a presigned single PUT allows (5 GiB).
 */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** The declared type is a claim. Step 2.3 checks the bytes against it. */
export const ALLOWED_DOCUMENT_TYPES = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/json',
] as const;
export type DocumentContentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

/** How long a presigned upload URL stays valid. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/** The largest request body the create-document route reads (title, type and size only). */
export const MAX_CREATE_DOCUMENT_REQUEST_BYTES = 2 * 1024;

export const createDocumentRequestSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1, { error: 'title is required' })
    .max(200, { error: 'title must be at most 200 characters' }),
  contentType: z.enum(ALLOWED_DOCUMENT_TYPES, {
    error: `contentType must be one of: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`,
  }),
  sizeBytes: z
    .int({ error: 'sizeBytes must be a whole number of bytes' })
    .min(1, { error: 'sizeBytes must be at least 1' })
    .max(MAX_DOCUMENT_BYTES, { error: `sizeBytes must be at most ${String(MAX_DOCUMENT_BYTES)}` }),
});
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

/**
 * Why a document could not be indexed (build guide 2.3). Stored on the document and shown to
 * operators, so it is always one of these codes, never an error message or document content.
 */
export const DOCUMENT_FAILURE_REASONS = [
  /** The bytes are not what the declared content type says (for example a "PDF" without %PDF). */
  'type_mismatch',
  /** A text document that is not valid UTF-8. */
  'invalid_utf8',
  /** A JSON document that does not parse. */
  'invalid_json',
  /** No text left after extraction and clean-up. */
  'empty_document',
  /** A PDF whose pages have no text layer (for example a scan). OCR is not supported. */
  'no_text_layer',
  /** A password-protected PDF. */
  'encrypted_pdf',
  /** A PDF that the parser cannot read. */
  'unreadable_pdf',
  /** A PDF with more pages than the extractor accepts. */
  'too_many_pages',
  /** A stored object larger than the upload limit. */
  'too_large',
  /** The uploaded object is no longer in storage. */
  'object_missing',
] as const;
export type DocumentFailureReason = (typeof DOCUMENT_FAILURE_REASONS)[number];

/** The S3 key for a document. Never derived from anything the uploader names. */
export function documentObjectKey(workspaceId: string, documentId: string): string {
  return `workspaces/${workspaceId}/documents/${documentId}`;
}

/**
 * Indexing job (decision record: indexing path → SQS Standard → indexing worker). `jobId` is the
 * idempotency key the worker records in processed_messages; one document has one indexing job,
 * so a repeated confirm re-sends the same job instead of starting a second one.
 */
export const indexingJobSchema = z.strictObject({
  jobId: z.string().regex(/^index:[0-9a-f-]{36}$/),
  workspaceId: z.uuid(),
  documentId: z.uuid(),
});
export type IndexingJob = z.infer<typeof indexingJobSchema>;

export function indexingJobFor(workspaceId: string, documentId: string): IndexingJob {
  return { jobId: `index:${documentId}`, workspaceId, documentId };
}
