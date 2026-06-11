/**
 * Synthetic example generation: Self-Instruct, Evol-Instruct, persona-driven
 * and Magpie-style cold generation.
 *
 * Examples are requested in batches of {@link BATCH_SIZE} per LLM call with
 * strict-JSON array parsing; every created example is tagged
 * `meta.synthetic = technique` and the new ids land on the job's
 * `params.createdIds`.
 */
import {
  createExample,
  type Example,
  type ProviderConfig,
} from '@/engine/types';
import {
  PERSONAS,
  buildEvolInstructPrompt,
  buildMagpiePrompt,
  buildPersonaPrompt,
  buildSelfInstructPrompt,
  extractStrictJson,
  type PromptPair,
  type SeedPair,
} from './prompts';
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

/** Generation technique supported by {@link generateSynthetic}. */
export type SyntheticTechnique = 'self-instruct' | 'evol-instruct' | 'persona' | 'magpie-style';

/** Examples requested per LLM call. */
const BATCH_SIZE = 5;

/** Personas rotated into each persona-technique batch. */
const PERSONAS_PER_BATCH = 5;

/** Default sampling temperature for generation (diversity matters). */
const DEFAULT_TEMPERATURE = 0.8;

/** Options accepted by {@link generateSynthetic}. */
export interface GenerateSyntheticOptions {
  /** Project that receives the generated examples. */
  projectId: string;
  /** Generation technique. */
  technique: SyntheticTechnique;
  /** Total number of examples to generate (>= 1). */
  count: number;
  /** Seed example ids — required for self-instruct and evol-instruct. */
  seedExampleIds?: string[];
  /** Topic constraint — required for magpie-style, optional for persona. */
  topic?: string;
  /** Provider configuration for the LLM calls. */
  provider: ProviderConfig;
  /** Model id to use. */
  model: string;
  /** Sampling temperature override (default 0.8). */
  temperature?: number;
  /** Optional database double (tests). */
  dbOverride?: MinimalDb;
  /** Optional chat transport override (tests). */
  chatFn?: ChatFn;
}

/** One generated instruction/response pair from a strict-JSON model reply. */
export interface GeneratedPair {
  instruction: string;
  response: string;
}

interface BatchSpec {
  batchIndex: number;
  count: number;
}

/**
 * Parse a strict-JSON generation reply into instruction/response pairs.
 *
 * Accepts the canonical `{"examples":[…]}` envelope or a bare array, drops
 * malformed/empty entries, and throws when nothing usable remains (so the
 * batch counts as failed instead of silently producing zero examples).
 *
 * @param raw - JSON value extracted from the model output.
 */
export function parseGeneratedPairs(raw: unknown): GeneratedPair[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)['examples']
      : undefined;
  if (!Array.isArray(list)) {
    throw new Error('generation output is missing an "examples" array');
  }
  const pairs: GeneratedPair[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    const instruction = typeof rec['instruction'] === 'string' ? rec['instruction'].trim() : '';
    const response = typeof rec['response'] === 'string' ? rec['response'].trim() : '';
    if (instruction === '' || response === '') continue;
    pairs.push({ instruction, response });
  }
  if (pairs.length === 0) {
    throw new Error('generation output contained no valid instruction/response pairs');
  }
  return pairs;
}

/** Extract a seed pair (first user turn + last assistant turn) from an example. */
function seedFromExample(example: Example): SeedPair | null {
  const instruction = example.messages.find((m) => m.role === 'user')?.content.trim() ?? '';
  if (instruction === '') return null;
  const response = example.messages
    .findLast((m) => m.role === 'assistant')
    ?.content.trim();
  return {
    instruction,
    ...(response !== undefined && response !== '' ? { response } : {}),
  };
}

/** Rotating window over {@link PERSONAS} so each batch sees fresh personas. */
function personasForBatch(batchIndex: number): string[] {
  const start = (batchIndex * PERSONAS_PER_BATCH) % PERSONAS.length;
  return Array.from(
    { length: Math.min(PERSONAS_PER_BATCH, PERSONAS.length) },
    (_, i) => PERSONAS[(start + i) % PERSONAS.length],
  );
}

/**
 * Generate brand-new synthetic examples with an LLM, as a persisted batch job.
 *
 * The total `count` is split into batches of {@link BATCH_SIZE} (one job item
 * = one LLM call). Each batch is parsed strictly, turned into user/assistant
 * examples via {@link createExample} tagged `meta.synthetic = technique`, and
 * bulk-added. The ids of every created example are collected on the job's
 * `params.createdIds` (available on the final {@link BatchHandle.promise}
 * snapshot and on the persisted job row).
 *
 * @throws Error synchronously when `count < 1`, when a seed-based technique
 *         has no `seedExampleIds`, or when magpie-style has no `topic`.
 */
export function generateSynthetic(opts: GenerateSyntheticOptions): BatchHandle {
  if (!Number.isFinite(opts.count) || opts.count < 1) {
    throw new Error('generateSynthetic requires count >= 1');
  }
  const count = Math.floor(opts.count);
  const needsSeeds = opts.technique === 'self-instruct' || opts.technique === 'evol-instruct';
  if (needsSeeds && (opts.seedExampleIds === undefined || opts.seedExampleIds.length === 0)) {
    throw new Error(`${opts.technique} generation requires seedExampleIds`);
  }
  if (opts.technique === 'magpie-style' && (opts.topic === undefined || opts.topic.trim() === '')) {
    throw new Error('magpie-style generation requires a topic');
  }

  const database = resolveDb(opts.dbOverride);

  // One nonce per RUN: identical settings still get fresh generations on a
  // re-run (distinct cache keys), while batches within this run stay cacheable
  // for the per-item retry.
  const runNonce = crypto.randomUUID();

  const items: BatchSpec[] = [];
  for (let i = 0, remaining = count; remaining > 0; i++, remaining -= BATCH_SIZE) {
    items.push({ batchIndex: i, count: Math.min(BATCH_SIZE, remaining) });
  }

  const createdIds: string[] = [];
  const params: Record<string, unknown> = {
    technique: opts.technique,
    count,
    provider: opts.provider.id,
    model: opts.model,
    ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
    createdIds,
  };

  // Seeds are loaded once, lazily, and shared by every batch worker.
  let seedsPromise: Promise<SeedPair[]> | undefined;
  const loadSeeds = (): Promise<SeedPair[]> => {
    seedsPromise ??= (async () => {
      const seeds: SeedPair[] = [];
      for (const id of opts.seedExampleIds ?? []) {
        const example = await database.examples.get(id);
        if (example === undefined) continue;
        const seed = seedFromExample(example);
        if (seed !== null) seeds.push(seed);
      }
      return seeds;
    })();
    return seedsPromise;
  };

  const buildPrompt = async (batch: BatchSpec): Promise<PromptPair> => {
    switch (opts.technique) {
      case 'self-instruct':
        return buildSelfInstructPrompt({
          seeds: await loadSeeds(),
          count: batch.count,
          batchIndex: batch.batchIndex,
        });
      case 'evol-instruct':
        return buildEvolInstructPrompt({
          seeds: await loadSeeds(),
          count: batch.count,
          direction: batch.batchIndex % 2 === 0 ? 'depth' : 'breadth',
          batchIndex: batch.batchIndex,
        });
      case 'persona':
        return buildPersonaPrompt({
          personas: personasForBatch(batch.batchIndex),
          topic: opts.topic,
          count: batch.count,
          batchIndex: batch.batchIndex,
        });
      case 'magpie-style':
        return buildMagpiePrompt({
          topic: opts.topic ?? '',
          count: batch.count,
          batchIndex: batch.batchIndex,
        });
    }
  };

  return runBatch<BatchSpec>({
    projectId: opts.projectId,
    kind: 'generate-synthetic',
    items,
    params,
    dbOverride: opts.dbOverride,
    worker: async (batch, signal) => {
      const pair = await buildPrompt(batch);
      const request = {
        model: opts.model,
        messages: pairToMessages({
          system: pair.system,
          user: `${pair.user}\n\nbatch seed: ${runNonce}`,
        }),
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
        jsonMode: true,
        signal,
      };
      const result = await cachedChat(opts.provider, request, database, opts.chatFn);

      let pairs: GeneratedPair[];
      try {
        pairs = parseGeneratedPairs(extractStrictJson(result.content));
      } catch (err) {
        // Drop the poisoned cache entry so the retry gets a fresh response.
        await uncacheChat(opts.provider, request, database);
        throw err;
      }
      const examples = pairs.map((p) =>
        createExample({
          projectId: opts.projectId,
          messages: [
            { role: 'user', content: p.instruction },
            { role: 'assistant', content: p.response },
          ],
          meta: { synthetic: opts.technique, batchIndex: batch.batchIndex },
        }),
      );
      await database.examples.bulkAdd(examples);
      for (const example of examples) createdIds.push(example.id);
    },
  });
}
