// Builds small, valid PDFs in memory so the tests carry no binary fixtures.

export interface PdfPage {
  /** Lines drawn as text with Helvetica; empty for a page with no text layer. */
  readonly lines?: readonly string[];
  /** Raw content-stream operators drawn after the text, for example vector shapes. */
  readonly drawing?: string;
}

function escapePdfString(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function contentStream(page: PdfPage): string {
  const parts: string[] = [];
  if (page.lines !== undefined && page.lines.length > 0) {
    parts.push('BT /F1 12 Tf 72 720 Td 14 TL');
    for (const line of page.lines) {
      parts.push(`(${escapePdfString(line)}) Tj T*`);
    }
    parts.push('ET');
  }
  if (page.drawing !== undefined) {
    parts.push(page.drawing);
  }
  return parts.join('\n');
}

export interface PdfOptions {
  /**
   * Adds a Standard security handler (RC4, revision 2) whose password check values match no
   * password, so a reader must ask for one: the shape of a password-protected PDF.
   */
  readonly passwordProtected?: boolean;
}

const UNMATCHABLE_CHECK = `<${'ab'.repeat(32)}>`;
const FILE_ID = `<${'01'.repeat(16)}>`;

/** A PDF 1.4 file with one Helvetica font shared by every page. */
export function buildPdf(pages: readonly PdfPage[], options: PdfOptions = {}): Uint8Array {
  const objects: string[] = [];
  // 1: catalog, 2: page tree, 3: font, then a page and a content stream per page.
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const [index, page] of pages.entries()) {
    const contentId = pageIds[index]! + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentId)} 0 R >>`,
    );
    const stream = contentStream(page);
    objects.push(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const encryption =
    options.passwordProtected === true
      ? ` /Encrypt << /Filter /Standard /V 1 /R 2 /O ${UNMATCHABLE_CHECK} /U ${UNMATCHABLE_CHECK} /P -4 >> /ID [${FILE_ID} ${FILE_ID}]`
      : '';
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R${encryption} >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  // Every character above is ASCII, so string length equals byte length.
  return new TextEncoder().encode(body);
}

/** A filled rectangle: something on the page, but no text. */
export const VECTOR_DRAWING = '0 0 1 rg 100 100 400 600 re f';
export const VECTOR_ONLY_PAGE: PdfPage = { drawing: VECTOR_DRAWING };
