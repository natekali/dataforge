/**
 * Generic batch-job runner and cached chat transport for all AI operations.
 *
 * Every AI feature (enhance, synthetic generation, document Q&A, judging,
 * preference pairs) funnels through {@link runBatch}: it persists a {@link Job}
 * row, runs a worker over the items with bounded concurrency, retries each
 * failing item once, throttles progress writes, and supports cooperative
 * cancellation via AbortController.
 *
 * Injection seam (used by ai.test.ts): every operation accepts an optional
 * {@link ChatFn} that replaces the real provider adapter, and an optional
 * {@link MinimalDb} that replaces the Dexie singleton. Production callers
 * simply omit both.
 */
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  Example,
  Job,
  JobKind,
  ProviderConfig,
} from '@/engine/types';
import { db, type CacheEntry } from '@/lib/db';
import { getAdapter } from '@/lib/providers';

// ---------------------------------------------------------------------------
// Database seam
// ---------------------------------------------------------------------------

/**
 * Structural subset of the Dexie database used by the AI operations.
 *
 * Deliberately loose (method signatures, `Promise<unknown>` returns) so that
 * both the real Dexie tables and a plain in-memory stub satisfy it in tests.
 */
export interface MinimalDb {
  jobs: {
    add(job: Job): Promise<unknown>;
    update(id: string, changes: Partial<Job>): Promise<unknown>;
    get(id: string): Promise<Job | undefined>;
  };
  examples: {
    get(id: string): Promise<Example | undefined>;
    update(id: string, changes: Partial<Example>): Promise<unknown>;
    bulkAdd(examples: Example[]): Promise<unknown>;
  };
  cache: {
    get(key: string): Promise<CacheEntry | undefined>;
    put(entry: CacheEntry): Promise<unknown>;
    delete(key: string): Promise<unknown>;
  };
}

/**
 * Resolve the database to operate on: the injected test double when provided,
 * otherwise the real Dexie singleton.
 *
 * @param override - Optional in-memory replacement (tests, dry runs).
 */
export function resolveDb(override?: MinimalDb): MinimalDb {
  return override ?? db;
}

// ---------------------------------------------------------------------------
// Chat transport + response cache
// ---------------------------------------------------------------------------

/**
 * One non-streaming chat completion. This is THE injection seam for tests:
 * pass a fake ChatFn to any AI operation to bypass real provider HTTP calls.
 */
export type ChatFn = (config: ProviderConfig, req: ChatRequest) => Promise<ChatResult>;

/** Default transport: route through the BYOK provider adapter registry. */
export const adapterChatFn: ChatFn = (config, req) => getAdapter(config.id).chat(config, req);

/** 32-bit FNV-1a hash rendered as 8 hex characters (subtle-crypto fallback). */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute the cache key for a chat request: SHA-256 hex (via `crypto.subtle`)
 * of the JSON of `{ provider, model, messages, temperature }`. Falls back to
 * an inline FNV-1a hex hash when the subtle API is unavailable (insecure
 * contexts, exotic runtimes).
 *
 * @param config - Provider configuration (only the id participates in the key).
 * @param req    - Chat request (model, messages and temperature participate).
 */
export async function chatCacheKey(config: ProviderConfig, req: ChatRequest): Promise<string> {
  const payload = JSON.stringify({
    provider: config.id,
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? null,
  });
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return fnv1aHex(payload);
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Run a chat completion through the response cache.
 *
 * On a cache hit the stored {@link ChatResult} is returned without any network
 * call; on a miss the transport is invoked and the successful result is stored
 * JSON-stringified in the `cache` table, making long generation runs resumable
 * and retries free. Failures are never cached.
 *
 * @param config     - Provider configuration for the call.
 * @param req        - Chat request. `signal` is honored but excluded from the key.
 * @param dbOverride - Optional database double (tests).
 * @param chatFn     - Optional transport override (tests); defaults to the
 *                     provider adapter registry.
 */
export async function cachedChat(
  config: ProviderConfig,
  req: ChatRequest,
  dbOverride?: MinimalDb,
  chatFn: ChatFn = adapterChatFn,
): Promise<ChatResult> {
  const database = resolveDb(dbOverride);
  const key = await chatCacheKey(config, req);
  const hit = await database.cache.get(key);
  if (hit !== undefined) {
    try {
      return JSON.parse(hit.value) as ChatResult;
    } catch {
      // Corrupt entry — fall through to a fresh request that overwrites it.
    }
  }
  const result = await chatFn(config, req);
  await database.cache.put({ key, value: JSON.stringify(result), createdAt: Date.now() });
  return result;
}

/**
 * Delete the cache entry for a chat request.
 *
 * {@link cachedChat} stores responses before the caller has validated them, so
 * an unparseable response would otherwise poison every retry and future run.
 * Callers invoke this when they fail to parse a cached response, guaranteeing
 * the next attempt reaches the transport again.
 *
 * @param config     - Provider configuration used for the original call.
 * @param req        - The exact chat request whose entry should be dropped.
 * @param dbOverride - Optional database double (tests).
 */
export async function uncacheChat(
  config: ProviderConfig,
  req: ChatRequest,
  dbOverride?: MinimalDb,
): Promise<void> {
  const database = resolveDb(dbOverride);
  const key = await chatCacheKey(config, req);
  await database.cache.delete(key);
}

/**
 * Convert a system+user prompt pair (the shape produced by every builder in
 * prompts.ts) into the two-message chat request body.
 */
export function pairToMessages(pair: { system: string; user: string }): ChatMessage[] {
  return [
    { role: 'system', content: pair.system },
    { role: 'user', content: pair.user },
  ];
}

// ---------------------------------------------------------------------------
// Batch runner
// ---------------------------------------------------------------------------

/** Minimum interval between persisted job-progress writes (final write always lands). */
const MIN_WRITE_INTERVAL_MS = 250;

/** Default number of items processed in parallel. */
const DEFAULT_CONCURRENCY = 4;

/** How many distinct per-item error messages are kept on the job. */
const MAX_RECORDED_ERRORS = 3;

/** Options accepted by {@link runBatch}. */
export interface RunBatchOptions<T> {
  /** Project the job belongs to. */
  projectId: string;
  /** Job kind persisted on the row (drives UI labels/filters). */
  kind: JobKind;
  /** Work items, processed in order of availability. */
  items: T[];
  /** Max items in flight at once (default 4, min 1). */
  concurrency?: number;
  /**
   * Kind-specific parameter snapshot persisted on the job. Workers may mutate
   * it (e.g. push created ids) — the final write persists the mutated object.
   */
  params: Record<string, unknown>;
  /** Process one item. Throwing marks the attempt failed (one retry granted). */
  worker: (item: T, signal: AbortSignal) => Promise<void>;
  /** Called with a job snapshot after every persisted progress write. */
  onProgress?: (job: Job) => void;
  /** Optional database double (tests). */
  dbOverride?: MinimalDb;
}

/** Handle returned by {@link runBatch}. */
export interface BatchHandle {
  /** Id of the persisted Job row. */
  jobId: string;
  /** Resolves with the final job snapshot (completed / failed / cancelled). Never rejects. */
  promise: Promise<Job>;
  /** Abort outstanding work; the job finishes with status "cancelled". */
  cancel: () => void;
}

/** Human-readable progress line stored in Job.detail. */
function describeProgress(done: number, failed: number, total: number): string {
  const processed = done + failed;
  return failed > 0
    ? `${processed}/${total} processed — ${failed} failed`
    : `${processed}/${total} processed`;
}

/**
 * Run a worker over a list of items as a persisted, cancellable batch job.
 *
 * Behaviour:
 * - Creates a `running` Job row immediately; `jobId` is available synchronously.
 * - Processes items with bounded concurrency (default 4).
 * - Each failing item is retried exactly once; a second failure increments
 *   `failed` and the run continues.
 * - Progress writes are throttled to at least {@link MIN_WRITE_INTERVAL_MS}
 *   apart; the final state is always written.
 * - `cancel()` aborts the shared AbortSignal: in-flight items may finish or
 *   abort, no new items start, and the job ends with status `cancelled`.
 * - Final status: `cancelled` when aborted, `failed` when every item failed
 *   (or the runner itself errored), otherwise `completed` (partial failures
 *   are recorded in `failed` but do not fail the job).
 *
 * @returns The job id, a promise for the final job snapshot, and a cancel function.
 */
export function runBatch<T>(opts: RunBatchOptions<T>): BatchHandle {
  const database = resolveDb(opts.dbOverride);
  const controller = new AbortController();
  const total = opts.items.length;
  const startedAt = Date.now();

  const job: Job = {
    id: crypto.randomUUID(),
    projectId: opts.projectId,
    kind: opts.kind,
    status: 'running',
    progress: 0,
    detail: describeProgress(0, 0, total),
    total,
    done: 0,
    failed: 0,
    createdAt: startedAt,
    updatedAt: startedAt,
    params: opts.params,
  };

  let lastWrite = 0;
  let finished = false;
  /** First few distinct worker error messages, surfaced on the final job. */
  const errors: string[] = [];

  const snapshot = (): Job => ({ ...job });

  const persist = async (force: boolean): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastWrite < MIN_WRITE_INTERVAL_MS) return;
    lastWrite = now;
    job.updatedAt = now;
    await database.jobs.update(job.id, {
      status: job.status,
      progress: job.progress,
      detail: job.detail,
      done: job.done,
      failed: job.failed,
      updatedAt: job.updatedAt,
      params: job.params,
      ...(job.error !== undefined ? { error: job.error } : {}),
    });
    opts.onProgress?.(snapshot());
  };

  const runItem = async (item: T): Promise<void> => {
    let succeeded = false;
    for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
      try {
        await opts.worker(item, controller.signal);
        succeeded = true;
      } catch (err) {
        // Cancelled mid-flight: count the item neither done nor failed.
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        if (errors.length < MAX_RECORDED_ERRORS && !errors.includes(message)) {
          errors.push(message);
        }
      }
    }
    if (succeeded) job.done += 1;
    else job.failed += 1;
    job.progress = total === 0 ? 1 : (job.done + job.failed) / total;
    job.detail = describeProgress(job.done, job.failed, total);
    await persist(false);
  };

  const promise = (async (): Promise<Job> => {
    try {
      await database.jobs.add(snapshot());
      lastWrite = Date.now();
      opts.onProgress?.(snapshot());

      let next = 0;
      const laneCount = Math.min(
        Math.max(1, Math.floor(opts.concurrency ?? DEFAULT_CONCURRENCY)),
        Math.max(total, 1),
      );
      const lane = async (): Promise<void> => {
        while (!controller.signal.aborted) {
          const index = next;
          next += 1;
          if (index >= total) return;
          await runItem(opts.items[index]);
        }
      };
      await Promise.all(Array.from({ length: laneCount }, () => lane()));

      if (controller.signal.aborted) {
        job.status = 'cancelled';
      } else if (total > 0 && job.failed === total) {
        job.status = 'failed';
        job.error = errors[0] ?? 'every item in the batch failed';
      } else {
        job.status = 'completed';
        job.progress = 1;
        if (job.failed > 0 && errors.length > 0) job.error = errors[0];
      }
    } catch (err) {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      finished = true;
      if (errors.length > 0) job.params['errors'] = errors;
      job.detail = describeProgress(job.done, job.failed, total);
      try {
        await persist(true);
      } catch {
        // Persistence is best effort at this point; the snapshot is still returned.
      }
    }
    return snapshot();
  })();

  return {
    jobId: job.id,
    promise,
    cancel: () => {
      if (!finished) controller.abort();
    },
  };
}
