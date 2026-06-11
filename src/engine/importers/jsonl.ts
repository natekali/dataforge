/**
 * JSONL / NDJSON and plain JSON parsers.
 *
 * Runtime-environment agnostic: safe in Web Workers and Node.
 */

import { stripBom } from './textdoc';

/** Maximum number of per-line errors collected before further bad lines are skipped silently. */
export const MAX_LINE_ERRORS = 20;

/** Result of parsing a line-oriented rows file. */
export interface JsonlParseResult {
  /** Successfully parsed rows, in file order. */
  rows: unknown[];
  /** Per-line parse errors, capped at {@link MAX_LINE_ERRORS}. */
  errors: string[];
}

/**
 * Parses JSONL / NDJSON text into rows.
 *
 * Resilient by design: tolerates a leading BOM, CRLF line endings, and blank
 * lines. Lines that fail to parse are skipped; the first
 * {@link MAX_LINE_ERRORS} failures are reported with 1-based line numbers.
 *
 * @param text - Raw decoded JSONL content.
 * @returns Parsed rows plus any per-line errors.
 */
export function parseJsonl(text: string): JsonlParseResult {
  const rows: unknown[] = [];
  const errors: string[] = [];

  const lines = stripBom(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    // trim() removes the \r left behind by CRLF line endings.
    const line = (lines[i] ?? '').trim();
    if (!line) continue;

    try {
      rows.push(JSON.parse(line) as unknown);
    } catch (err) {
      if (errors.length < MAX_LINE_ERRORS) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`line ${i + 1}: ${message}`);
      }
    }
  }

  return { rows, errors };
}

/**
 * Parses a whole-file JSON document into rows.
 *
 * Accepted shapes:
 *  - a JSON array            → its elements,
 *  - `{ "data": [...] }`     → the wrapped array (HuggingFace-style export),
 *  - any other single object → a one-element array.
 *
 * @param text - Raw decoded JSON content.
 * @returns The extracted rows.
 * @throws {SyntaxError} When the text is not valid JSON.
 * @throws {Error} When the JSON root is a scalar (string/number/boolean/null).
 */
export function parseJson(text: string): unknown[] {
  const value: unknown = JSON.parse(stripBom(text));

  if (Array.isArray(value)) return value;

  if (value !== null && typeof value === 'object') {
    const wrapped = (value as Record<string, unknown>)['data'];
    if (Array.isArray(wrapped)) return wrapped;
    return [value];
  }

  throw new Error('JSON root must be an array or an object, got a scalar value');
}
