import { describe, expect, it } from 'vitest';
import { CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS, chunkText, type Chunk } from '../src/index.ts';

/** Deterministic filler: numbered sentences of 40 to 70 characters. */
function sentences(count: number, prefix = 'Item'): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `${prefix} ${String(index + 1)} ships in ${String((index % 7) + 2)} business days${'.'.padStart((index % 4) * 8 + 1, ' and more')}`,
  ).join(' ');
}

function paragraph(index: number, length: number): string {
  const words = `Paragraph ${String(index)} explains one policy in plain words`;
  return `${words} ${'x'.repeat(Math.max(0, length - words.length - 2))}.`;
}

/** Checks the properties every chunking must have. */
function expectWellFormed(
  source: string,
  chunks: readonly Chunk[],
  { coverage = true }: { coverage?: boolean } = {},
): void {
  for (const [position, chunk] of chunks.entries()) {
    expect(chunk.index).toBe(position);
    expect(chunk.text).toBe(source.slice(chunk.start, chunk.end));
    expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS);
    expect(chunk.text).toBe(chunk.text.trim());
    expect(chunk.text.length).toBeGreaterThan(0);
  }
  // Each chunk reaches further than the one before: none merely repeats the previous overlap.
  for (const [index, next] of chunks.slice(1).entries()) {
    expect(next.start).toBeGreaterThan(chunks[index]!.start);
    expect(next.end).toBeGreaterThan(chunks[index]!.end);
  }
  if (!coverage) {
    return;
  }
  // Every non-whitespace character of the source is in at least one chunk.
  const covered = new Uint8Array(source.length);
  for (const chunk of chunks) covered.fill(1, chunk.start, chunk.end);
  // Offsets count UTF-16 code units, like string indexes.
  const uncovered = Array.from({ length: source.length }, (_, offset) => offset).filter(
    (offset) => covered[offset] === 0 && /\S/.test(source[offset]!),
  );
  expect(uncovered, 'offsets in no chunk').toEqual([]);
}

function overlaps(chunks: readonly Chunk[]): number[] {
  return chunks.slice(1).map((chunk, index) => chunks[index]!.end - chunk.start);
}

describe('chunkText: the recursive splitter', () => {
  it('records the size and overlap it was designed with', () => {
    expect(CHUNK_TARGET_CHARS).toBe(800);
    expect(CHUNK_OVERLAP_CHARS).toBe(100);
  });

  it('produces no chunks for empty or whitespace-only input', () => {
    expect(chunkText('', 'text/plain')).toEqual([]);
    expect(chunkText(' \n\n\t  \n', 'text/plain')).toEqual([]);
    expect(chunkText('', 'text/markdown')).toEqual([]);
  });

  it('produces one chunk for a short input, with its offsets', () => {
    const source = '  Refunds are issued within 5 business days.\n';

    expect(chunkText(source, 'text/plain')).toEqual([
      {
        index: 0,
        start: 2,
        end: 44,
        text: 'Refunds are issued within 5 business days.',
        headingPath: [],
        embeddingText: 'Refunds are issued within 5 business days.',
      },
    ]);
  });

  it('keeps an input of exactly the target size in one chunk', () => {
    const source = 'a'.repeat(CHUNK_TARGET_CHARS);

    expect(chunkText(source, 'text/plain')).toHaveLength(1);
    expect(chunkText(`${source}a`, 'text/plain')).toHaveLength(2);
  });

  it('splits a long input into chunks within the size limit, overlapping by at most the overlap', () => {
    const source = sentences(120);

    const chunks = chunkText(source, 'text/plain');

    expect(chunks.length).toBeGreaterThan(5);
    expectWellFormed(source, chunks);
    for (const overlap of overlaps(chunks)) {
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBeLessThanOrEqual(CHUNK_OVERLAP_CHARS);
    }
  });

  it('always produces the same chunks for the same input', () => {
    const source = `${sentences(80)}\n\n${paragraph(1, 500)}\n\n${'z'.repeat(2000)}`;

    const first = chunkText(source, 'text/plain');
    const second = chunkText(source, 'text/plain');

    expect(second).toEqual(first);
    expect(first.map((chunk) => [chunk.start, chunk.end])).toMatchSnapshot();
  });

  it('cuts at paragraph breaks before anything finer', () => {
    const paragraphs = [paragraph(1, 500), paragraph(2, 500), paragraph(3, 500)];
    const source = paragraphs.join('\n\n');

    const chunks = chunkText(source, 'text/plain');

    // Two 500-character paragraphs do not fit in 800, so each paragraph is its own chunk.
    expect(chunks.map((chunk) => chunk.text)).toEqual(paragraphs);
  });

  it('packs short paragraphs together up to the target size', () => {
    const paragraphs = Array.from({ length: 6 }, (_, index) => paragraph(index, 200));
    const source = paragraphs.join('\n\n');

    const chunks = chunkText(source, 'text/plain');

    expect(chunks[0]!.text).toBe(paragraphs.slice(0, 3).join('\n\n'));
    expectWellFormed(source, chunks);
  });

  it('keeps a paragraph of short lines whole rather than mixing it with the next', () => {
    // Two paragraphs of ten 50-character lines each.
    const paragraphs = [1, 2].map((index) =>
      Array.from(
        { length: 10 },
        (_, line) => `Paragraph ${String(index)}, line ${String(line)}: ${'w'.repeat(28)}`,
      ).join('\n'),
    );
    const source = paragraphs.join('\n\n');

    expect(chunkText(source, 'text/plain').map((chunk) => chunk.text)).toEqual(paragraphs);
  });

  it('starts the next chunk past the overlap when the overlap and the next piece do not fit', () => {
    // 700 + 90 fill one chunk. The 90 would be the overlap, but 90 + 750 exceeds the target.
    const source = [paragraph(1, 700), paragraph(2, 90), paragraph(3, 750)].join('\n\n');

    const chunks = chunkText(source, 'text/plain');

    expectWellFormed(source, chunks);
    expect(chunks).toHaveLength(2);
  });

  it('cuts a long paragraph at sentence ends', () => {
    const source = sentences(40);

    const chunks = chunkText(source, 'text/plain');

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text).toMatch(/\.$/);
    }
  });

  it('cuts a long sentence at spaces', () => {
    const source = Array.from({ length: 300 }, (_, index) => `word${String(index)}`).join(' ');

    const chunks = chunkText(source, 'text/plain');

    expectWellFormed(source, chunks);
    for (const chunk of chunks) {
      expect(chunk.text).toMatch(/^word\d+(?: word\d+)*$/);
    }
  });

  it('cuts a run with no separators at fixed points, and still overlaps', () => {
    const source = 'x'.repeat(2500);

    const chunks = chunkText(source, 'text/plain');

    expectWellFormed(source, chunks);
    expect(chunks.map((chunk) => chunk.text.length)).toEqual([800, 800, 800, 400]);
    expect(overlaps(chunks)).toEqual([100, 100, 100]);
  });

  it('never cuts between the two halves of a surrogate pair', () => {
    const source = `a${'😀'.repeat(1200)}`;

    const chunks = chunkText(source, 'text/plain');

    expectWellFormed(source, chunks);
    for (const chunk of chunks) {
      expect(chunk.text.isWellFormed()).toBe(true);
    }
  });

  it('ignores headings in text that is not markdown', () => {
    const source = '# Not a heading here\n\nPlain text body.';

    expect(chunkText(source, 'text/plain')).toMatchObject([{ text: source, headingPath: [] }]);
  });
});

describe('chunkText: markdown', () => {
  const policy = [
    'Welcome to the help centre.',
    '',
    '# Refunds',
    '',
    '## Timelines',
    '',
    'Refunds are issued within 5 business days.',
    '',
    '## Exceptions ##',
    '',
    'Gift cards are not refundable.',
    '',
    '# Shipping',
    '',
    'We ship to 40 countries.',
  ].join('\n');

  it('starts a chunk at every heading and records the heading path', () => {
    const chunks = chunkText(policy, 'text/markdown');

    expect(chunks.map((chunk) => [chunk.headingPath, chunk.text])).toEqual([
      [[], 'Welcome to the help centre.'],
      [['Refunds', 'Timelines'], '## Timelines\n\nRefunds are issued within 5 business days.'],
      [['Refunds', 'Exceptions'], '## Exceptions ##\n\nGift cards are not refundable.'],
      [['Shipping'], '# Shipping\n\nWe ship to 40 countries.'],
    ]);
    // "# Refunds" has nothing under it before "## Timelines", so it is only in the paths.
    expectWellFormed(policy, chunks, { coverage: false });
  });

  it('prepends the heading path to the embedded text only', () => {
    const timelines = chunkText(policy, 'text/markdown')[1]!;

    expect(timelines.text).not.toContain('Refunds >');
    expect(timelines.embeddingText).toBe(`Refunds > Timelines\n\n${timelines.text}`);
  });

  it('embeds text with no heading above it as it is', () => {
    const preamble = chunkText(policy, 'text/markdown')[0]!;

    expect(preamble.embeddingText).toBe(preamble.text);
  });

  it('pops back up the path when a shallower heading follows a deeper one', () => {
    const source = '# A\n\n## B\n\n### C\n\nc body\n\n## D\n\nd body\n\n# E\n\ne body';

    expect(chunkText(source, 'text/markdown').map((chunk) => chunk.headingPath)).toEqual([
      ['A', 'B', 'C'],
      ['A', 'D'],
      ['E'],
    ]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const source = [
      '# Install',
      '',
      '```sh',
      '# this is a shell comment',
      '~~~',
      '# a tilde line does not close a backtick fence',
      'npm install',
      '```',
      '',
      '~~~',
      '## also code',
      '~~~',
      '',
      'Done.',
    ].join('\n');

    const chunks = chunkText(source, 'text/markdown');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ headingPath: ['Install'], text: source });
  });

  it('only treats # followed by a space, at most three spaces in, as a heading', () => {
    const source = '# Real\n\n#hashtag\n    # indented code\n\nbody';

    expect(chunkText(source, 'text/markdown')).toMatchObject([
      { headingPath: ['Real'], text: source },
    ]);
    expect(chunkText('   # Three spaces in\n\nbody', 'text/markdown')).toMatchObject([
      { headingPath: ['Three spaces in'] },
    ]);
  });

  it('splits a long section with the recursive splitter and keeps its path on every piece', () => {
    const source = `# Intro\n\nShort.\n\n## Warranty\n\n${sentences(60, 'Clause')}`;

    const chunks = chunkText(source, 'text/markdown');
    const warranty = chunks.filter((chunk) => chunk.headingPath.at(-1) === 'Warranty');

    expect(warranty.length).toBeGreaterThan(1);
    for (const chunk of warranty) {
      expect(chunk.headingPath).toEqual(['Intro', 'Warranty']);
    }
    expectWellFormed(source, chunks);
    // Overlap never crosses a heading: the first Warranty chunk starts at its heading.
    expect(warranty[0]!.text.startsWith('## Warranty')).toBe(true);
  });

  it('always produces the same chunks for the same markdown', () => {
    const source = `${policy}\n\n## Long\n\n${sentences(50)}`;

    expect(chunkText(source, 'text/markdown')).toEqual(chunkText(source, 'text/markdown'));
  });
});
