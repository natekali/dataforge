/**
 * LLM-as-judge rubric scoring for stored examples.
 *
 * Each example is rendered as a transcript, scored on helpfulness /
 * correctness / clarity (1–10) with a pass/fail verdict, and written back as
 * a 0–100 `qualityScore` plus a `meta.judge` record.
 */
import type { Example, Message, ProviderConfig } from '@/engine/types';
import { buildJudgePrompt, conversationTranscript, extractStrictJson } from './prompts';
import {
  cachedChat,
  pairToMessages,
  resolveDb,
  runBatch,
  type BatchHandle,
  type ChatFn,
  type MinimalDb,
} from './runner';

/** Rubric dimensions returned by the judge, each clamped to 1–10. */
export interface JudgeScores {
  helpfulness: number;
  correctness: number;
  clarity: number;
}

/** Parsed judge response for one example. */
export interface JudgeOutcome {
  scores: JudgeScores;
  verdict: 'pass' | 'fail';
  rationale?: string;
}

/** Options accepted by {@link judgeExamples}. */
export interface JudgeExamplesOptions {
  /** Project the job belongs to. */
  projectId: string;
  /** Ids of the examples to score. */
  exampleIds: string[];
  /** Provider configuration for the LLM calls. */
  provider: ProviderConfig;
  /** Model id to use as the judge. */
  model: string;
  /** Optional database double (tests). */
  dbOverride?: MinimalDb;
  /** Optional chat transport override (tests). */
  chatFn?: ChatFn;
}

/** Messages judged for an example: prompt plus its response continuation. */
function judgedMessages(example: Example): Message[] {
  return [...example.messages, ...(example.chosen ?? example.completion ?? [])];
}

function readScore(rec: Record<string, unknown>, key: string): number {
  const value = rec[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`judge output is missing a numeric "${key}" score`);
  }
  return Math.max(1, Math.min(10, value));
}

/**
 * Parse and validate a strict-JSON judge reply.
 *
 * @param raw - JSON value extracted from the model output.
 * @throws Error when any rubric score is missing or non-numeric.
 */
export function parseJudgeOutcome(raw: unknown): JudgeOutcome {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('judge output is not a JSON object');
  }
  const rec = raw as Record<string, unknown>;
  const scores: JudgeScores = {
    helpfulness: readScore(rec, 'helpfulness'),
    correctness: readScore(rec, 'correctness'),
    clarity: readScore(rec, 'clarity'),
  };
  const rationale =
    typeof rec['rationale'] === 'string' && rec['rationale'].trim() !== ''
      ? rec['rationale'].trim()
      : undefined;
  return {
    scores,
    verdict: rec['verdict'] === 'pass' ? 'pass' : 'fail',
    ...(rationale !== undefined ? { rationale } : {}),
  };
}

/**
 * Convert 1–10 rubric scores to the canonical 0–100 quality score
 * (mean of the three dimensions, scaled and rounded).
 */
export function toQualityScore(scores: JudgeScores): number {
  const mean = (scores.helpfulness + scores.correctness + scores.clarity) / 3;
  return Math.max(0, Math.min(100, Math.round(mean * 10)));
}

/**
 * Score a set of examples with an LLM judge, as a persisted batch job.
 *
 * Per example: render the full transcript (including preference `chosen` or
 * KTO `completion` continuations), run the rubric prompt deterministically
 * (temperature 0, JSON mode), then write back `qualityScore` (0–100) and
 * `meta.judge = { scores, verdict, model }` with an `updatedAt` stamp.
 *
 * @returns The {@link BatchHandle} of the underlying job.
 */
export function judgeExamples(opts: JudgeExamplesOptions): BatchHandle {
  const database = resolveDb(opts.dbOverride);

  return runBatch<string>({
    projectId: opts.projectId,
    kind: 'llm-judge',
    items: opts.exampleIds,
    params: {
      provider: opts.provider.id,
      model: opts.model,
      exampleCount: opts.exampleIds.length,
    },
    dbOverride: opts.dbOverride,
    worker: async (exampleId, signal) => {
      const example = await database.examples.get(exampleId);
      if (example === undefined) throw new Error(`example ${exampleId} not found`);

      const pair = buildJudgePrompt(conversationTranscript(judgedMessages(example)));
      const result = await cachedChat(
        opts.provider,
        {
          model: opts.model,
          messages: pairToMessages(pair),
          temperature: 0,
          jsonMode: true,
          signal,
        },
        database,
        opts.chatFn,
      );

      const outcome = parseJudgeOutcome(extractStrictJson(result.content));
      await database.examples.update(exampleId, {
        qualityScore: toQualityScore(outcome.scores),
        updatedAt: Date.now(),
        meta: {
          ...example.meta,
          judge: {
            scores: outcome.scores,
            verdict: outcome.verdict,
            model: opts.model,
            ...(outcome.rationale !== undefined ? { rationale: outcome.rationale } : {}),
          },
        },
      });
    },
  });
}
