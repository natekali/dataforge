import { describe, it, expect } from 'vitest';
import type { Message, TemplateFamily, ToolCall } from '@/engine/types';
import {
  SPECIAL_TOKENS,
  ALL_SPECIAL_TOKENS,
  renderConversation,
  renderToolCallText,
  reasoningToInline,
} from './templates';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const msg = (role: Message['role'], content: string, extra?: Partial<Message>): Message => ({
  role,
  content,
  ...extra,
});

/** 3-turn conversation with a system prompt. */
const threeTurn: Message[] = [
  msg('system', 'You are helpful.'),
  msg('user', 'Hello'),
  msg('assistant', 'Hi there'),
];

/** Multi-turn conversation: system + 2 user/assistant exchanges. */
const fiveTurn: Message[] = [
  msg('system', 'SYS'),
  msg('user', 'U1'),
  msg('assistant', 'A1'),
  msg('user', 'U2'),
  msg('assistant', 'A2'),
];

const ALL_FAMILIES: TemplateFamily[] = [
  'chatml',
  'kimi-chatml',
  'llama3',
  'llama4',
  'gemma',
  'mistral-tekken',
  'deepseek',
  'harmony',
  'glm',
  'granite',
  'phi4',
  'phi4-mini',
];

/** Assert that the given substrings appear in `text` in strictly increasing order. */
function expectOrder(text: string, ...parts: string[]): void {
  let cursor = -1;
  for (const part of parts) {
    const idx = text.indexOf(part, cursor + 1);
    expect(idx, `expected "${part}" after position ${cursor} in:\n${text}`).toBeGreaterThan(cursor);
    cursor = idx;
  }
}

// ---------------------------------------------------------------------------
// SPECIAL_TOKENS / ALL_SPECIAL_TOKENS
// ---------------------------------------------------------------------------

describe('SPECIAL_TOKENS', () => {
  it('covers every template family with at least 2 tokens', () => {
    for (const family of ALL_FAMILIES) {
      expect(SPECIAL_TOKENS[family].length).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses the genuine fullwidth/lower-block characters for deepseek', () => {
    expect(SPECIAL_TOKENS.deepseek).toContain('<｜User｜>');
    expect(SPECIAL_TOKENS.deepseek).toContain('<｜begin▁of▁sentence｜>');
    expect(SPECIAL_TOKENS.deepseek).toContain('<think>');
    expect(SPECIAL_TOKENS.deepseek).toContain('</think>');
  });

  it('lists the documented control tokens per family', () => {
    expect(SPECIAL_TOKENS.chatml).toEqual(['<|im_start|>', '<|im_end|>']);
    expect(SPECIAL_TOKENS['kimi-chatml']).toContain('<|im_middle|>');
    expect(SPECIAL_TOKENS.llama3).toContain('<|eot_id|>');
    expect(SPECIAL_TOKENS.llama4).toContain('<|eot|>');
    expect(SPECIAL_TOKENS.gemma).toContain('<bos>');
    expect(SPECIAL_TOKENS['mistral-tekken']).toContain('[SYSTEM_PROMPT]');
    expect(SPECIAL_TOKENS['mistral-tekken']).toContain('[/THINK]');
    expect(SPECIAL_TOKENS.harmony).toContain('<|return|>');
    expect(SPECIAL_TOKENS.glm).toContain('[gMASK]');
    expect(SPECIAL_TOKENS.glm).toContain('<|observation|>');
    expect(SPECIAL_TOKENS.granite).toContain('<|start_of_role|>');
    expect(SPECIAL_TOKENS.phi4).toContain('<|im_sep|>');
    expect(SPECIAL_TOKENS['phi4-mini']).toContain('<|end|>');
  });
});

describe('ALL_SPECIAL_TOKENS', () => {
  it('is the deduplicated union of all family tokens', () => {
    expect(new Set(ALL_SPECIAL_TOKENS).size).toBe(ALL_SPECIAL_TOKENS.length);
    const union = new Set(Object.values(SPECIAL_TOKENS).flat());
    expect(new Set(ALL_SPECIAL_TOKENS)).toEqual(union);
  });

  it('contains shared tokens exactly once', () => {
    // <|im_end|> appears in chatml, kimi-chatml and phi4.
    expect(ALL_SPECIAL_TOKENS.filter((t) => t === '<|im_end|>')).toHaveLength(1);
    // <|begin_of_text|> appears in llama3 and llama4.
    expect(ALL_SPECIAL_TOKENS.filter((t) => t === '<|begin_of_text|>')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// renderConversation — exact wire format per family
// ---------------------------------------------------------------------------

describe('renderConversation — exact output per family', () => {
  it('chatml', () => {
    expect(renderConversation(threeTurn, 'chatml')).toBe(
      '<|im_start|>system\nYou are helpful.<|im_end|>\n' +
        '<|im_start|>user\nHello<|im_end|>\n' +
        '<|im_start|>assistant\nHi there<|im_end|>\n',
    );
  });

  it('kimi-chatml', () => {
    expect(renderConversation(threeTurn, 'kimi-chatml')).toBe(
      '<|im_system|>system<|im_middle|>You are helpful.<|im_end|>' +
        '<|im_user|>user<|im_middle|>Hello<|im_end|>' +
        '<|im_assistant|>assistant<|im_middle|>Hi there<|im_end|>',
    );
  });

  it('llama3', () => {
    expect(renderConversation(threeTurn, 'llama3')).toBe(
      '<|begin_of_text|>' +
        '<|start_header_id|>system<|end_header_id|>\n\nYou are helpful.<|eot_id|>' +
        '<|start_header_id|>user<|end_header_id|>\n\nHello<|eot_id|>' +
        '<|start_header_id|>assistant<|end_header_id|>\n\nHi there<|eot_id|>',
    );
  });

  it('llama4', () => {
    expect(renderConversation(threeTurn, 'llama4')).toBe(
      '<|begin_of_text|>' +
        '<|header_start|>system<|header_end|>\n\nYou are helpful.<|eot|>' +
        '<|header_start|>user<|header_end|>\n\nHello<|eot|>' +
        '<|header_start|>assistant<|header_end|>\n\nHi there<|eot|>',
    );
  });

  it('gemma (system merged into first user turn)', () => {
    expect(renderConversation(threeTurn, 'gemma')).toBe(
      '<bos>' +
        '<start_of_turn>user\nYou are helpful.\n\nHello<end_of_turn>\n' +
        '<start_of_turn>model\nHi there<end_of_turn>\n',
    );
  });

  it('mistral-tekken', () => {
    expect(renderConversation(threeTurn, 'mistral-tekken')).toBe(
      '<s>[SYSTEM_PROMPT]You are helpful.[/SYSTEM_PROMPT][INST]Hello[/INST]Hi there</s>',
    );
  });

  it('deepseek', () => {
    expect(renderConversation(threeTurn, 'deepseek')).toBe(
      '<｜begin▁of▁sentence｜>You are helpful.<｜User｜>Hello<｜Assistant｜>Hi there<｜end▁of▁sentence｜>',
    );
  });

  it('harmony (final reply stops with <|return|>)', () => {
    expect(renderConversation(threeTurn, 'harmony')).toBe(
      '<|start|>system<|message|>You are helpful.<|end|>' +
        '<|start|>user<|message|>Hello<|end|>' +
        '<|start|>assistant<|channel|>final<|message|>Hi there<|return|>',
    );
  });

  it('glm', () => {
    expect(renderConversation(threeTurn, 'glm')).toBe(
      '[gMASK]<sop><|system|>\nYou are helpful.<|user|>\nHello<|assistant|>\nHi there',
    );
  });

  it('granite', () => {
    expect(renderConversation(threeTurn, 'granite')).toBe(
      '<|start_of_role|>system<|end_of_role|>You are helpful.<|end_of_text|>\n' +
        '<|start_of_role|>user<|end_of_role|>Hello<|end_of_text|>\n' +
        '<|start_of_role|>assistant<|end_of_role|>Hi there<|end_of_text|>\n',
    );
  });

  it('phi4', () => {
    expect(renderConversation(threeTurn, 'phi4')).toBe(
      '<|im_start|>system<|im_sep|>You are helpful.<|im_end|>' +
        '<|im_start|>user<|im_sep|>Hello<|im_end|>' +
        '<|im_start|>assistant<|im_sep|>Hi there<|im_end|>',
    );
  });

  it('phi4-mini', () => {
    expect(renderConversation(threeTurn, 'phi4-mini')).toBe(
      '<|system|>You are helpful.<|end|><|user|>Hello<|end|><|assistant|>Hi there<|end|>',
    );
  });
});

describe('renderConversation — control-token ordering on multi-turn input', () => {
  it('keeps role headers in turn order for every family', () => {
    for (const family of ALL_FAMILIES) {
      const text = renderConversation(fiveTurn, family);
      expectOrder(text, 'U1', 'A1', 'U2', 'A2');
    }
  });

  it('repeats per-turn control tokens once per turn (chatml)', () => {
    const text = renderConversation(fiveTurn, 'chatml');
    expect(text.match(/<\|im_start\|>/g)).toHaveLength(5);
    expect(text.match(/<\|im_end\|>/g)).toHaveLength(5);
  });

  it('emits BOS exactly once (llama3, gemma, deepseek, mistral)', () => {
    expect(renderConversation(fiveTurn, 'llama3').match(/<\|begin_of_text\|>/g)).toHaveLength(1);
    expect(renderConversation(fiveTurn, 'gemma').match(/<bos>/g)).toHaveLength(1);
    expect(
      renderConversation(fiveTurn, 'deepseek').match(/<｜begin▁of▁sentence｜>/g),
    ).toHaveLength(1);
    expect(renderConversation(fiveTurn, 'mistral-tekken').startsWith('<s>')).toBe(true);
  });

  it('harmony: only the very last assistant reply stops with <|return|>', () => {
    const text = renderConversation(fiveTurn, 'harmony');
    expect(text.match(/<\|return\|>/g)).toHaveLength(1);
    expect(text.endsWith('A2<|return|>')).toBe(true);
    expectOrder(text, 'A1<|end|>', 'A2<|return|>');
  });
});

// ---------------------------------------------------------------------------
// System handling
// ---------------------------------------------------------------------------

describe('system handling', () => {
  it('gemma never emits a system role label', () => {
    const text = renderConversation(threeTurn, 'gemma');
    expect(text).not.toContain('system');
    expect(text).toContain('<start_of_turn>user\nYou are helpful.\n\nHello');
  });

  it('gemma without any user turn emits system text as a user turn', () => {
    const text = renderConversation([msg('system', 'SYS only')], 'gemma');
    expect(text).toBe('<bos><start_of_turn>user\nSYS only<end_of_turn>\n');
  });

  it('developer role renders like system for non-harmony families', () => {
    const text = renderConversation([msg('developer', 'Dev rules'), msg('user', 'Hi')], 'chatml');
    expect(text).toContain('<|im_start|>system\nDev rules<|im_end|>');
  });

  it('harmony keeps developer as a distinct role', () => {
    const text = renderConversation([msg('developer', 'Dev rules'), msg('user', 'Hi')], 'harmony');
    expect(text).toContain('<|start|>developer<|message|>Dev rules<|end|>');
  });
});

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

describe('reasoning rendering', () => {
  const withReasoning: Message[] = [
    msg('user', 'Why?'),
    msg('assistant', 'Because.', { reasoning: 'thinking hard' }),
  ];

  it('inlines <think> blocks by default (chatml)', () => {
    const text = renderConversation(withReasoning, 'chatml');
    expect(text).toContain('<|im_start|>assistant\n<think>\nthinking hard\n</think>\n\nBecause.');
  });

  it('inlines <think> blocks for deepseek', () => {
    const text = renderConversation(withReasoning, 'deepseek');
    expect(text).toContain('<｜Assistant｜><think>\nthinking hard\n</think>\n\nBecause.');
  });

  it('uses [THINK] delimiters for mistral-tekken', () => {
    const text = renderConversation(withReasoning, 'mistral-tekken');
    expect(text).toContain('[THINK]thinking hard[/THINK]Because.</s>');
  });

  it('harmony renders reasoning as a separate analysis-channel message', () => {
    const text = renderConversation(withReasoning, 'harmony');
    expectOrder(
      text,
      '<|start|>assistant<|channel|>analysis<|message|>thinking hard<|end|>',
      '<|start|>assistant<|channel|>final<|message|>Because.<|return|>',
    );
    expect(text).not.toContain('<think>');
  });

  it('includeReasoning: false strips traces entirely', () => {
    for (const family of ALL_FAMILIES) {
      const text = renderConversation(withReasoning, family, { includeReasoning: false });
      expect(text).not.toContain('thinking hard');
      expect(text).not.toContain('<think>');
      expect(text).not.toContain('[THINK]');
      expect(text).not.toContain('analysis');
    }
  });

  it('stripPriorThinking keeps only the final assistant trace', () => {
    const convo: Message[] = [
      msg('user', 'U1'),
      msg('assistant', 'A1', { reasoning: 'first trace' }),
      msg('user', 'U2'),
      msg('assistant', 'A2', { reasoning: 'final trace' }),
    ];
    for (const family of ALL_FAMILIES) {
      const text = renderConversation(convo, family, { stripPriorThinking: true });
      expect(text, family).not.toContain('first trace');
      expect(text, family).toContain('final trace');
    }
    // Without the option both traces survive.
    const both = renderConversation(convo, 'chatml');
    expect(both).toContain('first trace');
    expect(both).toContain('final trace');
  });

  it('empty reasoning strings are ignored', () => {
    const text = renderConversation(
      [msg('user', 'Q'), msg('assistant', 'A', { reasoning: '' })],
      'chatml',
    );
    expect(text).not.toContain('<think>');
  });
});

// ---------------------------------------------------------------------------
// Generation prompt
// ---------------------------------------------------------------------------

describe('addGenerationPrompt', () => {
  const prompt: Message[] = [msg('system', 'S'), msg('user', 'Q')];
  const expectedTail: Record<TemplateFamily, string> = {
    chatml: '<|im_start|>assistant\n',
    'kimi-chatml': '<|im_assistant|>assistant<|im_middle|>',
    llama3: '<|start_header_id|>assistant<|end_header_id|>\n\n',
    llama4: '<|header_start|>assistant<|header_end|>\n\n',
    gemma: '<start_of_turn>model\n',
    'mistral-tekken': '[/INST]', // Mistral generates directly after [/INST]
    deepseek: '<｜Assistant｜>',
    harmony: '<|start|>assistant',
    glm: '<|assistant|>',
    granite: '<|start_of_role|>assistant<|end_of_role|>',
    phi4: '<|im_start|>assistant<|im_sep|>',
    'phi4-mini': '<|assistant|>',
  };

  it('appends the family generation header', () => {
    for (const family of ALL_FAMILIES) {
      const text = renderConversation(prompt, family, { addGenerationPrompt: true });
      expect(text.endsWith(expectedTail[family]), `${family}:\n${text}`).toBe(true);
    }
  });

  it('is off by default', () => {
    expect(renderConversation(prompt, 'chatml').endsWith('<|im_start|>assistant\n')).toBe(false);
  });

  it('harmony uses <|end|> (not <|return|>) on the last reply when prompting', () => {
    const text = renderConversation(threeTurn, 'harmony', { addGenerationPrompt: true });
    expect(text).toContain('<|message|>Hi there<|end|>');
    expect(text).not.toContain('<|return|>');
    expect(text.endsWith('<|start|>assistant')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tool messages and tool calls inside conversations
// ---------------------------------------------------------------------------

describe('tool turns in renderConversation', () => {
  const call: ToolCall = { id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' };
  const toolConvo: Message[] = [
    msg('user', 'Weather in Paris?'),
    msg('assistant', '', { toolCalls: [call] }),
    msg('tool', '{"temp":21}', { toolCallId: 'call_1', name: 'get_weather' }),
    msg('assistant', 'It is 21C.'),
  ];

  it('chatml renders hermes tool calls inside the assistant turn', () => {
    const text = renderConversation(toolConvo, 'chatml');
    expect(text).toContain(
      '<|im_start|>assistant\n<tool_call>\n{"name":"get_weather","arguments":{"city":"Paris"}}\n</tool_call><|im_end|>',
    );
    expect(text).toContain('<|im_start|>tool\n{"temp":21}<|im_end|>');
  });

  it('mistral-tekken renders [TOOL_CALLS] and tool results', () => {
    const text = renderConversation(toolConvo, 'mistral-tekken');
    expect(text).toContain(
      '[TOOL_CALLS][{"name":"get_weather","arguments":{"city":"Paris"},"id":"call_1"}]',
    );
    expect(text).toContain('[TOOL_RESULTS]{"temp":21}[/TOOL_RESULTS]');
  });

  it('llama3 maps the tool role to ipython', () => {
    const text = renderConversation(toolConvo, 'llama3');
    expect(text).toContain('<|start_header_id|>ipython<|end_header_id|>\n\n{"temp":21}<|eot_id|>');
  });

  it('glm maps the tool role to <|observation|>', () => {
    const text = renderConversation(toolConvo, 'glm');
    expect(text).toContain('<|observation|>\n{"temp":21}');
  });

  it('granite maps the tool role to tool_response', () => {
    const text = renderConversation(toolConvo, 'granite');
    expect(text).toContain('<|start_of_role|>tool_response<|end_of_role|>{"temp":21}');
  });

  it('harmony renders calls on the commentary channel and results from functions.*', () => {
    const text = renderConversation(toolConvo, 'harmony');
    expectOrder(
      text,
      '<|start|>assistant<|channel|>commentary to=functions.get_weather<|message|>{"city":"Paris"}<|end|>',
      '<|start|>functions.get_weather<|message|>{"temp":21}<|end|>',
      '<|start|>assistant<|channel|>final<|message|>It is 21C.<|return|>',
    );
  });

  it('appends tool-call text after non-empty assistant content', () => {
    const text = renderConversation(
      [msg('user', 'Q'), msg('assistant', 'Let me check.', { toolCalls: [call] })],
      'chatml',
    );
    expect(text).toContain('Let me check.\n<tool_call>');
  });
});

// ---------------------------------------------------------------------------
// renderToolCallText
// ---------------------------------------------------------------------------

describe('renderToolCallText', () => {
  const calls: ToolCall[] = [
    { id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' },
    { id: 'call_2', name: 'get_time', arguments: '{"tz":"UTC"}' },
  ];

  it('hermes: one <tool_call> block per call', () => {
    expect(renderToolCallText(calls, 'hermes')).toBe(
      '<tool_call>\n{"name":"get_weather","arguments":{"city":"Paris"}}\n</tool_call>\n' +
        '<tool_call>\n{"name":"get_time","arguments":{"tz":"UTC"}}\n</tool_call>',
    );
  });

  it('mistral: single [TOOL_CALLS] token with a JSON array', () => {
    expect(renderToolCallText(calls, 'mistral')).toBe(
      '[TOOL_CALLS][{"name":"get_weather","arguments":{"city":"Paris"},"id":"call_1"},' +
        '{"name":"get_time","arguments":{"tz":"UTC"},"id":"call_2"}]',
    );
  });

  it('openai: JSON-stringified tool_calls array with string arguments', () => {
    const text = renderToolCallText(calls, 'openai');
    const parsed = JSON.parse(text) as Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
    });
  });

  it('glm: name + raw arguments per call', () => {
    expect(renderToolCallText(calls, 'glm')).toBe(
      'get_weather\n{"city":"Paris"}\nget_time\n{"tz":"UTC"}',
    );
  });

  it('llama-ipython: {"name", "parameters"} JSON per call', () => {
    expect(renderToolCallText([calls[0]!], 'llama-ipython')).toBe(
      '{"name":"get_weather","parameters":{"city":"Paris"}}',
    );
  });

  it('harmony-ts: commentary header addressed to functions.*', () => {
    expect(renderToolCallText([calls[0]!], 'harmony-ts')).toBe(
      '<|channel|>commentary to=functions.get_weather<|message|>{"city":"Paris"}',
    );
  });

  it('none: empty string', () => {
    expect(renderToolCallText(calls, 'none')).toBe('');
  });

  it('empty call list: empty string for any style', () => {
    expect(renderToolCallText([], 'hermes')).toBe('');
  });

  it('malformed argument JSON falls back to the raw string', () => {
    const bad: ToolCall[] = [{ id: 'c', name: 'f', arguments: 'not json' }];
    expect(renderToolCallText(bad, 'hermes')).toBe(
      '<tool_call>\n{"name":"f","arguments":"not json"}\n</tool_call>',
    );
  });
});

// ---------------------------------------------------------------------------
// reasoningToInline
// ---------------------------------------------------------------------------

describe('reasoningToInline', () => {
  const m: Message = { role: 'assistant', content: 'Answer.', reasoning: 'trace' };

  it('uses <think> delimiters for think-tag families', () => {
    for (const family of ['chatml', 'deepseek', 'llama3', 'glm', 'granite'] as TemplateFamily[]) {
      expect(reasoningToInline(m, family)).toBe('<think>\ntrace\n</think>\n\nAnswer.');
    }
  });

  it('uses [THINK] delimiters for mistral-tekken', () => {
    expect(reasoningToInline(m, 'mistral-tekken')).toBe('[THINK]trace[/THINK]Answer.');
  });

  it('falls back to <think> tags for harmony (documented behavior)', () => {
    expect(reasoningToInline(m, 'harmony')).toBe('<think>\ntrace\n</think>\n\nAnswer.');
  });

  it('returns content unchanged when there is no reasoning', () => {
    expect(reasoningToInline({ role: 'assistant', content: 'Plain.' }, 'chatml')).toBe('Plain.');
    expect(reasoningToInline({ role: 'assistant', content: 'Plain.', reasoning: '' }, 'chatml')).toBe(
      'Plain.',
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('renders an empty conversation as just the family prefix', () => {
    expect(renderConversation([], 'chatml')).toBe('');
    expect(renderConversation([], 'llama3')).toBe('<|begin_of_text|>');
    expect(renderConversation([], 'gemma')).toBe('<bos>');
    expect(renderConversation([], 'glm')).toBe('[gMASK]<sop>');
    expect(renderConversation([], 'mistral-tekken')).toBe('<s>');
  });

  it('empty conversation + generation prompt yields only the assistant header', () => {
    expect(renderConversation([], 'chatml', { addGenerationPrompt: true })).toBe(
      '<|im_start|>assistant\n',
    );
  });

  it('deepseek folds tool results into the user channel', () => {
    const text = renderConversation(
      [msg('user', 'Q'), msg('assistant', 'A'), msg('tool', 'RESULT')],
      'deepseek',
    );
    expect(text).toContain('<｜User｜>RESULT');
  });

  it('phi4-mini folds tool results into the user role', () => {
    const text = renderConversation([msg('tool', 'RESULT')], 'phi4-mini');
    expect(text).toBe('<|user|>RESULT<|end|>');
  });
});
