/**
 * TargetPicker — chooses which examples an AI operation runs on.
 *
 * API
 *   const targets = useRef<TargetPickerHandle>(null);
 *   <TargetPicker ref={targets} projectId={projectId} label="Run on" />
 *   const ids = await targets.current?.resolve() ?? [];
 *
 * Three modes, radio behavior:
 *   - "Selected in grid"  the current data-grid selection (disabled when empty)
 *   - "All examples"      every example in the project
 *   - "Random sample"     N ids drawn uniformly, default 50
 *
 * An optional `typeFilter` restricts every mode (counts and resolution) to one
 * dataset type, e.g. "sft" for preference-pair building. `resolve()` queries
 * Dexie at call time, so the returned ids are always fresh even if the grid
 * changed after mounting.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DatasetType } from '@/engine/types';
import { db } from '@/lib/db';
import { useUiStore } from '@/lib/store';
import { cn, fmtNum } from '@/lib/utils';
import { Input } from '@/components/ui/Input';

export type TargetMode = 'selection' | 'all' | 'sample';

export interface TargetPickerHandle {
  /** Resolve the current choice to concrete example ids. */
  resolve: () => Promise<string[]>;
}

interface TargetPickerProps {
  projectId: string;
  /** Group label rendered above the control. */
  label?: string;
  /** Restrict the pool to one dataset type. */
  typeFilter?: DatasetType;
  /** Disable every input (no provider, job running). */
  disabled?: boolean;
}

const DEFAULT_SAMPLE_SIZE = 50;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const TargetPicker = forwardRef<TargetPickerHandle, TargetPickerProps>(
  function TargetPicker({ projectId, label = 'Run on', typeFilter, disabled = false }, ref) {
    const groupName = useId();
    const selection = useUiStore((s) => s.selection);

    const [mode, setMode] = useState<TargetMode>(() =>
      useUiStore.getState().selection.size > 0 ? 'selection' : 'all',
    );
    const [sampleSize, setSampleSize] = useState(String(DEFAULT_SAMPLE_SIZE));

    const fetchPoolIds = useCallback(async (): Promise<string[]> => {
      const collection = typeFilter
        ? db.examples.where('[projectId+type]').equals([projectId, typeFilter])
        : db.examples.where('projectId').equals(projectId);
      return (await collection.primaryKeys()) as string[];
    }, [projectId, typeFilter]);

    const poolIds = useLiveQuery(() => fetchPoolIds(), [fetchPoolIds]);

    /** Grid selection narrowed to this project and (optionally) one type. */
    const selectedCount = useMemo(() => {
      if (poolIds === undefined) return null;
      const pool = new Set(poolIds);
      let n = 0;
      for (const id of selection) if (pool.has(id)) n += 1;
      return n;
    }, [poolIds, selection]);

    // If the eligible selection empties while active, fall back to the pool.
    useEffect(() => {
      if (mode === 'selection' && selectedCount === 0) setMode('all');
    }, [mode, selectedCount]);

    useImperativeHandle(
      ref,
      () => ({
        resolve: async () => {
          const pool = await fetchPoolIds();
          if (mode === 'selection') {
            const chosen = useUiStore.getState().selection;
            return pool.filter((id) => chosen.has(id));
          }
          if (mode === 'sample') {
            const n = Math.floor(Number(sampleSize));
            const size = Number.isFinite(n) && n >= 1 ? n : DEFAULT_SAMPLE_SIZE;
            return shuffle(pool).slice(0, size);
          }
          return pool;
        },
      }),
      [fetchPoolIds, mode, sampleSize],
    );

    const poolCount = poolIds?.length ?? null;
    const selectionEmpty = selectedCount === null || selectedCount === 0;

    return (
      <fieldset disabled={disabled} className={cn('min-w-0', disabled && 'opacity-45')}>
        <legend className="mb-1 block text-[13px] font-medium text-ink-dim">{label}</legend>
        <div className="flex flex-col gap-2 rounded-(--radius-control) border border-hairline bg-surface-2 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <label
              className={cn(
                'flex items-center gap-2 text-[13px]',
                selectionEmpty ? 'text-ink-faint' : 'cursor-pointer text-ink',
              )}
            >
              <input
                type="radio"
                name={groupName}
                className="size-3.5 accent-accent"
                checked={mode === 'selection'}
                onChange={() => setMode('selection')}
                disabled={selectionEmpty}
              />
              Selected in grid
            </label>
            <span className="ml-auto font-mono text-xs tabular-nums text-ink-dim">
              {selectedCount === null ? '—' : fmtNum(selectedCount)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
              <input
                type="radio"
                name={groupName}
                className="size-3.5 accent-accent"
                checked={mode === 'all'}
                onChange={() => setMode('all')}
              />
              All examples
            </label>
            <span className="ml-auto font-mono text-xs tabular-nums text-ink-dim">
              {poolCount === null ? '—' : fmtNum(poolCount)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
              <input
                type="radio"
                name={groupName}
                className="size-3.5 accent-accent"
                checked={mode === 'sample'}
                onChange={() => setMode('sample')}
              />
              Random sample
            </label>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={sampleSize}
              onChange={(e) => {
                setSampleSize(e.target.value);
                setMode('sample');
              }}
              className="h-7 w-16 px-1.5 text-center font-mono text-xs tabular-nums"
              aria-label="Sample size"
            />
            <span className="ml-auto font-mono text-xs tabular-nums text-ink-faint">
              of {poolCount === null ? '—' : fmtNum(poolCount)}
            </span>
          </div>
        </div>
        {typeFilter !== undefined && (
          <p className="mt-1 text-xs text-ink-faint">
            Only {typeFilter.toUpperCase()} examples are eligible.
          </p>
        )}
      </fieldset>
    );
  },
);
