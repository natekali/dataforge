/**
 * Tests for the AI operations module (runner, cache, enhance, generation,
 * judging, preference pairs).
 *
 * Injection seam: every operation accepts `dbOverride` (a {@link MinimalDb}
 * satisfied here by a plain in-memory stub) and `chatFn` (a fake transport
 * replacing the real provider adapters). No network, no IndexedDB.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createExample,
  type ChatResult,
  type Example,
  type Job,
  type ProviderConfig,
} from '@/engine/types';
import type { CacheEntry } from '@/lib/db';
import {
  cachedChat,
  chatCacheKey,
  runBatch,
  uncacheChat,
  type ChatFn,
  type MinimalDb,
} from './runner';
import { enhanceExamples, extractJson } from './enhance';
import { generateSynthetic } from './generate';
import { generateFromDocument } from './docgen';
import { judgeExamples } from './judge';
import { buildPreferencePairs, promptPortion } from './preference';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const provider: ProviderConfig = { id: 'openai', apiKey: 'test-key', enabled: true };

interface MemoryDb extends MinimalDb {
  jobRows: Map<string, Job>;
  exampleRows: Map<string, Example>;
  cacheRows: Map<string, CacheEntry>;
}

/** Plain in-memory stand-in for the Dexie tables used by the AI operations. */
function memoryDb(seedExamples: Example[] = []): MemoryDb {
  const jobRows = new Map<string, Job>();
  const exampleRows = new Map<string, Example>(
    seedExamples.map((e) => [e.id, structuredClone(e)]),
  );
  const cacheRows = new Map<string, CacheEntry>();
  return {
    jobRows,
    exampleRows,
    cacheRows,
    jobs: {
      add: async (job) => {
        jobRows.set(job.id, structuredClone(job));
      },
      update: async (id, changes) => {
        const current = jobRows.get(id);
        if (current !== undefined) jobRows.set(id, { ...current, ...structuredClone(changes) });
        return current !== undefined ? 1 : 0;
      },
      get: async (id) => {
        const row = jobRows.get(id);
        return row === undefined ? undefined : structuredClone(row);
      },
    },
    examples: {
      get: async (id) => {
        const row = exampleRows.get(id);
        return row === undefined ? undefined : structuredClone(row);
      },
      update: async (id, changes) => {
        const current = exampleRows.get(id);
        if (current === undefined) return 0;
        exampleRows.set(id, { ...current, ...structuredClone(changes) });
        return 1;
      },
      bulkAdd: async (examples) => {
        for (const example of examples) exampleRows.set(example.id, structuredClone(example));
      },
    },
    cache: {
      get: async (key) => cacheRows.get(key),
      put: async (entry) => {
        cacheRows.set(entry.key, entry);
      },
      delete: async (key) => {
        cacheRows.delete(key);
      },
    },
  };
}

function sftExample(overrides: Partial<Example> = {}): Example {
  return createExample({
    projectId: 'proj-1',
    messages: [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// extractJson
// ---------------------------------------------------------------------------

describe('extractJson', () => {
  it('parses bare JSON objects and arrays', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson(' [1, 2, 3] ')).toEqual([1, 2, 3]);
  });

  it('parses JSON inside markdown code fences', () => {
    expect(extractJson('```json\n{"a":{"b":2}}\n```')).toEqual({ a: { b: 2 } });
    expect(extractJson('```\n[true, false]\n```')).toEqual([true, false]);
  });

  it('parses prose-wrapped JSON with nested braces and braces inside strings', () => {
    const text =
      'Sure! Here is the result: {"text":"a } stray { brace","nested":{"list":[1,{"k":2}]}} Hope that helps!';
    expect(extractJson(text)).toEqual({
      text: 'a } stray { brace',
      nested: { list: [1, { k: 2 }] },
    });
  });

  it('prefers the fenced block over surrounding prose', () => {
    const text = 'Intro prose.\n```json\n{"fenced":true}\n```\nTrailing prose.';
    expect(extractJson(text)).toEqual({ fenced: true });
  });

  it('throws on output with no JSON at all', () => {
    expect(() => extractJson('I cannot help with that request.')).toThrow();
    expect(() => extractJson('{"unterminated": ')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// runBatch
// ---------------------------------------------------------------------------

describe('runBatch', () => {
  it('caps concurrency at the requested level', async () => {
    const db = memoryDb();
    let active = 0;
    let peak = 0;
    const handle = runBatch<number>({
      projectId: 'proj-1',
      kind: 'enhance',
      items: Array.from({ length: 12 }, (_, i) => i),
      concurrency: 3,
      params: {},
      dbOverride: db,
      worker: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(15);
        active -= 1;
      },
    });
    const job = await handle.promise;
    expect(peak).toBe(3);
    expect(job.status).toBe('completed');
    expect(job.done).toBe(12);
    expect(job.failed).toBe(0);
    expect(job.progress).toBe(1);
  });

  it('retries each failing item exactly once and records persistent failures', async () => {
    const db = memoryDb();
    const attempts = new Map<number, number>();
    const handle = runBatch<number>({
      projectId: 'proj-1',
      kind: 'enhance',
      items: [0, 1, 2],
      concurrency: 1,
      params: {},
      dbOverride: db,
      worker: async (item) => {
        const n = (attempts.get(item) ?? 0) + 1;
        attempts.set(item, n);
        if (item === 0 && n === 1) throw new Error('flaky once');
        if (item === 1) throw new Error('always fails');
      },
    });
    const job = await handle.promise;
    expect(attempts.get(0)).toBe(2); // failed, retried, succeeded
    expect(attempts.get(1)).toBe(2); // failed, retried, failed — no third attempt
    expect(attempts.get(2)).toBe(1);
    expect(job.done).toBe(2);
    expect(job.failed).toBe(1);
    expect(job.status).toBe('completed'); // partial failure does not fail the job
  });

  it('marks the job failed when every item fails', async () => {
    const db = memoryDb();
    const handle = runBatch<number>({
      projectId: 'proj-1',
      kind: 'enhance',
      items: [0, 1],
      params: {},
      dbOverride: db,
      worker: async () => {
        throw new Error('boom');
      },
    });
    const job = await handle.promise;
    expect(job.status).toBe('failed');
    expect(job.failed).toBe(2);
    expect(job.error).toBeTruthy();
    expect(db.jobRows.get(handle.jobId)?.status).toBe('failed');
  });

  it('collects the first 3 distinct error messages and surfaces the first on the job', async () => {
    const db = memoryDb();
    const handle = runBatch<number>({
      projectId: 'proj-1',
      kind: 'enhance',
      items: [0, 1, 2, 3, 4, 5],
      concurrency: 1,
      params: {},
      dbOverride: db,
      worker: async (item) => {
        if (item === 5) return; // one success keeps the job "completed"
        throw new Error(`error ${Math.min(item, 3)}`); // items 3 and 4 share a message
      },
    });
    const job = await handle.promise;
    expect(job.status).toBe('completed');
    expect(job.failed).toBe(5);
    expect(job.params['errors']).toEqual(['error 0', 'error 1', 'error 2']);
    expect(job.error).toBe('error 0');
    const row = db.jobRows.get(handle.jobId);
    expect(row?.error).toBe('error 0');
    expect(row?.params['errors']).toEqual(['error 0', 'error 1', 'error 2']);
  });

  it('uses the first collected error as the diagnostic when every item fails', async () => {
    const db = memoryDb();
    const handle = runBatch<number>({
      projectId: 'proj-1',
      kind: 'enhance',
      items: [0, 1],
      concurrency: 1,
      params: {},
      dbOverride: db,
      worker: async () => {
        throw new Error('provider exploded');
      },
    });
    const job = await handle.promise;
    expect(job.status).toBe('failed');
    expect(job.error).toBe('provider exploded');
    expect(job.params['errors']).toEqual(['provider exploded']);
  });

  it('completes immediately on an empty item list', async () => {
    const db = memoryDb();
    const handle = runBatch<number>({
      projectId: 'proj-1',
      kind: 'enhance',
      items: [],
      params: {},
      dbOverride: db,
      worker: async () => undefined,
    });
    const job = await handle.promise;
    expect(job.status).toBe('completed');
    expect(job.total).toBe(0);
    expect(job.progress).toBe(1);
  });

  it('cancels: aborts in-flight work, stops new items, persists status cancelled', async () => {
    const db = memoryDb();
    const handle = runBatch<number>({
      projectId: 'proj-1',
      kind: 'generate-synthetic',
      items: Array.from({ length: 12 }, (_, i) => i),
      concurrency: 2,
      params: {},
      dbOverride: db,
      worker: (_item, signal) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 40);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    });
    await sleep(50);
    handle.cancel();
    const job = await handle.promise;
    expect(job.status).toBe('cancelled');
    expect(job.done).toBeLessThan(12);
    expect(db.jobRows.get(handle.jobId)?.status).toBe('cancelled');
  });

  it('reports monotonically non-decreasing progress ending at 1', async () => {
    const db = memoryDb();
    const progresses: number[] = [];
    const statuses: string[] = [];
    const handle = runBatch<number>({
      projectId: 'proj-1',
      kind: 'enhance',
      items: Array.from({ length: 8 }, (_, i) => i),
      concurrency: 2,
      params: { label: 'progress-test' },
      dbOverride: db,
      onProgress: (job) => {
        progresses.push(job.progress);
        statuses.push(job.status);
      },
      worker: async () => {
        await sleep(80);
      },
    });
    const job = await handle.promise;
    expect(progresses.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    }
    expect(progresses.at(-1)).toBe(1);
    expect(statuses.at(-1)).toBe('completed');
    // Final state (including params) is persisted on the job row.
    const row = db.jobRows.get(handle.jobId);
    expect(row?.status).toBe('completed');
    expect(row?.params['label']).toBe('progress-test');
    expect(job.updatedAt).toBeGreaterThanOrEqual(job.createdAt);
  });
});

// ---------------------------------------------------------------------------
// cachedChat
// ---------------------------------------------------------------------------

describe('cachedChat', () => {
  const req = {
    model: 'test-model',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    temperature: 0.5,
  };

  it('misses then hits: the transport runs only once for identical requests', async () => {
    const db = memoryDb();
    let calls = 0;
    const chatFn: ChatFn = async () => {
      calls += 1;
      return { content: 'cached answer', usage: { inputTokens: 1, outputTokens: 2 } };
    };
    const first = await cachedChat(provider, req, db, chatFn);
    const second = await cachedChat(provider, req, db, chatFn);
    expect(calls).toBe(1);
    expect(first.content).toBe('cached answer');
    expect(second).toEqual(first);
    expect(db.cacheRows.size).toBe(1);
  });

  it('treats a different temperature as a different cache key', async () => {
    const db = memoryDb();
    let calls = 0;
    const chatFn: ChatFn = async () => {
      calls += 1;
      return { content: `answer ${calls}` };
    };
    await cachedChat(provider, req, db, chatFn);
    const other = await cachedChat(provider, { ...req, temperature: 0.9 }, db, chatFn);
    expect(calls).toBe(2);
    expect(other.content).toBe('answer 2');
    expect(db.cacheRows.size).toBe(2);
  });

  it('stores the JSON-stringified ChatResult under a sha-256 hex key', async () => {
    const db = memoryDb();
    const result: ChatResult = { content: 'stored' };
    await cachedChat(provider, req, db, async () => result);
    const key = await chatCacheKey(provider, req);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(db.cacheRows.get(key)?.value).toBe(JSON.stringify(result));
  });

  it('uncacheChat deletes the entry so the next call reaches the transport', async () => {
    const db = memoryDb();
    let calls = 0;
    const chatFn: ChatFn = async () => {
      calls += 1;
      return { content: `answer ${calls}` };
    };
    await cachedChat(provider, req, db, chatFn);
    expect(db.cacheRows.size).toBe(1);

    await uncacheChat(provider, req, db);
    expect(db.cacheRows.size).toBe(0);

    const fresh = await cachedChat(provider, req, db, chatFn);
    expect(calls).toBe(2);
    expect(fresh.content).toBe('answer 2');
  });

  it('falls back to FNV-1a hex when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    try {
      const key = await chatCacheKey(provider, req);
      const again = await chatCacheKey(provider, req);
      expect(key).toMatch(/^[0-9a-f]{8}$/);
      expect(again).toBe(key);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// enhanceExamples
// ---------------------------------------------------------------------------

describe('enhanceExamples', () => {
  it('writes the enhanced assistant content back with meta.enhanceOp', async () => {
    const example = sftExample();
    const db = memoryDb([example]);
    const chatFn: ChatFn = async () => ({
      content: JSON.stringify({
        messages: [
          { role: 'user', content: 'What is 2+2?' },
          { role: 'assistant', content: '2 + 2 equals 4.' },
        ],
      }),
    });
    const job = await enhanceExamples({
      projectId: 'proj-1',
      exampleIds: [example.id],
      op: 'improve-quality',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(job.status).toBe('completed');
    expect(job.done).toBe(1);
    const updated = db.exampleRows.get(example.id);
    expect(updated?.messages[1].content).toBe('2 + 2 equals 4.');
    expect(updated?.messages[0]).toEqual(example.messages[0]); // user turn untouched
    expect(updated?.meta['enhanceOp']).toBe('improve-quality');
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(example.updatedAt);
  });

  it('moves the returned reasoning onto the last assistant message for add-reasoning', async () => {
    const example = sftExample();
    const db = memoryDb([example]);
    const chatFn: ChatFn = async () => ({
      content: JSON.stringify({
        messages: [
          { role: 'user', content: 'What is 2+2?' },
          {
            role: 'assistant',
            content: 'The answer is 4.',
            reasoning: 'Two plus two: count up two from two.',
          },
        ],
      }),
    });
    const job = await enhanceExamples({
      projectId: 'proj-1',
      exampleIds: [example.id],
      op: 'add-reasoning',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(job.status).toBe('completed');
    const updated = db.exampleRows.get(example.id);
    expect(updated?.messages[1].reasoning).toBe('Two plus two: count up two from two.');
    expect(updated?.messages[1].content).toBe('The answer is 4.');
  });

  it('extracts a leading <think> block into reasoning for add-reasoning', async () => {
    const example = sftExample();
    const db = memoryDb([example]);
    const chatFn: ChatFn = async () => ({
      content: JSON.stringify({
        messages: [
          { role: 'user', content: 'What is 2+2?' },
          { role: 'assistant', content: '<think>2 and 2 make 4.</think>It is 4.' },
        ],
      }),
    });
    await enhanceExamples({
      projectId: 'proj-1',
      exampleIds: [example.id],
      op: 'add-reasoning',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    const updated = db.exampleRows.get(example.id);
    expect(updated?.messages[1].reasoning).toBe('2 and 2 make 4.');
    expect(updated?.messages[1].content).toBe('It is 4.');
  });

  it('leaves the example untouched and counts failed on unparseable output', async () => {
    const example = sftExample();
    const db = memoryDb([example]);
    const before = db.exampleRows.get(example.id);
    let calls = 0;
    const chatFn: ChatFn = async () => {
      calls += 1;
      return { content: 'I am sorry, I cannot produce JSON today.' };
    };
    const job = await enhanceExamples({
      projectId: 'proj-1',
      exampleIds: [example.id],
      op: 'improve-quality',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(job.failed).toBe(1);
    expect(job.done).toBe(0);
    expect(job.status).toBe('failed'); // the only item failed
    expect(job.error).toBeTruthy(); // the parse failure is surfaced on the job
    expect(db.exampleRows.get(example.id)).toEqual(before);
    expect(calls).toBe(2); // unparseable response is uncached, so the retry hit the transport
    expect(db.cacheRows.size).toBe(0); // no poisoned entry survives the run
  });

  it('recovers on retry when the first response is unparseable', async () => {
    const example = sftExample();
    const db = memoryDb([example]);
    let calls = 0;
    const chatFn: ChatFn = async () => {
      calls += 1;
      if (calls === 1) return { content: 'not JSON' };
      return {
        content: JSON.stringify({
          messages: [
            { role: 'user', content: 'What is 2+2?' },
            { role: 'assistant', content: 'Four.' },
          ],
        }),
      };
    };
    const job = await enhanceExamples({
      projectId: 'proj-1',
      exampleIds: [example.id],
      op: 'improve-quality',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(calls).toBe(2);
    expect(job.status).toBe('completed');
    expect(job.done).toBe(1);
    expect(db.exampleRows.get(example.id)?.messages[1].content).toBe('Four.');
  });

  it('rejects responses whose roles do not match the original conversation', async () => {
    const example = sftExample();
    const db = memoryDb([example]);
    const chatFn: ChatFn = async () => ({
      content: JSON.stringify({
        messages: [
          { role: 'assistant', content: 'swapped' },
          { role: 'user', content: 'swapped' },
        ],
      }),
    });
    const job = await enhanceExamples({
      projectId: 'proj-1',
      exampleIds: [example.id],
      op: 'expand',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(job.failed).toBe(1);
    expect(db.exampleRows.get(example.id)?.messages[1].content).toBe('4');
  });
});

// ---------------------------------------------------------------------------
// generateSynthetic
// ---------------------------------------------------------------------------

describe('generateSynthetic', () => {
  /** Returns exactly as many pairs as the prompt asks for. */
  const generatorChatFn: ChatFn = async (_config, req) => {
    const match = /exactly (\d+) entries/.exec(req.messages[1].content);
    const n = Number(match?.[1] ?? 0);
    return {
      content: JSON.stringify({
        examples: Array.from({ length: n }, (_, i) => ({
          instruction: `instruction ${n}-${i}`,
          response: `response ${n}-${i}`,
        })),
      }),
    };
  };

  it('splits the run into batches of 5 and tags meta.synthetic with the technique', async () => {
    const db = memoryDb();
    const requestedCounts: number[] = [];
    const chatFn: ChatFn = async (config, req) => {
      const match = /exactly (\d+) entries/.exec(req.messages[1].content);
      requestedCounts.push(Number(match?.[1] ?? 0));
      return generatorChatFn(config, req);
    };
    const job = await generateSynthetic({
      projectId: 'proj-1',
      technique: 'magpie-style',
      count: 7,
      topic: 'rust programming',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(job.status).toBe('completed');
    expect(job.total).toBe(2); // ceil(7 / 5) batches
    expect(requestedCounts.sort((a, b) => b - a)).toEqual([5, 2]);

    const createdIds = job.params['createdIds'] as string[];
    expect(createdIds).toHaveLength(7);
    for (const id of createdIds) {
      const example = db.exampleRows.get(id);
      expect(example).toBeDefined();
      expect(example?.meta['synthetic']).toBe('magpie-style');
      expect(example?.projectId).toBe('proj-1');
      expect(example?.messages[0].role).toBe('user');
      expect(example?.messages[1].role).toBe('assistant');
    }
    // The persisted job row carries the created ids too.
    expect(db.jobRows.get(job.id)?.params['createdIds']).toHaveLength(7);
  });

  it('uses seed examples for self-instruct generation', async () => {
    const seed = sftExample();
    const db = memoryDb([seed]);
    let sawSeed = false;
    const chatFn: ChatFn = async (config, req) => {
      if (req.messages[1].content.includes('What is 2+2?')) sawSeed = true;
      return generatorChatFn(config, req);
    };
    const job = await generateSynthetic({
      projectId: 'proj-1',
      technique: 'self-instruct',
      count: 3,
      seedExampleIds: [seed.id],
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(job.status).toBe('completed');
    expect(sawSeed).toBe(true);
    expect(job.params['createdIds']).toHaveLength(3);
  });

  it('validates its inputs synchronously', () => {
    const base = {
      projectId: 'proj-1',
      count: 5,
      provider,
      model: 'test-model',
      dbOverride: memoryDb(),
    };
    expect(() => generateSynthetic({ ...base, technique: 'magpie-style' })).toThrow(/topic/);
    expect(() => generateSynthetic({ ...base, technique: 'self-instruct' })).toThrow(/seed/);
    expect(() =>
      generateSynthetic({ ...base, technique: 'persona', count: 0 }),
    ).toThrow(/count/);
  });

  it('re-running with identical settings hits the transport again (per-run nonce)', async () => {
    const db = memoryDb();
    let calls = 0;
    const chatFn: ChatFn = async (config, req) => {
      calls += 1;
      return generatorChatFn(config, req);
    };
    const opts = {
      projectId: 'proj-1',
      technique: 'magpie-style' as const,
      count: 3,
      topic: 'rust programming',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    };
    await generateSynthetic(opts).promise;
    await generateSynthetic(opts).promise;
    expect(calls).toBe(2); // one fresh transport call per run, not a cache replay
    expect(db.cacheRows.size).toBe(2); // distinct cache keys per run
  });

  it('deletes the cache entry when batch parsing fails so the retry is fresh', async () => {
    const db = memoryDb();
    let calls = 0;
    const chatFn: ChatFn = async () => {
      calls += 1;
      return { content: 'no examples here' };
    };
    const job = await generateSynthetic({
      projectId: 'proj-1',
      technique: 'magpie-style',
      count: 2,
      topic: 'rust programming',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(job.status).toBe('failed');
    expect(calls).toBe(2); // retry reached the transport instead of the poisoned cache
    expect(db.cacheRows.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateFromDocument
// ---------------------------------------------------------------------------

describe('generateFromDocument', () => {
  it('creates grounded examples per chunk with document metadata', async () => {
    const db = memoryDb();
    const chatFn: ChatFn = async () => ({
      content: JSON.stringify({
        examples: [
          { instruction: 'What does chlorophyll do?', response: 'It absorbs light.' },
          { instruction: 'What is photosynthesis?', response: 'Light to chemical energy.' },
        ],
      }),
    });
    const job = await generateFromDocument({
      projectId: 'proj-1',
      text: 'Photosynthesis converts light into chemical energy. Plants use chlorophyll.',
      title: 'Biology Notes',
      questionsPerChunk: 2,
      style: 'qa',
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(job.status).toBe('completed');
    expect(job.total).toBe(1); // short text = single chunk
    const createdIds = job.params['createdIds'] as string[];
    expect(createdIds).toHaveLength(2);
    const first = db.exampleRows.get(createdIds[0]);
    expect(first?.meta['generator']).toBe('doc-qa');
    expect(first?.meta['docTitle']).toBe('Biology Notes');
    expect(first?.meta['chunkIndex']).toBe(0);
  });

  it('throws synchronously on an empty document', () => {
    expect(() =>
      generateFromDocument({
        projectId: 'proj-1',
        text: '   \n  ',
        title: 'Empty',
        questionsPerChunk: 3,
        style: 'qa',
        provider,
        model: 'test-model',
        dbOverride: memoryDb(),
      }),
    ).toThrow(/no text/);
  });
});

// ---------------------------------------------------------------------------
// judgeExamples
// ---------------------------------------------------------------------------

describe('judgeExamples', () => {
  it('writes a 0-100 qualityScore and meta.judge from the rubric scores', async () => {
    const example = sftExample();
    const db = memoryDb([example]);
    const chatFn: ChatFn = async () => ({
      content: JSON.stringify({
        helpfulness: 7,
        correctness: 9,
        clarity: 8,
        verdict: 'pass',
        rationale: 'Solid arithmetic.',
      }),
    });
    const job = await judgeExamples({
      projectId: 'proj-1',
      exampleIds: [example.id],
      provider,
      model: 'judge-model',
      dbOverride: db,
      chatFn,
    }).promise;

    expect(job.status).toBe('completed');
    const updated = db.exampleRows.get(example.id);
    expect(updated?.qualityScore).toBe(80); // round(((7+9+8)/3) * 10)
    const judge = updated?.meta['judge'] as {
      scores: Record<string, number>;
      verdict: string;
      model: string;
    };
    expect(judge.scores).toEqual({ helpfulness: 7, correctness: 9, clarity: 8 });
    expect(judge.verdict).toBe('pass');
    expect(judge.model).toBe('judge-model');
  });

  it('counts the item failed when the judge omits a score', async () => {
    const example = sftExample();
    const db = memoryDb([example]);
    const chatFn: ChatFn = async () => ({
      content: JSON.stringify({ helpfulness: 7, verdict: 'pass' }),
    });
    const job = await judgeExamples({
      projectId: 'proj-1',
      exampleIds: [example.id],
      provider,
      model: 'judge-model',
      dbOverride: db,
      chatFn,
    }).promise;
    expect(job.failed).toBe(1);
    expect(db.exampleRows.get(example.id)?.qualityScore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPreferencePairs
// ---------------------------------------------------------------------------

describe('buildPreferencePairs', () => {
  function sourceExample(): Example {
    return createExample({
      projectId: 'proj-1',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Write a haiku about rivers.' },
        { role: 'assistant', content: 'original answer' },
      ],
    });
  }

  /** Candidate calls return "candidate-N"; the ranking call returns `ranking`. */
  function preferenceChatFn(ranking: { ranking: number[]; tie: boolean }): ChatFn {
    return async (_config, req) => {
      if (req.jsonMode === true) {
        return { content: JSON.stringify({ ...ranking, rationale: 'judged' }) };
      }
      const match = /Candidate (\d+) of/.exec(req.messages[0].content);
      return { content: `candidate-${match?.[1] ?? '?'}` };
    };
  }

  it('extracts the prompt portion up to the last user turn inclusive', () => {
    const example = sourceExample();
    const prompt = promptPortion(example.messages);
    expect(prompt?.map((m) => m.role)).toEqual(['system', 'user']);
    expect(promptPortion([{ role: 'assistant', content: 'no user turn' }])).toBeNull();
  });

  it('creates a preference pair ordered by the judge ranking', async () => {
    const example = sourceExample();
    const db = memoryDb([example]);
    const job = await buildPreferencePairs({
      projectId: 'proj-1',
      exampleIds: [example.id],
      provider,
      model: 'test-model',
      candidates: 3,
      dbOverride: db,
      chatFn: preferenceChatFn({ ranking: [2, 3, 1], tie: false }),
    }).promise;

    expect(job.status).toBe('completed');
    const createdIds = job.params['createdIds'] as string[];
    expect(createdIds).toHaveLength(1);

    const pair = db.exampleRows.get(createdIds[0]);
    expect(pair?.type).toBe('preference');
    expect(pair?.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(pair?.chosen?.[0]?.content).toBe('candidate-2'); // best per ranking
    expect(pair?.rejected?.[0]?.content).toBe('candidate-1'); // worst per ranking
    expect(pair?.meta['generator']).toBe('on-policy-pairs');
    expect(pair?.meta['sourceExampleId']).toBe(example.id);
    // The source example itself is never modified.
    expect(db.exampleRows.get(example.id)?.messages).toHaveLength(3);
  });

  it('skips pair creation when the judge flags a tie', async () => {
    const example = sourceExample();
    const db = memoryDb([example]);
    const job = await buildPreferencePairs({
      projectId: 'proj-1',
      exampleIds: [example.id],
      provider,
      model: 'test-model',
      dbOverride: db,
      chatFn: preferenceChatFn({ ranking: [1, 2, 3], tie: true }),
    }).promise;

    expect(job.status).toBe('completed');
    expect(job.done).toBe(1); // a skipped tie is not a failure
    expect(job.params['createdIds']).toHaveLength(0);
    expect(db.exampleRows.size).toBe(1); // only the source example remains
  });

  it('clamps the candidate count to 2-4 and keys candidates by index', async () => {
    const example = sourceExample();
    const db = memoryDb([example]);
    const candidateIndices: string[] = [];
    const chatFn: ChatFn = async (_config, req) => {
      if (req.jsonMode === true) {
        return { content: JSON.stringify({ ranking: [4, 2, 3, 1], tie: false }) };
      }
      const match = /Candidate (\d+) of (\d+)/.exec(req.messages[0].content);
      candidateIndices.push(match?.[1] ?? '?');
      return { content: `candidate-${match?.[1] ?? '?'}` };
    };
    const job = await buildPreferencePairs({
      projectId: 'proj-1',
      exampleIds: [example.id],
      provider,
      model: 'test-model',
      candidates: 99, // clamped to 4
      dbOverride: db,
      chatFn,
    }).promise;

    expect(candidateIndices).toEqual(['1', '2', '3', '4']); // distinct cache keys per candidate
    const createdIds = job.params['createdIds'] as string[];
    const pair = db.exampleRows.get(createdIds[0]);
    expect(pair?.chosen?.[0]?.content).toBe('candidate-4');
    expect(pair?.rejected?.[0]?.content).toBe('candidate-1');
  });

  it('samples fresh candidates on a re-run with identical settings (per-run nonce)', async () => {
    const example = sourceExample();
    const db = memoryDb([example]);
    let candidateCalls = 0;
    const chatFn: ChatFn = async (_config, req) => {
      if (req.jsonMode === true) {
        return { content: JSON.stringify({ ranking: [1, 2, 3], tie: false }) };
      }
      candidateCalls += 1;
      const match = /Candidate (\d+) of/.exec(req.messages[0].content);
      return { content: `candidate-${match?.[1] ?? '?'}` };
    };
    const opts = {
      projectId: 'proj-1',
      exampleIds: [example.id],
      provider,
      model: 'test-model',
      candidates: 3,
      dbOverride: db,
      chatFn,
    };
    await buildPreferencePairs(opts).promise;
    await buildPreferencePairs(opts).promise;
    expect(candidateCalls).toBe(6); // 3 per run — the second run does not replay the cache
  });

  it('counts the item failed when the ranking is not a valid permutation', async () => {
    const example = sourceExample();
    const db = memoryDb([example]);
    const job = await buildPreferencePairs({
      projectId: 'proj-1',
      exampleIds: [example.id],
      provider,
      model: 'test-model',
      candidates: 3,
      dbOverride: db,
      chatFn: preferenceChatFn({ ranking: [1, 1, 2], tie: false }),
    }).promise;
    expect(job.failed).toBe(1);
    expect(job.params['createdIds']).toHaveLength(0);
  });
});
