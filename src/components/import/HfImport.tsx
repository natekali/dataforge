/**
 * Hugging Face tab — search the Hub or load a dataset by id/URL, pick a
 * config and split, preview the first raw rows, then stream the rows in
 * (parquet first, /rows API as fallback) and convert them in the worker.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleAlert, Download, Heart, Search, X } from 'lucide-react';
import type { ImportResult } from '@/engine/types';
import {
  getDatasetInfo,
  getRows,
  importViaParquet,
  importViaRows,
  parseHfUrl,
  searchDatasets,
  type ParsedHfRef,
} from '@/lib/hf';
import { getEngineWorker } from '@/lib/workerClient';
import { useSetting } from '@/lib/hooks';
import { fmtNum } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Progress, Spinner } from '@/components/ui/Controls';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { ImportPreview } from './ImportPreview';

const SEARCH_DEBOUNCE_MS = 400;
const SEARCH_LIMIT = 8;
const PREVIEW_ROWS = 5;
const VALUE_CLIP = 80;

/** Render a raw row as a one-line `key: value` snippet. */
function rowSnippet(row: unknown): string {
  const clip = (s: string) => {
    const oneLine = s.replace(/\s+/g, ' ').trim();
    return oneLine.length > VALUE_CLIP ? `${oneLine.slice(0, VALUE_CLIP)}…` : oneLine;
  };
  if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
    return Object.entries(row as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${clip(typeof v === 'string' ? v : (JSON.stringify(v) ?? ''))}`)
      .join('   ');
  }
  return clip(JSON.stringify(row) ?? String(row));
}

export function HfImport({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [direct, setDirect] = useState('');
  const [selected, setSelected] = useState<ParsedHfRef | null>(null);
  const [config, setConfig] = useState('');
  const [split, setSplit] = useState('');
  const [maxRows, setMaxRows] = useState('5000');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const tokenSetting = useSetting<string>('hf-token', '');
  const hfToken =
    typeof tokenSetting === 'string' && tokenSetting.trim() ? tokenSetting.trim() : undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Abort an in-flight import if the tab unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const search = useQuery({
    queryKey: ['hf-search', debounced],
    queryFn: ({ signal }) =>
      searchDatasets(debounced.trim(), { limit: SEARCH_LIMIT, hfToken, signal }),
    enabled: debounced.trim().length >= 2,
    staleTime: 60_000,
  });

  const info = useQuery({
    queryKey: ['hf-info', selected?.id],
    queryFn: ({ signal }) => getDatasetInfo(selected!.id, { hfToken, signal }),
    enabled: !!selected,
    staleTime: 5 * 60_000,
  });

  // Default config when info lands; honor a config parsed from the URL.
  useEffect(() => {
    const configs = info.data?.configs ?? [];
    if (configs.length === 0) return;
    setConfig((prev) => {
      if (prev && configs.some((c) => c.name === prev)) return prev;
      if (selected?.config && configs.some((c) => c.name === selected.config))
        return selected.config;
      return configs[0].name;
    });
  }, [info.data, selected]);

  const activeConfig = info.data?.configs.find((c) => c.name === config);

  // Default split once a config is active; honor a split parsed from the URL.
  useEffect(() => {
    const splits = activeConfig?.splits ?? [];
    if (splits.length === 0) return;
    setSplit((prev) => {
      if (prev && splits.some((s) => s.name === prev)) return prev;
      if (selected?.split && splits.some((s) => s.name === selected.split)) return selected.split;
      return splits[0].name;
    });
  }, [activeConfig, selected]);

  const rowsPreview = useQuery({
    queryKey: ['hf-rows', selected?.id, config, split],
    queryFn: ({ signal }) =>
      getRows(selected!.id, config, split, 0, PREVIEW_ROWS, { hfToken, signal }),
    enabled: !!selected && !!config && !!split,
    staleTime: 5 * 60_000,
  });

  function selectDataset(ref: ParsedHfRef) {
    if (busy) return;
    setSelected(ref);
    setConfig('');
    setSplit('');
    setResult(null);
  }

  function handleLoad() {
    const ref = parseHfUrl(direct);
    if (!ref) {
      toast.error('Not a Hugging Face dataset id or URL.');
      return;
    }
    selectDataset(ref);
  }

  async function handleImport() {
    if (!selected || !config || !split || busy) return;
    setBusy(true);
    setResult(null);
    setProgress({ done: 0, total: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const max = Math.max(0, Math.floor(Number(maxRows) || 0));
      const opts = {
        maxRows: max === 0 ? undefined : max,
        hfToken,
        signal: controller.signal,
        onProgress: (done: number, total: number) => setProgress({ done, total }),
      };
      let rows: unknown[];
      try {
        rows = await importViaParquet(selected.id, config, split, opts);
      } catch (err) {
        if (controller.signal.aborted) throw err;
        rows = await importViaRows(selected.id, config, split, opts);
      }
      if (rows.length === 0) {
        toast.error('This split has no rows.');
        return;
      }
      const api = getEngineWorker();
      const schema = await api.detect(rows);
      setResult(await api.convert(rows, schema, projectId));
    } catch (err) {
      if (controller.signal.aborted) {
        toast.info('Import cancelled');
      } else {
        toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  const searchResults = search.data ?? [];
  const showResults = debounced.trim().length >= 2;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="hf-search">Search the Hub</Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            />
            <Input
              id="hf-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="alpaca, ultrachat…"
              className="pl-8"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="hf-direct">Or load by id / URL</Label>
          <div className="flex gap-2">
            <Input
              id="hf-direct"
              value={direct}
              onChange={(e) => setDirect(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLoad();
              }}
              placeholder="org/name or huggingface.co URL"
              className="font-mono text-[13px]"
            />
            <Button size="md" onClick={handleLoad} disabled={!direct.trim() || busy}>
              Load
            </Button>
          </div>
        </div>
      </div>

      {showResults && (
        <div className="panel overflow-hidden">
          {search.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-ink-dim">
              <Spinner className="size-3.5" /> Searching…
            </div>
          ) : search.isError ? (
            <p className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] text-danger">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              Search failed. Check your connection.
            </p>
          ) : searchResults.length === 0 ? (
            <p className="px-3 py-2.5 text-[13px] text-ink-faint">No datasets found.</p>
          ) : (
            <ul className="divide-y divide-hairline/60">
              {searchResults.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => selectDataset({ id: d.id })}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-100 hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
                      {d.id}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-ink-faint">
                      <Download className="size-3.5" aria-hidden /> {fmtNum(d.downloads)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-ink-faint">
                      <Heart className="size-3.5" aria-hidden /> {fmtNum(d.likes)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected && (
        <section className="panel animate-rise" aria-label="Selected dataset">
          <div className="panel-header">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="tech-label">Dataset</h3>
              <span className="truncate font-mono text-[13px] text-ink">{selected.id}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Clear dataset"
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setResult(null);
              }}
            >
              <X />
            </Button>
          </div>

          <div className="flex flex-col gap-3 p-3">
            {info.isLoading && (
              <div className="flex items-center gap-2 text-[13px] text-ink-dim">
                <Spinner className="size-3.5" /> Loading dataset info…
              </div>
            )}
            {info.isError && (
              <p className="flex items-start gap-1.5 text-[13px] text-danger">
                <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
                {info.error instanceof Error ? info.error.message : 'Could not load dataset info.'}
              </p>
            )}

            {info.data && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Config</Label>
                    <Select value={config} onValueChange={setConfig} disabled={busy}>
                      <SelectTrigger aria-label="Dataset config">
                        <SelectValue placeholder="Select config…" />
                      </SelectTrigger>
                      <SelectContent>
                        {info.data.configs.map((c) => (
                          <SelectItem key={c.name} value={c.name}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Split</Label>
                    <Select value={split} onValueChange={setSplit} disabled={busy || !config}>
                      <SelectTrigger aria-label="Dataset split">
                        <SelectValue placeholder="Select split…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(activeConfig?.splits ?? []).map((s) => (
                          <SelectItem key={s.name} value={s.name}>
                            {s.numExamples != null
                              ? `${s.name} (${fmtNum(s.numExamples)})`
                              : s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {config && split && (
                  <div className="rounded-(--radius-control) border border-hairline bg-surface-2">
                    <p className="tech-label border-b border-hairline px-2.5 py-1.5">First rows</p>
                    {rowsPreview.isLoading ? (
                      <div className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-ink-dim">
                        <Spinner className="size-3.5" /> Loading rows…
                      </div>
                    ) : rowsPreview.isError ? (
                      <p className="flex items-center gap-1.5 px-2.5 py-2 text-[13px] text-danger">
                        <CircleAlert className="size-4 shrink-0" aria-hidden />
                        Row preview unavailable.
                      </p>
                    ) : (
                      <ul>
                        {rowsPreview.data?.rows.map((row, i) => (
                          <li
                            key={i}
                            className="truncate border-b border-hairline/60 px-2.5 py-1.5 font-mono text-xs text-ink-dim last:border-b-0"
                          >
                            {rowSnippet(row)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label htmlFor="hf-max-rows">Max rows</Label>
                    <Input
                      id="hf-max-rows"
                      type="number"
                      min={0}
                      value={maxRows}
                      onChange={(e) => setMaxRows(e.target.value)}
                      disabled={busy}
                      className="w-28 font-mono tabular-nums"
                    />
                  </div>
                  <Button
                    variant="solid"
                    size="md"
                    onClick={handleImport}
                    disabled={busy || !config || !split}
                  >
                    {busy ? (
                      <Spinner className="border-accent-ink/30 border-t-accent-ink" />
                    ) : (
                      <Download />
                    )}
                    Import
                  </Button>
                  {busy && (
                    <Button variant="ghost" size="md" onClick={() => abortRef.current?.abort()}>
                      Cancel
                    </Button>
                  )}
                </div>
                <p className="text-xs text-ink-faint">0 imports everything.</p>

                {busy && progress && (
                  <div className="flex items-center gap-3">
                    <Progress
                      value={progress.total > 0 ? progress.done / progress.total : 0}
                      className="min-w-0 flex-1"
                    />
                    <span className="shrink-0 font-mono text-xs tabular-nums text-ink-dim">
                      {fmtNum(progress.done)} / {fmtNum(progress.total)} rows
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {result && <ImportPreview result={result} onDiscard={() => setResult(null)} />}
    </div>
  );
}
