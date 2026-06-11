import { describe, expect, it } from 'vitest';
import type { ImportResult } from '@/engine/types';
import { mergeParseErrors } from '@/lib/workerClient';

/** Minimal ImportResult fixture. */
function importResult(errors: string[]): ImportResult {
  return {
    examples: [],
    schema: {
      format: 'openai-messages',
      confidence: 1,
      fieldMapping: {},
      sampleCount: 0,
      warnings: [],
    },
    skipped: 0,
    errors,
  };
}

describe('mergeParseErrors', () => {
  it('returns the input unchanged when there are no parse errors', () => {
    const result = importResult(['convert error']);
    expect(mergeParseErrors(result)).toBe(result);
    expect(mergeParseErrors(result, [])).toBe(result);
  });

  it('prepends parse errors before conversion errors', () => {
    const result = importResult(['convert error']);
    const merged = mergeParseErrors(result, ['line 3: bad JSON', 'line 9: bad JSON']);
    expect(merged.errors).toEqual(['line 3: bad JSON', 'line 9: bad JSON', 'convert error']);
  });

  it('never mutates the input result', () => {
    const result = importResult(['convert error']);
    const merged = mergeParseErrors(result, ['parse error']);
    expect(merged).not.toBe(result);
    expect(result.errors).toEqual(['convert error']);
    // Non-error fields are carried over untouched.
    expect(merged.schema).toBe(result.schema);
    expect(merged.examples).toBe(result.examples);
    expect(merged.skipped).toBe(0);
  });
});
