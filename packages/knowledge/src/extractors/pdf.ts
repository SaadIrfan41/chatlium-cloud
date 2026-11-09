// PDF text-layer extraction with Mozilla's pdf.js. Only the text layer is read: nothing is
// rendered and no OCR is attempted, so a scanned PDF fails with `no_text_layer`.
import type { DocumentFailureReason } from '@chatlium/contracts';
import { getDocument, VerbosityLevel } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';

/** More pages than any support document needs; bounds the work one upload can cause. */
export const MAX_PDF_PAGES = 500;

/**
 * A PDF is treated as having no text layer when it averages fewer visible characters per page
 * than this. A scan often still carries a page number or a stray header, so zero is too strict.
 */
export const MIN_TEXT_CHARS_PER_PAGE = 10;

export type PdfExtraction =
  | { readonly ok: true; readonly text: string; readonly pageOffsets: readonly number[] }
  | { readonly ok: false; readonly reason: DocumentFailureReason };

function isTextItem(item: unknown): item is TextItem {
  return typeof item === 'object' && item !== null && 'str' in item;
}

function visibleCharacters(text: string): number {
  return text.replaceAll(/\s/g, '').length;
}

function failureFor(error: unknown): DocumentFailureReason {
  if (error instanceof Error && error.name === 'PasswordException') {
    return 'encrypted_pdf';
  }
  return 'unreadable_pdf';
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtraction> {
  const task = getDocument({
    // pdf.js may transfer the buffer it is given, so hand it a copy.
    data: bytes.slice(),
    // Nothing is displayed: no font loading, no system fonts, no XFA forms, no canvas.
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    isOffscreenCanvasSupported: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      return { ok: false, reason: 'too_many_pages' };
    }

    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      // oxlint-disable-next-line no-await-in-loop -- pages are read one at a time to bound memory
      const page = await document.getPage(number);
      // oxlint-disable-next-line no-await-in-loop -- see above
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter(isTextItem)
          .map((item) => item.str + (item.hasEOL ? '\n' : ''))
          .join('')
          .replaceAll('\0', '')
          .replaceAll(/\r\n?/g, '\n')
          .trim(),
      );
      page.cleanup();
    }

    const characters = pages.reduce((total, page) => total + visibleCharacters(page), 0);
    if (characters < MIN_TEXT_CHARS_PER_PAGE * pages.length) {
      return { ok: false, reason: 'no_text_layer' };
    }

    const pageOffsets: number[] = [];
    let text = '';
    for (const page of pages) {
      if (text.length > 0) {
        text += '\n\n';
      }
      pageOffsets.push(text.length);
      text += page;
    }
    return { ok: true, text, pageOffsets };
  } catch (error) {
    return { ok: false, reason: failureFor(error) };
  } finally {
    await task.destroy();
  }
}
