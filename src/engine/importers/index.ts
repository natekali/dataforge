/**
 * File-import router: maps an uploaded file (name + bytes) to either tabular
 * rows or a plain-text document, dispatching to the per-format parsers.
 *
 * Runtime-environment agnostic: safe in Web Workers and Node. The worker
 * wrapper that marshals files across the postMessage boundary lives in a
 * separate module — everything here is a pure function of its inputs.
 */

import { parseJsonl, parseJson } from './jsonl';
import { parseCsv } from './csv';
import { parseParquet } from './parquet';
import { parseXlsx } from './xlsx';
import { parsePdf } from './pdf';
import { parseDocx } from './docx';
import { parseTextDocument } from './textdoc';

// Re-export the individual parsers so consumers (worker wrapper, import
// pipeline) have a single entry point.
export { parseJsonl, parseJson, MAX_LINE_ERRORS } from './jsonl';
export type { JsonlParseResult } from './jsonl';
export { parseCsv } from './csv';
export type { CsvParseResult } from './csv';
export { parseParquet } from './parquet';
export { parseXlsx } from './xlsx';
export { parsePdf } from './pdf';
export { parseDocx } from './docx';
export {
  parseTextDocument,
  stripBom,
  extractQAPairs,
  chunkText,
  DEFAULT_CHUNK_MAX_CHARS,
  DEFAULT_CHUNK_OVERLAP,
} from './textdoc';
export type { ChunkTextOptions } from './textdoc';

/** Input accepted by {@link parseFile}. */
export interface ParseFileInput {
  /** Original file name (used for extension routing and document titles). */
  name: string;
  /** Raw file bytes. */
  data: ArrayBuffer;
}

/**
 * Result of parsing a file:
 *  - `rows`     — tabular data (JSONL/JSON/CSV/Parquet/XLSX); schema detection
 *                 happens downstream. `errors` carries non-fatal per-row
 *                 diagnostics when present.
 *  - `document` — unstructured text (PDF/DOCX/MD/TXT) plus a title derived
 *                 from the file name.
 */
export type ParsedFile =
  | { kind: 'rows'; rows: unknown[]; errors?: string[] }
  | { kind: 'document'; text: string; title: string };

/** Internal format token produced by {@link detectFormat}. */
export type ImportFormat =
  | 'jsonl'
  | 'json'
  | 'csv'
  | 'parquet'
  | 'xlsx'
  | 'pdf'
  | 'docx'
  | 'text';

const EXTENSION_FORMATS: Record<string, ImportFormat> = {
  jsonl: 'jsonl',
  ndjson: 'jsonl',
  json: 'json',
  csv: 'csv',
  tsv: 'csv',
  parquet: 'parquet',
  pq: 'parquet',
  xlsx: 'xlsx',
  xls: 'xlsx',
  pdf: 'pdf',
  docx: 'docx',
  md: 'text',
  markdown: 'text',
  txt: 'text',
};

/** Returns the lower-cased extension of a file name, without the dot. */
function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Derives a document title from a file name (basename without extension). */
function titleFromName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Decodes file bytes as UTF-8 (lenient, BOM removed by the decoder). */
function decodeText(data: ArrayBuffer): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

/** Checks whether `bytes` starts with the given ASCII prefix. */
function startsWithBytes(bytes: Uint8Array, prefix: string): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

/** Decodes a byte window as latin-1 for cheap ASCII substring sniffing. */
function latin1Window(data: ArrayBuffer, start: number, length: number): string {
  const from = Math.max(0, Math.min(start, data.byteLength));
  const len = Math.min(length, data.byteLength - from);
  return new TextDecoder('latin1').decode(new Uint8Array(data, from, len));
}

/**
 * Detects the import format of a file from its extension, falling back to
 * content sniffing (magic bytes, then JSON/JSONL heuristics) for unknown
 * extensions. Anything unrecognized is treated as plain text.
 *
 * @param name - Original file name.
 * @param data - Raw file bytes.
 * @returns The format token used by {@link parseFile} for dispatch.
 */
export function detectFormat(name: string, data: ArrayBuffer): ImportFormat {
  const byExtension = EXTENSION_FORMATS[extensionOf(name)];
  if (byExtension) return byExtension;

  const head = new Uint8Array(data, 0, Math.min(8, data.byteLength));

  if (startsWithBytes(head, '%PDF')) return 'pdf';
  if (startsWithBytes(head, 'PAR1')) return 'parquet';

  if (startsWithBytes(head, 'PK\x03\x04')) {
    // DOCX and XLSX are both ZIP containers; entry names appear in the local
    // file headers (start) and the central directory (end).
    const window = latin1Window(data, 0, 4096) + latin1Window(data, data.byteLength - 4096, 4096);
    if (window.includes('word/')) return 'docx';
    if (window.includes('xl/')) return 'xlsx';
  }

  const text = decodeText(data).trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const jsonlish = lines.length > 1 && lines.slice(0, 5).every((l) => l.startsWith('{'));
    return jsonlish ? 'jsonl' : 'json';
  }

  return 'text';
}

/**
 * Parses an uploaded file into rows or a document, routed by file extension
 * (with content sniffing as a fallback for unknown extensions).
 *
 * Routing:
 *  - `.jsonl` / `.ndjson`        → JSONL rows (resilient line-by-line parse)
 *  - `.json`                     → array / `{data:[...]}` / single object rows
 *  - `.csv` / `.tsv`             → delimited rows (delimiter auto-detected)
 *  - `.parquet` / `.pq`          → parquet rows (all standard codecs)
 *  - `.xlsx` / `.xls`            → first-sheet rows
 *  - `.pdf`                      → extracted text document
 *  - `.docx`                     → extracted text document
 *  - `.md` / `.markdown` / `.txt` → normalized text document
 *
 * @param input - File name plus raw bytes.
 * @returns The parsed rows or document.
 * @throws When the bytes are not a valid instance of the routed format
 *         (e.g. corrupt parquet/xlsx, JSON with a scalar root).
 */
export async function parseFile(input: ParseFileInput): Promise<ParsedFile> {
  const { name, data } = input;

  switch (detectFormat(name, data)) {
    case 'jsonl': {
      const { rows, errors } = parseJsonl(decodeText(data));
      return errors.length ? { kind: 'rows', rows, errors } : { kind: 'rows', rows };
    }
    case 'json':
      return { kind: 'rows', rows: parseJson(decodeText(data)) };
    case 'csv': {
      const { rows, errors } = parseCsv(decodeText(data));
      return errors.length ? { kind: 'rows', rows, errors } : { kind: 'rows', rows };
    }
    case 'parquet':
      return { kind: 'rows', rows: await parseParquet(data) };
    case 'xlsx':
      return { kind: 'rows', rows: parseXlsx(data) };
    case 'pdf':
      return { kind: 'document', text: await parsePdf(data), title: titleFromName(name) };
    case 'docx':
      return { kind: 'document', text: await parseDocx(data), title: titleFromName(name) };
    case 'text':
      return {
        kind: 'document',
        text: parseTextDocument(decodeText(data)),
        title: titleFromName(name),
      };
  }
}
