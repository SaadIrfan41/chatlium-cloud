// Text extraction (build guide 2.3). Turns stored document bytes into plain text, or a failure
// code. The declared content type is a claim: the bytes are checked against it first.
import {
  MAX_DOCUMENT_BYTES,
  type DocumentContentType,
  type DocumentFailureReason,
} from '@chatlium/contracts';
import { extractPdfText } from './pdf.ts';

export interface ExtractedText {
  readonly ok: true;
  /** Line endings are `\n`. For a PDF, pages are separated by a blank line. */
  readonly text: string;
  /** For a PDF: where each page starts in `text` (index 0 is page 1). Empty otherwise. */
  readonly pageOffsets: readonly number[];
}

export interface ExtractionFailure {
  readonly ok: false;
  readonly reason: DocumentFailureReason;
}

export type ExtractionResult = ExtractedText | ExtractionFailure;

const PDF_SIGNATURE = new TextEncoder().encode('%PDF-');

function fail(reason: DocumentFailureReason): ExtractionFailure {
  return { ok: false, reason };
}

function startsWithPdfSignature(bytes: Uint8Array): boolean {
  return PDF_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * UTF-8 with invalid sequences rejected rather than replaced. A leading byte-order mark is
 * dropped, null bytes are stripped and line endings become `\n`.
 */
function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true })
      .decode(bytes)
      .replaceAll('\0', '')
      .replaceAll(/\r\n?/g, '\n');
  } catch {
    return undefined;
  }
}

function hasContent(text: string): boolean {
  return /\S/.test(text);
}

export async function extractText(
  bytes: Uint8Array,
  declaredType: DocumentContentType,
): Promise<ExtractionResult> {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return fail('too_large');
  }
  const looksLikePdf = startsWithPdfSignature(bytes);

  if (declaredType === 'application/pdf') {
    if (!looksLikePdf) {
      return fail('type_mismatch');
    }
    const pdf = await extractPdfText(bytes);
    return pdf.ok ? pdf : fail(pdf.reason);
  }

  // A text type must not carry a PDF either.
  if (looksLikePdf) {
    return fail('type_mismatch');
  }
  const text = decodeUtf8(bytes);
  if (text === undefined) {
    return fail('invalid_utf8');
  }
  if (!hasContent(text)) {
    return fail('empty_document');
  }
  if (declaredType === 'application/json') {
    try {
      JSON.parse(text);
    } catch {
      return fail('invalid_json');
    }
  }
  return { ok: true, text, pageOffsets: [] };
}
