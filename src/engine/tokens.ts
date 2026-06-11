/**
 * DataForge V2 — token counting.
 *
 * Exact BPE counts use the `o200k_base` encoding (GPT-4o / o-series) loaded
 * through gpt-tokenizer's per-encoding entrypoint so only the o200k ranks are
 * pulled into the bundle. o200k_base is used as a cross-model proxy: open
 * models (Qwen, Llama, Gemma, …) ship their own vocabularies, but o200k counts
 * track them closely enough for sizing datasets and spotting context overflow.
 *
 * Runtime-environment agnostic: no DOM, no React — safe in Web Workers and in
 * Node (vitest).
 */

import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import type { Example, Message } from '@/engine/types';

/**
 * Fixed per-message overhead added by {@link countExample} for every message
 * in an example (role tokens + turn delimiters). Four tokens mirrors the
 * classic OpenAI chat-format guidance; real chat templates (ChatML, Llama 3,
 * Harmony, …) vary between roughly 3 and 7 tokens per turn, so this is a
 * deliberate middle-of-the-road approximation.
 */
export const MESSAGE_TOKEN_OVERHEAD = 4;

/**
 * Average characters per token used by {@link approxAnthropicTokens}.
 * Anthropic does not publish a local tokenizer; ~3.5 chars/token is the
 * commonly observed average for English prose on Claude models.
 */
export const ANTHROPIC_CHARS_PER_TOKEN = 3.5;

/**
 * Count the exact number of `o200k_base` BPE tokens in a string.
 *
 * @param text - Any string (empty strings count as 0 tokens).
 * @returns The token count.
 */
export function countText(text: string): number {
  if (text.length === 0) return 0;
  return encode(text).length;
}

/**
 * Count the tokens contributed by one message list (content + reasoning +
 * tool-call arguments + per-message overhead).
 */
function countMessages(messages: readonly Message[] | undefined): number {
  if (messages === undefined || messages.length === 0) return 0;
  let total = 0;
  for (const message of messages) {
    total += MESSAGE_TOKEN_OVERHEAD;
    total += countText(message.content);
    if (message.reasoning !== undefined) {
      total += countText(message.reasoning);
    }
    if (message.toolCalls !== undefined) {
      for (const call of message.toolCalls) {
        total += countText(call.arguments);
      }
    }
  }
  return total;
}

/**
 * Approximate the rendered token size of an {@link Example} in `o200k_base`.
 *
 * Counted, for every message in `messages` plus the `chosen`, `rejected` and
 * `completion` lists when present:
 *  - `content` text,
 *  - `reasoning` trace text,
 *  - each tool call's JSON `arguments` string,
 *  - a flat {@link MESSAGE_TOKEN_OVERHEAD} (4 tokens) per message for role
 *    tokens and turn delimiters.
 *
 * Approximation notes (this module is built independently of the chat-template
 * renderer, so it cannot reproduce the exact per-model serialization):
 *  - Chat-template framing differs per model family; the flat 4-token
 *    per-message constant stands in for it.
 *  - Tool-call function names/ids, think-block delimiters, tool schema
 *    definitions (`Example.tools`) and the RL `answer` field are NOT counted —
 *    they are template/metadata concerns rendered (or omitted) at export time.
 *
 * @param example - The example to measure.
 * @returns The approximate total token count.
 */
export function countExample(example: Example): number {
  return (
    countMessages(example.messages) +
    countMessages(example.chosen) +
    countMessages(example.rejected) +
    countMessages(example.completion)
  );
}

/**
 * Count tokens for a batch of examples in one pass.
 *
 * @param examples - Examples to measure (order is preserved in `perExample`).
 * @returns The grand total and the per-example counts, index-aligned with the
 *          input array.
 */
export function countExamples(examples: Example[]): {
  total: number;
  perExample: number[];
} {
  const perExample = examples.map((example) => countExample(example));
  let total = 0;
  for (const count of perExample) total += count;
  return { total, perExample };
}

/**
 * Estimate Anthropic (Claude) token usage from character length.
 *
 * Anthropic ships no public local tokenizer, so this is a documented fallback:
 * `ceil(chars / 3.5)` based on the commonly observed ~3.5 characters/token
 * average for English text. Expect drift on code, CJK text and whitespace-heavy
 * content; use the provider's usage metadata when an exact figure matters.
 *
 * @param text - Any string (empty strings count as 0 tokens).
 * @returns The estimated token count (always ≥ 1 for non-empty input).
 */
export function approxAnthropicTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / ANTHROPIC_CHARS_PER_TOKEN);
}
