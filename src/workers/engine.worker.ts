/**
 * Engine Web Worker — runs every CPU-heavy dataset operation off the main
 * thread: file parsing, schema detection, conversion, quality analysis,
 * cleaning, duplicate detection, benchmark decontamination and token
 * counting.
 *
 * Exposed via comlink. The matching client (and the {@link EngineWorkerApi}
 * contract) lives in `src/lib/workerClient.ts`; the contract is imported here
 * type-only, so there is no runtime cycle.
 *
 * Every operation delegates to the DOM-free engine modules — this file only
 * adapts their signatures to the worker contract (batching `cleanExample`,
 * aggregating per-example reports for the model-aware analysis path). It is
 * itself DOM-free: it uses only Web APIs available in workers and Node.
 */

import { expose } from 'comlink';
import { detectFormat } from '@/engine/detection';
import { rowsToExamples } from '@/engine/convert';
import { parseFile } from '@/engine/importers';
import { analyzeDataset, analyzeExample, cleanExample } from '@/engine/quality';
import { decontaminate, exactDuplicates, nearDuplicates } from '@/engine/dedup';
import { countExamples } from '@/engine/tokens';
import type {
  DatasetQualitySummary,
  Example,
  IssueType,
  ModelInfo,
  QualityReport,
} from '@/engine/types';
import type { AnalyzeResult, EngineWorkerApi } from '@/lib/workerClient';

// ---------------------------------------------------------------------------
// Quality analysis adaptation
// ---------------------------------------------------------------------------

/**
 * Aggregates per-example reports into a dataset-level summary using the same
 * score buckets as the engine's dataset scan (≥90 excellent, ≥70 good,
 * ≥50 fair, else poor) so both {@link analyze} paths report consistently.
 */
function summarizeReports(reports: QualityReport[]): DatasetQualitySummary {
  const scoreDistribution = { excellent: 0, good: 0, fair: 0, poor: 0 };
  const issueCounts: Partial<Record<IssueType, number>> = {};
  let totalScore = 0;
  for (const report of reports) {
    totalScore += report.score;
    if (report.score >= 90) scoreDistribution.excellent += 1;
    else if (report.score >= 70) scoreDistribution.good += 1;
    else if (report.score >= 50) scoreDistribution.fair += 1;
    else scoreDistribution.poor += 1;
    for (const issue of report.issues) {
      issueCounts[issue.type] = (issueCounts[issue.type] ?? 0) + 1;
    }
  }
  return {
    scored: reports.length,
    averageScore: reports.length === 0 ? 0 : Math.round((totalScore / reports.length) * 10) / 10,
    scoreDistribution,
    issueCounts,
  };
}

/**
 * Batched quality analysis (one postMessage round trip for a whole dataset).
 *
 * - Without `targetModel`, this is the engine's dataset scan
 *   ({@link analyzeDataset}), which includes the dataset-wide exact-duplicate
 *   pass.
 * - With `targetModel`, every example is scored model-aware
 *   ({@link analyzeExample} with `context_overflow` and target-family
 *   special-token checks). The engine's duplicate pass is part of the
 *   dataset scan only; use the dedicated `exactDuplicates`/`nearDuplicates`
 *   operations for duplicate screening on this path.
 */
function analyze(examples: Example[], targetModel?: ModelInfo): AnalyzeResult {
  if (targetModel === undefined) return analyzeDataset(examples);
  const reports = examples.map((example) => analyzeExample(example, { targetModel }));
  return { reports, summary: summarizeReports(reports) };
}

// ---------------------------------------------------------------------------
// Worker API
// ---------------------------------------------------------------------------

/**
 * Concrete worker implementation of {@link EngineWorkerApi}. Exported so the
 * pure logic can be unit-tested directly in Node (vitest) without spawning a
 * worker.
 */
export const engineWorkerApi: EngineWorkerApi = {
  parseFile,
  detect: detectFormat,
  convert: rowsToExamples,
  analyzeExample,
  analyze,
  cleanExamples: (examples, opts) => examples.map((example) => cleanExample(example, opts)),
  exactDuplicates,
  nearDuplicates,
  decontaminate,
  countTokens: (examples) => countExamples(examples).perExample,
};

// comlink's expose() requires a postMessage endpoint. Inside a real worker
// globalThis is one; in Node (vitest imports this module to test the logic)
// it is not, so guard to keep the module importable everywhere.
const scope = globalThis as { addEventListener?: unknown; postMessage?: unknown };
if (typeof scope.addEventListener === 'function' && typeof scope.postMessage === 'function') {
  expose(engineWorkerApi);
}
