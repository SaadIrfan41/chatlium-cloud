import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DOCUMENT_TYPES,
  createDocumentRequestSchema,
  DOCUMENT_FAILURE_REASONS,
  documentObjectKey,
  indexingJobFor,
  indexingJobSchema,
  MAX_DOCUMENT_BYTES,
  UPLOAD_URL_TTL_SECONDS,
} from '../src/index.ts';

const valid = { title: 'Refund policy', contentType: 'text/plain', sizeBytes: 1200 };

describe('upload limits', () => {
  it('are the recorded values', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10_485_760);
    expect(UPLOAD_URL_TTL_SECONDS).toBe(300);
    expect(ALLOWED_DOCUMENT_TYPES).toEqual([
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/json',
    ]);
  });
});

describe('createDocumentRequestSchema', () => {
  it.each(ALLOWED_DOCUMENT_TYPES)('accepts %s', (contentType) => {
    expect(createDocumentRequestSchema.parse({ ...valid, contentType })).toEqual({
      ...valid,
      contentType,
    });
  });

  it('trims the title', () => {
    expect(createDocumentRequestSchema.parse({ ...valid, title: '  Refunds  ' }).title).toBe(
      'Refunds',
    );
  });

  it('accepts exactly the size limit and refuses one byte more', () => {
    expect(
      createDocumentRequestSchema.safeParse({ ...valid, sizeBytes: MAX_DOCUMENT_BYTES }).success,
    ).toBe(true);
    expect(
      createDocumentRequestSchema.safeParse({ ...valid, sizeBytes: MAX_DOCUMENT_BYTES + 1 })
        .success,
    ).toBe(false);
  });

  it.each([
    ['an empty title', { title: '   ' }],
    ['a title over 200 characters', { title: 'x'.repeat(201) }],
    ['a type that is not allowed', { contentType: 'text/html' }],
    ['a type with parameters', { contentType: 'text/plain; charset=utf-8' }],
    ['a zero size', { sizeBytes: 0 }],
    ['a fractional size', { sizeBytes: 1.5 }],
    ['a size given as a string', { sizeBytes: '1200' }],
    ['an unknown field', { s3Key: 'workspaces/other/documents/x' }],
  ])('refuses %s', (_case, override) => {
    expect(createDocumentRequestSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe('documentObjectKey', () => {
  it('is built from IDs only', () => {
    expect(
      documentObjectKey(
        '0195d6a4-0000-7000-8000-00000000000a',
        '0195d6a4-0000-7000-8000-0000000d0c01',
      ),
    ).toBe(
      'workspaces/0195d6a4-0000-7000-8000-00000000000a/documents/0195d6a4-0000-7000-8000-0000000d0c01',
    );
  });
});

describe('indexing job', () => {
  it('has one stable job ID per document', () => {
    const job = indexingJobFor(
      '0195d6a4-0000-7000-8000-00000000000a',
      '0195d6a4-0000-7000-8000-0000000d0c01',
    );

    expect(job).toEqual({
      jobId: 'index:0195d6a4-0000-7000-8000-0000000d0c01',
      workspaceId: '0195d6a4-0000-7000-8000-00000000000a',
      documentId: '0195d6a4-0000-7000-8000-0000000d0c01',
    });
    expect(indexingJobSchema.parse(job)).toEqual(job);
  });

  it('refuses a job whose workspace is not a UUID', () => {
    expect(
      indexingJobSchema.safeParse({
        jobId: 'index:0195d6a4-0000-7000-8000-0000000d0c01',
        workspaceId: 'acme',
        documentId: '0195d6a4-0000-7000-8000-0000000d0c01',
      }).success,
    ).toBe(false);
  });
});

describe('document failure reasons', () => {
  it('are distinct snake_case codes, safe to store and show', () => {
    expect(new Set(DOCUMENT_FAILURE_REASONS).size).toBe(DOCUMENT_FAILURE_REASONS.length);
    for (const reason of DOCUMENT_FAILURE_REASONS) {
      expect(reason).toMatch(/^[a-z]+(?:_[a-z0-9]+)*$/);
    }
  });

  it('include the codes the build guide requires', () => {
    // A PDF without a text layer, and bytes that do not match the declared type (Step 2.3).
    expect(DOCUMENT_FAILURE_REASONS).toEqual(
      expect.arrayContaining(['no_text_layer', 'type_mismatch']),
    );
  });
});
