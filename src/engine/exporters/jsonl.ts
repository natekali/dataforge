/**
 * DataForge V2 — canonical OpenAI-messages JSONL exporter + the shared
 * rendering core used by every framework builder.
 *
 * Shared rendering rules (applied identically across frameworks):
 *  - Canonical message JSON = { role, content, tool_calls?, tool_call_id?,
 *    name?, weight? } with tool_calls in OpenAI wrapped form
 *    ({ id, type: "function", function: { name, arguments: string } }).
 *  - Reasoning: when `options.includeReasoning` and a message has a trace,
 *    harmony-family targets get a separate `thinking` field on assistant
 *    messages; every other target gets the trace inlined with the model's
 *    think delimiters (default `<think>…</think>`). A message NEVER carries
 *    both a `thinking` field and inline tags.
 *  - `options.stripPriorThinking` keeps only the FINAL assistant trace of a
 *    message array; prompt-context arrays (preference/kto/rl prompts) have no
 *    final turn, so all of their traces are stripped.
 *  - `options.includeSystem === false` drops system AND developer turns.
 *  - Per-example tool schemas render as top-level
 *    `tools: [{ type: "function", function: { name, description, parameters } }]`.
 *
 * Runtime-environment agnostic: no DOM, no React.
 */

import type {
  Example,
  ExportOptions,
  Message,
  ModelInfo,
  Role,
  SplitName,
  ToolDefinition,
} from '@/engine/types';
import { examplesToRows } from '@/engine/convert';
import { renderToolCallText } from '@/engine/templates';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Options + resolved target model threaded through every builder. */
export interface RenderContext {
  options: ExportOptions;
  model?: ModelInfo;
}

/** Map of split name → emitted data-file path (e.g. train → "data/train.jsonl"). */
export type SplitFileMap = Partial<Record<SplitName, string>>;

/** How reasoning traces are rendered for a target. */
export type ReasoningStyle =
  | { kind: 'thinking-field' }
  | { kind: 'inline'; open: string; close: string };

/** OpenAI wrapped tool-call shape used in canonical message JSON. */
export interface CanonicalToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Canonical message JSON emitted to dataset files. */
export interface CanonicalMessage {
  role: Role;
  content: string;
  /** Separate reasoning trace — harmony-family targets only. */
  thinking?: string;
  tool_calls?: CanonicalToolCall[];
  tool_call_id?: string;
  name?: string;
  weight?: 0 | 1;
}

/** Message-array role: a prompt context has no "final" assistant turn. */
export interface PrepareOptions {
  /** 'prompt' = preference/kto/rl prompt portion; 'final' (default) = full conversation. */
  context?: 'prompt' | 'final';
}

/** {@link renderMessages} options. */
export interface RenderMessagesOptions extends PrepareOptions {
  /** Override the model-resolved reasoning style (e.g. MS-SWIFT forces `<think>`). */
  style?: ReasoningStyle;
}

// ---------------------------------------------------------------------------
// Reasoning style resolution
// ---------------------------------------------------------------------------

/** Default inline delimiters when no target model is selected. */
const DEFAULT_THINK: { open: string; close: string } = { open: '<think>', close: '</think>' };

/**
 * Resolve the reasoning style for a target model: harmony-family models get a
 * separate `thinking` field; models with inline delimiters use those; no model
 * (or no declared delimiters) falls back to `<think>…</think>`.
 */
export function resolveReasoningStyle(model?: ModelInfo): ReasoningStyle {
  if (model?.templateFamily === 'harmony' || model?.thinkDelimiters === 'harmony-channel') {
    return { kind: 'thinking-field' };
  }
  return inlineReasoningStyle(model);
}

/**
 * Always-inline reasoning style for text-only shapes (flattened DPO columns,
 * LLaMA-Factory role/content messages) where a `thinking` field cannot exist.
 * Harmony models fall back to `<think>` tags so traces are never dropped.
 */
export function inlineReasoningStyle(model?: ModelInfo): ReasoningStyle {
  const delimiters = model?.thinkDelimiters;
  if (Array.isArray(delimiters)) {
    return { kind: 'inline', open: delimiters[0], close: delimiters[1] };
  }
  return { kind: 'inline', ...DEFAULT_THINK };
}

/**
 * Prepend a reasoning trace to content using inline delimiters. Bracket-token
 * styles (`[THINK]…[/THINK]`) are compact; tag styles use the Qwen/DeepSeek
 * newline convention.
 */
export function inlineThink(
  style: { open: string; close: string },
  reasoning: string,
  content: string,
): string {
  if (style.open.startsWith('[')) {
    return `${style.open}${reasoning}${style.close}${content}`;
  }
  const block = `${style.open}\n${reasoning}\n${style.close}`;
  return content.length > 0 ? `${block}\n\n${content}` : block;
}

// ---------------------------------------------------------------------------
// Message preparation + canonical rendering
// ---------------------------------------------------------------------------

/**
 * Apply the export options to a message array: filters system/developer turns
 * when `includeSystem` is off and resolves which reasoning traces survive
 * (`includeReasoning` / `stripPriorThinking`, with prompt contexts treated as
 * having no final assistant turn). Returns copies — inputs are not mutated.
 */
export function prepareMessages(
  messages: Message[],
  ctx: RenderContext,
  opts?: PrepareOptions,
): Message[] {
  const { includeReasoning, stripPriorThinking, includeSystem } = ctx.options;
  const kept = includeSystem
    ? messages
    : messages.filter((m) => m.role !== 'system' && m.role !== 'developer');
  const lastAssistant =
    opts?.context === 'prompt' ? -1 : kept.findLastIndex((m) => m.role === 'assistant');
  return kept.map((m, i) => {
    const keepReasoning =
      m.role === 'assistant' &&
      m.reasoning !== undefined &&
      m.reasoning !== '' &&
      includeReasoning &&
      (!stripPriorThinking || i === lastAssistant);
    const copy: Message = { ...m };
    if (!keepReasoning) delete copy.reasoning;
    return copy;
  });
}

/** Render one prepared message to canonical JSON in the given reasoning style. */
function messageToCanonical(m: Message, style: ReasoningStyle): CanonicalMessage {
  const out: CanonicalMessage = { role: m.role, content: m.content };
  if (m.reasoning !== undefined && m.reasoning !== '') {
    if (style.kind === 'thinking-field') out.thinking = m.reasoning;
    else out.content = inlineThink(style, m.reasoning, m.content);
  }
  if (m.toolCalls !== undefined && m.toolCalls.length > 0) {
    out.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.arguments },
    }));
  }
  if (m.toolCallId !== undefined) out.tool_call_id = m.toolCallId;
  if (m.name !== undefined) out.name = m.name;
  if (m.weight !== undefined) out.weight = m.weight;
  return out;
}

/**
 * Render a message array to canonical message JSON, applying the shared
 * reasoning/system rules. The reasoning style is resolved from the context's
 * model unless overridden via `opts.style`.
 */
export function renderMessages(
  messages: Message[],
  ctx: RenderContext,
  opts?: RenderMessagesOptions,
): CanonicalMessage[] {
  const style = opts?.style ?? resolveReasoningStyle(ctx.model);
  return prepareMessages(messages, ctx, opts).map((m) => messageToCanonical(m, style));
}

/**
 * Render per-example tool schemas as the top-level `tools` array
 * (`[{ type: "function", function: { name, description?, parameters } }]`).
 * Returns undefined when the example declares no tools.
 */
export function renderToolDefinitions(
  tools: ToolDefinition[] | undefined,
): { type: 'function'; function: ToolDefinition }[] | undefined {
  if (tools === undefined || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Flatten a message array to plain text for text-column targets (Axolotl
 * user_defined DPO/KTO fields). Reasoning is always inlined (a flat string
 * cannot carry a `thinking` field) and tool calls are appended in the model's
 * native text style (hermes tags when unknown/none).
 */
export function flattenMessagesText(
  messages: Message[],
  ctx: RenderContext,
  opts?: RenderMessagesOptions,
): string {
  const style = opts?.style ?? inlineReasoningStyle(ctx.model);
  const open = style.kind === 'inline' ? style : { open: '<think>', close: '</think>' };
  const modelToolStyle = ctx.model?.toolCallStyle;
  const toolStyle = modelToolStyle === undefined || modelToolStyle === 'none' ? 'hermes' : modelToolStyle;
  return prepareMessages(messages, ctx, opts)
    .map((m) => {
      let body =
        m.reasoning !== undefined && m.reasoning !== ''
          ? inlineThink(open, m.reasoning, m.content)
          : m.content;
      if (m.toolCalls !== undefined && m.toolCalls.length > 0) {
        const calls = renderToolCallText(m.toolCalls, toolStyle);
        body = body.length > 0 ? `${body}\n${calls}` : calls;
      }
      return body;
    })
    .filter((body) => body.length > 0)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// JSONL serialization
// ---------------------------------------------------------------------------

/**
 * Serialize rows to JSONL (one JSON object per line, trailing newline, empty
 * string for zero rows). Every emitted line is verified to round-trip through
 * `JSON.parse` so downstream trainers never see a malformed line.
 */
export function toJsonl(rows: Record<string, unknown>[]): string {
  const lines = rows.map((row) => {
    const line = JSON.stringify(row);
    JSON.parse(line); // guarantee: every emitted JSONL line must parse
    return line;
  });
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

// ---------------------------------------------------------------------------
// Row builders: canonical + legacy
// ---------------------------------------------------------------------------

/** Whether the example's `messages` array is a prompt context (no final turn). */
function messagesContext(example: Example): 'prompt' | 'final' {
  return example.type === 'sft' ? 'final' : 'prompt';
}

/**
 * Canonical OpenAI-messages rows — the universal 2026 interchange shape.
 * Structural columns (chosen / rejected / completion / label / answer / tools)
 * are preserved so preference, KTO and RL examples round-trip losslessly.
 */
export function buildCanonicalRows(
  examples: Example[],
  ctx: RenderContext,
): Record<string, unknown>[] {
  return examples.map((ex) => {
    const row: Record<string, unknown> = {
      messages: renderMessages(ex.messages, ctx, { context: messagesContext(ex) }),
    };
    if (ex.chosen !== undefined && ex.chosen.length > 0) {
      row['chosen'] = renderMessages(ex.chosen, ctx);
    }
    if (ex.rejected !== undefined && ex.rejected.length > 0) {
      row['rejected'] = renderMessages(ex.rejected, ctx);
    }
    if (ex.completion !== undefined && ex.completion.length > 0) {
      row['completion'] = renderMessages(ex.completion, ctx);
    }
    if (ex.label !== undefined) row['label'] = ex.label;
    if (ex.answer !== undefined) row['answer'] = ex.answer;
    const tools = renderToolDefinitions(ex.tools);
    if (tools !== undefined) row['tools'] = tools;
    return row;
  });
}

/**
 * Legacy Alpaca / ShareGPT rows via {@link examplesToRows}, with the export
 * options (system filtering, reasoning policy) applied first so the legacy
 * inline `<think>` rendering only ever sees traces that should survive.
 */
export function buildLegacyRows(
  examples: Example[],
  ctx: RenderContext,
  format: 'alpaca' | 'sharegpt',
): Record<string, unknown>[] {
  const prepared = examples.map((ex) => ({
    ...ex,
    messages: prepareMessages(ex.messages, ctx, { context: messagesContext(ex) }),
    chosen: ex.chosen !== undefined ? prepareMessages(ex.chosen, ctx) : undefined,
    rejected: ex.rejected !== undefined ? prepareMessages(ex.rejected, ctx) : undefined,
    completion: ex.completion !== undefined ? prepareMessages(ex.completion, ctx) : undefined,
  }));
  return examplesToRows(prepared, format) as Record<string, unknown>[];
}
