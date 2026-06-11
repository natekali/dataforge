/**
 * DataForge V2 — chat-template rendering + special tokens.
 *
 * Faithful plain-text renderers for every supported template family, used for
 * preview panes and token counting. Conventions are ported from the V1 Python
 * core (`dataforge_core/models.py`) and extended to the 2026 model landscape.
 *
 * Runtime-environment agnostic: no DOM, no React — safe in Web Workers and
 * Node (vitest).
 */

import type { Message, Role, TemplateFamily, ToolCall, ToolCallStyle } from '@/engine/types';

// ---------------------------------------------------------------------------
// Special tokens
// ---------------------------------------------------------------------------

/**
 * Every control token per template family. Used by renderers below and by the
 * quality engine to detect `special_token_conflict` issues (user data that
 * collides with the target model's control vocabulary).
 */
export const SPECIAL_TOKENS: Record<TemplateFamily, string[]> = {
  chatml: ['<|im_start|>', '<|im_end|>'],
  'kimi-chatml': ['<|im_system|>', '<|im_user|>', '<|im_assistant|>', '<|im_middle|>', '<|im_end|>'],
  llama3: ['<|begin_of_text|>', '<|start_header_id|>', '<|end_header_id|>', '<|eot_id|>'],
  llama4: ['<|begin_of_text|>', '<|header_start|>', '<|header_end|>', '<|eot|>'],
  gemma: ['<start_of_turn>', '<end_of_turn>', '<bos>'],
  'mistral-tekken': [
    '[INST]',
    '[/INST]',
    '[SYSTEM_PROMPT]',
    '[/SYSTEM_PROMPT]',
    '[TOOL_CALLS]',
    '[THINK]',
    '[/THINK]',
    '<s>',
    '</s>',
  ],
  deepseek: [
    '<｜begin▁of▁sentence｜>',
    '<｜User｜>',
    '<｜Assistant｜>',
    '<｜end▁of▁sentence｜>',
    '<think>',
    '</think>',
  ],
  harmony: ['<|start|>', '<|channel|>', '<|message|>', '<|end|>', '<|return|>'],
  glm: ['[gMASK]', '<sop>', '<|system|>', '<|user|>', '<|assistant|>', '<|observation|>'],
  granite: ['<|start_of_role|>', '<|end_of_role|>', '<|end_of_text|>'],
  phi4: ['<|im_start|>', '<|im_sep|>', '<|im_end|>'],
  'phi4-mini': ['<|system|>', '<|user|>', '<|assistant|>', '<|end|>'],
};

/**
 * Deduplicated union of every family's control tokens. Intended for
 * conflict-scanning user content against ALL known control vocabularies.
 */
export const ALL_SPECIAL_TOKENS: string[] = [...new Set(Object.values(SPECIAL_TOKENS).flat())];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link renderConversation}. */
export interface RenderOptions {
  /** Render reasoning traces (think blocks / analysis channel). Default true. */
  includeReasoning?: boolean;
  /** Drop reasoning from every assistant turn except the LAST one. Default false. */
  stripPriorThinking?: boolean;
  /** Append the family's assistant generation header at the end. Default false. */
  addGenerationPrompt?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A message with option-filtered reasoning, ready for family rendering. */
interface PreparedMessage {
  role: Role;
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  name?: string;
}

/** Native tool-call text form used when rendering assistant turns per family. */
const FAMILY_TOOL_STYLE: Record<TemplateFamily, ToolCallStyle> = {
  chatml: 'hermes',
  'kimi-chatml': 'hermes',
  llama3: 'llama-ipython',
  llama4: 'llama-ipython',
  gemma: 'hermes',
  'mistral-tekken': 'mistral',
  deepseek: 'openai',
  harmony: 'harmony-ts',
  glm: 'glm',
  granite: 'openai',
  phi4: 'openai',
  'phi4-mini': 'openai',
};

/** JSON.parse that falls back to the raw string for malformed arguments. */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Inline think-block prefix for a reasoning trace in the family's delimiters.
 * mistral-tekken uses `[THINK]…[/THINK]`; every other inline family uses
 * `<think>…</think>` (Qwen/DeepSeek convention, trailing blank line).
 */
function thinkPrefix(family: TemplateFamily, reasoning: string): string {
  if (family === 'mistral-tekken') return `[THINK]${reasoning}[/THINK]`;
  return `<think>\n${reasoning}\n</think>\n\n`;
}

/**
 * Apply reasoning options: drops traces when `includeReasoning` is false and
 * keeps only the final assistant trace when `stripPriorThinking` is true.
 */
function prepareMessages(messages: Message[], opts: Required<RenderOptions>): PreparedMessage[] {
  const lastAssistantIdx = messages.findLastIndex((m) => m.role === 'assistant');
  return messages.map((m, i) => {
    const keepReasoning =
      m.role === 'assistant' &&
      m.reasoning !== undefined &&
      m.reasoning !== '' &&
      opts.includeReasoning &&
      (!opts.stripPriorThinking || i === lastAssistantIdx);
    return {
      role: m.role,
      content: m.content,
      reasoning: keepReasoning ? m.reasoning : undefined,
      toolCalls: m.toolCalls,
      name: m.name,
    };
  });
}

/**
 * Assistant turn body for inline-think families: think prefix + content,
 * with native-form tool-call text appended on its own line.
 */
function assistantBody(m: PreparedMessage, family: TemplateFamily): string {
  const think = m.reasoning ? thinkPrefix(family, m.reasoning) : '';
  let body = think + m.content;
  if (m.toolCalls && m.toolCalls.length > 0) {
    const tools = renderToolCallText(m.toolCalls, FAMILY_TOOL_STYLE[family]);
    body = body ? `${body}\n${tools}` : tools;
  }
  return body;
}

/**
 * Gemma has no system role: fold system/developer text into the first user
 * turn (`{system}\n\n{user}`), or emit it as a standalone user turn when the
 * conversation has no user message.
 */
function mergeSystemIntoFirstUser(messages: PreparedMessage[]): PreparedMessage[] {
  const systems = messages.filter((m) => m.role === 'system' || m.role === 'developer');
  if (systems.length === 0) return messages;
  const rest = messages.filter((m) => m.role !== 'system' && m.role !== 'developer');
  const systemText = systems.map((m) => m.content).join('\n\n');
  const firstUserIdx = rest.findIndex((m) => m.role === 'user');
  if (firstUserIdx === -1) {
    return [{ role: 'user', content: systemText }, ...rest];
  }
  return rest.map((m, i) =>
    i === firstUserIdx ? { ...m, content: `${systemText}\n\n${m.content}` } : m,
  );
}

/** Map the canonical role to the textual role label a family expects. */
function roleLabel(role: Role, toolLabel: string): string {
  if (role === 'developer') return 'system';
  if (role === 'tool') return toolLabel;
  return role;
}

// ---------------------------------------------------------------------------
// Family renderers
// ---------------------------------------------------------------------------

function renderChatml(msgs: PreparedMessage[], gen: boolean): string {
  let out = '';
  for (const m of msgs) {
    const body = m.role === 'assistant' ? assistantBody(m, 'chatml') : m.content;
    out += `<|im_start|>${roleLabel(m.role, 'tool')}\n${body}<|im_end|>\n`;
  }
  if (gen) out += '<|im_start|>assistant\n';
  return out;
}

function renderKimiChatml(msgs: PreparedMessage[], gen: boolean): string {
  let out = '';
  for (const m of msgs) {
    const body = m.role === 'assistant' ? assistantBody(m, 'kimi-chatml') : m.content;
    let header: string;
    if (m.role === 'user') header = '<|im_user|>user';
    else if (m.role === 'assistant') header = '<|im_assistant|>assistant';
    else if (m.role === 'tool') header = '<|im_system|>tool';
    else header = '<|im_system|>system';
    out += `${header}<|im_middle|>${body}<|im_end|>`;
  }
  if (gen) out += '<|im_assistant|>assistant<|im_middle|>';
  return out;
}

function renderLlama(
  msgs: PreparedMessage[],
  gen: boolean,
  family: 'llama3' | 'llama4',
): string {
  const [hStart, hEnd, eot] =
    family === 'llama3'
      ? ['<|start_header_id|>', '<|end_header_id|>', '<|eot_id|>']
      : ['<|header_start|>', '<|header_end|>', '<|eot|>'];
  let out = '<|begin_of_text|>';
  for (const m of msgs) {
    const body = m.role === 'assistant' ? assistantBody(m, family) : m.content;
    out += `${hStart}${roleLabel(m.role, 'ipython')}${hEnd}\n\n${body}${eot}`;
  }
  if (gen) out += `${hStart}assistant${hEnd}\n\n`;
  return out;
}

function renderGemma(msgs: PreparedMessage[], gen: boolean): string {
  let out = '<bos>';
  for (const m of mergeSystemIntoFirstUser(msgs)) {
    const body = m.role === 'assistant' ? assistantBody(m, 'gemma') : m.content;
    const label = m.role === 'assistant' ? 'model' : 'user';
    out += `<start_of_turn>${label}\n${body}<end_of_turn>\n`;
  }
  if (gen) out += '<start_of_turn>model\n';
  return out;
}

function renderMistralTekken(msgs: PreparedMessage[]): string {
  let out = '<s>';
  for (const m of msgs) {
    switch (m.role) {
      case 'system':
      case 'developer':
        out += `[SYSTEM_PROMPT]${m.content}[/SYSTEM_PROMPT]`;
        break;
      case 'user':
        out += `[INST]${m.content}[/INST]`;
        break;
      case 'assistant':
        out += `${assistantBody(m, 'mistral-tekken')}</s>`;
        break;
      case 'tool':
        out += `[TOOL_RESULTS]${m.content}[/TOOL_RESULTS]`;
        break;
    }
  }
  // No generation header: Mistral models generate directly after [/INST].
  return out;
}

function renderDeepseek(msgs: PreparedMessage[], gen: boolean): string {
  let out = '<｜begin▁of▁sentence｜>';
  for (const m of msgs) {
    switch (m.role) {
      case 'system':
      case 'developer':
        // DeepSeek renders the system prompt bare, directly after BOS.
        out += m.content;
        break;
      case 'user':
      case 'tool':
        out += `<｜User｜>${m.content}`;
        break;
      case 'assistant':
        out += `<｜Assistant｜>${assistantBody(m, 'deepseek')}<｜end▁of▁sentence｜>`;
        break;
    }
  }
  if (gen) out += '<｜Assistant｜>';
  return out;
}

function renderHarmony(msgs: PreparedMessage[], gen: boolean): string {
  let out = '';
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const isLast = i === msgs.length - 1;
    switch (m.role) {
      case 'system':
        out += `<|start|>system<|message|>${m.content}<|end|>`;
        break;
      case 'developer':
        out += `<|start|>developer<|message|>${m.content}<|end|>`;
        break;
      case 'user':
        out += `<|start|>user<|message|>${m.content}<|end|>`;
        break;
      case 'tool':
        out += `<|start|>functions.${m.name ?? 'tool'}<|message|>${m.content}<|end|>`;
        break;
      case 'assistant': {
        // Reasoning becomes a separate analysis-channel message.
        if (m.reasoning) {
          out += `<|start|>assistant<|channel|>analysis<|message|>${m.reasoning}<|end|>`;
        }
        // Tool calls become commentary-channel messages addressed to functions.
        for (const call of m.toolCalls ?? []) {
          out += `<|start|>assistant<|channel|>commentary to=functions.${call.name}<|message|>${call.arguments}<|end|>`;
        }
        if (m.content) {
          // The final assistant reply of a finished conversation stops with
          // <|return|>; everything earlier stops with <|end|>.
          const stop = isLast && !gen ? '<|return|>' : '<|end|>';
          out += `<|start|>assistant<|channel|>final<|message|>${m.content}${stop}`;
        }
        break;
      }
    }
  }
  if (gen) out += '<|start|>assistant';
  return out;
}

function renderGlm(msgs: PreparedMessage[], gen: boolean): string {
  let out = '[gMASK]<sop>';
  for (const m of msgs) {
    const body = m.role === 'assistant' ? assistantBody(m, 'glm') : m.content;
    out += `<|${roleLabel(m.role, 'observation')}|>\n${body}`;
  }
  if (gen) out += '<|assistant|>';
  return out;
}

function renderGranite(msgs: PreparedMessage[], gen: boolean): string {
  let out = '';
  for (const m of msgs) {
    const body = m.role === 'assistant' ? assistantBody(m, 'granite') : m.content;
    out += `<|start_of_role|>${roleLabel(m.role, 'tool_response')}<|end_of_role|>${body}<|end_of_text|>\n`;
  }
  if (gen) out += '<|start_of_role|>assistant<|end_of_role|>';
  return out;
}

function renderPhi4(msgs: PreparedMessage[], gen: boolean): string {
  let out = '';
  for (const m of msgs) {
    const body = m.role === 'assistant' ? assistantBody(m, 'phi4') : m.content;
    out += `<|im_start|>${roleLabel(m.role, 'tool')}<|im_sep|>${body}<|im_end|>`;
  }
  if (gen) out += '<|im_start|>assistant<|im_sep|>';
  return out;
}

function renderPhi4Mini(msgs: PreparedMessage[], gen: boolean): string {
  let out = '';
  for (const m of msgs) {
    const body = m.role === 'assistant' ? assistantBody(m, 'phi4-mini') : m.content;
    // phi4-mini has no dedicated tool role token; tool results render as user.
    const label = m.role === 'assistant' ? 'assistant' : m.role === 'user' || m.role === 'tool' ? 'user' : 'system';
    out += `<|${label}|>${body}<|end|>`;
  }
  if (gen) out += '<|assistant|>';
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a conversation to the family's plain-text wire format, for preview
 * and token counting.
 *
 * Family-specific behavior:
 * - gemma merges system/developer text into the first user turn (no system role).
 * - harmony renders reasoning as a separate analysis-channel assistant message
 *   and ends the final assistant reply with `<|return|>`.
 * - mistral-tekken inlines reasoning as `[THINK]…[/THINK]`; every other inline
 *   family uses `<think>…</think>`.
 * - Assistant tool calls render in the family's native style (hermes tags for
 *   ChatML-likes, `[TOOL_CALLS]` for Mistral, commentary channel for harmony…).
 *
 * @param messages Conversation in canonical form.
 * @param family   Target chat-template family.
 * @param opts     Reasoning/generation-prompt options (see {@link RenderOptions}).
 */
export function renderConversation(
  messages: Message[],
  family: TemplateFamily,
  opts?: RenderOptions,
): string {
  const resolved: Required<RenderOptions> = {
    includeReasoning: opts?.includeReasoning ?? true,
    stripPriorThinking: opts?.stripPriorThinking ?? false,
    addGenerationPrompt: opts?.addGenerationPrompt ?? false,
  };
  const prepared = prepareMessages(messages, resolved);
  const gen = resolved.addGenerationPrompt;

  switch (family) {
    case 'chatml':
      return renderChatml(prepared, gen);
    case 'kimi-chatml':
      return renderKimiChatml(prepared, gen);
    case 'llama3':
      return renderLlama(prepared, gen, 'llama3');
    case 'llama4':
      return renderLlama(prepared, gen, 'llama4');
    case 'gemma':
      return renderGemma(prepared, gen);
    case 'mistral-tekken':
      return renderMistralTekken(prepared);
    case 'deepseek':
      return renderDeepseek(prepared, gen);
    case 'harmony':
      return renderHarmony(prepared, gen);
    case 'glm':
      return renderGlm(prepared, gen);
    case 'granite':
      return renderGranite(prepared, gen);
    case 'phi4':
      return renderPhi4(prepared, gen);
    case 'phi4-mini':
      return renderPhi4Mini(prepared, gen);
    default: {
      const exhaustive: never = family;
      throw new Error(`Unknown template family: ${String(exhaustive)}`);
    }
  }
}

/**
 * Render tool calls to text in the requested style.
 *
 * - `hermes`:        one `<tool_call>{json}</tool_call>` block per call.
 * - `mistral`:       a single `[TOOL_CALLS][{…}, …]` token with a JSON array.
 * - `openai`:        the JSON-stringified OpenAI `tool_calls` array
 *                    (arguments stay a JSON-encoded string, per spec).
 * - `glm`:           `{name}\n{arguments}` per call (GLM observation flow).
 * - `llama-ipython`: `{"name": …, "parameters": …}` JSON per call (Llama 3.1+).
 * - `harmony-ts`:    commentary-channel header per call
 *                    (`<|channel|>commentary to=functions.{name}<|message|>{args}`).
 * - `none`:          empty string.
 *
 * Arguments are parsed from their canonical JSON-string form where the style
 * embeds them as objects; malformed JSON falls back to the raw string.
 */
export function renderToolCallText(toolCalls: ToolCall[], style: ToolCallStyle): string {
  if (style === 'none' || toolCalls.length === 0) return '';
  switch (style) {
    case 'hermes':
      return toolCalls
        .map(
          (c) =>
            `<tool_call>\n${JSON.stringify({ name: c.name, arguments: tryParseJson(c.arguments) })}\n</tool_call>`,
        )
        .join('\n');
    case 'mistral':
      return `[TOOL_CALLS]${JSON.stringify(
        toolCalls.map((c) => ({ name: c.name, arguments: tryParseJson(c.arguments), id: c.id })),
      )}`;
    case 'openai':
      return JSON.stringify(
        toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments },
        })),
      );
    case 'glm':
      return toolCalls.map((c) => `${c.name}\n${c.arguments}`).join('\n');
    case 'llama-ipython':
      return toolCalls
        .map((c) => JSON.stringify({ name: c.name, parameters: tryParseJson(c.arguments) }))
        .join('\n');
    case 'harmony-ts':
      return toolCalls
        .map((c) => `<|channel|>commentary to=functions.${c.name}<|message|>${c.arguments}`)
        .join('\n');
    default: {
      const exhaustive: never = style;
      throw new Error(`Unknown tool-call style: ${String(exhaustive)}`);
    }
  }
}

/**
 * Return a message's content with its reasoning trace prepended in the
 * family's inline delimiters (`[THINK]…[/THINK]` for mistral-tekken,
 * `<think>…</think>` otherwise). Messages without reasoning are returned
 * unchanged.
 *
 * Note: harmony has no inline delimiters (reasoning lives in the analysis
 * channel — see {@link renderConversation}); this helper falls back to
 * `<think>` tags for harmony so the trace is never silently dropped.
 */
export function reasoningToInline(message: Message, family: TemplateFamily): string {
  if (message.reasoning === undefined || message.reasoning === '') return message.content;
  return thinkPrefix(family, message.reasoning) + message.content;
}
