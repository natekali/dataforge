import { describe, it, expect } from 'vitest';
import { utils as xlsxUtils, write as xlsxWrite } from 'xlsx';
import { zipSync, strToU8 } from 'fflate';

import {
  parseFile,
  detectFormat,
  parseJsonl,
  parseJson,
  parseCsv,
  parseXlsx,
  parseParquet,
  parseDocx,
  parsePdf,
  parseTextDocument,
  extractQAPairs,
  chunkText,
  MAX_LINE_ERRORS,
  type ParsedFile,
} from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a tightly-sliced ArrayBuffer copy of a Uint8Array. */
function bufOf(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** Encodes text as a UTF-8 ArrayBuffer. */
function enc(text: string): ArrayBuffer {
  return bufOf(new TextEncoder().encode(text));
}

function expectRows(file: ParsedFile): { rows: unknown[]; errors?: string[] } {
  if (file.kind !== 'rows') throw new Error(`expected rows, got ${file.kind}`);
  return file;
}

function expectDocument(file: ParsedFile): { text: string; title: string } {
  if (file.kind !== 'document') throw new Error(`expected document, got ${file.kind}`);
  return file;
}

// ---------------------------------------------------------------------------
// JSONL
// ---------------------------------------------------------------------------

describe('parseJsonl', () => {
  it('parses one JSON object per line', () => {
    const { rows, errors } = parseJsonl('{"a":1}\n{"b":2}');
    expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(errors).toEqual([]);
  });

  it('tolerates a leading BOM', () => {
    const { rows, errors } = parseJsonl('﻿{"a":1}\n{"b":2}');
    expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(errors).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const { rows, errors } = parseJsonl('{"a":1}\r\n{"b":2}\r\n');
    expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(errors).toEqual([]);
  });

  it('skips blank and whitespace-only lines', () => {
    const { rows, errors } = parseJsonl('\n  \n{"a":1}\n\n{"b":2}\n   \n');
    expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(errors).toEqual([]);
  });

  it('collects per-line errors with 1-based line numbers and keeps good rows', () => {
    const { rows, errors } = parseJsonl('{"a":1}\nnot json at all\n{"b":2}');
    expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^line 2:/);
  });

  it('caps collected errors at MAX_LINE_ERRORS', () => {
    const text = Array.from({ length: 30 }, (_, i) => `bad line ${i}`).join('\n');
    const { rows, errors } = parseJsonl(text);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(MAX_LINE_ERRORS);
  });

  it('parses non-object rows (arrays, numbers) without complaint', () => {
    const { rows, errors } = parseJsonl('[1,2]\n42\n"str"');
    expect(rows).toEqual([[1, 2], 42, 'str']);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

describe('parseJson', () => {
  it('returns array elements for a JSON array', () => {
    expect(parseJson('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('wraps a single object in an array', () => {
    expect(parseJson('{"instruction":"hi","output":"yo"}')).toEqual([
      { instruction: 'hi', output: 'yo' },
    ]);
  });

  it('unwraps a {data:[...]} envelope', () => {
    expect(parseJson('{"data":[{"a":1},{"b":2}]}')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('tolerates a BOM', () => {
    expect(parseJson('﻿[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('throws on a scalar root', () => {
    expect(() => parseJson('"hello"')).toThrow(/array or an object/);
    expect(() => parseJson('42')).toThrow(/array or an object/);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJson('{nope')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('parses comma-separated values with a header row', () => {
    const { rows, errors } = parseCsv('a,b\n1,2\n3,4');
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
    expect(errors).toEqual([]);
  });

  it('auto-detects semicolon delimiters', () => {
    const { rows } = parseCsv('question;answer\nWhat is 2+2?;4\nCapital of France?;Paris');
    expect(rows).toEqual([
      { question: 'What is 2+2?', answer: '4' },
      { question: 'Capital of France?', answer: 'Paris' },
    ]);
  });

  it('auto-detects tab delimiters (TSV)', () => {
    const { rows } = parseCsv('a\tb\n1\t2');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('preserves quoted newlines inside cells', () => {
    const { rows } = parseCsv('question,answer\n"What is\n2+2?",4');
    expect(rows).toEqual([{ question: 'What is\n2+2?', answer: '4' }]);
  });

  it('revives JSON-encoded cells', () => {
    const csv =
      'messages,score\n"[{""role"":""user"",""content"":""hi""},{""role"":""assistant"",""content"":""hello""}]",5';
    const { rows } = parseCsv(csv);
    const row = rows[0] as Record<string, unknown>;
    expect(row['messages']).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(row['score']).toBe('5');
  });

  it('leaves almost-JSON strings untouched', () => {
    const { rows } = parseCsv('a\n"{not valid json}"');
    expect(rows).toEqual([{ a: '{not valid json}' }]);
  });

  it('skips empty lines and tolerates a BOM', () => {
    const { rows } = parseCsv('﻿a,b\n\n1,2\n  \n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });
});

// ---------------------------------------------------------------------------
// Markdown Q&A extraction
// ---------------------------------------------------------------------------

describe('extractQAPairs', () => {
  it('extracts ## Q / ## A pairs with inline text', () => {
    const md = [
      '# FAQ',
      '',
      '## Q: What is DataForge?',
      '## A: A dataset workbench.',
      '',
      '## Q: Is it client-side?',
      '## A: Yes, 100%.',
    ].join('\n');
    expect(extractQAPairs(md)).toEqual([
      { instruction: 'What is DataForge?', output: 'A dataset workbench.' },
      { instruction: 'Is it client-side?', output: 'Yes, 100%.' },
    ]);
  });

  it('extracts ### Question / ### Answer sections with body lines', () => {
    const md = ['### Question', 'What is two plus two?', '### Answer', 'Four.'].join('\n');
    expect(extractQAPairs(md)).toEqual([
      { instruction: 'What is two plus two?', output: 'Four.' },
    ]);
  });

  it('extracts **Q:** / **A:** pairs', () => {
    const md = ['**Q:** How fast is it?', '**A:** Very fast.'].join('\n');
    expect(extractQAPairs(md)).toEqual([
      { instruction: 'How fast is it?', output: 'Very fast.' },
    ]);
  });

  it('extracts bare Q:/A: pairs', () => {
    const md = ['Q: Capital of France?', 'A: Paris.'].join('\n');
    expect(extractQAPairs(md)).toEqual([{ instruction: 'Capital of France?', output: 'Paris.' }]);
  });

  it('collects multi-line answers until the next question', () => {
    const md = [
      '## Q: List two colors',
      '## A:',
      'Red',
      'Blue',
      '',
      '## Q: Next?',
      '## A: Done',
    ].join('\n');
    expect(extractQAPairs(md)).toEqual([
      { instruction: 'List two colors', output: 'Red\nBlue' },
      { instruction: 'Next?', output: 'Done' },
    ]);
  });

  it('supports numbered markers like Q1/Q2', () => {
    const md = ['## Q1: First?', '## A1: One.', '## Q2: Second?', '## A2: Two.'].join('\n');
    expect(extractQAPairs(md)).toEqual([
      { instruction: 'First?', output: 'One.' },
      { instruction: 'Second?', output: 'Two.' },
    ]);
  });

  it('returns an empty array when no Q&A structure exists', () => {
    expect(extractQAPairs('# Title\n\nJust some prose.\n\nMore prose.')).toEqual([]);
  });

  it('does not mistake "## A guide" or "Quite:" for markers', () => {
    const md = [
      '## About',
      'Intro text.',
      '## A guide to setup',
      'Setup text.',
      'Quite: interesting',
    ].join('\n');
    expect(extractQAPairs(md)).toEqual([]);
  });

  it('drops pairs missing either side', () => {
    const md = ['## Q: Orphan question?', '', '## Q: Real?', '## A: Yes.'].join('\n');
    expect(extractQAPairs(md)).toEqual([{ instruction: 'Real?', output: 'Yes.' }]);
  });
});

// ---------------------------------------------------------------------------
// Text chunking
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('returns the whole (trimmed) text when it fits', () => {
    expect(chunkText('  short text  ')).toEqual(['short text']);
  });

  it('returns [] for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('prefers paragraph boundaries', () => {
    const text = 'A'.repeat(60) + '\n\n' + 'B'.repeat(60);
    const chunks = chunkText(text, { maxChars: 100, overlap: 10 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('A'.repeat(60));
    expect(chunks[1]!.startsWith('A'.repeat(10))).toBe(true); // overlap
    expect(chunks[1]!.endsWith('B'.repeat(60))).toBe(true);
  });

  it('falls back to sentence boundaries when no paragraph break is in range', () => {
    const text = 'Alpha beta gamma delta. '.repeat(10).trim();
    const chunks = chunkText(text, { maxChars: 100, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
      expect(chunk.endsWith('.')).toBe(true);
    }
  });

  it('hard-cuts when no boundary is available', () => {
    const text = 'X'.repeat(250);
    const chunks = chunkText(text, { maxChars: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
    // Overlapping windows must jointly cover the full text.
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBeGreaterThanOrEqual(250);
  });

  it('never exceeds maxChars and always terminates', () => {
    const text = ('word '.repeat(50) + '\n\n').repeat(20);
    const chunks = chunkText(text, { maxChars: 120, overlap: 119 }); // hostile overlap
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
  });

  it('uses 4000/200 defaults', () => {
    const para = 'Sentence one is here. '.repeat(40).trim(); // ~880 chars
    const text = Array.from({ length: 10 }, () => para).join('\n\n'); // ~8800 chars
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(4000);
  });
});

// ---------------------------------------------------------------------------
// parseTextDocument
// ---------------------------------------------------------------------------

describe('parseTextDocument', () => {
  it('strips BOM, normalizes CRLF/CR, and trims', () => {
    expect(parseTextDocument('﻿  line one\r\nline two\rline three \n')).toBe(
      'line one\nline two\nline three',
    );
  });
});

// ---------------------------------------------------------------------------
// XLSX (round-trip built with the xlsx lib itself)
// ---------------------------------------------------------------------------

function buildXlsx(rows: Record<string, unknown>[]): ArrayBuffer {
  const sheet = xlsxUtils.json_to_sheet(rows);
  const workbook = xlsxUtils.book_new();
  xlsxUtils.book_append_sheet(workbook, sheet, 'Sheet1');
  const out: unknown = xlsxWrite(workbook, { bookType: 'xlsx', type: 'array' });
  if (out instanceof ArrayBuffer) return out;
  if (out instanceof Uint8Array) return bufOf(out);
  throw new Error('unexpected xlsx write output');
}

describe('parseXlsx', () => {
  it('round-trips rows through a real workbook', () => {
    const source = [
      { question: 'What is 2+2?', answer: 4 },
      { question: 'Capital of France?', answer: 'Paris' },
    ];
    const rows = parseXlsx(buildXlsx(source));
    expect(rows).toEqual(source);
  });

  it('fills missing cells with null', () => {
    const sheet = xlsxUtils.aoa_to_sheet([
      ['a', 'b'],
      [1], // second cell missing
    ]);
    const workbook = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(workbook, sheet, 'Data');
    const out = xlsxWrite(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    expect(parseXlsx(out)).toEqual([{ a: 1, b: null }]);
  });
});

// ---------------------------------------------------------------------------
// Parquet (minimal file hand-assembled with thrift compact encoding)
// ---------------------------------------------------------------------------

/** Minimal thrift compact-protocol writer (subset used by parquet metadata). */
class ThriftWriter {
  readonly bytes: number[] = [];
  private readonly lastField: number[] = [0];

  varint(v: number): void {
    let n = v >>> 0;
    while (n > 0x7f) {
      this.bytes.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.bytes.push(n);
  }

  zigzag(v: number): void {
    this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  private fieldHeader(id: number, type: number): void {
    const frame = this.lastField.length - 1;
    const delta = id - this.lastField[frame]!;
    this.bytes.push(((delta & 0xf) << 4) | type);
    this.lastField[frame] = id;
  }

  i32(id: number, v: number): void {
    this.fieldHeader(id, 5);
    this.zigzag(v);
  }

  i64(id: number, v: number): void {
    this.fieldHeader(id, 6);
    this.zigzag(v);
  }

  rawString(s: string): void {
    const b = new TextEncoder().encode(s);
    this.varint(b.length);
    this.bytes.push(...b);
  }

  string(id: number, s: string): void {
    this.fieldHeader(id, 8);
    this.rawString(s);
  }

  list(id: number, elemType: number, count: number): void {
    this.fieldHeader(id, 9);
    if (count < 15) this.bytes.push((count << 4) | elemType);
    else {
      this.bytes.push(0xf0 | elemType);
      this.varint(count);
    }
  }

  structField(id: number): void {
    this.fieldHeader(id, 12);
    this.lastField.push(0);
  }

  /** Begin a struct that is a list element (no field header). */
  listStruct(): void {
    this.lastField.push(0);
  }

  structEnd(): void {
    this.bytes.push(0);
    this.lastField.pop();
  }

  stop(): void {
    this.bytes.push(0);
  }
}

/** Builds a one-column (BYTE_ARRAY "name", required) uncompressed parquet file. */
function buildMinimalParquet(values: string[]): ArrayBuffer {
  const encoder = new TextEncoder();

  // PLAIN-encoded page data: [u32 LE length][bytes] per value.
  const pageData: number[] = [];
  for (const value of values) {
    const b = encoder.encode(value);
    pageData.push(b.length & 0xff, (b.length >> 8) & 0xff, (b.length >> 16) & 0xff, (b.length >> 24) & 0xff);
    pageData.push(...b);
  }

  // PageHeader (thrift struct).
  const ph = new ThriftWriter();
  ph.i32(1, 0); // type = DATA_PAGE
  ph.i32(2, pageData.length); // uncompressed_page_size
  ph.i32(3, pageData.length); // compressed_page_size
  ph.structField(5); // data_page_header
  ph.i32(1, values.length); // num_values
  ph.i32(2, 0); // encoding = PLAIN
  ph.i32(3, 3); // definition_level_encoding = RLE
  ph.i32(4, 3); // repetition_level_encoding = RLE
  ph.structEnd();
  ph.stop();

  const chunkBytes = [...ph.bytes, ...pageData];
  const dataPageOffset = 4; // right after the leading "PAR1"

  // FileMetaData (thrift struct).
  const md = new ThriftWriter();
  md.i32(1, 1); // version
  md.list(2, 12, 2); // schema: list<SchemaElement>
  md.listStruct(); // root element
  md.string(4, 'root'); // name
  md.i32(5, 1); // num_children
  md.structEnd();
  md.listStruct(); // column element
  md.i32(1, 6); // type = BYTE_ARRAY
  md.i32(3, 0); // repetition_type = REQUIRED
  md.string(4, 'name');
  md.structEnd();
  md.i64(3, values.length); // num_rows
  md.list(4, 12, 1); // row_groups
  md.listStruct(); // RowGroup
  md.list(1, 12, 1); // columns
  md.listStruct(); // ColumnChunk
  md.i64(2, dataPageOffset); // file_offset
  md.structField(3); // meta_data: ColumnMetaData
  md.i32(1, 6); // type = BYTE_ARRAY
  md.list(2, 5, 2); // encodings list<i32>
  md.zigzag(0); // PLAIN
  md.zigzag(3); // RLE
  md.list(3, 8, 1); // path_in_schema list<string>
  md.rawString('name');
  md.i32(4, 0); // codec = UNCOMPRESSED
  md.i64(5, values.length); // num_values
  md.i64(6, chunkBytes.length); // total_uncompressed_size
  md.i64(7, chunkBytes.length); // total_compressed_size
  md.i64(9, dataPageOffset); // data_page_offset
  md.structEnd();
  md.structEnd(); // ColumnChunk
  md.i64(2, chunkBytes.length); // total_byte_size
  md.i64(3, values.length); // num_rows
  md.structEnd(); // RowGroup
  md.stop();

  const magic = [0x50, 0x41, 0x52, 0x31]; // "PAR1"
  const len = md.bytes.length;
  const file = new Uint8Array([
    ...magic,
    ...chunkBytes,
    ...md.bytes,
    len & 0xff,
    (len >> 8) & 0xff,
    (len >> 16) & 0xff,
    (len >> 24) & 0xff,
    ...magic,
  ]);
  return bufOf(file);
}

describe('parseParquet', () => {
  it('reads rows from a minimal uncompressed parquet file', async () => {
    const data = buildMinimalParquet(['alpha', 'beta', 'gamma']);
    const rows = await parseParquet(data);
    expect(rows).toEqual([{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }]);
  });
});

// ---------------------------------------------------------------------------
// DOCX (zip container built with fflate)
// ---------------------------------------------------------------------------

function buildMinimalDocx(paragraphs: string[]): ArrayBuffer {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body></w:document>`;
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(documentXml),
  });
  return bufOf(zipped);
}

describe('parseDocx', () => {
  it('extracts paragraph text from a minimal docx', async () => {
    const data = buildMinimalDocx(['Hello from DOCX', 'Second paragraph']);
    const text = await parseDocx(data);
    expect(text).toContain('Hello from DOCX');
    expect(text).toContain('Second paragraph');
  });
});

// ---------------------------------------------------------------------------
// PDF (minimal hand-assembled file)
// ---------------------------------------------------------------------------

function buildMinimalPdf(text: string): ArrayBuffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return enc(pdf);
}

describe('parsePdf', () => {
  it('extracts text from a minimal PDF', async () => {
    const text = await parsePdf(buildMinimalPdf('Hello PDF Import'));
    expect(text).toContain('Hello PDF Import');
  });
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

describe('parseFile router', () => {
  it('routes .jsonl to rows', async () => {
    const file = await parseFile({ name: 'data.jsonl', data: enc('{"a":1}\n{"b":2}') });
    expect(expectRows(file).rows).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('routes .ndjson to rows', async () => {
    const file = await parseFile({ name: 'data.ndjson', data: enc('{"a":1}') });
    expect(expectRows(file).rows).toEqual([{ a: 1 }]);
  });

  it('surfaces jsonl line errors on the result', async () => {
    const file = await parseFile({ name: 'data.jsonl', data: enc('{"a":1}\noops') });
    const { rows, errors } = expectRows(file);
    expect(rows).toEqual([{ a: 1 }]);
    expect(errors).toHaveLength(1);
  });

  it('routes .json to rows', async () => {
    const file = await parseFile({ name: 'data.json', data: enc('[{"a":1}]') });
    expect(expectRows(file).rows).toEqual([{ a: 1 }]);
  });

  it('routes .csv to rows', async () => {
    const file = await parseFile({ name: 'data.csv', data: enc('a,b\n1,2') });
    expect(expectRows(file).rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('routes .tsv to rows', async () => {
    const file = await parseFile({ name: 'data.tsv', data: enc('a\tb\n1\t2') });
    expect(expectRows(file).rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('routes .parquet to rows', async () => {
    const file = await parseFile({ name: 'data.parquet', data: buildMinimalParquet(['x']) });
    expect(expectRows(file).rows).toEqual([{ name: 'x' }]);
  });

  it('routes .xlsx to rows', async () => {
    const file = await parseFile({ name: 'quiz.xlsx', data: buildXlsx([{ q: 'hi', a: 'yo' }]) });
    expect(expectRows(file).rows).toEqual([{ q: 'hi', a: 'yo' }]);
  });

  it('routes .md to a document with a title from the file name', async () => {
    const file = await parseFile({ name: 'notes.md', data: enc('# Notes\n\nBody text.') });
    const doc = expectDocument(file);
    expect(doc.title).toBe('notes');
    expect(doc.text).toBe('# Notes\n\nBody text.');
  });

  it('routes .txt to a document', async () => {
    const file = await parseFile({ name: 'README.txt', data: enc('plain text\r\nhere') });
    const doc = expectDocument(file);
    expect(doc.title).toBe('README');
    expect(doc.text).toBe('plain text\nhere');
  });

  it('routes .docx to a document', async () => {
    const file = await parseFile({ name: 'memo.docx', data: buildMinimalDocx(['Hello memo']) });
    const doc = expectDocument(file);
    expect(doc.title).toBe('memo');
    expect(doc.text).toContain('Hello memo');
  });

  it('routes .pdf to a document', async () => {
    const file = await parseFile({ name: 'report.pdf', data: buildMinimalPdf('Quarterly numbers') });
    const doc = expectDocument(file);
    expect(doc.title).toBe('report');
    expect(doc.text).toContain('Quarterly numbers');
  });

  it('derives titles from paths with directories', async () => {
    const file = await parseFile({ name: 'C:\\docs\\guide.md', data: enc('hello') });
    expect(expectDocument(file).title).toBe('guide');
  });

  it('sniffs JSON content for unknown extensions', async () => {
    const file = await parseFile({ name: 'mystery', data: enc('[{"a":1}]') });
    expect(expectRows(file).rows).toEqual([{ a: 1 }]);
  });

  it('sniffs JSONL content for unknown extensions', async () => {
    const file = await parseFile({ name: 'mystery.dat', data: enc('{"a":1}\n{"b":2}') });
    expect(expectRows(file).rows).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('falls back to a text document for unknown content', async () => {
    const file = await parseFile({ name: 'mystery.bin', data: enc('just some words') });
    const doc = expectDocument(file);
    expect(doc.text).toBe('just some words');
    expect(doc.title).toBe('mystery');
  });
});

describe('detectFormat', () => {
  it('prefers the extension over content', () => {
    expect(detectFormat('a.csv', enc('{"a":1}'))).toBe('csv');
  });

  it('detects magic bytes for extensionless binary formats', () => {
    expect(detectFormat('blob', buildMinimalPdf('x'))).toBe('pdf');
    expect(detectFormat('blob', buildMinimalParquet(['x']))).toBe('parquet');
    expect(detectFormat('blob', buildMinimalDocx(['x']))).toBe('docx');
    expect(detectFormat('blob', buildXlsx([{ a: 1 }]))).toBe('xlsx');
  });
});
