import { describe, expect, it } from 'vitest';
import {
  ALPACA_ALIASES,
  DETECTION_SAMPLE_LIMIT,
  DPO_PROMPT_FIELDS,
  FIELD_PRESENCE_THRESHOLD,
  FORMAT_SPECIFICITY,
  classifyRow,
  detectFormat,
  isKtoLabel,
  isRecord,
  resolveAlpacaField,
} from '@/engine/detection';

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

const openaiRow = (user = 'Hi', assistant = 'Hello') => ({
  messages: [
    { role: 'user', content: user },
    { role: 'assistant', content: assistant },
  ],
});

const sharegptRow = () => ({
  conversations: [
    { from: 'human', value: 'Hi' },
    { from: 'gpt', value: 'Hello' },
  ],
});

const alpacaRow = () => ({ instruction: 'Summarize this', output: 'A summary.' });

const dpoRow = () => ({ prompt: 'Best color?', chosen: 'Blue.', rejected: 'No idea.' });

const ktoRow = (label: unknown = true) => ({ prompt: 'Q', completion: 'A', label });

const repeat = <T>(make: () => T, n: number): T[] => Array.from({ length: n }, make);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('detection constants', () => {
  it('exposes the documented alias lists', () => {
    expect(ALPACA_ALIASES.instruction).toEqual(['instruction', 'prompt', 'question', 'query']);
    expect(ALPACA_ALIASES.output).toEqual(['output', 'response', 'completion', 'answer']);
    expect(DPO_PROMPT_FIELDS).toContain('messages');
    expect(DETECTION_SAMPLE_LIMIT).toBe(200);
    expect(FIELD_PRESENCE_THRESHOLD).toBe(0.5);
  });

  it('ranks paired/labelled formats as more specific than text', () => {
    expect(FORMAT_SPECIFICITY['dpo-pairs']).toBeGreaterThan(FORMAT_SPECIFICITY['openai-messages']);
    expect(FORMAT_SPECIFICITY['kto-unpaired']).toBeGreaterThan(FORMAT_SPECIFICITY.alpaca);
    expect(FORMAT_SPECIFICITY.text).toBeLessThan(FORMAT_SPECIFICITY.alpaca);
  });
});

// ---------------------------------------------------------------------------
// classifyRow
// ---------------------------------------------------------------------------

describe('classifyRow', () => {
  it('classifies each canonical row shape', () => {
    expect(classifyRow(openaiRow())).toBe('openai-messages');
    expect(classifyRow(sharegptRow())).toBe('sharegpt');
    expect(classifyRow(alpacaRow())).toBe('alpaca');
    expect(classifyRow(dpoRow())).toBe('dpo-pairs');
    expect(classifyRow(ktoRow())).toBe('kto-unpaired');
    expect(classifyRow({ text: 'raw line' })).toBe('text');
    expect(classifyRow('a plain string row')).toBe('text');
  });

  it('prefers dpo-pairs over openai-messages when chosen/rejected are present', () => {
    const row = {
      messages: [{ role: 'user', content: 'Q' }],
      chosen: [{ role: 'assistant', content: 'A' }],
      rejected: [{ role: 'assistant', content: 'B' }],
    };
    expect(classifyRow(row)).toBe('dpo-pairs');
  });

  it('prefers kto-unpaired over alpaca when a boolean label is present', () => {
    expect(classifyRow({ prompt: 'Q', completion: 'A', label: false })).toBe('kto-unpaired');
    // Without the label the same fields read as aliased alpaca.
    expect(classifyRow({ prompt: 'Q', completion: 'A' })).toBe('alpaca');
  });

  it('accepts 0/1 and "true"/"false" labels for kto-unpaired', () => {
    expect(classifyRow(ktoRow(1))).toBe('kto-unpaired');
    expect(classifyRow(ktoRow(0))).toBe('kto-unpaired');
    expect(classifyRow(ktoRow('true'))).toBe('kto-unpaired');
    expect(classifyRow(ktoRow('false'))).toBe('kto-unpaired');
    // Anything else is not a label — these rows read as aliased alpaca.
    expect(classifyRow(ktoRow(2))).toBe('alpaca');
    expect(classifyRow(ktoRow('maybe'))).toBe('alpaca');
  });

  it('returns null for unrecognizable rows', () => {
    expect(classifyRow(null)).toBeNull();
    expect(classifyRow(42)).toBeNull();
    expect(classifyRow({})).toBeNull();
    expect(classifyRow({ foo: 1, bar: 2 })).toBeNull();
    expect(classifyRow({ messages: ['not-an-object'] })).toBeNull();
    expect(classifyRow({ messages: [] })).toBeNull();
    expect(classifyRow('   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectFormat — per format
// ---------------------------------------------------------------------------

describe('detectFormat', () => {
  it('returns unknown with a warning for an empty dataset', () => {
    const schema = detectFormat([]);
    expect(schema.format).toBe('unknown');
    expect(schema.confidence).toBe(0);
    expect(schema.sampleCount).toBe(0);
    expect(schema.warnings.length).toBeGreaterThan(0);
  });

  it('detects openai-messages with high confidence', () => {
    const schema = detectFormat(repeat(openaiRow, 10));
    expect(schema.format).toBe('openai-messages');
    expect(schema.confidence).toBeGreaterThanOrEqual(0.9);
    expect(schema.fieldMapping).toEqual({ messages: 'messages' });
    expect(schema.sampleCount).toBe(10);
  });

  it('detects sharegpt and maps from/value', () => {
    const schema = detectFormat(repeat(sharegptRow, 5));
    expect(schema.format).toBe('sharegpt');
    expect(schema.confidence).toBeGreaterThanOrEqual(0.9);
    expect(schema.fieldMapping).toEqual({ conversations: 'messages', from: 'role', value: 'content' });
  });

  it('detects canonical alpaca and includes optional fields in the mapping', () => {
    const rows = repeat(() => ({ ...alpacaRow(), input: 'context', system: 'Be brief.' }), 6);
    const schema = detectFormat(rows);
    expect(schema.format).toBe('alpaca');
    expect(schema.fieldMapping).toEqual({
      instruction: 'instruction',
      output: 'output',
      input: 'input',
      system: 'system',
    });
  });

  it.each([
    ['prompt', 'response'],
    ['question', 'answer'],
    ['query', 'completion'],
  ])('detects aliased alpaca (%s/%s)', (instructionKey, outputKey) => {
    const rows = repeat(() => ({ [instructionKey]: 'do it', [outputKey]: 'done' }), 4);
    const schema = detectFormat(rows);
    expect(schema.format).toBe('alpaca');
    expect(schema.fieldMapping[instructionKey]).toBe('instruction');
    expect(schema.fieldMapping[outputKey]).toBe('output');
  });

  it('detects dpo-pairs with a string prompt', () => {
    const schema = detectFormat(repeat(dpoRow, 4));
    expect(schema.format).toBe('dpo-pairs');
    expect(schema.fieldMapping).toEqual({ prompt: 'messages', chosen: 'chosen', rejected: 'rejected' });
  });

  it('detects dpo-pairs with a message-list prompt (not openai-messages)', () => {
    const rows = repeat(
      () => ({
        messages: [{ role: 'user', content: 'Q' }],
        chosen: [{ role: 'assistant', content: 'A' }],
        rejected: [{ role: 'assistant', content: 'B' }],
      }),
      4,
    );
    const schema = detectFormat(rows);
    expect(schema.format).toBe('dpo-pairs');
    expect(schema.fieldMapping['messages']).toBe('messages');
  });

  it('detects kto-unpaired (not alpaca) when boolean labels are present', () => {
    const schema = detectFormat([ktoRow(true), ktoRow(false), ktoRow(true)]);
    expect(schema.format).toBe('kto-unpaired');
    expect(schema.fieldMapping).toEqual({ prompt: 'messages', completion: 'completion', label: 'label' });
  });

  it('detects kto-unpaired with integer 0/1 and string labels', () => {
    const schema = detectFormat([ktoRow(1), ktoRow(0), ktoRow('true'), ktoRow('false')]);
    expect(schema.format).toBe('kto-unpaired');
    expect(schema.fieldMapping).toEqual({ prompt: 'messages', completion: 'completion', label: 'label' });
  });

  it('detects single-string-field rows as text', () => {
    const schema = detectFormat(repeat(() => ({ text: 'a raw line' }), 4));
    expect(schema.format).toBe('text');
    expect(schema.fieldMapping).toEqual({ text: 'messages' });
  });

  it('detects plain string rows as text', () => {
    const schema = detectFormat(['line one', 'line two', 'line three']);
    expect(schema.format).toBe('text');
    expect(schema.confidence).toBeCloseTo(FORMAT_SPECIFICITY.text, 4);
  });

  // -------------------------------------------------------------------------
  // Confidence ordering & threshold
  // -------------------------------------------------------------------------

  it('orders confidence by field specificity', () => {
    const openai = detectFormat(repeat(openaiRow, 10)).confidence;
    const canonicalAlpaca = detectFormat(repeat(alpacaRow, 10)).confidence;
    const aliasedAlpaca = detectFormat(
      repeat(() => ({ prompt: 'do it', response: 'done' }), 10),
    ).confidence;
    const text = detectFormat(repeat(() => ({ text: 'raw' }), 10)).confidence;

    expect(openai).toBeGreaterThan(canonicalAlpaca);
    expect(canonicalAlpaca).toBeGreaterThan(aliasedAlpaca);
    expect(aliasedAlpaca).toBeGreaterThan(text);
  });

  it('scales confidence by the presence ratio', () => {
    const full = detectFormat(repeat(openaiRow, 10));
    const partial = detectFormat([
      ...repeat(openaiRow, 6),
      ...repeat(() => ({ junk: 1, more: 2 }), 4),
    ]);
    expect(partial.format).toBe('openai-messages');
    expect(partial.confidence).toBeCloseTo(full.confidence * 0.6, 4);
  });

  it('returns unknown when no format reaches the presence threshold', () => {
    const rows = [...repeat(openaiRow, 4), ...repeat(() => ({ junk: 1, more: 2 }), 6)];
    const schema = detectFormat(rows);
    expect(schema.format).toBe('unknown');
    expect(schema.confidence).toBeLessThan(FIELD_PRESENCE_THRESHOLD);
    expect(schema.fieldMapping).toEqual({});
    expect(schema.warnings.some((w) => w.includes('did not match'))).toBe(true);
  });

  it('qualifies a format at exactly the 0.5 presence ratio', () => {
    const rows = [...repeat(openaiRow, 5), ...repeat(() => ({ junk: 1, more: 2 }), 5)];
    const schema = detectFormat(rows);
    expect(schema.format).toBe('openai-messages');
    expect(schema.confidence).toBeCloseTo(0.5 * FORMAT_SPECIFICITY['openai-messages'], 4);
  });

  // -------------------------------------------------------------------------
  // Warnings & sampling
  // -------------------------------------------------------------------------

  it('warns about mixed formats and picks the more specific winner on ties', () => {
    const rows = [...repeat(openaiRow, 5), ...repeat(sharegptRow, 5)];
    const schema = detectFormat(rows);
    expect(schema.format).toBe('openai-messages');
    expect(schema.warnings.some((w) => w.includes('sharegpt'))).toBe(true);
  });

  it('warns about empty field values', () => {
    const rows = repeat(() => ({ instruction: 'do it', output: '' }), 3);
    const schema = detectFormat(rows);
    expect(schema.format).toBe('alpaca');
    expect(schema.warnings.some((w) => w.includes('"output"'))).toBe(true);
  });

  it('caps analysis at DETECTION_SAMPLE_LIMIT rows', () => {
    const schema = detectFormat(repeat(openaiRow, 250));
    expect(schema.sampleCount).toBe(DETECTION_SAMPLE_LIMIT);
    expect(schema.format).toBe('openai-messages');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('helpers', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('resolveAlpacaField returns the first matching alias', () => {
    expect(resolveAlpacaField({ prompt: 'p', instruction: 'i' }, 'instruction')).toBe('instruction');
    expect(resolveAlpacaField({ prompt: 'p' }, 'instruction')).toBe('prompt');
    expect(resolveAlpacaField({ prompt: 42 }, 'instruction')).toBeUndefined();
    expect(resolveAlpacaField({}, 'output')).toBeUndefined();
  });

  it('isKtoLabel accepts booleans, 0/1 and "true"/"false" only', () => {
    expect(isKtoLabel(true)).toBe(true);
    expect(isKtoLabel(false)).toBe(true);
    expect(isKtoLabel(0)).toBe(true);
    expect(isKtoLabel(1)).toBe(true);
    expect(isKtoLabel('true')).toBe(true);
    expect(isKtoLabel('false')).toBe(true);
    expect(isKtoLabel(2)).toBe(false);
    expect(isKtoLabel('yes')).toBe(false);
    expect(isKtoLabel(null)).toBe(false);
    expect(isKtoLabel(undefined)).toBe(false);
  });
});
