/**
 * Main-thread client for the engine Web Worker.
 *
 * Declares the {@link EngineWorkerApi} contract (the worker implements it via
 * a type-only import, so there is no runtime cycle), owns the lazy worker
 * singleton, and provides convenience wrappers for the common pipelines
 * (file import, quality analysis, cleaning, duplicate detection, benchmark
 * decontamination, token counting).
 *
 * All heavy lifting — parsing, detection, conversion, analysis, dedup —
 * happens inside the worker; this module only marshals data across the
 * postMessage boundary (transferring ArrayBuffers instead of copying them).
 */

import { transfer, wrap } from 'comlink';
import type { Remote } from 'comlink';
import type {
  CleaningOptions,
  DatasetQualitySummary,
  DetectedSchema,
  Example,
  ImportResult,
  ModelInfo,
  QualityReport,
} from '@/engine/types';
import type { ParsedFile, ParseFileInput } from '@/engine/importers';
import type {
  BenchmarkSample,
  ContaminationHit,
  DecontaminateOptions,
  DuplicateGroup,
  NearDuplicateOptions,
} from '@/engine/dedup';

// Result/option shapes of the dedup operations, re-exported so worker
// consumers do not need to know which engine module defines them.
export type {
  BenchmarkSample,
  ContaminationHit,
  DecontaminateOptions,
  DuplicateGroup,
  NearDuplicateOptions,
} from '@/engine/dedup';

// ---------------------------------------------------------------------------
// Worker API contract
// ---------------------------------------------------------------------------

/** Result of a full-dataset quality analysis. */
export interface AnalyzeResult {
  /** One report per input example, index-aligned. */
  reports: QualityReport[];
  /** Aggregate score distribution and issue tallies. */
  summary: DatasetQualitySummary;
}

/** One cleaned example plus the list of changes that were applied to it. */
export interface CleanedExample {
  /** The cleaned copy (the input example is never mutated). */
  example: Example;
  /** Deduplicated change descriptions; empty when nothing was modified. */
  changed: string[];
}

/**
 * Contract implemented by `src/workers/engine.worker.ts` and consumed on the
 * main thread as `Remote<EngineWorkerApi>` (comlink turns every method —
 * including the synchronous ones — into a Promise-returning proxy).
 *
 * Every method delegates to a DOM-free engine module, so the same logic is
 * unit-testable in Node without a worker.
 */
export interface EngineWorkerApi {
  /** Parses an uploaded file (name + bytes) into rows or a text document. */
  parseFile(input: ParseFileInput): Promise<ParsedFile>;
  /** Detects the source schema of tabular rows. */
  detect(rows: unknown[]): DetectedSchema;
  /** Converts rows into canonical Examples for `projectId`. */
  convert(rows: unknown[], schema: DetectedSchema, projectId: string): ImportResult;
  /** Scores a single example; model-aware when `opts.targetModel` is given. */
  analyzeExample(example: Example, opts?: { targetModel?: ModelInfo }): QualityReport;
  /**
   * Batched quality analysis. Without `targetModel` this is the engine's
   * dataset scan (includes the exact-duplicate pass); with `targetModel`
   * every example is scored model-aware (context overflow, target-family
   * special tokens) instead.
   */
  analyze(examples: Example[], targetModel?: ModelInfo): AnalyzeResult;
  /** Cleans every example with the given options (pure; inputs untouched). */
  cleanExamples(examples: Example[], opts: CleaningOptions): CleanedExample[];
  /** Groups of examples whose normalized full text is identical. */
  exactDuplicates(examples: Example[]): DuplicateGroup[];
  /** MinHash/LSH near-duplicate groups above the similarity threshold. */
  nearDuplicates(examples: Example[], opts?: NearDuplicateOptions): DuplicateGroup[];
  /** Flags examples that share a verbatim word n-gram with a benchmark. */
  decontaminate(
    examples: Example[],
    benchmark: BenchmarkSample,
    opts?: DecontaminateOptions,
  ): ContaminationHit[];
  /** Per-example rendered token counts, index-aligned with the input. */
  countTokens(examples: Example[]): number[];
}

// ---------------------------------------------------------------------------
// Lazy worker singleton
// ---------------------------------------------------------------------------

let workerInstance: Worker | null = null;
let remoteApi: Remote<EngineWorkerApi> | null = null;

/**
 * Returns the comlink proxy for the engine worker, creating the worker on
 * first use. The same instance is reused for the lifetime of the page.
 */
export function getEngineWorker(): Remote<EngineWorkerApi> {
  if (!remoteApi) {
    workerInstance = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), {
      type: 'module',
    });
    remoteApi = wrap<EngineWorkerApi>(workerInstance);
  }
  return remoteApi;
}

/**
 * Terminates the engine worker (if running) and clears the singleton so the
 * next {@link getEngineWorker} call spawns a fresh one. Safe to call when no
 * worker exists. In-flight calls are dropped, never resolved — only use this
 * for teardown.
 */
export function terminateEngineWorker(): void {
  workerInstance?.terminate();
  workerInstance = null;
  remoteApi = null;
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/** Pipeline phase reported by {@link importFileToProject}. */
export type ImportPhase = 'parsing' | 'detecting' | 'converting';

/** Outcome of importing a file: converted rows, or a text document. */
export type ImportFileOutcome =
  | { kind: 'rows'; result: ImportResult }
  | { kind: 'document'; text: string; title: string };

/**
 * Merges non-fatal parse-stage diagnostics (bad JSONL lines, malformed CSV
 * records) into an {@link ImportResult}'s error list, parse errors first.
 * Returns the input result unchanged when there are no parse errors.
 *
 * Note: rows dropped during parsing never reach conversion, so they are not
 * reflected in `result.skipped` — only in the merged `errors`.
 */
export function mergeParseErrors(result: ImportResult, parseErrors?: string[]): ImportResult {
  if (!parseErrors || parseErrors.length === 0) return result;
  return { ...result, errors: [...parseErrors, ...result.errors] };
}

/**
 * Imports a browser File into a project: reads its bytes, then parses,
 * detects and converts entirely inside the engine worker. The file's
 * ArrayBuffer is transferred (zero-copy) to the worker.
 *
 * Documents (PDF/DOCX/MD/TXT) short-circuit after parsing and are returned
 * as raw text for the document-to-dataset flow.
 *
 * @param file      - The uploaded file.
 * @param projectId - Project the converted examples will belong to.
 * @param onPhase   - Optional progress callback fired as each phase starts.
 */
export async function importFileToProject(
  file: File,
  projectId: string,
  onPhase?: (phase: ImportPhase) => void,
): Promise<ImportFileOutcome> {
  const api = getEngineWorker();

  onPhase?.('parsing');
  const data = await file.arrayBuffer();
  const parsed = await api.parseFile(transfer({ name: file.name, data }, [data]));

  if (parsed.kind === 'document') {
    return { kind: 'document', text: parsed.text, title: parsed.title };
  }

  onPhase?.('detecting');
  const schema = await api.detect(parsed.rows);

  onPhase?.('converting');
  const result = await api.convert(parsed.rows, schema, projectId);
  return { kind: 'rows', result: mergeParseErrors(result, parsed.errors) };
}

/**
 * Runs quality analysis in the worker.
 *
 * @param examples    - Examples to score (reports are index-aligned).
 * @param targetModel - Optional fine-tune target; switches to model-aware
 *                      scoring (context overflow, target-family special
 *                      tokens) instead of the dataset scan.
 */
export async function analyzeExamples(
  examples: Example[],
  targetModel?: ModelInfo,
): Promise<AnalyzeResult> {
  return getEngineWorker().analyze(examples, targetModel);
}

/**
 * Cleans a batch of examples in the worker. Pure: inputs are never mutated;
 * each result carries the cleaned copy plus its change descriptions, and is
 * index-aligned with the input.
 *
 * @param examples - Examples to clean.
 * @param opts     - Which cleaning operations to run.
 */
export async function cleanExamples(
  examples: Example[],
  opts: CleaningOptions,
): Promise<CleanedExample[]> {
  return getEngineWorker().cleanExamples(examples, opts);
}

/**
 * Finds exact and near duplicates in one round-trip pair. Exact groups have
 * identical normalized full text (similarity 1); near groups are MinHash/LSH
 * candidates verified by exact Jaccard similarity. Each group names the
 * example to keep and the ids to drop.
 */
export async function findDuplicates(
  examples: Example[],
  opts?: NearDuplicateOptions,
): Promise<{ exact: DuplicateGroup[]; near: DuplicateGroup[] }> {
  const api = getEngineWorker();
  const [exact, near] = await Promise.all([
    api.exactDuplicates(examples),
    api.nearDuplicates(examples, opts),
  ]);
  return { exact, near };
}

/**
 * Flags training examples that share a verbatim word n-gram with a benchmark
 * test set (n-gram containment), for pre-export decontamination. Pass each
 * benchmark (e.g. the engine's built-in samples or a user-loaded test split)
 * as a named {@link BenchmarkSample}.
 */
export async function decontaminateExamples(
  examples: Example[],
  benchmark: BenchmarkSample,
  opts?: DecontaminateOptions,
): Promise<ContaminationHit[]> {
  return getEngineWorker().decontaminate(examples, benchmark, opts);
}

/**
 * Counts rendered tokens per example in the worker (exact o200k_base BPE).
 * The returned array is index-aligned with the input.
 */
export async function countTokensFor(examples: Example[]): Promise<number[]> {
  return getEngineWorker().countTokens(examples);
}
