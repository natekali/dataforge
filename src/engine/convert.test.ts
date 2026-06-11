import { describe, expect, it } from 'vitest';
import type { DetectedSchema, SourceFormat } from '@/engine/types';
import { createExample } from '@/engine/types';
import { detectFormat } from '@/engine/detection';
import { buildCanonicalRows } from '@/engine/exporters/jsonl';
import {
  MAX_IMPORT_ERRORS,
  ROLE_ALIASES,
  SHAREGPT_FROM,
  examplesToRows,
  extractThink,
  generateToolCallId,
  normalizeRole,
  rowsToExamples,
} from '@/engine/convert';

const PROJECT = 'project-1';

/** Detect + convert in one go (integration path used by the importer). */
function importRows(rows: unknown[]) {
  return rowsToExamples(rows, detectFormat(rows), PROJECT);
}

/** Hand-built schema for forcing a specific format. */
function schemaOf(format: SourceFormat, fieldMapping: Record<string, string> = {}): DetectedSchema {
  return { format, confidence: 1, fieldMapping, sampleCount: 0, warnings: [] };
}

/** Wrapped OpenAI tool definition as it appears on source rows. */
const RAW_TOOLS = [
  {
    type: 'function',
    function: { name: 'search', description: 'Web search', parameters: { type: 'object' } },
  },
];

/** The canonical ToolDefinition produced from {@link RAW_TOOLS}. */
const CANONICAL_TOOLS = [
  { name: 'search', description: 'Web search', parameters: { type: 'object' } },
];

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe('normalizeRole', () => {
  it('normalizes aliases case-insensitively', () => {
    expect(normalizeRole('HUMAN')).toBe('user');
    expect(normalizeRole('gpt')).toBe('assistant');
    expect(normalizeRole('ai')).toBe('assistant');
    expect(normalizeRole('bot')).toBe('assistant');
    expect(normalizeRole('model')).toBe('assistant');
    expect(normalizeRole('observation')).toBe('tool');
    expect(normalizeRole(' tool ')).toBe('tool');
    expect(normalizeRole('developer')).toBe('developer');
  });

  it('throws on unknown or non-string roles', () => {
    expect(() => normalizeRole('alien')).toThrow(/unsupported role/);
    expect(() => normalizeRole(7)).toThrow(/must be a string/);
  });

  it('exposes the alias table', () => {
    expect(ROLE_ALIASES['human']).toBe('user');
    expect(ROLE_ALIASES['function']).toBe('tool');
  });
});

describe('extractThink', () => {
  it('extracts a think block into reasoning', () => {
    expect(extractThink('<think>Because logic.</think>\nBecause.')).toEqual({
      content: 'Because.',
      reasoning: 'Because logic.',
    });
  });

  it('joins multiple think blocks', () => {
    const result = extractThink('<think>one</think><think>two</think>final');
    expect(result.reasoning).toBe('one\n\ntwo');
    expect(result.content).toBe('final');
  });

  it('leaves content without complete think blocks untouched', () => {
    expect(extractThink('no tags here')).toEqual({ content: 'no tags here' });
    expect(extractThink('<think>unclosed')).toEqual({ content: '<think>unclosed' });
  });
});

describe('generateToolCallId', () => {
  it('produces unique OpenAI-style ids', () => {
    const a = generateToolCallId();
    const b = generateToolCallId();
    expect(a).toMatch(/^call_[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// OpenAI messages import
// ---------------------------------------------------------------------------

describe('rowsToExamples — openai-messages', () => {
  it('converts a basic conversation with factory defaults', () => {
    const rows = [
      {
        messages: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      },
    ];
    const result = importRows(rows);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.examples).toHaveLength(1);

    const example = result.examples[0];
    expect(example.projectId).toBe(PROJECT);
    expect(example.type).toBe('sft');
    expect(example.split).toBe('train');
    expect(example.meta['sourceFormat']).toBe('openai-messages');
    expect(example.messages).toEqual([
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ]);
  });

  it('passes through tool_calls, tool_call_id, name, and weight', () => {
    const rows = [
      {
        messages: [
          { role: 'user', content: 'Weather in Paris?' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_abc123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
              },
            ],
          },
          { role: 'tool', content: '{"temp":21}', tool_call_id: 'call_abc123', name: 'get_weather' },
          { role: 'assistant', content: 'It is 21C.', weight: 0 },
        ],
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages[1].toolCalls).toEqual([
      { id: 'call_abc123', name: 'get_weather', arguments: '{"city":"Paris"}' },
    ]);
    expect(example.messages[2].role).toBe('tool');
    expect(example.messages[2].toolCallId).toBe('call_abc123');
    expect(example.messages[2].name).toBe('get_weather');
    expect(example.messages[3].weight).toBe(0);
  });

  it('JSON-stringifies object arguments and generates missing call ids', () => {
    const rows = [
      {
        messages: [
          { role: 'user', content: 'go' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{ type: 'function', function: { name: 'f', arguments: { a: 1 } } }],
          },
        ],
      },
    ];
    const [example] = importRows(rows).examples;
    const call = example.messages[1].toolCalls?.[0];
    expect(call?.arguments).toBe('{"a":1}');
    expect(call?.id).toMatch(/^call_[0-9a-f]{24}$/);
    expect(call?.name).toBe('f');
  });

  it('extracts <think> blocks from assistant content into reasoning', () => {
    const rows = [
      {
        messages: [
          { role: 'user', content: 'Why?' },
          { role: 'assistant', content: '<think>Because logic.</think>\nBecause.' },
        ],
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages[1].reasoning).toBe('Because logic.');
    expect(example.messages[1].content).toBe('Because.');
  });

  it('does not extract <think> blocks from user content', () => {
    const rows = [
      {
        messages: [
          { role: 'user', content: 'What does <think>x</think> mean?' },
          { role: 'assistant', content: 'It is a tag.' },
        ],
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages[0].content).toBe('What does <think>x</think> mean?');
    expect(example.messages[0].reasoning).toBeUndefined();
  });

  it('maps message-level reasoning_content / thinking fields', () => {
    const rows = [
      {
        messages: [
          { role: 'user', content: 'Q' },
          { role: 'assistant', content: 'A', reasoning_content: 'RC' },
        ],
      },
      {
        messages: [
          { role: 'user', content: 'Q' },
          { role: 'assistant', content: 'A', thinking: 'TH' },
        ],
      },
    ];
    const { examples } = importRows(rows);
    expect(examples[0].messages[1].reasoning).toBe('RC');
    expect(examples[1].messages[1].reasoning).toBe('TH');
  });

  it('maps a row-level reasoning field to the last assistant message', () => {
    const rows = [
      {
        messages: [
          { role: 'user', content: 'Q' },
          { role: 'assistant', content: 'first' },
          { role: 'user', content: 'more' },
          { role: 'assistant', content: 'last' },
        ],
        reasoning: 'row trace',
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages[1].reasoning).toBeUndefined();
    expect(example.messages[3].reasoning).toBe('row trace');
  });

  it('coerces null content and joins text content parts', () => {
    const rows = [
      {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
          },
          { role: 'assistant', content: null },
        ],
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages[0].content).toBe('Hello world');
    expect(example.messages[1].content).toBe('');
  });

  it('passes through top-level tool definitions', () => {
    const rows = [
      {
        messages: [
          { role: 'user', content: 'search it' },
          { role: 'assistant', content: 'ok' },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'search',
              description: 'Web search',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.tools).toEqual([
      { name: 'search', description: 'Web search', parameters: { type: 'object', properties: {} } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// ShareGPT import
// ---------------------------------------------------------------------------

describe('rowsToExamples — sharegpt', () => {
  it('normalizes from/value turns and exotic role spellings', () => {
    const rows = [
      {
        conversations: [
          { from: 'human', value: 'a' },
          { from: 'ai', value: 'b' },
          { from: 'observation', value: 'c' },
          { from: 'bot', value: 'd' },
          { from: 'model', value: 'e' },
          { from: 'gpt', value: 'f' },
        ],
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'assistant',
      'assistant',
    ]);
    expect(example.messages.map((m) => m.content)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(example.meta['sourceFormat']).toBe('sharegpt');
  });

  it('prepends a top-level system field as a system message', () => {
    const rows = [
      {
        system: 'Be terse.',
        conversations: [
          { from: 'human', value: 'Hi' },
          { from: 'gpt', value: 'Hello' },
        ],
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages[0]).toEqual({ role: 'system', content: 'Be terse.' });
    expect(example.messages).toHaveLength(3);
  });

  it('extracts think tags from gpt turns', () => {
    const rows = [
      {
        conversations: [
          { from: 'human', value: 'Why?' },
          { from: 'gpt', value: '<think>hmm</think>\nBecause.' },
        ],
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages[1].reasoning).toBe('hmm');
    expect(example.messages[1].content).toBe('Because.');
  });
});

// ---------------------------------------------------------------------------
// Alpaca import
// ---------------------------------------------------------------------------

describe('rowsToExamples — alpaca', () => {
  it('concatenates instruction and input with input on its own line', () => {
    const rows = [
      { instruction: 'Summarize', input: 'Long text here', output: 'Short.', system: 'Be brief.' },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Summarize\nLong text here' },
      { role: 'assistant', content: 'Short.' },
    ]);
    expect(example.meta['sourceFormat']).toBe('alpaca');
  });

  it('omits input when absent or empty', () => {
    const { examples } = importRows([
      { instruction: 'Summarize', output: 'Short.' },
      { instruction: 'Count', input: '   ', output: 'Three.' },
    ]);
    expect(examples[0].messages[0].content).toBe('Summarize');
    expect(examples[1].messages[0].content).toBe('Count');
  });

  it('resolves aliased fields through the detected schema', () => {
    const rows = [{ prompt: 'P', response: 'R' }];
    const [example] = importRows(rows).examples;
    expect(example.messages).toEqual([
      { role: 'user', content: 'P' },
      { role: 'assistant', content: 'R' },
    ]);
  });

  it('honors an explicit fieldMapping over alias scanning', () => {
    const rows = [{ task: 'Do X', result: 'Done' }];
    const schema = schemaOf('alpaca', { task: 'instruction', result: 'output' });
    const [example] = rowsToExamples(rows, schema, PROJECT).examples;
    expect(example.messages).toEqual([
      { role: 'user', content: 'Do X' },
      { role: 'assistant', content: 'Done' },
    ]);
  });

  it('extracts think tags and row-level reasoning from outputs', () => {
    const { examples } = importRows([
      { instruction: 'Why?', output: '<think>logic</think>\nBecause.' },
      { instruction: 'Why not?', output: 'Because.', reasoning: 'row trace' },
    ]);
    expect(examples[0].messages[1]).toEqual({
      role: 'assistant',
      content: 'Because.',
      reasoning: 'logic',
    });
    expect(examples[1].messages[1].reasoning).toBe('row trace');
  });

  it('skips rows with empty instruction or output', () => {
    const rows = [
      { instruction: '', output: 'x' },
      { instruction: 'ok', output: '   ' },
      { instruction: 'fine', output: 'good' },
    ];
    const result = rowsToExamples(rows, schemaOf('alpaca'), PROJECT);
    expect(result.examples).toHaveLength(1);
    expect(result.skipped).toBe(2);
    expect(result.errors[0]).toMatch(/^Row 1: .*instruction/);
    expect(result.errors[1]).toMatch(/^Row 2: .*output/);
  });
});

// ---------------------------------------------------------------------------
// DPO import
// ---------------------------------------------------------------------------

describe('rowsToExamples — dpo-pairs', () => {
  it('converts string prompts and continuations to preference examples', () => {
    const rows = [{ prompt: 'Best color?', chosen: 'Blue.', rejected: 'No idea.', system: 'Opine.' }];
    const [example] = importRows(rows).examples;
    expect(example.type).toBe('preference');
    expect(example.messages).toEqual([
      { role: 'system', content: 'Opine.' },
      { role: 'user', content: 'Best color?' },
    ]);
    expect(example.chosen).toEqual([{ role: 'assistant', content: 'Blue.' }]);
    expect(example.rejected).toEqual([{ role: 'assistant', content: 'No idea.' }]);
  });

  it('keeps message-list prompts and normalizes message-list continuations', () => {
    const rows = [
      {
        messages: [
          { role: 'system', content: 'S' },
          { role: 'human', content: 'Q' },
        ],
        chosen: [{ role: 'gpt', content: 'A1' }],
        rejected: [{ role: 'gpt', content: 'A2' }],
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'Q' },
    ]);
    expect(example.chosen).toEqual([{ role: 'assistant', content: 'A1' }]);
    expect(example.rejected).toEqual([{ role: 'assistant', content: 'A2' }]);
  });

  it('extracts think tags from chosen/rejected strings', () => {
    const rows = [{ prompt: 'Q', chosen: '<think>R</think>\nA', rejected: 'B' }];
    const [example] = importRows(rows).examples;
    expect(example.chosen?.[0]).toEqual({ role: 'assistant', content: 'A', reasoning: 'R' });
  });

  it('skips rows missing chosen or rejected', () => {
    const result = rowsToExamples(
      [{ prompt: 'Q', chosen: 'A' }, { prompt: 'Q', chosen: 'A', rejected: 'B' }],
      schemaOf('dpo-pairs'),
      PROJECT,
    );
    expect(result.examples).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/rejected/);
  });

  it('passes through top-level tool definitions', () => {
    const rows = [{ prompt: 'Q', chosen: 'A', rejected: 'B', tools: RAW_TOOLS }];
    const [example] = importRows(rows).examples;
    expect(example.type).toBe('preference');
    expect(example.tools).toEqual(CANONICAL_TOOLS);
  });
});

// ---------------------------------------------------------------------------
// KTO import
// ---------------------------------------------------------------------------

describe('rowsToExamples — kto-unpaired', () => {
  it('converts prompt + completion + boolean label', () => {
    const rows = [
      { prompt: 'Q1', completion: 'A1', label: true },
      { prompt: 'Q2', completion: 'A2', label: false },
    ];
    const { examples } = importRows(rows);
    expect(examples[0].type).toBe('kto');
    expect(examples[0].messages).toEqual([{ role: 'user', content: 'Q1' }]);
    expect(examples[0].completion).toEqual([{ role: 'assistant', content: 'A1' }]);
    expect(examples[0].label).toBe(true);
    expect(examples[1].label).toBe(false);
  });

  it('coerces 0/1 labels when the schema is forced', () => {
    const result = rowsToExamples(
      [{ prompt: 'Q', completion: 'A', label: 1 }, { prompt: 'Q', completion: 'B', label: 0 }],
      schemaOf('kto-unpaired'),
      PROJECT,
    );
    expect(result.examples[0].label).toBe(true);
    expect(result.examples[1].label).toBe(false);
  });

  it('skips rows with a missing or invalid label', () => {
    const result = rowsToExamples(
      [{ prompt: 'Q', completion: 'A', label: 'maybe' }],
      schemaOf('kto-unpaired'),
      PROJECT,
    );
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/label/);
  });

  it('imports 0/1 and "true"/"false" labels through detection', () => {
    const rows = [
      { prompt: 'Q1', completion: 'A1', label: 1 },
      { prompt: 'Q2', completion: 'A2', label: 0 },
      { prompt: 'Q3', completion: 'A3', label: 'true' },
      { prompt: 'Q4', completion: 'A4', label: 'false' },
    ];
    const result = importRows(rows);
    expect(result.skipped).toBe(0);
    expect(result.examples.map((e) => e.type)).toEqual(['kto', 'kto', 'kto', 'kto']);
    expect(result.examples.map((e) => e.label)).toEqual([true, false, true, false]);
  });

  it('passes through top-level tool definitions', () => {
    const rows = [{ prompt: 'Q', completion: 'A', label: true, tools: RAW_TOOLS }];
    const [example] = importRows(rows).examples;
    expect(example.type).toBe('kto');
    expect(example.tools).toEqual(CANONICAL_TOOLS);
  });
});

// ---------------------------------------------------------------------------
// RL import (canonical messages + answer)
// ---------------------------------------------------------------------------

describe('rowsToExamples — rl', () => {
  it('imports prompt-only rows with a string answer as rl examples', () => {
    const rows = [{ messages: [{ role: 'user', content: 'Compute 2+2.' }], answer: '4' }];
    const result = importRows(rows);
    expect(result.skipped).toBe(0);
    const [example] = result.examples;
    expect(example.type).toBe('rl');
    expect(example.answer).toBe('4');
    expect(example.messages).toEqual([{ role: 'user', content: 'Compute 2+2.' }]);
    expect(example.meta['sourceFormat']).toBe('openai-messages');
  });

  it('keeps rows with an assistant turn as sft, ignoring a stray answer', () => {
    const rows = [
      {
        messages: [
          { role: 'user', content: 'Q' },
          { role: 'assistant', content: 'A' },
        ],
        answer: 'stray',
      },
    ];
    const [example] = importRows(rows).examples;
    expect(example.type).toBe('sft');
    expect(example.answer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Text + unknown import
// ---------------------------------------------------------------------------

describe('rowsToExamples — text and unknown', () => {
  it('converts plain string rows and single-field rows to user messages', () => {
    const { examples } = importRows(['raw line one', 'raw line two']);
    expect(examples).toHaveLength(2);
    expect(examples[0].messages).toEqual([{ role: 'user', content: 'raw line one' }]);
    expect(examples[0].meta['sourceFormat']).toBe('text');

    const fromObjects = importRows([{ text: 'document body' }]);
    expect(fromObjects.examples[0].messages).toEqual([{ role: 'user', content: 'document body' }]);
  });

  it('classifies rows individually under an unknown schema', () => {
    const rows = [
      { messages: [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }] },
      { conversations: [{ from: 'human', value: 'Q' }, { from: 'gpt', value: 'A' }] },
      { instruction: 'i', output: 'o' },
      42,
    ];
    const result = rowsToExamples(rows, schemaOf('unknown'), PROJECT);
    expect(result.examples).toHaveLength(3);
    expect(result.skipped).toBe(1);
    expect(result.examples.map((e) => e.meta['sourceFormat'])).toEqual([
      'openai-messages',
      'sharegpt',
      'alpaca',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Malformed row handling
// ---------------------------------------------------------------------------

describe('rowsToExamples — malformed rows', () => {
  it('skips invalid rows and reports row-numbered errors', () => {
    const rows = [
      { messages: [{ role: 'user', content: 'ok' }, { role: 'assistant', content: 'fine' }] },
      { messages: [] },
      { messages: 'not-an-array' },
      42,
      { messages: [{ content: 'no role' }] },
      { messages: [{ role: 'alien', content: 'x' }] },
    ];
    const result = rowsToExamples(rows, schemaOf('openai-messages'), PROJECT);
    expect(result.examples).toHaveLength(1);
    expect(result.skipped).toBe(5);
    expect(result.errors).toHaveLength(5);
    expect(result.errors[0]).toMatch(/^Row 2: /);
    expect(result.errors[2]).toMatch(/^Row 4: .*not an object/);
    expect(result.errors[3]).toMatch(/missing "role"/);
    expect(result.errors[4]).toMatch(/unsupported role/);
  });

  it('counts all skipped rows but retains at most MAX_IMPORT_ERRORS errors', () => {
    const rows = Array.from({ length: 30 }, () => ({ messages: [] }));
    const result = rowsToExamples(rows, schemaOf('openai-messages'), PROJECT);
    expect(result.skipped).toBe(30);
    expect(result.errors).toHaveLength(MAX_IMPORT_ERRORS);
    expect(result.examples).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Legacy export + round trips
// ---------------------------------------------------------------------------

describe('examplesToRows', () => {
  it('round-trips a full openai-messages row exactly', () => {
    const original = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Weather in Paris?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
            },
          ],
        },
        { role: 'tool', content: '{"temp":21}', tool_call_id: 'call_abc123', name: 'get_weather' },
        { role: 'assistant', content: 'It is 21C in Paris.', weight: 1 },
      ],
    };
    const { examples } = rowsToExamples([original], schemaOf('openai-messages'), PROJECT);
    const [row] = examplesToRows(examples, 'openai-messages');
    expect(row).toEqual(original);
  });

  it('round-trips think tags through reasoning extraction and re-inlining', () => {
    const original = {
      messages: [
        { role: 'user', content: 'Why?' },
        { role: 'assistant', content: '<think>Because logic.</think>\nBecause.' },
      ],
    };
    const { examples } = rowsToExamples([original], schemaOf('openai-messages'), PROJECT);
    expect(examples[0].messages[1].reasoning).toBe('Because logic.');
    const [row] = examplesToRows(examples, 'openai-messages');
    expect(row).toEqual(original);
  });

  it('round-trips a sharegpt conversation exactly', () => {
    const original = {
      conversations: [
        { from: 'system', value: 'Be terse.' },
        { from: 'human', value: 'Hi' },
        { from: 'gpt', value: 'Hello' },
      ],
    };
    const { examples } = rowsToExamples([original], schemaOf('sharegpt'), PROJECT);
    const [row] = examplesToRows(examples, 'sharegpt');
    expect(row).toEqual(original);
  });

  it('round-trips an alpaca row without input exactly', () => {
    const original = { system: 'Be brief.', instruction: 'Summarize', output: 'Short.' };
    const { examples } = rowsToExamples([original], schemaOf('alpaca'), PROJECT);
    const [row] = examplesToRows(examples, 'alpaca');
    expect(row).toEqual(original);
  });

  it('folds alpaca input into the exported instruction', () => {
    const { examples } = rowsToExamples(
      [{ instruction: 'Summarize', input: 'Long text', output: 'Short.' }],
      schemaOf('alpaca'),
      PROJECT,
    );
    const [row] = examplesToRows(examples, 'alpaca');
    expect(row).toEqual({ instruction: 'Summarize\nLong text', output: 'Short.' });
  });

  it('uses first system/user/assistant for alpaca and falls back to chosen', () => {
    const preference = createExample({
      projectId: PROJECT,
      type: 'preference',
      messages: [{ role: 'user', content: 'Q' }],
      chosen: [{ role: 'assistant', content: 'A' }],
      rejected: [{ role: 'assistant', content: 'B' }],
    });
    const [row] = examplesToRows([preference], 'alpaca');
    expect(row).toEqual({ instruction: 'Q', output: 'A' });
  });

  it('exports preference and kto columns in openai-messages shape', () => {
    const { examples } = rowsToExamples(
      [{ prompt: 'Q', chosen: 'A', rejected: 'B' }],
      schemaOf('dpo-pairs'),
      PROJECT,
    );
    const [dpoOut] = examplesToRows(examples, 'openai-messages');
    expect(dpoOut).toEqual({
      messages: [{ role: 'user', content: 'Q' }],
      chosen: [{ role: 'assistant', content: 'A' }],
      rejected: [{ role: 'assistant', content: 'B' }],
    });

    const kto = rowsToExamples(
      [{ prompt: 'Q', completion: 'A', label: false }],
      schemaOf('kto-unpaired'),
      PROJECT,
    );
    const [ktoOut] = examplesToRows(kto.examples, 'openai-messages');
    expect(ktoOut).toEqual({
      messages: [{ role: 'user', content: 'Q' }],
      completion: [{ role: 'assistant', content: 'A' }],
      label: false,
    });
  });

  it('maps roles to sharegpt from-values (tool → observation, developer → system)', () => {
    expect(SHAREGPT_FROM.tool).toBe('observation');
    const example = createExample({
      projectId: PROJECT,
      messages: [
        { role: 'developer', content: 'd' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a', reasoning: 'R' },
        { role: 'tool', content: 't' },
      ],
    });
    const [row] = examplesToRows([example], 'sharegpt');
    expect(row).toEqual({
      conversations: [
        { from: 'system', value: 'd' },
        { from: 'human', value: 'u' },
        { from: 'gpt', value: '<think>R</think>\na' },
        { from: 'observation', value: 't' },
      ],
    });
  });

  it('re-inlines reasoning into alpaca output', () => {
    const example = createExample({
      projectId: PROJECT,
      messages: [
        { role: 'user', content: 'Why?' },
        { role: 'assistant', content: 'Because.', reasoning: 'logic' },
      ],
    });
    const [row] = examplesToRows([example], 'alpaca');
    expect(row).toEqual({ instruction: 'Why?', output: '<think>logic</think>\nBecause.' });
  });

  it('re-wraps tool definitions for openai-messages export', () => {
    const original = {
      messages: [
        { role: 'user', content: 'search it' },
        { role: 'assistant', content: 'ok' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'search', description: 'Web search', parameters: { type: 'object' } },
        },
      ],
    };
    const { examples } = rowsToExamples([original], schemaOf('openai-messages'), PROJECT);
    const [row] = examplesToRows(examples, 'openai-messages');
    expect(row).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Canonical JSONL round trip
// ---------------------------------------------------------------------------

describe('canonical JSONL round trip', () => {
  it('preserves rl type, answer and tools through export, detection and re-import', () => {
    const rl = createExample({
      projectId: PROJECT,
      type: 'rl',
      messages: [{ role: 'user', content: 'Compute 2+2.' }],
      answer: '4',
      tools: CANONICAL_TOOLS,
    });
    const rows = buildCanonicalRows([rl], {
      options: {
        framework: 'jsonl',
        datasetType: 'rl',
        includeReasoning: true,
        stripPriorThinking: false,
        includeSystem: true,
        splitFiles: false,
        projectName: 'P',
      },
    });

    const schema = detectFormat(rows);
    expect(schema.format).toBe('openai-messages');

    const result = rowsToExamples(rows, schema, PROJECT);
    expect(result.skipped).toBe(0);
    const [example] = result.examples;
    expect(example.type).toBe('rl');
    expect(example.answer).toBe('4');
    expect(example.messages).toEqual([{ role: 'user', content: 'Compute 2+2.' }]);
    expect(example.tools).toEqual(CANONICAL_TOOLS);
  });
});
