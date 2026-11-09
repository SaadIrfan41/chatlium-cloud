import { MAX_DOCUMENT_BYTES } from '@chatlium/contracts';
import { describe, expect, it } from 'vitest';
import { extractText, MAX_PDF_PAGES } from '../src/index.ts';
import { buildPdf, VECTOR_DRAWING, VECTOR_ONLY_PAGE } from './pdf-fixtures.ts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('extractText: text documents', () => {
  it('returns plain text as UTF-8, with CRLF and CR turned into LF', async () => {
    const result = await extractText(
      encode('Refunds take 5 days.\r\nCafé hours: 9–5\rEnd'),
      'text/plain',
    );

    expect(result).toEqual({
      ok: true,
      text: 'Refunds take 5 days.\nCafé hours: 9–5\nEnd',
      pageOffsets: [],
    });
  });

  it('keeps markdown as written, headings included', async () => {
    const markdown = '# Shipping\n\nWe ship **worldwide**.\n\n## Returns\n\n- 30 days\n';

    const result = await extractText(encode(markdown), 'text/markdown');

    expect(result).toEqual({ ok: true, text: markdown, pageOffsets: [] });
  });

  it('strips null bytes and a byte-order mark', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode('a\0b\0c')]);

    expect(await extractText(bytes, 'text/plain')).toEqual({
      ok: true,
      text: 'abc',
      pageOffsets: [],
    });
  });

  it('rejects bytes that are not valid UTF-8', async () => {
    const latin1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x6f, 0x6b]);

    expect(await extractText(latin1, 'text/plain')).toEqual({ ok: false, reason: 'invalid_utf8' });
  });

  it('rejects a document with nothing but whitespace and null bytes', async () => {
    expect(await extractText(encode(' \n\t\0 \r\n'), 'text/markdown')).toEqual({
      ok: false,
      reason: 'empty_document',
    });
  });

  it('accepts JSON that parses and rejects JSON that does not', async () => {
    const valid = await extractText(
      encode('{"faq":[{"q":"Hours?","a":"9-5"}]}'),
      'application/json',
    );
    const invalid = await extractText(encode('{"faq": [}'), 'application/json');

    expect(valid).toEqual({
      ok: true,
      text: '{"faq":[{"q":"Hours?","a":"9-5"}]}',
      pageOffsets: [],
    });
    expect(invalid).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('does not treat text that only mentions JSON syntax as JSON when declared as text', async () => {
    expect(await extractText(encode('{"faq": [}'), 'text/plain')).toMatchObject({ ok: true });
  });

  it('rejects a PDF declared as a text type', async () => {
    const pdf = buildPdf([{ lines: ['This is a real PDF with a text layer.'] }]);

    expect(await extractText(pdf, 'text/plain')).toEqual({ ok: false, reason: 'type_mismatch' });
    expect(await extractText(pdf, 'text/markdown')).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('rejects anything larger than the upload limit before reading it', async () => {
    const tooBig = new Uint8Array(MAX_DOCUMENT_BYTES + 1).fill(0x61);
    const atLimit = new Uint8Array(MAX_DOCUMENT_BYTES).fill(0x61);

    expect(await extractText(tooBig, 'text/plain')).toEqual({ ok: false, reason: 'too_large' });
    expect(await extractText(atLimit, 'text/plain')).toMatchObject({ ok: true });
  });
});

describe('extractText: PDF documents', () => {
  it('extracts the text layer, one block per page, and records where each page starts', async () => {
    const pdf = buildPdf([
      { lines: ['Refund policy', 'Refunds are issued within 5 business days.'] },
      { lines: ['Shipping (international)', 'Orders ship from Lahore.'] },
    ]);

    const result = await extractText(pdf, 'application/pdf');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pages = result.text.split('\n\n');
    expect(pages).toHaveLength(2);
    // Each drawn line ends with a line break, and each page is trimmed.
    expect(pages[0]).toBe('Refund policy\nRefunds are issued within 5 business days.');
    expect(pages[1]).toBe('Shipping (international)\nOrders ship from Lahore.');
    expect(result.pageOffsets).toEqual([0, pages[0]!.length + 2]);
    expect(result.text.slice(result.pageOffsets[1])).toBe(pages[1]);
  });

  it('fails a PDF with no text layer with no_text_layer', async () => {
    const pdf = buildPdf([VECTOR_ONLY_PAGE, VECTOR_ONLY_PAGE]);

    expect(await extractText(pdf, 'application/pdf')).toEqual({
      ok: false,
      reason: 'no_text_layer',
    });
  });

  it('judges the text layer per page, not by the document total', async () => {
    // 15 visible characters in all, but 5 a page: a scan with a page footer.
    const pdf = buildPdf(
      ['p. 001', 'p. 002', 'p. 003'].map((footer) => ({
        lines: [footer],
        drawing: VECTOR_DRAWING,
      })),
    );

    expect(await extractText(pdf, 'application/pdf')).toEqual({
      ok: false,
      reason: 'no_text_layer',
    });
  });

  it('fails a PDF whose pages carry almost no text, such as a scan with page numbers', async () => {
    const pdf = buildPdf([
      { lines: ['1'], drawing: VECTOR_DRAWING },
      { lines: ['2'], drawing: VECTOR_DRAWING },
    ]);

    expect(await extractText(pdf, 'application/pdf')).toEqual({
      ok: false,
      reason: 'no_text_layer',
    });
  });

  it('accepts a mostly text PDF that has one blank page', async () => {
    const pdf = buildPdf([
      { lines: ['Warranty terms cover parts and labour for two years.'] },
      VECTOR_ONLY_PAGE,
    ]);

    expect(await extractText(pdf, 'application/pdf')).toMatchObject({ ok: true });
  });

  it('rejects text declared as a PDF', async () => {
    expect(await extractText(encode('Just some text, not a PDF.'), 'application/pdf')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
  });

  it('requires the full %PDF- signature at the very start', async () => {
    const pdf = buildPdf([{ lines: ['Valid content for the signature test.'] }]);
    const shifted = new Uint8Array([0x20, ...pdf]);
    const truncated = encode('%PDF');

    expect(await extractText(shifted, 'application/pdf')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
    expect(await extractText(truncated, 'application/pdf')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
  });

  it('fails a password-protected PDF with encrypted_pdf', async () => {
    const pdf = buildPdf([{ lines: ['Confidential pricing for partners only.'] }], {
      passwordProtected: true,
    });

    expect(await extractText(pdf, 'application/pdf')).toEqual({
      ok: false,
      reason: 'encrypted_pdf',
    });
  });

  it('fails a file that starts like a PDF but is not one with unreadable_pdf', async () => {
    expect(
      await extractText(encode('%PDF-1.7\nthis is not a PDF body'), 'application/pdf'),
    ).toEqual({
      ok: false,
      reason: 'unreadable_pdf',
    });
  });

  it(`fails a PDF with more than ${String(MAX_PDF_PAGES)} pages with too_many_pages`, async () => {
    const page = { lines: ['A page with enough text on it.'] };
    const atLimit = buildPdf(Array.from({ length: MAX_PDF_PAGES }, () => page));
    const overLimit = buildPdf(Array.from({ length: MAX_PDF_PAGES + 1 }, () => page));

    expect(await extractText(overLimit, 'application/pdf')).toEqual({
      ok: false,
      reason: 'too_many_pages',
    });
    expect(await extractText(atLimit, 'application/pdf')).toMatchObject({ ok: true });
  }, 60_000);

  it('does not change the bytes it was given', async () => {
    const pdf = buildPdf([{ lines: ['Bytes must be left as they were.'] }]);
    const copy = pdf.slice();

    await extractText(pdf, 'application/pdf');

    expect(pdf).toEqual(copy);
  });
});
