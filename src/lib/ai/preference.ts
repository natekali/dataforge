/**
 * On-policy preference-pair construction (DPO/ORPO data).
 *
 * For every source SFT example: sample N candidate responses at high
 * temperature, have an LLM judge rank them, then create a NEW preference
 * example pairing the best candidate against the worst. Ties are skipped —
 * a pair with no real quality gap is training noise.
 */
import {
  createExample,
  type ChatMessage,
  type ChatResult,
  type Message,
  type ProviderConfig,
} from '@/engine/types';
import { buildRankingPrompt, conversationTranscript, extractStrictJson } from './prompts';
import {
  cachedChat,
  pairToMessages,
  resolveDb,
  runBatch,
  type BatchHandle,
  type ChatFn,
  type MinimalDb,
} from './runner';

/** Default number of candidate responses sampled per example. */
const DEFAULT_CANDIDATES = 3;

/** Allowed candidate-count range. */
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 4;

/** Sampling temperature for candidate generation (diversity is the point). */
const CANDIDATE_TEMPERATURE = 0.9;

/** Options accepted by {@link buildPreferencePairs}. */
export interface BuildPreferencePairsOptions {
  /** Project that receives the new preference examples. */
  projectId: string;
  /** Ids of the source SFT examples to build pairs from. */
  exampleIds: string[];
  /** Provider configuration for the LLM calls. */
  provider: ProviderConfig;
  /** Model id used both for candidate sampling and ranking. */
  model: string;
  /** Candidates per example (default 3, clamped to 2–4). */
  candidates?: number;
  /** Optional database double (tests). */
  dbOverride?: MinimalDb;
  /** Optional chat transport override (tests). */
  chatFn?: ChatFn;
}

/**
 * Extract the prompt portion of a conversation: everything up to and
 * including the LAST user turn. Returns null when there is no user turn
 * (nothing to respond to).
 *
 * @param messages - Full source conversation.
 */
export function promptPortion(messages: Message[]): Message[] | null {
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  if (lastUser === -1) return null;
  return messages.slice(0, lastUser + 1);
}

/**
 * Build the chat request for one candidate sample. The candidate index is
 * embedded in the leading system message so each candidate has a distinct
 * cache key — otherwise {@link cachedChat} would collapse all N samples into
 * one cached response. The run nonce keeps cache keys distinct ACROSS runs so
 * re-running the same sources samples fresh candidates instead of recreating
 * identical pairs, while retries within one run still hit the cache.
 */
function candidateRequestMessages(
  prompt: Message[],
  candidateIndex: number,
  totalCandidates: number,
  runNonce: string,
): ChatMessage[] {
  const header: ChatMessage = {
    role: 'system',
    content:
      `Candidate ${candidateIndex + 1} of ${totalCandidates}. ` +
      'You are the assistant in the conversation below. Write your single best response to the ' +
      'latest user message. Different candidates should explore genuinely different approaches.\n' +
      `batch seed: ${runNonce}`,
  };
  const mapped: ChatMessage[] = prompt.map((m) => {
    switch (m.role) {
      case 'assistant':
        return { role: 'assistant', content: m.content };
      case 'user':
        return { role: 'user', content: m.content };
      case 'tool':
        return {
          role: 'user',
          content: `[tool result${m.name !== undefined ? `: ${m.name}` : ''}]\n${m.content}`,
        };
      default:
        // system + developer both map to the provider-level system role.
        return { role: 'system', content: m.content };
    }
  });
  return [header, ...mapped];
}

interface RankingOutcome {
  /** 1-based candidate numbers, best first — validated permutation. */
  ranking: number[];
  /** True when the judge could not separate best from worst. */
  tie: boolean;
}

/** Parse and validate a strict-JSON ranking reply. */
function parseRanking(raw: unknown, candidateCount: number): RankingOutcome {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('ranking output is not a JSON object');
  }
  const rec = raw as Record<string, unknown>;
  const ranking = rec['ranking'];
  if (!Array.isArray(ranking) || ranking.length !== candidateCount) {
    throw new Error(`ranking must list all ${candidateCount} candidates exactly once`);
  }
  const seen = new Set<number>();
  const order: number[] = [];
  for (const value of ranking) {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > candidateCount ||
      seen.has(value)
    ) {
      throw new Error('ranking must be a permutation of 1-based candidate numbers');
    }
    seen.add(value);
    order.push(value);
  }
  return { ranking: order, tie: rec['tie'] === true };
}

/** Wrap a chat result as an assistant message, keeping any reasoning trace. */
function toAssistantMessage(result: ChatResult): Message {
  return {
    role: 'assistant',
    content: result.content,
    ...(result.reasoning !== undefined && result.reasoning.trim() !== ''
      ? { reasoning: result.reasoning }
      : {}),
  };
}

/**
 * Build on-policy preference pairs from SFT examples, as a persisted batch job.
 *
 * Per source example:
 * 1. take the prompt portion (everything up to the last user turn inclusive);
 * 2. sample N candidates at temperature 0.9 (candidate index in the prompt
 *    keeps cache keys distinct);
 * 3. rank the candidates with the LLM judge;
 * 4. unless the judge flags a tie (or best and worst are textually identical),
 *    create a NEW preference example `{ messages: prompt, chosen: [best],
 *    rejected: [worst] }` tagged `meta.generator = "on-policy-pairs"`.
 *
 * Created example ids land on the job's `params.createdIds` (available on the
 * final {@link BatchHandle.promise} snapshot and the persisted job row).
 */
export function buildPreferencePairs(opts: BuildPreferencePairsOptions): BatchHandle {
  const requested = opts.candidates ?? DEFAULT_CANDIDATES;
  const candidateCount = Number.isFinite(requested)
    ? Math.max(MIN_CANDIDATES, Math.min(MAX_CANDIDATES, Math.floor(requested)))
    : DEFAULT_CANDIDATES;
  const database = resolveDb(opts.dbOverride);

  // One nonce per RUN so identical settings sample fresh candidates on re-run.
  const runNonce = crypto.randomUUID();

  const createdIds: string[] = [];
  const params: Record<string, unknown> = {
    provider: opts.provider.id,
    model: opts.model,
    candidateCount,
    exampleCount: opts.exampleIds.length,
    createdIds,
  };

  return runBatch<string>({
    projectId: opts.projectId,
    kind: 'build-preference-pairs',
    items: opts.exampleIds,
    params,
    dbOverride: opts.dbOverride,
    worker: async (exampleId, signal) => {
      const example = await database.examples.get(exampleId);
      if (example === undefined) throw new Error(`example ${exampleId} not found`);
      const prompt = promptPortion(example.messages);
      if (prompt === null) {
        throw new Error(`example ${exampleId} has no user turn to build a preference pair from`);
      }

      const candidates: ChatResult[] = [];
      for (let i = 0; i < candidateCount; i++) {
        candidates.push(
          await cachedChat(
            opts.provider,
            {
              model: opts.model,
              messages: candidateRequestMessages(prompt, i, candidateCount, runNonce),
              temperature: CANDIDATE_TEMPERATURE,
              signal,
            },
            database,
            opts.chatFn,
          ),
        );
      }

      const rankingPair = buildRankingPrompt(
        conversationTranscript(prompt),
        candidates.map((c) => c.content),
      );
      const rankingResult = await cachedChat(
        opts.provider,
        {
          model: opts.model,
          messages: pairToMessages(rankingPair),
          temperature: 0,
          jsonMode: true,
          signal,
        },
        database,
        opts.chatFn,
      );
      const outcome = parseRanking(extractStrictJson(rankingResult.content), candidateCount);

      // The judge could not separate best from worst — no usable pair.
      if (outcome.tie) return;
      const best = candidates[outcome.ranking[0] - 1];
      const worst = candidates[outcome.ranking[outcome.ranking.length - 1] - 1];
      // Identical text is a de-facto tie regardless of the judge's verdict.
      if (best.content === worst.content) return;

      const created = createExample({
        projectId: opts.projectId,
        type: 'preference',
        split: example.split,
        messages: prompt.map((m) => ({ ...m })),
        chosen: [toAssistantMessage(best)],
        rejected: [toAssistantMessage(worst)],
        meta: {
          generator: 'on-policy-pairs',
          sourceExampleId: exampleId,
          candidateCount,
          rankingModel: opts.model,
        },
      });
      await database.examples.bulkAdd([created]);
      createdIds.push(created.id);
    },
  });
}
