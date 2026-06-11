/**
 * HuggingFace Hub import client.
 *
 * Talks exclusively to browser CORS-safe endpoints:
 *  - `https://huggingface.co/api/*`            (dataset search)
 *  - `https://datasets-server.huggingface.co/*` (info / splits / rows / parquet)
 *  - resolved parquet shard URLs                (ranged reads via hyparquet)
 *
 * Runtime-environment agnostic: no DOM, no React — safe in Web Workers and
 * Node 22 (vitest). All functions accept an optional HF access token which is
 * sent as an `Authorization: Bearer` header (required for gated/private
 * datasets).
 */

import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects, toJson } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUB_API_BASE = 'https://huggingface.co';
const DATASETS_SERVER_BASE = 'https://datasets-server.huggingface.co';

/** Hard limit imposed by the datasets-server /rows endpoint. */
const ROWS_PAGE_SIZE = 100;
/** Delay between 429 retries. */
const RETRY_DELAY_MS = 1000;
/** Maximum number of retries after a 429 response (so up to 4 total attempts). */
const MAX_RETRIES_429 = 3;
/** Default number of search results. */
const DEFAULT_SEARCH_LIMIT = 20;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options shared by every API call. */
export interface HfRequestOptions {
  /** HF access token; sent as `Authorization: Bearer <token>` when present. */
  hfToken?: string;
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
}

/** Options for {@link searchDatasets}. */
export interface HfSearchOptions extends HfRequestOptions {
  /** Maximum number of results (default 20). */
  limit?: number;
}

/** A dataset hit returned by hub search. */
export interface HfDatasetSummary {
  /** Repo id, e.g. "tatsu-lab/alpaca". */
  id: string;
  downloads: number;
  likes: number;
  tags: string[];
}

/** Per-split metadata from the /info endpoint. */
export interface HfSplitInfo {
  name: string;
  numExamples: number | null;
  numBytes: number | null;
}

/** Per-config metadata from the /info endpoint. */
export interface HfConfigInfo {
  name: string;
  splits: HfSplitInfo[];
}

/** Mapped response of the datasets-server /info endpoint. */
export interface HfDatasetInfo {
  configs: HfConfigInfo[];
  /** True when the server only computed info for part of the dataset. */
  partial: boolean;
}

/** A (config, split) pair from the /splits endpoint. */
export interface HfSplit {
  config: string;
  split: string;
}

/** One page of rows from the /rows endpoint. */
export interface HfRowsPage {
  /** Unwrapped row payloads (the `.row` field of each entry). */
  rows: unknown[];
  /** Total rows available in this config/split. */
  total: number;
}

/** A parquet shard exposed by the /parquet endpoint. */
export interface HfParquetFile {
  config: string;
  split: string;
  url: string;
  /** Shard size in bytes (0 when the server did not report it). */
  size: number;
}

/** Options for {@link importViaParquet} and {@link importViaRows}. */
export interface HfImportOptions extends HfRequestOptions {
  /** Stop after this many rows (entire split when omitted). */
  maxRows?: number;
  /** Progress callback: rows fetched so far out of the resolved total. */
  onProgress?: (done: number, total: number) => void;
}

/** Result of {@link parseHfUrl}. */
export interface ParsedHfRef {
  /** Dataset repo id, e.g. "tatsu-lab/alpaca". */
  id: string;
  /** Config/subset when the input specified one. */
  config?: string;
  /** Split when the input specified one. */
  split?: string;
}

/** Error thrown for non-OK HTTP responses; carries the status code. */
export class HfHubError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(`HTTP ${status}: ${message}`);
    this.name = 'HfHubError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(hfToken?: string): Record<string, string> | undefined {
  return hfToken ? { Authorization: `Bearer ${hfToken}` } : undefined;
}

/** Throw the canonical AbortError once the signal has been triggered. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

/** Extract a human-readable message from an error response body. */
async function readErrorMessage(response: Response): Promise<string> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    // Body unreadable — fall through to statusText.
  }
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof (parsed as { error?: unknown }).error === 'string'
      ) {
        return (parsed as { error: string }).error;
      }
    } catch {
      // Not JSON — use raw text.
    }
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  }
  return response.statusText || 'Request failed';
}

/**
 * GET a JSON endpoint with bearer auth, surfacing HTTP status + message on
 * failure and retrying 429 responses (1s sleep, max 3 retries).
 */
async function fetchJson<T>(url: string, opts?: HfRequestOptions): Promise<T> {
  let attempt = 0;
  for (;;) {
    const response = await fetch(url, {
      headers: authHeaders(opts?.hfToken),
      signal: opts?.signal,
    });
    if (response.status === 429 && attempt < MAX_RETRIES_429) {
      attempt += 1;
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    if (!response.ok) {
      throw new HfHubError(response.status, await readErrorMessage(response));
    }
    return (await response.json()) as T;
  }
}

function datasetsServerUrl(
  endpoint: 'info' | 'splits' | 'rows' | 'parquet',
  params: Record<string, string>,
): string {
  const url = new URL(`${DATASETS_SERVER_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Raw hub search item (subset we consume). */
interface RawSearchItem {
  id?: unknown;
  downloads?: unknown;
  likes?: unknown;
  tags?: unknown;
}

/**
 * Search the HuggingFace Hub for datasets, sorted by downloads.
 *
 * @param query free-text search query
 * @param opts  optional token / abort signal / result limit (default 20)
 */
export async function searchDatasets(
  query: string,
  opts?: HfSearchOptions,
): Promise<HfDatasetSummary[]> {
  const url = new URL(`${HUB_API_BASE}/api/datasets`);
  url.searchParams.set('search', query);
  url.searchParams.set('limit', String(opts?.limit ?? DEFAULT_SEARCH_LIMIT));
  url.searchParams.set('sort', 'downloads');
  const data = await fetchJson<RawSearchItem[]>(url.toString(), opts);
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is RawSearchItem & { id: string } => typeof item?.id === 'string')
    .map((item) => ({
      id: item.id,
      downloads: typeof item.downloads === 'number' ? item.downloads : 0,
      likes: typeof item.likes === 'number' ? item.likes : 0,
      tags: Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
    }));
}

// ---------------------------------------------------------------------------
// Dataset metadata (datasets-server)
// ---------------------------------------------------------------------------

interface RawInfoResponse {
  dataset_info?: Record<
    string,
    {
      splits?: Record<string, { name?: unknown; num_examples?: unknown; num_bytes?: unknown }>;
    }
  >;
  partial?: unknown;
}

/**
 * Fetch per-config/per-split metadata for a dataset from the datasets-server
 * `/info` endpoint.
 *
 * @param id dataset repo id, e.g. "tatsu-lab/alpaca"
 */
export async function getDatasetInfo(
  id: string,
  opts?: HfRequestOptions,
): Promise<HfDatasetInfo> {
  const data = await fetchJson<RawInfoResponse>(
    datasetsServerUrl('info', { dataset: id }),
    opts,
  );
  const configs: HfConfigInfo[] = [];
  for (const [configName, info] of Object.entries(data.dataset_info ?? {})) {
    const splits: HfSplitInfo[] = [];
    for (const [splitName, split] of Object.entries(info?.splits ?? {})) {
      splits.push({
        name: typeof split?.name === 'string' ? split.name : splitName,
        numExamples: typeof split?.num_examples === 'number' ? split.num_examples : null,
        numBytes: typeof split?.num_bytes === 'number' ? split.num_bytes : null,
      });
    }
    configs.push({ name: configName, splits });
  }
  return { configs, partial: data.partial === true };
}

interface RawSplitsResponse {
  splits?: { config?: unknown; split?: unknown }[];
}

/**
 * List all (config, split) pairs of a dataset via the datasets-server
 * `/splits` endpoint.
 *
 * @param id dataset repo id
 */
export async function getSplits(id: string, opts?: HfRequestOptions): Promise<HfSplit[]> {
  const data = await fetchJson<RawSplitsResponse>(
    datasetsServerUrl('splits', { dataset: id }),
    opts,
  );
  if (!Array.isArray(data.splits)) return [];
  return data.splits
    .filter(
      (entry): entry is { config: string; split: string } =>
        typeof entry?.config === 'string' && typeof entry?.split === 'string',
    )
    .map((entry) => ({ config: entry.config, split: entry.split }));
}

// ---------------------------------------------------------------------------
// Rows (datasets-server /rows)
// ---------------------------------------------------------------------------

interface RawRowsResponse {
  rows?: { row?: unknown }[];
  num_rows_total?: unknown;
}

/**
 * Fetch one page of rows from the datasets-server `/rows` endpoint.
 *
 * Each entry's `.row` payload is unwrapped, so the returned `rows` array
 * contains the bare record objects.
 *
 * @param id     dataset repo id
 * @param config dataset config/subset (e.g. "default")
 * @param split  split name (e.g. "train")
 * @param offset zero-based row offset
 * @param length page size, clamped to the server maximum of 100
 */
export async function getRows(
  id: string,
  config: string,
  split: string,
  offset: number,
  length: number,
  opts?: HfRequestOptions,
): Promise<HfRowsPage> {
  const clampedLength = Math.max(1, Math.min(Math.floor(length), ROWS_PAGE_SIZE));
  const data = await fetchJson<RawRowsResponse>(
    datasetsServerUrl('rows', {
      dataset: id,
      config,
      split,
      offset: String(Math.max(0, Math.floor(offset))),
      length: String(clampedLength),
    }),
    opts,
  );
  const rawRows = Array.isArray(data.rows) ? data.rows : [];
  const rows = rawRows.map((entry) =>
    entry !== null && typeof entry === 'object' && 'row' in entry ? entry.row : entry,
  );
  const total = typeof data.num_rows_total === 'number' ? data.num_rows_total : rows.length;
  return { rows, total };
}

// ---------------------------------------------------------------------------
// Parquet (datasets-server /parquet + hyparquet ranged reads)
// ---------------------------------------------------------------------------

interface RawParquetResponse {
  parquet_files?: { config?: unknown; split?: unknown; url?: unknown; size?: unknown }[];
}

/**
 * List the auto-converted parquet shards of a dataset via the datasets-server
 * `/parquet` endpoint.
 *
 * @param id dataset repo id
 */
export async function listParquetFiles(
  id: string,
  opts?: HfRequestOptions,
): Promise<HfParquetFile[]> {
  const data = await fetchJson<RawParquetResponse>(
    datasetsServerUrl('parquet', { dataset: id }),
    opts,
  );
  if (!Array.isArray(data.parquet_files)) return [];
  return data.parquet_files
    .filter(
      (file): file is { config: string; split: string; url: string; size?: unknown } =>
        typeof file?.config === 'string' &&
        typeof file?.split === 'string' &&
        typeof file?.url === 'string',
    )
    .map((file) => ({
      config: file.config,
      split: file.split,
      url: file.url,
      size: typeof file.size === 'number' ? file.size : 0,
    }));
}

/**
 * Import rows by streaming the dataset's auto-converted parquet shards with
 * hyparquet (HTTP range requests — only the needed row groups are fetched).
 *
 * Preferred over {@link importViaRows} for large imports: far fewer requests
 * and no 100-row page cap.
 *
 * @param id     dataset repo id
 * @param config dataset config/subset
 * @param split  split name
 * @param opts   maxRows cutoff, progress callback, token, abort signal
 * @returns row objects (column name → value)
 */
export async function importViaParquet(
  id: string,
  config: string,
  split: string,
  opts: HfImportOptions = {},
): Promise<unknown[]> {
  const { maxRows, onProgress, hfToken, signal } = opts;
  const files = (await listParquetFiles(id, opts)).filter(
    (file) => file.config === config && file.split === split,
  );
  if (files.length === 0) {
    throw new Error(
      `No parquet files found for dataset "${id}" (config "${config}", split "${split}")`,
    );
  }
  throwIfAborted(signal);

  // The signal also rides along on hyparquet's ranged reads.
  const requestInit: RequestInit = { signal };
  if (hfToken) requestInit.headers = { Authorization: `Bearer ${hfToken}` };

  // Open every shard and read its footer so the row total is known up front.
  const shards = await Promise.all(
    files.map(async (file) => {
      const buffer = await asyncBufferFromUrl({
        url: file.url,
        byteLength: file.size > 0 ? file.size : undefined,
        requestInit,
      });
      const metadata = await parquetMetadataAsync(buffer);
      throwIfAborted(signal);
      return { buffer, metadata, numRows: Number(metadata.num_rows) };
    }),
  );

  const available = shards.reduce((sum, shard) => sum + shard.numRows, 0);
  const total = maxRows === undefined ? available : Math.min(Math.max(0, maxRows), available);

  const rows: unknown[] = [];
  onProgress?.(0, total);
  for (const shard of shards) {
    throwIfAborted(signal);
    if (rows.length >= total) break;
    const want = Math.min(total - rows.length, shard.numRows);
    if (want <= 0) continue;
    const shardRows = await parquetReadObjects({
      file: shard.buffer,
      metadata: shard.metadata,
      compressors,
      rowStart: 0,
      rowEnd: want,
    });
    throwIfAborted(signal);
    for (const row of shardRows) {
      if (rows.length >= total) break;
      // Same normalization as the local parquet importer: BigInts become
      // numbers, dates ISO strings, byte arrays plain arrays.
      rows.push(toJson(row));
    }
    onProgress?.(rows.length, total);
  }
  return rows;
}

/**
 * Import rows by paging through the datasets-server `/rows` endpoint in
 * 100-row requests. Honors `maxRows`, reports progress after each page and
 * retries 429 responses (1s backoff, max 3 retries per request).
 *
 * @param id     dataset repo id
 * @param config dataset config/subset
 * @param split  split name
 * @param opts   maxRows cutoff, progress callback, token, abort signal
 * @returns unwrapped row objects
 */
export async function importViaRows(
  id: string,
  config: string,
  split: string,
  opts: HfImportOptions = {},
): Promise<unknown[]> {
  const { maxRows, onProgress } = opts;
  if (maxRows !== undefined && maxRows <= 0) {
    onProgress?.(0, 0);
    return [];
  }

  const rows: unknown[] = [];
  let offset = 0;
  let total: number | undefined;

  for (;;) {
    const want =
      maxRows === undefined ? ROWS_PAGE_SIZE : Math.min(ROWS_PAGE_SIZE, maxRows - rows.length);
    const page = await getRows(id, config, split, offset, want, opts);
    if (total === undefined) {
      total = maxRows === undefined ? page.total : Math.min(maxRows, page.total);
    }
    for (const row of page.rows) {
      if (rows.length >= total) break;
      rows.push(row);
    }
    onProgress?.(rows.length, total);
    offset += page.rows.length;
    if (rows.length >= total || page.rows.length === 0) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/** Bare repo id: "org/name" or a canonical no-namespace id like "squad". */
const BARE_ID_RE = /^[\w.-]+(?:\/[\w.-]+)?$/;

/** Repo sub-paths that can directly follow a canonical dataset name. */
const DATASET_SUBPATHS = new Set(['viewer', 'tree', 'blob', 'resolve']);

/**
 * Parse a user-supplied HuggingFace dataset reference.
 *
 * Accepted forms (behaviour ported from dataforge_core/url_parser.py):
 *  - bare repo id:            `org/name` or canonical `name` (e.g. "squad")
 *  - hf shorthand:            `hf://org/name[/config[/split]]`
 *  - hub URLs:                `https://huggingface.co/datasets/org/name`
 *                             and canonical `.../datasets/name`
 *    - viewer paths:          `.../viewer/{config}[/{split}]`
 *    - tree paths:            `.../tree/{revision}` (revision is ignored)
 *    - query params:          `?config=...&split=...` (override path values)
 *  - `hf.co` and `*.huggingface.co` hosts are accepted as aliases
 *
 * `config`/`split` are only set when the input explicitly specifies them.
 *
 * @returns the parsed reference, or null when the input is not a HF dataset
 */
export function parseHfUrl(input: string): ParsedHfRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // hf://org/name[/config[/split]]
  if (trimmed.startsWith('hf://')) {
    const parts = trimmed
      .slice('hf://'.length)
      .split('/')
      .filter((part) => part.length > 0);
    if (parts.length < 2) return null;
    const ref: ParsedHfRef = { id: `${parts[0]}/${parts[1]}` };
    if (parts.length > 2) ref.config = parts[2];
    if (parts.length > 3) ref.split = parts[3];
    return ref;
  }

  // Full http(s) URLs.
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    const isHfHost =
      host === 'huggingface.co' || host.endsWith('.huggingface.co') || host === 'hf.co';
    if (!isHfHost) return null;

    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    if (parts.length < 2 || parts[0] !== 'datasets') return null;

    // Canonical single-segment id ("squad") when nothing follows the name or
    // the next segment is a repo sub-path; "org/name" otherwise.
    const canonical = parts.length === 2 || DATASET_SUBPATHS.has(parts[2]);
    const ref: ParsedHfRef = {
      id: canonical
        ? decodeURIComponent(parts[1])
        : `${decodeURIComponent(parts[1])}/${decodeURIComponent(parts[2])}`,
    };
    const rest = parts.slice(canonical ? 2 : 3);

    // .../viewer/{config}[/{split}]
    if (rest.length >= 2 && rest[0] === 'viewer') {
      ref.config = decodeURIComponent(rest[1]);
      if (rest.length >= 3) ref.split = decodeURIComponent(rest[2]);
    }
    // .../tree/{revision} — revision intentionally ignored.

    const queryConfig = url.searchParams.get('config');
    const querySplit = url.searchParams.get('split');
    if (queryConfig) ref.config = queryConfig;
    if (querySplit) ref.split = querySplit;
    return ref;
  }

  // Bare "org/name" or canonical "name".
  if (BARE_ID_RE.test(trimmed)) {
    return { id: trimmed };
  }
  return null;
}
