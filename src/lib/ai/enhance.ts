/**
 * LLM-powered enhancement of existing examples (rewrite, expand, simplify,
 * add reasoning traces, …).
 *
 * Each example is round-tripped through {@link buildEnhancePrompt}: the model
 * must return the complete conversation as strict JSON, only assistant turns
 * are merged back, and any parse/validation failure leaves the stored example
 * untouched (counted as a failed item on the job).
 */
import type { Example, Message, ProviderConfig, Role } from '@/engine/types';
import { buildEnhancePrompt, extractStrictJson, type EnhanceOp } from './prompts';
import {
  cachedChat,
  pairToMessages,
  resolveDb,
  runBatch,
  uncacheChat,
  type BatchHandle,
  type ChatFn,
  type MinimalDb,
} from './runner';

/**
 * Robust JSON extraction from raw model output (fences, prose wrapping,
 * balanced-brace scanning). Re-exported here under the operation-level name so
 * tests and UI code can import it next to {@link enhanceExamples}.
 */
export { extractStrictJson as extractJson } from './prompts';

export type { EnhanceOp } from './prompts';

/** Sampling temperature for enhancement (low — we want faithful rewrites). */
const ENHANCE_TEMPERATURE = 0.3;

const VALID_ROLES: ReadonlySet<string> = new Set([
  'system',
  'developer',
  'user',
  'assistant',
  'tool',
]);

/** Leading `<think>…</think>` block (the alternative trace placement the prompt allows). */
const THINK_BLOCK = /^\s*<think>([\s\S]*?)<\/think>\s*/;

/** Options accepted by {@link enhanceExamples}. */
export interface EnhanceExamplesOptions {
  /** Project the job belongs to. */
  projectId: string;
  /** Ids of the examples to enhance. */
  exampleIds: string[];
  /** Enhancement operation to perform. */
  op: EnhanceOp;
  /** Required when `op === 'custom'`. */
  customInstruction?: string;
  /** Provider configuration for the LLM calls. */
  provider: ProviderConfig;
  /** Model id to use. */
  model: string;
  /** Optional database double (tests). */
  dbOverride?: MinimalDb;
  /** Optional chat transport override (tests). */
  chatFn?: ChatFn;
}

interface ReturnedMessage {
  role: Role;
  content: string;
  reasoning?: string;
}

/** Validate the model's round-tripped conversation against the original. */
function parseReturnedMessages(raw: unknown, original: Message[]): ReturnedMessage[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('enhanced output is not a JSON object');
  }
  const list = (raw as Record<string, unknown>)['messages'];
  if (!Array.isArray(list)) {
    throw new Error('enhanced output is missing a "messages" array');
  }
  if (list.length !== original.length) {
    throw new Error(
      `enhanced output has ${list.length} messages but the original has ${original.length}`,
    );
  }
  return list.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`enhanced message ${i} is not an object`);
    }
    const rec = entry as Record<string, unknown>;
    const role = rec['role'];
    if (typeof role !== 'string' || !VALID_ROLES.has(role)) {
      throw new Error(`enhanced message ${i} has an invalid role`);
    }
    if (role !== original[i].role) {
      throw new Error(
        `enhanced message ${i} role "${role}" does not match the original "${original[i].role}"`,
      );
    }
    const content = rec['content'];
    if (typeof content !== 'string') {
      throw new Error(`enhanced message ${i} is missing string content`);
    }
    const rawReasoning = rec['reasoning'];
    const reasoning =
      typeof rawReasoning === 'string' && rawReasoning.trim() !== ''
        ? rawReasoning.trim()
        : undefined;
    return { role: role as Role, content, ...(reasoning !== undefined ? { reasoning } : {}) };
  });
}

/**
 * Merge a validated model response back into the original conversation.
 *
 * Only assistant turns absorb changes; every other message is kept verbatim
 * regardless of what the model returned. For the `add-reasoning` op the
 * returned trace is moved onto the LAST assistant message's `reasoning` field
 * (accepting either the JSON `reasoning` field or a leading `<think>` block).
 *
 * @param original - Stored conversation.
 * @param raw      - Parsed JSON value from the model.
 * @param op       - Enhancement operation that produced the response.
 * @throws Error when the response does not round-trip the conversation shape.
 */
export function mergeEnhanced(original: Message[], raw: unknown, op: EnhanceOp): Message[] {
  const returned = parseReturnedMessages(raw, original);
  const lastAssistant = original.findLastIndex((m) => m.role === 'assistant');

  return original.map((msg, i) => {
    if (msg.role !== 'assistant') return msg;
    const r = returned[i];
    let content = r.content;
    let reasoning = r.reasoning ?? msg.reasoning;

    if (op === 'add-reasoning') {
      if (i === lastAssistant) {
        if (r.reasoning === undefined) {
          const think = THINK_BLOCK.exec(content);
          if (think !== null) {
            reasoning = (think[1] ?? '').trim();
            content = content.slice(think[0].length).trimStart();
          }
        }
      } else {
        // Traces belong only on the final assistant turn for this op.
        reasoning = msg.reasoning;
      }
    }

    return { ...msg, content, ...(reasoning !== undefined ? { reasoning } : {}) };
  });
}

/**
 * Enhance a set of examples with an LLM, as a persisted batch job.
 *
 * Per example: build the operation prompt, run a cached JSON-mode chat call,
 * robustly extract + validate the returned conversation, then write the merged
 * messages back (`updatedAt` stamped, `meta.enhanceOp` recorded). On any
 * parse or validation failure the stored example is left untouched and the
 * item counts as failed.
 *
 * @returns The {@link BatchHandle} of the underlying job.
 */
export function enhanceExamples(opts: EnhanceExamplesOptions): BatchHandle {
  const database = resolveDb(opts.dbOverride);

  return runBatch<string>({
    projectId: opts.projectId,
    kind: 'enhance',
    items: opts.exampleIds,
    params: {
      op: opts.op,
      provider: opts.provider.id,
      model: opts.model,
      exampleCount: opts.exampleIds.length,
      ...(opts.customInstruction !== undefined
        ? { customInstruction: opts.customInstruction }
        : {}),
    },
    dbOverride: opts.dbOverride,
    worker: async (exampleId, signal) => {
      const example: Example | undefined = await database.examples.get(exampleId);
      if (example === undefined) throw new Error(`example ${exampleId} not found`);

      const pair = buildEnhancePrompt(opts.op, example.messages, opts.customInstruction);
      const request = {
        model: opts.model,
        messages: pairToMessages(pair),
        temperature: ENHANCE_TEMPERATURE,
        jsonMode: true,
        signal,
      };
      const result = await cachedChat(opts.provider, request, database, opts.chatFn);

      let merged: Message[];
      try {
        merged = mergeEnhanced(example.messages, extractStrictJson(result.content), opts.op);
      } catch (err) {
        // Drop the poisoned cache entry so the retry gets a fresh response.
        await uncacheChat(opts.provider, request, database);
        throw err;
      }
      await database.examples.update(exampleId, {
        messages: merged,
        updatedAt: Date.now(),
        meta: { ...example.meta, enhanceOp: opts.op },
      });
    },
  });
}
