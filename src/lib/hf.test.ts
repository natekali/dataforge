/**
 * Tests for the HuggingFace Hub import client.
 *
 * All network access is mocked via vi.stubGlobal('fetch', ...); no real
 * requests are made.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HfHubError,
  getDatasetInfo,
  getRows,
  getSplits,
  importViaParquet,
  importViaRows,
  listParquetFiles,
  parseHfUrl,
  searchDatasets,
} from './hf';

// Parquet decoding needs real bytes; stub hyparquet's read path while keeping
// the real toJson so normalization is exercised for real.
const hyparquetMocks = vi.hoisted(() => ({
  asyncBufferFromUrl: vi.fn(),
  parquetMetadataAsync: vi.fn(),
  parquetReadObjects: vi.fn(),
}));

vi.mock('hyparquet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hyparquet')>();
  return { ...actual, ...hyparquetMocks };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Build /rows entries in the datasets-server wire shape. */
function makeWireRows(start: number, count: number): { row_idx: number; row: unknown }[] {
  return Array.from({ length: count }, (_, i) => ({
    row_idx: start + i,
    row: { text: `row-${start + i}` },
  }));
}

/** Stub global fetch and return the mock for assertions. */
function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  hyparquetMocks.asyncBufferFromUrl.mockReset();
  hyparquetMocks.parquetMetadataAsync.mockReset();
  hyparquetMocks.parquetReadObjects.mockReset();
});

// ---------------------------------------------------------------------------
// parseHfUrl
// ---------------------------------------------------------------------------

describe('parseHfUrl', () => {
  it('parses a bare org/name id', () => {
    expect(parseHfUrl('tatsu-lab/alpaca')).toEqual({ id: 'tatsu-lab/alpaca' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseHfUrl('  tatsu-lab/alpaca  ')).toEqual({ id: 'tatsu-lab/alpaca' });
  });

  it('parses hf:// shorthand without config', () => {
    expect(parseHfUrl('hf://tatsu-lab/alpaca')).toEqual({ id: 'tatsu-lab/alpaca' });
  });

  it('parses hf:// shorthand with config', () => {
    expect(parseHfUrl('hf://allenai/c4/en')).toEqual({ id: 'allenai/c4', config: 'en' });
  });

  it('parses hf:// shorthand with config and split', () => {
    expect(parseHfUrl('hf://allenai/c4/en/validation')).toEqual({
      id: 'allenai/c4',
      config: 'en',
      split: 'validation',
    });
  });

  it('parses a plain hub dataset URL', () => {
    expect(parseHfUrl('https://huggingface.co/datasets/tatsu-lab/alpaca')).toEqual({
      id: 'tatsu-lab/alpaca',
    });
  });

  it('parses a hub URL with trailing slash', () => {
    expect(parseHfUrl('https://huggingface.co/datasets/tatsu-lab/alpaca/')).toEqual({
      id: 'tatsu-lab/alpaca',
    });
  });

  it('parses viewer paths with config and split', () => {
    expect(
      parseHfUrl('https://huggingface.co/datasets/Open-Orca/OpenOrca/viewer/default/train'),
    ).toEqual({ id: 'Open-Orca/OpenOrca', config: 'default', split: 'train' });
  });

  it('parses viewer paths with config only', () => {
    expect(parseHfUrl('https://huggingface.co/datasets/allenai/c4/viewer/en')).toEqual({
      id: 'allenai/c4',
      config: 'en',
    });
  });

  it('parses ?split= query params', () => {
    expect(parseHfUrl('https://huggingface.co/datasets/tatsu-lab/alpaca?split=test')).toEqual({
      id: 'tatsu-lab/alpaca',
      split: 'test',
    });
  });

  it('parses ?config= and ?split= query params together', () => {
    expect(
      parseHfUrl('https://huggingface.co/datasets/allenai/c4?config=en&split=validation'),
    ).toEqual({ id: 'allenai/c4', config: 'en', split: 'validation' });
  });

  it('lets query params override viewer path values', () => {
    expect(
      parseHfUrl('https://huggingface.co/datasets/allenai/c4/viewer/en/train?split=validation'),
    ).toEqual({ id: 'allenai/c4', config: 'en', split: 'validation' });
  });

  it('parses tree paths, ignoring the revision', () => {
    expect(parseHfUrl('https://huggingface.co/datasets/tatsu-lab/alpaca/tree/main')).toEqual({
      id: 'tatsu-lab/alpaca',
    });
  });

  it('accepts the hf.co short domain', () => {
    expect(parseHfUrl('https://hf.co/datasets/tatsu-lab/alpaca')).toEqual({
      id: 'tatsu-lab/alpaca',
    });
  });

  it('parses a canonical no-namespace id', () => {
    expect(parseHfUrl('squad')).toEqual({ id: 'squad' });
  });

  it('parses a canonical hub dataset URL', () => {
    expect(parseHfUrl('https://huggingface.co/datasets/squad')).toEqual({ id: 'squad' });
  });

  it('parses canonical viewer paths with config and split', () => {
    expect(
      parseHfUrl('https://huggingface.co/datasets/squad/viewer/plain_text/train'),
    ).toEqual({ id: 'squad', config: 'plain_text', split: 'train' });
  });

  it('parses canonical tree paths, ignoring the revision', () => {
    expect(parseHfUrl('https://huggingface.co/datasets/squad/tree/main')).toEqual({
      id: 'squad',
    });
  });

  it('returns null for empty input', () => {
    expect(parseHfUrl('')).toBeNull();
    expect(parseHfUrl('   ')).toBeNull();
  });

  it('returns null for non-HF hosts', () => {
    expect(parseHfUrl('https://example.com/datasets/org/name')).toBeNull();
    expect(parseHfUrl('https://example.com/data.jsonl')).toBeNull();
  });

  it('returns null for hub URLs that are not dataset pages', () => {
    expect(parseHfUrl('https://huggingface.co/tatsu-lab/alpaca')).toBeNull();
  });

  it('returns null for incomplete hf:// references', () => {
    expect(parseHfUrl('hf://onlyorg')).toBeNull();
  });

  it('returns null for arbitrary text', () => {
    expect(parseHfUrl('not a url at all')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// searchDatasets
// ---------------------------------------------------------------------------

describe('searchDatasets', () => {
  it('builds the search URL and maps id/downloads/likes/tags', async () => {
    const mock = stubFetch(() =>
      Promise.resolve(
        jsonResponse([
          { id: 'tatsu-lab/alpaca', downloads: 12345, likes: 678, tags: ['task:sft', 'en'] },
          { id: 'no-stats/dataset' },
        ]),
      ),
    );

    const results = await searchDatasets('alpaca instruction');

    expect(mock).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(String(mock.mock.calls[0]?.[0]));
    expect(calledUrl.origin).toBe('https://huggingface.co');
    expect(calledUrl.pathname).toBe('/api/datasets');
    expect(calledUrl.searchParams.get('search')).toBe('alpaca instruction');
    expect(calledUrl.searchParams.get('limit')).toBe('20');
    expect(calledUrl.searchParams.get('sort')).toBe('downloads');

    expect(results).toEqual([
      { id: 'tatsu-lab/alpaca', downloads: 12345, likes: 678, tags: ['task:sft', 'en'] },
      { id: 'no-stats/dataset', downloads: 0, likes: 0, tags: [] },
    ]);
  });

  it('drops malformed entries without a string id', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse([{ downloads: 1 }, { id: 'ok/dataset', likes: 2 }])),
    );
    const results = await searchDatasets('q');
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('ok/dataset');
  });

  it('sends the bearer token when provided', async () => {
    const mock = stubFetch(() => Promise.resolve(jsonResponse([])));
    await searchDatasets('q', { hfToken: 'hf_secret' });
    const init = mock.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ Authorization: 'Bearer hf_secret' });
  });

  it('honours a custom result limit', async () => {
    const mock = stubFetch(() => Promise.resolve(jsonResponse([])));
    await searchDatasets('q', { limit: 5 });
    const calledUrl = new URL(String(mock.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get('limit')).toBe('5');
  });
});

// ---------------------------------------------------------------------------
// getDatasetInfo / getSplits / listParquetFiles
// ---------------------------------------------------------------------------

describe('getDatasetInfo', () => {
  it('maps configs and splits from the /info response', async () => {
    const mock = stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          dataset_info: {
            default: {
              splits: {
                train: { name: 'train', num_bytes: 1024, num_examples: 52002 },
                test: { name: 'test', num_examples: 500 },
              },
            },
          },
          partial: false,
        }),
      ),
    );

    const info = await getDatasetInfo('tatsu-lab/alpaca');

    const calledUrl = new URL(String(mock.mock.calls[0]?.[0]));
    expect(calledUrl.origin).toBe('https://datasets-server.huggingface.co');
    expect(calledUrl.pathname).toBe('/info');
    expect(calledUrl.searchParams.get('dataset')).toBe('tatsu-lab/alpaca');

    expect(info).toEqual({
      configs: [
        {
          name: 'default',
          splits: [
            { name: 'train', numExamples: 52002, numBytes: 1024 },
            { name: 'test', numExamples: 500, numBytes: null },
          ],
        },
      ],
      partial: false,
    });
  });
});

describe('getSplits', () => {
  it('maps config/split pairs from the /splits response', async () => {
    const mock = stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          splits: [
            { dataset: 'allenai/c4', config: 'en', split: 'train' },
            { dataset: 'allenai/c4', config: 'en', split: 'validation' },
            { bogus: true },
          ],
        }),
      ),
    );

    const splits = await getSplits('allenai/c4');

    const calledUrl = new URL(String(mock.mock.calls[0]?.[0]));
    expect(calledUrl.pathname).toBe('/splits');
    expect(calledUrl.searchParams.get('dataset')).toBe('allenai/c4');
    expect(splits).toEqual([
      { config: 'en', split: 'train' },
      { config: 'en', split: 'validation' },
    ]);
  });
});

describe('listParquetFiles', () => {
  it('maps config/split/url/size from the /parquet response', async () => {
    const mock = stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          parquet_files: [
            {
              dataset: 'tatsu-lab/alpaca',
              config: 'default',
              split: 'train',
              url: 'https://huggingface.co/datasets/tatsu-lab/alpaca/parquet/default/train/0.parquet',
              filename: '0.parquet',
              size: 24_000_000,
            },
            { config: 'default', split: 'train', url: 'https://example.org/1.parquet' },
          ],
        }),
      ),
    );

    const files = await listParquetFiles('tatsu-lab/alpaca');

    const calledUrl = new URL(String(mock.mock.calls[0]?.[0]));
    expect(calledUrl.pathname).toBe('/parquet');
    expect(files).toEqual([
      {
        config: 'default',
        split: 'train',
        url: 'https://huggingface.co/datasets/tatsu-lab/alpaca/parquet/default/train/0.parquet',
        size: 24_000_000,
      },
      { config: 'default', split: 'train', url: 'https://example.org/1.parquet', size: 0 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// getRows
// ---------------------------------------------------------------------------

describe('getRows', () => {
  it('builds the /rows URL, unwraps row.row and returns the total', async () => {
    const mock = stubFetch(() =>
      Promise.resolve(jsonResponse({ rows: makeWireRows(40, 3), num_rows_total: 52002 })),
    );

    const page = await getRows('tatsu-lab/alpaca', 'default', 'train', 40, 3);

    const calledUrl = new URL(String(mock.mock.calls[0]?.[0]));
    expect(calledUrl.pathname).toBe('/rows');
    expect(calledUrl.searchParams.get('dataset')).toBe('tatsu-lab/alpaca');
    expect(calledUrl.searchParams.get('config')).toBe('default');
    expect(calledUrl.searchParams.get('split')).toBe('train');
    expect(calledUrl.searchParams.get('offset')).toBe('40');
    expect(calledUrl.searchParams.get('length')).toBe('3');

    expect(page.total).toBe(52002);
    expect(page.rows).toEqual([{ text: 'row-40' }, { text: 'row-41' }, { text: 'row-42' }]);
  });

  it('clamps the page length to the server maximum of 100', async () => {
    const mock = stubFetch(() =>
      Promise.resolve(jsonResponse({ rows: [], num_rows_total: 0 })),
    );
    await getRows('a/b', 'default', 'train', 0, 5000);
    const calledUrl = new URL(String(mock.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get('length')).toBe('100');
  });

  it('sends the bearer token when provided', async () => {
    const mock = stubFetch(() =>
      Promise.resolve(jsonResponse({ rows: [], num_rows_total: 0 })),
    );
    await getRows('a/b', 'default', 'train', 0, 10, { hfToken: 'hf_secret' });
    const init = mock.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ Authorization: 'Bearer hf_secret' });
  });

  it('throws HfHubError with status and server message on failure', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'The dataset does not exist on the Hub.' }, 404)),
    );

    const error = await getRows('missing/dataset', 'default', 'train', 0, 10).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(HfHubError);
    expect((error as HfHubError).status).toBe(404);
    expect((error as HfHubError).message).toContain('404');
    expect((error as HfHubError).message).toContain('The dataset does not exist on the Hub.');
  });
});

// ---------------------------------------------------------------------------
// 429 retry behaviour
// ---------------------------------------------------------------------------

describe('429 backoff', () => {
  it('retries after 429 responses and succeeds', async () => {
    vi.useFakeTimers();
    const mock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(jsonResponse({ rows: makeWireRows(0, 2), num_rows_total: 2 }));
    vi.stubGlobal('fetch', mock);

    const promise = getRows('a/b', 'default', 'train', 0, 2);
    await vi.runAllTimersAsync();
    const page = await promise;

    expect(mock).toHaveBeenCalledTimes(3);
    expect(page.rows).toHaveLength(2);
  });

  it('gives up after 3 retries and surfaces the 429', async () => {
    vi.useFakeTimers();
    const mock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse({ error: 'rate limited' }, 429));
    vi.stubGlobal('fetch', mock);

    const promise = getRows('a/b', 'default', 'train', 0, 2).then(
      () => null,
      (e: unknown) => e,
    );
    await vi.runAllTimersAsync();
    const error = await promise;

    // 1 initial attempt + 3 retries.
    expect(mock).toHaveBeenCalledTimes(4);
    expect(error).toBeInstanceOf(HfHubError);
    expect((error as HfHubError).status).toBe(429);
  });

  it('waits one second between retries', async () => {
    vi.useFakeTimers();
    const mock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(jsonResponse({ rows: [], num_rows_total: 0 }));
    vi.stubGlobal('fetch', mock);

    const promise = getRows('a/b', 'default', 'train', 0, 2);
    // Let the first fetch resolve and the sleep timer get scheduled.
    await vi.advanceTimersByTimeAsync(999);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const page = await promise;
    expect(mock).toHaveBeenCalledTimes(2);
    expect(page.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// importViaRows
// ---------------------------------------------------------------------------

/** Fetch stub simulating a /rows backend over a fixed-size split. */
function stubRowsBackend(totalRows: number) {
  return stubFetch((input) => {
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get('offset'));
    const length = Number(url.searchParams.get('length'));
    const count = Math.max(0, Math.min(length, totalRows - offset));
    return Promise.resolve(
      jsonResponse({ rows: makeWireRows(offset, count), num_rows_total: totalRows }),
    );
  });
}

describe('importViaRows', () => {
  it('pages through /rows in 100-row requests and stops at maxRows', async () => {
    const mock = stubRowsBackend(250);
    const progress: [number, number][] = [];

    const rows = await importViaRows('a/b', 'default', 'train', {
      maxRows: 150,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(rows).toHaveLength(150);
    expect(rows[0]).toEqual({ text: 'row-0' });
    expect(rows[149]).toEqual({ text: 'row-149' });

    expect(mock).toHaveBeenCalledTimes(2);
    const first = new URL(String(mock.mock.calls[0]?.[0]));
    const second = new URL(String(mock.mock.calls[1]?.[0]));
    expect(first.searchParams.get('offset')).toBe('0');
    expect(first.searchParams.get('length')).toBe('100');
    expect(second.searchParams.get('offset')).toBe('100');
    expect(second.searchParams.get('length')).toBe('50');

    expect(progress).toEqual([
      [100, 150],
      [150, 150],
    ]);
  });

  it('fetches the entire split when maxRows is omitted', async () => {
    const mock = stubRowsBackend(230);
    const rows = await importViaRows('a/b', 'default', 'train', {});
    expect(rows).toHaveLength(230);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('caps the reported total at the split size when maxRows exceeds it', async () => {
    stubRowsBackend(30);
    const progress: [number, number][] = [];
    const rows = await importViaRows('a/b', 'default', 'train', {
      maxRows: 1000,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(rows).toHaveLength(30);
    expect(progress).toEqual([[30, 30]]);
  });

  it('handles an empty split', async () => {
    stubRowsBackend(0);
    const rows = await importViaRows('a/b', 'default', 'train', {});
    expect(rows).toEqual([]);
  });

  it('returns immediately when maxRows is 0', async () => {
    const mock = stubRowsBackend(100);
    const progress: [number, number][] = [];
    const rows = await importViaRows('a/b', 'default', 'train', {
      maxRows: 0,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(rows).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
    expect(progress).toEqual([[0, 0]]);
  });
});

// ---------------------------------------------------------------------------
// importViaParquet (hyparquet read path stubbed; toJson is the real thing)
// ---------------------------------------------------------------------------

/** Stub the /parquet listing with a single matching shard. */
function stubParquetListing(): void {
  stubFetch(() =>
    Promise.resolve(
      jsonResponse({
        parquet_files: [
          { config: 'default', split: 'train', url: 'https://example.org/0.parquet', size: 100 },
        ],
      }),
    ),
  );
}

/** Wire the hyparquet mocks to serve `rows` from one shard. */
function stubShard(rows: unknown[]): void {
  hyparquetMocks.asyncBufferFromUrl.mockResolvedValue({
    byteLength: 100,
    slice: () => new ArrayBuffer(0),
  });
  hyparquetMocks.parquetMetadataAsync.mockResolvedValue({ num_rows: BigInt(rows.length) });
  hyparquetMocks.parquetReadObjects.mockImplementation(
    ({ rowEnd }: { rowEnd: number }) => Promise.resolve(rows.slice(0, rowEnd)),
  );
}

describe('importViaParquet', () => {
  it('throws when no parquet shard matches the requested config/split', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          parquet_files: [
            { config: 'default', split: 'test', url: 'https://example.org/0.parquet', size: 10 },
          ],
        }),
      ),
    );

    await expect(importViaParquet('a/b', 'default', 'train')).rejects.toThrow(
      /No parquet files found/,
    );
  });

  it('surfaces HTTP errors from the /parquet listing', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ error: 'gated dataset' }, 401)));

    const error = await importViaParquet('gated/dataset', 'default', 'train').then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HfHubError);
    expect((error as HfHubError).status).toBe(401);
  });

  it('normalizes BigInt and Date values like the local parquet importer', async () => {
    stubParquetListing();
    stubShard([
      { id: 1n, when: new Date('2026-01-02T03:04:05.000Z'), bytes: new Uint8Array([1, 2]) },
      { id: 2n, when: new Date('2026-01-02T03:04:06.000Z'), bytes: new Uint8Array([3]) },
    ]);

    const rows = await importViaParquet('a/b', 'default', 'train');

    expect(rows).toEqual([
      { id: 1, when: '2026-01-02T03:04:05.000Z', bytes: [1, 2] },
      { id: 2, when: '2026-01-02T03:04:06.000Z', bytes: [3] },
    ]);
  });

  it('honors maxRows and reports progress', async () => {
    stubParquetListing();
    stubShard([{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
    const progress: [number, number][] = [];

    const rows = await importViaParquet('a/b', 'default', 'train', {
      maxRows: 3,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(rows).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
    expect(progress).toEqual([
      [0, 3],
      [3, 3],
    ]);
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    stubParquetListing();
    const controller = new AbortController();
    controller.abort();

    const error = await importViaParquet('a/b', 'default', 'train', {
      signal: controller.signal,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect(hyparquetMocks.asyncBufferFromUrl).not.toHaveBeenCalled();
  });

  it('stops between shard reads when aborted mid-import', async () => {
    stubParquetListing();
    const controller = new AbortController();
    stubShard([{ n: 0 }, { n: 1 }]);
    hyparquetMocks.parquetReadObjects.mockImplementation(() => {
      controller.abort();
      return Promise.resolve([{ n: 0 }, { n: 1 }]);
    });

    const error = await importViaParquet('a/b', 'default', 'train', {
      signal: controller.signal,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect(hyparquetMocks.parquetReadObjects).toHaveBeenCalledTimes(1);
  });
});
