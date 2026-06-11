/**
 * CSV / TSV parser built on papaparse.
 *
 * Runtime-environment agnostic: safe in Web Workers and Node.
 */

import { parse } from 'papaparse';
import { stripBom } from './textdoc';

/** Maximum number of parser errors surfaced to the caller. */
const MAX_CSV_ERRORS = 20;

/** Result of parsing a delimited text file. */
export interface CsvParseResult {
  /** One object per data row, keyed by (trimmed) header names. */
  rows: unknown[];
  /** Parser diagnostics (ragged rows, quote issues …), capped at 20. */
  errors: string[];
}

/**
 * Attempts to revive JSON-encoded cells (e.g. a `messages` column containing
 * `[{"role":"user",...}]`). Non-JSON strings are left untouched.
 */
function reviveJsonCells(row: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = reviveCell(value);
  }
  return out;
}

/** Parses a single cell value as JSON when it looks like an object or array. */
function reviveCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const objectish =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!objectish) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

/**
 * Parses CSV/TSV text into row objects.
 *
 * - First row is treated as the header (header names are trimmed).
 * - Delimiter is auto-detected among `,` `\t` `;` `|`.
 * - Empty / whitespace-only lines are skipped.
 * - Quoted fields may contain newlines (RFC 4180).
 * - Cells that look like JSON objects/arrays are parsed, so columns holding
 *   serialized chat messages survive the round trip.
 *
 * @param text - Raw decoded CSV/TSV content.
 * @returns Parsed rows plus any parser diagnostics.
 */
export function parseCsv(text: string): CsvParseResult {
  const result = parse<Record<string, string>>(stripBom(text), {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', '\t', ';', '|'],
    transformHeader: (header: string) => header.trim(),
  });

  const rows = result.data.map(reviveJsonCells);
  const errors = result.errors
    .slice(0, MAX_CSV_ERRORS)
    .map((e) => (e.row !== undefined ? `row ${e.row}: ${e.message}` : e.message));

  return { rows, errors };
}
