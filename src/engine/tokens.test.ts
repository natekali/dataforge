import { describe, expect, it } from 'vitest';
import { createExample } from '@/engine/types';
import type { Message, Role } from '@/engine/types';
import {
  ANTHROPIC_CHARS_PER_TOKEN,
  MESSAGE_TOKEN_OVERHEAD,
  approxAnthropicTokens,
  countExample,
  countExamples,
  countText,
} from '@/engine/tokens';

/**
 * Reference o200k_base token counts (verified against
 * gpt-tokenizer/encoding/o200k_base directly):
 *   "hello world"                                       → 2
 *   "Hello, world!"                                     → 4
 *   "The quick brown fox jumps over the lazy dog."      → 10
 *   "You are a helpful assistant."                      → 6
 *   "What is 2+2?"                                      → 7
 *   "2+2 equals 4."                                     → 7
 *   "Let me compute: 2+2 is elementary addition."       → 12
 *   '{"city":"Paris","unit":"celsius"}'                 → 10
 *   "Use the weather tool."                             → 5
 *   "It is sunny."                                      → 4
 *   "Bad answer"                                        → 2
 *   "héllo 🌍 — tokens"                                 → 6
 *   "a"                                                 → 1
 */

const msg = (role: Role, content: string, extra: Partial<Message> = {}): Message => ({
  role,
  content,
  ...extra,
});

describe('countText', () => {
  it('returns 0 for the empty string', () => {
    expect(countText('')).toBe(0);
  });

  it('returns deterministic o200k_base counts for known strings', () => {
    expect(countText('hello world')).toBe(2);
    expect(countText('Hello, world!')).toBe(4);
    expect(countText('The quick brown fox jumps over the lazy dog.')).toBe(10);
    expect(countText('a')).toBe(1);
  });

  it('handles non-ASCII text (accents, emoji, punctuation)', () => {
    expect(countText('héllo 🌍 — tokens')).toBe(6);
  });

  it('is stable across repeated calls', () => {
    const text = 'You are a helpful assistant.';
    expect(countText(text)).toBe(6);
    expect(countText(text)).toBe(6);
  });
});

describe('countExample', () => {
  it('sums message contents plus 4-token overhead per message (sft)', () => {
    const example = createExample({
      projectId: 'p1',
      messages: [
        msg('system', 'You are a helpful assistant.'), // 6
        msg('user', 'What is 2+2?'), // 7
      ],
    });
    expect(countExample(example)).toBe(6 + 7 + 2 * MESSAGE_TOKEN_OVERHEAD); // 21
  });

  it('includes assistant reasoning traces', () => {
    const example = createExample({
      projectId: 'p1',
      messages: [
        msg('user', 'What is 2+2?'), // 7
        msg('assistant', '2+2 equals 4.', {
          reasoning: 'Let me compute: 2+2 is elementary addition.', // 12
        }), // content 7
      ],
    });
    expect(countExample(example)).toBe(7 + 7 + 12 + 2 * MESSAGE_TOKEN_OVERHEAD); // 34
  });

  it('includes tool-call arguments but not names or ids', () => {
    const args = '{"city":"Paris","unit":"celsius"}'; // 10
    const base = createExample({
      projectId: 'p1',
      messages: [
        msg('user', 'Use the weather tool.'), // 5
        msg('assistant', '', {
          toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: args }],
        }),
      ],
    });
    expect(countExample(base)).toBe(5 + 0 + 10 + 2 * MESSAGE_TOKEN_OVERHEAD); // 23

    // A wildly longer name/id must not change the count.
    const renamed = createExample({
      projectId: 'p1',
      messages: [
        msg('user', 'Use the weather tool.'),
        msg('assistant', '', {
          toolCalls: [
            {
              id: 'call_with_an_extremely_long_identifier_string_0123456789',
              name: 'an_extremely_long_function_name_that_should_not_be_counted',
              arguments: args,
            },
          ],
        }),
      ],
    });
    expect(countExample(renamed)).toBe(countExample(base));
  });

  it('sums multiple tool calls on a single assistant turn', () => {
    const args = '{"city":"Paris","unit":"celsius"}'; // 10 each
    const example = createExample({
      projectId: 'p1',
      messages: [
        msg('assistant', '', {
          toolCalls: [
            { id: 'c1', name: 'get_weather', arguments: args },
            { id: 'c2', name: 'get_weather', arguments: args },
          ],
        }),
      ],
    });
    expect(countExample(example)).toBe(10 + 10 + MESSAGE_TOKEN_OVERHEAD); // 24
  });

  it('includes chosen and rejected lists for preference (dpo) examples', () => {
    const example = createExample({
      projectId: 'p1',
      type: 'preference',
      messages: [msg('user', 'What is 2+2?')], // 7 + 4
      chosen: [msg('assistant', '2+2 equals 4.')], // 7 + 4
      rejected: [msg('assistant', 'Bad answer')], // 2 + 4
    });
    expect(countExample(example)).toBe(7 + 7 + 2 + 3 * MESSAGE_TOKEN_OVERHEAD); // 28
  });

  it('counts reasoning and tool calls inside chosen/rejected lists too', () => {
    const example = createExample({
      projectId: 'p1',
      type: 'preference',
      messages: [msg('user', 'What is 2+2?')], // 7 + 4
      chosen: [
        msg('assistant', '2+2 equals 4.', {
          reasoning: 'Let me compute: 2+2 is elementary addition.', // 12
        }), // 7 + 4
      ],
      rejected: [
        msg('assistant', '', {
          toolCalls: [
            { id: 'c1', name: 'calc', arguments: '{"city":"Paris","unit":"celsius"}' }, // 10
          ],
        }), // 0 + 4
      ],
    });
    expect(countExample(example)).toBe(7 + 7 + 12 + 10 + 3 * MESSAGE_TOKEN_OVERHEAD); // 48
  });

  it('includes the completion list for kto examples', () => {
    const example = createExample({
      projectId: 'p1',
      type: 'kto',
      messages: [msg('user', 'hello world')], // 2 + 4
      completion: [msg('assistant', 'It is sunny.')], // 4 + 4
      label: true,
    });
    expect(countExample(example)).toBe(2 + 4 + 2 * MESSAGE_TOKEN_OVERHEAD); // 14
  });

  it('does not count the rl answer field or tool schema definitions', () => {
    const bare = createExample({
      projectId: 'p1',
      type: 'rl',
      messages: [msg('user', 'What is 2+2?')],
    });
    const decorated = createExample({
      projectId: 'p1',
      type: 'rl',
      messages: [msg('user', 'What is 2+2?')],
      answer: 'four, the answer is definitely four',
      tools: [
        {
          name: 'calculator',
          description: 'Evaluates arithmetic expressions.',
          parameters: { type: 'object', properties: { expr: { type: 'string' } } },
        },
      ],
    });
    expect(countExample(decorated)).toBe(countExample(bare));
    expect(countExample(bare)).toBe(7 + MESSAGE_TOKEN_OVERHEAD); // 11
  });

  it('returns 0 for an example with no messages', () => {
    const example = createExample({ projectId: 'p1', messages: [] });
    expect(countExample(example)).toBe(0);
  });

  it('charges only the overhead for empty-content messages', () => {
    const example = createExample({
      projectId: 'p1',
      messages: [msg('user', ''), msg('assistant', '')],
    });
    expect(countExample(example)).toBe(2 * MESSAGE_TOKEN_OVERHEAD); // 8
  });
});

describe('countExamples', () => {
  it('returns zeroed results for an empty batch', () => {
    expect(countExamples([])).toEqual({ total: 0, perExample: [] });
  });

  it('aggregates totals and keeps per-example counts index-aligned', () => {
    const a = createExample({
      projectId: 'p1',
      messages: [msg('user', 'hello world')], // 2 + 4 = 6
    });
    const b = createExample({
      projectId: 'p1',
      type: 'preference',
      messages: [msg('user', 'What is 2+2?')], // 7 + 4
      chosen: [msg('assistant', '2+2 equals 4.')], // 7 + 4
      rejected: [msg('assistant', 'Bad answer')], // 2 + 4
    }); // 28
    const c = createExample({ projectId: 'p1', messages: [] }); // 0

    const result = countExamples([a, b, c]);
    expect(result.perExample).toEqual([6, 28, 0]);
    expect(result.total).toBe(34);
    expect(result.perExample[0]).toBe(countExample(a));
    expect(result.perExample[1]).toBe(countExample(b));
  });
});

describe('approxAnthropicTokens', () => {
  it('returns 0 for the empty string', () => {
    expect(approxAnthropicTokens('')).toBe(0);
  });

  it('rounds up at ~3.5 chars per token', () => {
    expect(ANTHROPIC_CHARS_PER_TOKEN).toBe(3.5);
    expect(approxAnthropicTokens('a')).toBe(1); // ceil(1 / 3.5)
    expect(approxAnthropicTokens('abcdefg')).toBe(2); // ceil(7 / 3.5)
    expect(approxAnthropicTokens('x'.repeat(35))).toBe(10); // exact multiple
    expect(approxAnthropicTokens('x'.repeat(36))).toBe(11); // rounds up
  });

  it('counts characters, not bytes', () => {
    // 4 UTF-16 code units (surrogate pair counts as 2) → ceil(4 / 3.5) = 2.
    expect(approxAnthropicTokens('ab🌍')).toBe(2);
  });
});
