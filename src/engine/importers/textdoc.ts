/**
 * Plain-text / markdown document utilities.
 *
 * Runtime-environment agnostic: safe in Web Workers and Node. Provides the
 * `.md`/`.txt` document parser plus two text-mining helpers used by the
 * import pipeline:
 *
 *  - {@link extractQAPairs} — pull `## Q` / `## A` (and `**Q:**` / `**A:**`)
 *    style question/answer pairs out of markdown.
 *  - {@link chunkText}      — split long documents into overlapping chunks,
 *    preferring paragraph and then sentence boundaries.
 */

/** Default maximum characters per chunk produced by {@link chunkText}. */
export const DEFAULT_CHUNK_MAX_CHARS = 4000;

/** Default overlap (characters) between consecutive chunks. */
export const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Strips a leading UTF-8 byte-order mark from a decoded string, if present.
 *
 * @param text - Decoded text that may start with U+FEFF.
 * @returns The text without a leading BOM.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Normalizes a raw text or markdown document for storage: strips a BOM,
 * converts CRLF / lone CR line endings to LF, and trims outer whitespace.
 *
 * @param text - Raw decoded file contents.
 * @returns Normalized document text.
 */
export function parseTextDocument(text: string): string {
  return stripBom(text).replace(/\r\n?/g, '\n').trim();
}

/**
 * Marker patterns for Q/A extraction. Each regex either captures the inline
 * text following the marker (group 1) or matches a bare marker line.
 *
 * Recognized forms (case-insensitive, optional numbering like "Q1"/"Question 2"):
 *  - Headings:   `## Q: text`, `### Question`, `## Q1)` …
 *  - Bold:       `**Q:** text`, `**Question**: text`
 *  - Bare lines: `Q: text`, `Answer: text` (colon required to avoid false hits)
 */
function buildMarkerPatterns(letter: string, word: string): RegExp[] {
  return [
    // Heading with single letter — requires punctuation or end-of-line so
    // headings like "## A guide" are not mistaken for answers.
    new RegExp(`^#{1,6}\\s*${letter}\\s*\\d*\\s*[:.)]\\s*(.*)$`, 'i'),
    new RegExp(`^#{1,6}\\s*${letter}\\s*\\d*\\s*$`, 'i'),
    // Heading with full word ("## Question 2: …", "### Answer").
    new RegExp(`^#{1,6}\\s*${word}\\b\\s*\\d*\\s*[:.)]?\\s*(.*)$`, 'i'),
    // Bold markers — colon required ("**Q:** …", "**Answer**: …").
    new RegExp(`^\\*\\*\\s*${letter}\\s*\\d*\\s*(?::\\s*\\*\\*|\\*\\*\\s*:)\\s*(.*)$`, 'i'),
    new RegExp(`^\\*\\*\\s*${word}\\s*\\d*\\s*(?::\\s*\\*\\*|\\*\\*\\s*:)\\s*(.*)$`, 'i'),
    // Bare line markers — colon required ("Q: …", "Answer: …").
    new RegExp(`^${letter}\\s*\\d*\\s*:\\s*(.*)$`, 'i'),
    new RegExp(`^${word}\\s*\\d*\\s*:\\s*(.*)$`, 'i'),
  ];
}

const QUESTION_MARKERS = buildMarkerPatterns('q', 'question');
const ANSWER_MARKERS = buildMarkerPatterns('a', 'answer');

/**
 * Tests a trimmed line against a marker pattern set.
 *
 * @returns The inline text following the marker (possibly empty), or `null`
 *          when the line is not a marker.
 */
function matchMarker(line: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match) return (match[1] ?? '').trim();
  }
  return null;
}

/**
 * Extracts question/answer pairs from a markdown document.
 *
 * Walks the document line by line: a question marker opens a new pair, an
 * answer marker switches to collecting the answer, and plain lines accumulate
 * into whichever section is open. Pairs are emitted only when both sides are
 * non-empty. Returns rows shaped `{ instruction, output }` so they feed
 * directly into the row-based schema detection pipeline.
 *
 * @param markdown - Raw markdown text.
 * @returns Array of `{ instruction: string; output: string }` rows
 *          (empty when no Q/A structure is found).
 */
export function extractQAPairs(markdown: string): unknown[] {
  const text = parseTextDocument(markdown);
  const pairs: { instruction: string; output: string }[] = [];

  let question: string[] | null = null;
  let answer: string[] | null = null;

  const flush = (): void => {
    if (question && answer) {
      const instruction = question.join('\n').trim();
      const output = answer.join('\n').trim();
      if (instruction && output) pairs.push({ instruction, output });
    }
    question = null;
    answer = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    const questionText = matchMarker(line, QUESTION_MARKERS);
    if (questionText !== null) {
      flush();
      question = questionText ? [questionText] : [];
      continue;
    }

    const answerText = matchMarker(line, ANSWER_MARKERS);
    if (answerText !== null) {
      // An answer marker without an open question is ignored.
      if (question) answer = answerText ? [answerText] : [];
      continue;
    }

    if (answer) answer.push(rawLine);
    else if (question) question.push(rawLine);
  }
  flush();

  return pairs;
}

/** Options for {@link chunkText}. */
export interface ChunkTextOptions {
  /** Maximum characters per chunk (default {@link DEFAULT_CHUNK_MAX_CHARS}). */
  maxChars?: number;
  /** Characters of overlap between consecutive chunks (default {@link DEFAULT_CHUNK_OVERLAP}). */
  overlap?: number;
}

/** Sentence-final sequences considered acceptable break points. */
const SENTENCE_BREAKS = ['. ', '.\n', '! ', '? '];

/**
 * Finds the last sentence break whose punctuation mark ends at or before
 * `end` (exclusive of the trailing separator character).
 */
function lastSentenceBreak(text: string, end: number): number {
  let best = -1;
  for (const brk of SENTENCE_BREAKS) {
    const idx = text.lastIndexOf(brk, end - brk.length);
    if (idx > best) best = idx;
  }
  return best;
}

/**
 * Splits text into overlapping chunks of at most `maxChars` characters.
 *
 * Break-point preference, mirroring the original Python importer:
 *  1. the last paragraph boundary (`\n\n`) in the window,
 *  2. otherwise the last sentence boundary (`. `, `.\n`, `! `, `? `),
 *  3. otherwise a hard cut at `maxChars`.
 *
 * A boundary is only used when it lies past the midpoint of the window so
 * chunks never collapse to trivially small fragments. Each chunk after the
 * first starts `overlap` characters before the previous chunk's end.
 *
 * @param text - The document text to split.
 * @param opts - Optional `maxChars` / `overlap` overrides (defaults 4000/200).
 * @returns Trimmed, non-empty chunks in document order. Empty input yields `[]`.
 */
export function chunkText(text: string, opts: ChunkTextOptions = {}): string[] {
  const maxChars = Math.max(1, Math.floor(opts.maxChars ?? DEFAULT_CHUNK_MAX_CHARS));
  const overlap = Math.min(
    Math.max(0, Math.floor(opts.overlap ?? DEFAULT_CHUNK_OVERLAP)),
    maxChars - 1,
  );

  const trimmed = text.trim();
  if (!trimmed) return [];
  if (text.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      const minBreak = start + Math.floor(maxChars / 2);
      // Prefer a paragraph boundary fully inside the window…
      const paragraphBreak = text.lastIndexOf('\n\n', end - 2);
      if (paragraphBreak > minBreak) {
        end = paragraphBreak;
      } else {
        // …then a sentence boundary; keep the punctuation in the chunk.
        const sentenceBreak = lastSentenceBreak(text, end);
        if (sentenceBreak > minBreak) end = sentenceBreak + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= text.length) break;
    // Guarantee forward progress even with extreme overlap settings.
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
