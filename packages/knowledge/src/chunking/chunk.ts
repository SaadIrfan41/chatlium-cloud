// Deterministic chunking (build guide 2.4, amendments §12.5). The same text always gives the same
// chunks, and every chunk records where it sits in the source, so a citation can point back to it.
import type { DocumentContentType } from '@chatlium/contracts';

/**
 * The longest a chunk may be, in UTF-16 code units (JavaScript string length). About 150 to 200
 * English words: enough for one answerable passage, small enough that a few fit in a prompt.
 * Changing it changes every chunk, so it needs a test update.
 */
export const CHUNK_TARGET_CHARS = 800;

/**
 * The most text a chunk repeats from the end of the one before it, so a statement split across
 * a boundary is still whole in one of the two. Changing it needs a test update.
 */
export const CHUNK_OVERLAP_CHARS = 100;

export interface Chunk {
  /** Position in the document, from 0. */
  readonly index: number;
  /** Offsets into the source text: `text === source.slice(start, end)`. */
  readonly start: number;
  readonly end: number;
  /** The passage as written in the source. This is what is shown as evidence. */
  readonly text: string;
  /** For markdown, the headings above the chunk, outermost first. Empty otherwise. */
  readonly headingPath: readonly string[];
  /**
   * What is embedded and full-text indexed: the heading path, then the text. The path tells the
   * embedding what a short passage is about ("Refunds > Timelines: within 5 days").
   */
  readonly embeddingText: string;
}

interface Range {
  readonly start: number;
  readonly end: number;
}

/**
 * Where a range may be cut, coarsest first: paragraph breaks, line breaks, sentence ends, then
 * spaces. Each cut falls after the separator, so the pieces cover the range with no gaps.
 */
const SEPARATORS: readonly RegExp[] = [/\n[ \t]*\n\s*/g, /\n/g, /[.!?]['")\]]*\s+/g, /\s+/g];

function cutPoints(text: string, range: Range, separator: RegExp): number[] {
  const cuts: number[] = [];
  for (const match of text.slice(range.start, range.end).matchAll(separator)) {
    const cut = range.start + match.index + match[0].length;
    if (cut < range.end) {
      cuts.push(cut);
    }
  }
  return cuts;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Last resort for a run with no separator (a long URL, a hash): fixed-size pieces, never cutting
 * between the two halves of a surrogate pair. The pieces are overlap-sized so the merge step can
 * still overlap chunks.
 */
function hardSplit(text: string, range: Range): Range[] {
  const pieces: Range[] = [];
  let start = range.start;
  while (start < range.end) {
    let end = Math.min(start + CHUNK_OVERLAP_CHARS, range.end);
    if (end < range.end && isLowSurrogate(text.charCodeAt(end))) {
      end += 1;
    }
    pieces.push({ start, end });
    start = end;
  }
  return pieces;
}

/** Contiguous pieces covering `range`, each at most CHUNK_TARGET_CHARS long. */
function atoms(text: string, range: Range, level = 0): Range[] {
  if (range.end - range.start <= CHUNK_TARGET_CHARS) {
    return [range];
  }
  const separator = SEPARATORS[level];
  if (separator === undefined) {
    return hardSplit(text, range);
  }
  const cuts = cutPoints(text, range, separator);
  const pieces: Range[] = [];
  let start = range.start;
  for (const end of [...cuts, range.end]) {
    // A piece holds no separator of this level, so only finer levels can split it further.
    pieces.push(...atoms(text, { start, end }, level + 1));
    start = end;
  }
  return pieces;
}

/**
 * Greedily packs contiguous atoms into chunks of at most CHUNK_TARGET_CHARS. Each next chunk
 * starts with the trailing atoms of the previous one that fit in CHUNK_OVERLAP_CHARS.
 */
function pack(pieces: readonly Range[]): Range[] {
  const chunks: Range[] = [];
  const length = (from: number, to: number) => pieces[to]!.end - pieces[from]!.start;
  let first = 0;
  while (first < pieces.length) {
    let last = first;
    while (last + 1 < pieces.length && length(first, last + 1) <= CHUNK_TARGET_CHARS) {
      last += 1;
    }
    chunks.push({ start: pieces[first]!.start, end: pieces[last]!.end });
    if (last === pieces.length - 1) {
      break;
    }
    let next = last + 1;
    while (next - 1 > first && length(next - 1, last) <= CHUNK_OVERLAP_CHARS) {
      next -= 1;
    }
    // The next chunk must reach past this one, or it would repeat it.
    while (next <= last && length(next, last + 1) > CHUNK_TARGET_CHARS) {
      next += 1;
    }
    first = next;
  }
  return chunks;
}

/** Narrows a range to its non-whitespace content; undefined if there is none. */
function trimmed(text: string, range: Range): Range | undefined {
  let { start, end } = range;
  while (start < end && /\s/.test(text[start]!)) start += 1;
  while (end > start && /\s/.test(text[end - 1]!)) end -= 1;
  return start < end ? { start, end } : undefined;
}

interface Section extends Range {
  readonly headingPath: readonly string[];
  /** Where the text after the heading line begins. */
  readonly bodyStart: number;
}

const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Splits markdown at ATX headings (`# Title`). Headings inside fenced code blocks are ignored.
 * Setext headings (a line underlined with `===`) are not recognised and stay ordinary text.
 */
function markdownSections(text: string): Section[] {
  const sections: Section[] = [];
  const path: { level: number; title: string }[] = [];
  let current = { start: 0, bodyStart: 0, headingPath: [] as readonly string[] };
  let fence: string | undefined;
  let offset = 0;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]!;
      if (fence === undefined) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    const heading = fence === undefined ? ATX_HEADING.exec(line) : null;
    if (heading === null) {
      continue;
    }
    sections.push({ ...current, end: lineStart });
    const level = heading[1]!.length;
    while (path.length > 0 && path.at(-1)!.level >= level) {
      path.pop();
    }
    path.push({ level, title: heading[2]!.trim() });
    current = {
      start: lineStart,
      bodyStart: Math.min(offset, text.length),
      headingPath: path.map((entry) => entry.title).filter((title) => title.length > 0),
    };
  }
  sections.push({ ...current, end: text.length });
  // A heading with nothing under it (often a parent heading right before its first child) gives
  // no chunk: its title still appears in the child's heading path.
  return sections.filter((section) =>
    trimmed(text, { start: section.bodyStart, end: section.end }),
  );
}

function embeddingText(headingPath: readonly string[], text: string): string {
  return headingPath.length === 0 ? text : `${headingPath.join(' > ')}\n\n${text}`;
}

/**
 * Splits extracted text into chunks. Markdown starts a new chunk at every heading and records the
 * heading path; every other type is split by the recursive splitter alone. Long sections are split
 * by the same recursive splitter.
 */
export function chunkText(text: string, contentType: DocumentContentType): Chunk[] {
  const sections: readonly Section[] =
    contentType === 'text/markdown'
      ? markdownSections(text)
      : [{ start: 0, end: text.length, bodyStart: 0, headingPath: [] }];

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const content = trimmed(text, section);
    if (content === undefined) {
      continue;
    }
    for (const packed of pack(atoms(text, content))) {
      const range = trimmed(text, packed);
      if (range === undefined) {
        continue;
      }
      const passage = text.slice(range.start, range.end);
      chunks.push({
        index: chunks.length,
        start: range.start,
        end: range.end,
        text: passage,
        headingPath: section.headingPath,
        embeddingText: embeddingText(section.headingPath, passage),
      });
    }
  }
  return chunks;
}
