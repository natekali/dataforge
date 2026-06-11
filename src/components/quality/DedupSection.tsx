/**
 * Dedup — exact + near duplicate detection in the worker (MinHash/LSH with a
 * verified Jaccard threshold). Each group keeps its earliest example; removal
 * deletes every drop id in one undoable step.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Play, Trash2 } from 'lucide-react';

import { db } from '@/lib/db';
import { findDuplicates, type DuplicateGroup } from '@/lib/workerClient';
import { deleteExamples } from '@/lib/mutations';
import { withUndo } from '@/lib/undo';
import { fmtNum } from '@/lib/utils';
import type { Example } from '@/engine/types';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';

const MAX_GROUPS_SHOWN = 50;
const PREVIEW_CHARS = 80;

/** First user message content, collapsed and truncated for list rows. */
function previewOf(example: Example): string {
  const message =
    example.messages.find((m) => m.role === 'user') ?? example.messages[0];
  const text = (message?.content ?? '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return '(no text)';
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

interface DedupResults {
  exact: DuplicateGroup[];
  near: DuplicateGroup[];
  previews: Record<string, string>;
  scanned: number;
  threshold: number;
}

export function DedupSection({
  projectId,
  style,
}: {
  projectId: string;
  style?: CSSProperties;
}) {
  const [threshold, setThreshold] = useState(0.85);
  const [busy, setBusy] = useState<'idle' | 'scan' | 'remove'>('idle');
  const [results, setResults] = useState<DedupResults | null>(null);

  const groups = useMemo<DuplicateGroup[]>(
    () => (results ? [...results.exact, ...results.near] : []),
    [results],
  );

  const dropIds = useMemo(() => {
    const set = new Set<string>();
    for (const group of groups) {
      for (const id of group.dropIds) set.add(id);
    }
    return [...set];
  }, [groups]);

  async function runScan(): Promise<void> {
    if (busy !== 'idle') return;
    setBusy('scan');
    try {
      const examples = await db.examples.where('projectId').equals(projectId).toArray();
      if (examples.length < 2) {
        toast.error('Need at least two examples to compare.');
        return;
      }
      const { exact, near } = await findDuplicates(examples, { threshold });
      const byId = new Map(examples.map((e) => [e.id, e]));
      const previews: Record<string, string> = {};
      for (const group of [...exact, ...near]) {
        const keep = byId.get(group.keepId);
        previews[group.keepId] = keep ? previewOf(keep) : group.keepId;
      }
      setResults({ exact, near, previews, scanned: examples.length, threshold });
    } catch (err) {
      toast.error(`Dedup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  }

  async function removeDuplicates(): Promise<void> {
    if (busy !== 'idle' || dropIds.length === 0) return;
    setBusy('remove');
    const n = dropIds.length;
    const noun = n === 1 ? 'duplicate' : 'duplicates';
    try {
      await withUndo(`Remove ${n} ${noun}`, dropIds, () => deleteExamples(dropIds));
      setResults(null);
      toast.success(`Removed ${fmtNum(n)} ${noun}`, {
        description: 'Press Ctrl+Z to undo.',
      });
    } catch (err) {
      toast.error(`Removal failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  }

  const shown = groups.slice(0, MAX_GROUPS_SHOWN);

  return (
    <section className="panel animate-rise" style={style}>
      <div className="panel-header">
        <h2 className="tech-label">Dedup</h2>
        <span className="text-xs text-ink-faint">
          Exact matches plus near duplicates above the threshold.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 p-3">
        <label
          htmlFor="dedup-threshold"
          className="text-[13px] text-ink-dim"
        >
          Similarity threshold
        </label>
        <input
          id="dedup-threshold"
          type="range"
          min={0.7}
          max={0.95}
          step={0.05}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          disabled={busy !== 'idle'}
          className="w-44 cursor-pointer accent-accent"
        />
        <span className="font-mono text-[13px] tabular-nums text-ink">
          {threshold.toFixed(2)}
        </span>
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
          Find duplicates
        </Button>
      </div>

      {results && (
        <div className="border-t border-hairline">
          {groups.length === 0 ? (
            <p className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] text-ok">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              No duplicates found at this threshold.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[13px] text-ink-dim">
                <span>
                  <span className="font-mono tabular-nums text-ink">
                    {fmtNum(results.exact.length)}
                  </span>{' '}
                  exact {results.exact.length === 1 ? 'group' : 'groups'}
                </span>
                <span>
                  <span className="font-mono tabular-nums text-ink">
                    {fmtNum(results.near.length)}
                  </span>{' '}
                  near {results.near.length === 1 ? 'group' : 'groups'}
                </span>
                <span className="ml-auto font-mono text-xs tabular-nums text-ink-faint">
                  scanned {fmtNum(results.scanned)} at {results.threshold.toFixed(2)}
                </span>
              </div>

              {shown.map((group) => (
                <div
                  key={`${group.reason}-${group.keepId}`}
                  className="flex items-center gap-3 border-t border-hairline px-3 py-1.5"
                >
                  <Badge tone="neutral" className="shrink-0">
                    {group.reason}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim">
                    {results.previews[group.keepId] ?? group.keepId}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink-faint">
                    {fmtNum(group.dropIds.length)}{' '}
                    {group.dropIds.length === 1 ? 'duplicate' : 'duplicates'}
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-ink">
                    {Math.round(group.similarity * 100)}%
                  </span>
                </div>
              ))}

              {groups.length > MAX_GROUPS_SHOWN && (
                <p className="border-t border-hairline px-3 py-1.5 font-mono text-xs tabular-nums text-ink-faint">
                  Showing first {MAX_GROUPS_SHOWN} of {fmtNum(groups.length)} groups.
                </p>
              )}

              <div className="flex justify-end border-t border-hairline px-3 py-2">
                <Button
                  variant="danger"
                  onClick={() => void removeDuplicates()}
                  disabled={busy !== 'idle'}
                >
                  {busy === 'remove' ? <Spinner className="size-3.5" /> : <Trash2 />}
                  Remove {fmtNum(dropIds.length)}{' '}
                  {dropIds.length === 1 ? 'duplicate' : 'duplicates'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
