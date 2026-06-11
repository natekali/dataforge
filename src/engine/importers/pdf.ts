/**
 * PDF text extraction built on unpdf (serverless pdf.js build).
 *
 * Runtime-environment agnostic: safe in Web Workers and Node. unpdf is
 * imported dynamically so the pdf.js payload is only fetched when a PDF is
 * actually imported.
 */

import { parseTextDocument } from './textdoc';

/**
 * Extracts the full text of a PDF document, pages merged in order.
 *
 * @param data - The raw PDF bytes.
 * @returns Normalized document text (LF line endings, outer whitespace trimmed).
 */
export async function parsePdf(data: ArrayBuffer): Promise<string> {
  const { extractText } = await import('unpdf');

  // pdf.js takes ownership of (and may detach/transfer) the buffer it is
  // given — hand it a private copy so the caller's ArrayBuffer stays usable.
  const bytes = new Uint8Array(data.slice(0));

  const { text } = await extractText(bytes, { mergePages: true });
  return parseTextDocument(text);
}
