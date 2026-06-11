/**
 * DOCX text extraction built on mammoth.
 *
 * Runtime-environment agnostic: safe in Web Workers and Node. mammoth is
 * imported dynamically so it only loads when a .docx file is actually
 * imported.
 */

import { parseTextDocument } from './textdoc';

/** The slice of mammoth's API this module relies on. */
interface MammothLike {
  extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}

/**
 * Extracts the raw text content of a Word (.docx) document.
 *
 * @param data - The raw .docx bytes (a ZIP container).
 * @returns Normalized document text (LF line endings, outer whitespace trimmed).
 */
export async function parseDocx(data: ArrayBuffer): Promise<string> {
  // mammoth is published as a CommonJS `export =` module; depending on the
  // loader the namespace may or may not carry a `default` binding.
  const mod = (await import('mammoth')) as unknown as Partial<MammothLike> & {
    default?: MammothLike;
  };
  const mammoth: MammothLike =
    mod.default ?? (mod as MammothLike);

  // mammoth's browser build reads `arrayBuffer` while its Node build reads
  // `buffer` (forwarded to JSZip, which accepts ArrayBuffers). Supplying both
  // keys keeps this parser working in workers and in vitest alike.
  const input = { arrayBuffer: data, buffer: data } as unknown as {
    arrayBuffer: ArrayBuffer;
  };

  const result = await mammoth.extractRawText(input);
  return parseTextDocument(result.value);
}
