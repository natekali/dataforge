/**
 * Decontaminate — verbatim n-gram screen against benchmark test sets.
 * Sources: the engine's built-in samples or a user-supplied custom list
 * (.txt upload or pasted, one item per line). Hits can be flagged for review
 * or deleted (confirmed, undoable).
 */
import { useRef, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, FileUp, Flag, Play, Trash2 } from 'lucide-react';

import { db } from '@/lib/db';
import {
  decontaminateExamples,
  type BenchmarkSample,
  type ContaminationHit,
} from '@/lib/workerClient';
import { deleteExamples, setFlagged } from '@/lib/mutations';
import { withUndo } from '@/lib/undo';
import { fmtNum } from '@/lib/utils';
import { BUILTIN_BENCHMARK_SAMPLES } from '@/engine/dedup';
import type { Example } from '@/engine/types';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';

const CUSTOM_SOURCE = 'custom';
const MAX_HITS_SHOWN = 100;
const PREVIEW_CHARS = 80;
const NGRAM_CHARS = 60;

/** First user message content, collapsed and truncated for list rows. */
function previewOf(example: Example): string {
  const message =
    example.messages.find((m) => m.role === 'user') ?? example.messages[0];
  const text = (message?.content ?? '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return '(no text)';
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface DeconResults {
  hits: ContaminationHit[];
  previews: Record<string, string>;
  benchmarkName: string;
  scanned: number;
}

export function DecontaminateSection({
  projectId,
  style,
}: {
  projectId: string;
  style?: CSSProperties;
}) {
  const [source, setSource] = useState<string>(BUILTIN_BENCHMARK_SAMPLES[0]?.name ?? '');
  const [customText, setCustomText] = useState('');
  const [busy, setBusy] = useState<'idle' | 'scan' | 'flag' | 'delete'>('idle');
  const [results, setResults] = useState<DeconResults | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isCustom = source === CUSTOM_SOURCE;
  const hitIds = results ? results.hits.map((h) => h.exampleId) : [];
  const hitNoun = hitIds.length === 1 ? 'example' : 'examples';

  async function onFileSelected(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const text = await file.text();
      setCustomText(text);
      setResults(null);
    } catch {
      toast.error('Could not read that file.');
    }
  }

  async function runScan(): Promise<void> {
    if (busy !== 'idle') return;
    let benchmark: BenchmarkSample;
    if (isCustom) {
      const items = customText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (items.length === 0) {
        toast.error('Add at least one benchmark item.');
        return;
      }
      benchmark = { name: 'Custom list', items };
    } else {
      const builtin = BUILTIN_BENCHMARK_SAMPLES.find((b) => b.name === source);
      if (!builtin) {
        toast.error('Pick a benchmark source first.');
        return;
      }
      benchmark = builtin;
    }
    setBusy('scan');
    try {
      const examples = await db.examples.where('projectId').equals(projectId).toArray();
      if (examples.length === 0) {
        toast.error('No examples to check.');
        return;
      }
      const hits = await decontaminateExamples(examples, benchmark);
      const byId = new Map(examples.map((e) => [e.id, e]));
      const previews: Record<string, string> = {};
      for (const hit of hits) {
        const example = byId.get(hit.exampleId);
        previews[hit.exampleId] = example ? previewOf(example) : hit.exampleId;
      }
      setResults({ hits, previews, benchmarkName: benchmark.name, scanned: examples.length });
    } catch (err) {
      toast.error(`Check failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  }

  async function flagHits(): Promise<void> {
    if (busy !== 'idle' || hitIds.length === 0) return;
    setBusy('flag');
    try {
      await withUndo(`Flag ${hitIds.length} contaminated ${hitNoun}`, hitIds, () =>
        setFlagged(hitIds, true),
      );
      toast.success(`Flagged ${fmtNum(hitIds.length)} ${hitNoun}`, {
        description: 'Press Ctrl+Z to undo.',
      });
    } catch (err) {
      toast.error(`Flagging failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  }

  async function deleteHits(): Promise<void> {
    if (busy !== 'idle' || hitIds.length === 0) return;
    setBusy('delete');
    try {
      await withUndo(`Delete ${hitIds.length} contaminated ${hitNoun}`, hitIds, () =>
        deleteExamples(hitIds),
      );
      setConfirmOpen(false);
      setResults(null);
      toast.success(`Deleted ${fmtNum(hitIds.length)} ${hitNoun}`, {
        description: 'Press Ctrl+Z to undo.',
      });
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  }

  const shownHits = results ? results.hits.slice(0, MAX_HITS_SHOWN) : [];

  return (
    <section className="panel animate-rise" style={style}>
      <div className="panel-header">
        <h2 className="tech-label">Decontaminate</h2>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <p className="text-[13px] text-ink-dim">
          Checks for verbatim overlap with public benchmarks. A 13-word window must match.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={source}
            onValueChange={(value) => {
              setSource(value);
              setResults(null);
            }}
          >
            <SelectTrigger className="w-44" aria-label="Benchmark source" disabled={busy !== 'idle'}>
              <SelectValue placeholder="Pick a source" />
            </SelectTrigger>
            <SelectContent>
              {BUILTIN_BENCHMARK_SAMPLES.map((benchmark) => (
                <SelectItem key={benchmark.name} value={benchmark.name}>
                  {benchmark.name}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_SOURCE}>Custom list</SelectItem>
            </SelectContent>
          </Select>

          {isCustom && (
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== 'idle'}
            >
              <FileUp />
              Load .txt
            </Button>
          )}

          <Button
            variant="solid"
            className="ml-auto"
            onClick={() => void runScan()}
            disabled={busy !== 'idle'}
          >
            {busy === 'scan' ? (
              <Spinner className="size-3.5 border-accent-ink/30 border-t-accent-ink" />
            ) : (
              <Play />
            )}
            Run check
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            aria-label="Benchmark list file"
            onChange={(e) => {
              void onFileSelected(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {isCustom ? (
          <Textarea
            value={customText}
            onChange={(e) => {
              setCustomText(e.target.value);
              setResults(null);
            }}
            placeholder="One benchmark item per line."
            aria-label="Custom benchmark items"
            disabled={busy !== 'idle'}
          />
        ) : (
          <p className="text-xs text-ink-faint">
            Built-in lists are small samples, not full benchmarks.
          </p>
        )}
      </div>

      {results && (
        <div className="border-t border-hairline">
          {results.hits.length === 0 ? (
            <p className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] text-ok">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              No overlap with {results.benchmarkName} found in {fmtNum(results.scanned)}{' '}
              examples.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="flex items-center gap-1.5 text-[13px] text-warn">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                  <span className="font-mono tabular-nums">{fmtNum(results.hits.length)}</span>
                  {results.hits.length === 1 ? 'example overlaps' : 'examples overlap'} with{' '}
                  {results.benchmarkName}.
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => void flagHits()}
                    disabled={busy !== 'idle'}
                  >
                    {busy === 'flag' ? <Spinner className="size-3.5" /> : <Flag />}
                    Flag hits
                  </Button>
                  <Button
                    variant="danger"
                    size="xs"
                    onClick={() => setConfirmOpen(true)}
                    disabled={busy !== 'idle'}
                  >
                    <Trash2 />
                    Delete hits
                  </Button>
                </div>
              </div>

              {shownHits.map((hit) => (
                <div
                  key={hit.exampleId}
                  className="flex items-center gap-3 border-t border-hairline px-3 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim">
                    {results.previews[hit.exampleId] ?? hit.exampleId}
                  </span>
                  <span
                    className="max-w-[36%] shrink-0 truncate font-mono text-xs text-warn"
                    title={hit.matchedNgram}
                  >
                    {truncate(hit.matchedNgram, NGRAM_CHARS)}
                  </span>
                  <Badge tone="neutral" className="shrink-0">
                    {hit.benchmarkName}
                  </Badge>
                </div>
              ))}

              {results.hits.length > MAX_HITS_SHOWN && (
                <p className="border-t border-hairline px-3 py-1.5 font-mono text-xs tabular-nums text-ink-faint">
                  Showing first {MAX_HITS_SHOWN} of {fmtNum(results.hits.length)} hits.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title={`Delete ${fmtNum(hitIds.length)} contaminated ${hitNoun}?`}
          description="Removed examples can be restored with Ctrl+Z."
        >
          <p className="text-[13px] leading-relaxed text-ink-dim">
            This removes every example that overlaps with{' '}
            <span className="text-ink">{results?.benchmarkName ?? 'the benchmark'}</span> from the
            project.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy !== 'idle'}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void deleteHits()} disabled={busy !== 'idle'}>
              <Trash2 />
              Delete {hitNoun}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
