/**
 * DataForge V2 — OpenAI fine-tuning API exporter.
 *
 * - sft        → supervised chat format:
 *                `{ messages: [{role, content, tool_calls?, tool_call_id?, weight?}],
 *                   tools?, parallel_tool_calls? }`
 * - preference → DPO format:
 *                `{ input: { messages, tools? },
 *                   preferred_output: [last assistant msg of chosen],
 *                   non_preferred_output: [last assistant msg of rejected] }`
 * - kto / rl   → no OpenAI fine-tuning equivalent; throws
 *                {@link UnsupportedExportError} so the UI can grey the combo out.
 *
 * Reasoning is ALWAYS rendered inline (the model's think delimiters, or
 * `<think>…</think>` by default): the OpenAI fine-tuning API rejects unknown
 * message fields, so the harmony `thinking` field is never emitted here.
 *
 * Runtime-environment agnostic: no DOM, no React.
 */

import type { Example } from '@/engine/types';
import {
  inlineReasoningStyle,
  renderMessages,
  renderToolDefinitions,
  type CanonicalMessage,
  type RenderContext,
  type RenderMessagesOptions,
} from './jsonl';
import { UnsupportedExportError } from './index';

/** Render messages with reasoning forced inline (no `thinking` field). */
function renderInline(
  messages: Example['messages'],
  ctx: RenderContext,
  opts?: Pick<RenderMessagesOptions, 'context'>,
): CanonicalMessage[] {
  return renderMessages(messages, ctx, { ...opts, style: inlineReasoningStyle(ctx.model) });
}

/** Copy of a canonical message without the SFT-only `weight` loss mask. */
function stripWeight(message: CanonicalMessage): CanonicalMessage {
  const copy = { ...message };
  delete copy.weight;
  return copy;
}

/**
 * The single output message for a DPO `preferred_output`/`non_preferred_output`
 * list: the LAST assistant turn of the rendered continuation. Continuations
 * without an assistant turn fall back to the last message (role coerced to
 * assistant); empty continuations yield an empty assistant message.
 */
function lastAssistantOf(rendered: CanonicalMessage[]): CanonicalMessage {
  const last = rendered.findLast((m) => m.role === 'assistant') ?? rendered.at(-1);
  if (last === undefined) return { role: 'assistant', content: '' };
  return { ...stripWeight(last), role: 'assistant' };
}

/** True when any assistant turn issues two or more tool calls at once. */
function hasParallelToolCalls(messages: CanonicalMessage[]): boolean {
  return messages.some((m) => (m.tool_calls?.length ?? 0) > 1);
}

/** Supervised chat row: `{ messages, tools?, parallel_tool_calls? }`. */
function sftRow(ex: Example, ctx: RenderContext): Record<string, unknown> {
  // The API only accepts `weight` on assistant messages — strip it elsewhere.
  const messages = renderInline(ex.messages, ctx).map((m) =>
    m.role === 'assistant' ? m : stripWeight(m),
  );
  const row: Record<string, unknown> = { messages };
  const tools = renderToolDefinitions(ex.tools);
  if (tools !== undefined) {
    row['tools'] = tools;
    // Match the data: when no turn ever calls tools in parallel, train with
    // parallel calling disabled (the API default is true).
    if (!hasParallelToolCalls(messages)) row['parallel_tool_calls'] = false;
  }
  return row;
}

/** DPO row: `{ input, preferred_output, non_preferred_output }`. */
function preferenceRow(ex: Example, ctx: RenderContext): Record<string, unknown> {
  const input: Record<string, unknown> = {
    // DPO inputs have no loss mask — strip `weight` from the prompt context.
    messages: renderInline(ex.messages, ctx, { context: 'prompt' }).map(stripWeight),
  };
  const tools = renderToolDefinitions(ex.tools);
  if (tools !== undefined) input['tools'] = tools;
  return {
    input,
    preferred_output: [lastAssistantOf(renderInline(ex.chosen ?? [], ctx))],
    non_preferred_output: [lastAssistantOf(renderInline(ex.rejected ?? [], ctx))],
  };
}

/**
 * Dataset rows for the OpenAI fine-tuning API (one JSONL line per example).
 *
 * Supports `sft` (supervised chat format) and `preference` (DPO format);
 * `kto` and `rl` throw {@link UnsupportedExportError}.
 */
export function buildOpenAiFtRows(
  examples: Example[],
  ctx: RenderContext,
): Record<string, unknown>[] {
  const type = ctx.options.datasetType;
  switch (type) {
    case 'sft':
      return examples.map((ex) => sftRow(ex, ctx));
    case 'preference':
      return examples.map((ex) => preferenceRow(ex, ctx));
    case 'kto':
    case 'rl':
      throw new UnsupportedExportError('openai-ft', type);
  }
}
