/**
 * Virtualized dataset grid — fixed 36px rows over the page's filtered data.
 * Purely presentational: DatasetPage owns the single table scan and passes
 * the result down. Row click opens the inspector (?ex=id); checkboxes drive
 * the bulk-action selection in the UI store, with shift-click range selection.
 */
import { memo, useCallback, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Flag, Inbox } from 'lucide-react';
import type { Example, SplitName } from '@/engine/types';
import type { FilteredDataset } from '@/lib/hooks';
import { useUiStore } from '@/lib/store';
import { cn, fmtNum, fmtRelativeTime } from '@/lib/utils';
import { HeatBadge, TypeBadge } from '@/components/ui/Badge';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Checkbox, Spinner } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/EmptyState';

const ROW_HEIGHT = 40;
const PREVIEW_LEN = 110;
const EMPTY_ROWS: Example[] = [];

/** Shared column template — header and rows must stay in lockstep. */
const GRID_TEMPLATE =
  'grid grid-cols-[28px_44px_52px_minmax(0,1fr)_44px_60px_44px_36px_44px_76px] items-center gap-x-2 px-2';

const SPLIT_CHIP: Record<SplitName, { label: string; cls: string }> = {
  train: { label: 'TR', cls: 'border-hairline text-ink-dim' },
  validation: { label: 'VA', cls: 'border-info/30 bg-info/5 text-info' },
  test: { label: 'TE', cls: 'border-ok/30 bg-ok/5 text-ok' },
};

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_LEN ? `${oneLine.slice(0, PREVIEW_LEN)}…` : oneLine;
}

function buildPreview(e: Example): { user: string; assistant: string | null } {
  const userMsg = e.messages.find((m) => m.role === 'user') ?? e.messages[0];
  const assistantMsg =
    e.messages.find((m) => m.role === 'assistant') ??
    e.chosen?.find((m) => m.role === 'assistant') ??
    e.completion?.find((m) => m.role === 'assistant');
  return {
    user: userMsg ? clip(userMsg.content) : '',
    assistant: assistantMsg?.content ? clip(assistantMsg.content) : null,
  };
}

interface RowProps {
  example: Example;
  index: number;
  start: number;
  selected: boolean;
  active: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onCheckboxClick: (e: ReactMouseEvent<HTMLButtonElement>, index: number) => void;
}

const Row = memo(function Row({
  example: e,
  index,
  start,
  selected,
  active,
  onOpen,
  onToggle,
  onCheckboxClick,
}: RowProps) {
  const preview = buildPreview(e);
  const splitChip = SPLIT_CHIP[e.split];
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={active}
      tabIndex={0}
      onClick={() => onOpen(e.id)}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') onOpen(e.id);
      }}
      className={cn(
        GRID_TEMPLATE,
        'absolute left-0 top-0 h-9 w-full cursor-pointer select-none border-b border-l-2 border-b-hairline/60 transition-colors duration-100',
        active
          ? 'border-l-accent bg-surface-3'
          : selected
            ? 'border-l-transparent bg-surface-2 hover:bg-surface-3'
            : 'border-l-transparent hover:bg-surface-2',
      )}
      style={{ transform: `translateY(${start}px)` }}
    >
      <div
        role="gridcell"
        className="flex h-full items-center justify-center"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle(e.id)}
          onClick={(ev) => onCheckboxClick(ev, index)}
          aria-label={`Select row ${index + 1}`}
        />
      </div>
      <div
        role="gridcell"
        className="truncate text-right font-mono text-xs tabular-nums text-ink-faint"
      >
        {index + 1}
      </div>
      <div role="gridcell">
        <TypeBadge type={e.type} />
      </div>
      <div role="gridcell" className="min-w-0 truncate text-[13px]">
        {preview.user ? (
          <span className="text-ink">{preview.user}</span>
        ) : (
          <span className="italic text-ink-faint">(empty)</span>
        )}
        {preview.assistant && (
          <span className="text-ink-faint"> · {preview.assistant}</span>
        )}
      </div>
      <div
        role="gridcell"
        className="text-right font-mono text-xs tabular-nums text-ink-dim"
      >
        {e.messages.length}
      </div>
      <div
        role="gridcell"
        className="truncate text-right font-mono text-xs tabular-nums text-ink-dim"
      >
        {e.tokenCount == null ? <span className="text-ink-faint">·</span> : fmtNum(e.tokenCount)}
      </div>
      <div role="gridcell" className="flex justify-center">
        <HeatBadge score={e.qualityScore} />
      </div>
      <div role="gridcell" className="flex justify-center">
        <span
          className={cn(
            'rounded-(--radius-control) border px-1 font-mono text-[11px]',
            splitChip.cls,
          )}
          title={e.split}
        >
          {splitChip.label}
        </span>
      </div>
      <div role="gridcell" className="flex items-center justify-center gap-1">
        {e.flagged && (
          <Flag role="img" aria-label="Flagged" className="size-3.5 text-danger" />
        )}
        {e.reviewed && (
          <Check role="img" aria-label="Reviewed" className="size-3.5 text-ok" />
        )}
      </div>
      <div role="gridcell" className="truncate font-mono text-[11px] text-ink-faint">
        {fmtRelativeTime(e.updatedAt)}
      </div>
    </div>
  );
});

export interface DataGridProps {
  /** Result of the page-level useFilteredDataset scan (undefined while loading). */
  data: FilteredDataset | undefined;
  /** Example open in the inspector (?ex= param). */
  activeId: string | null;
  onOpen: (id: string) => void;
  onClearFilters: () => void;
}

export function DataGrid({ data: paged, activeId, onOpen, onClearFilters }: DataGridProps) {
  const selection = useUiStore((s) => s.selection);
  const rows = paged?.rows ?? EMPTY_ROWS;

  // Refs let row callbacks stay referentially stable so memo(Row) holds.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const lastCheckedIndex = useRef<number | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Clicking a different row while the inspector holds unsaved edits would
  // silently drop them; ask first.
  const handleOpen = useCallback(
    (id: string) => {
      if (
        id !== activeIdRef.current &&
        useUiStore.getState().inspectorDirty &&
        !window.confirm('Discard unsaved changes?')
      ) {
        return;
      }
      onOpen(id);
    },
    [onOpen],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const toggleSelect = useCallback((id: string) => {
    const { selection: current, setSelection } = useUiStore.getState();
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelection(next);
  }, []);

  const handleCheckboxClick = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>, index: number) => {
      e.stopPropagation();
      const anchor = lastCheckedIndex.current;
      if (e.shiftKey && anchor !== null && anchor !== index) {
        // Range select: prevent Radix's own toggle, add the whole span.
        e.preventDefault();
        const current = rowsRef.current;
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
        const { selection: sel, setSelection } = useUiStore.getState();
        const next = new Set(sel);
        for (let i = from; i <= to && i < current.length; i++) next.add(current[i].id);
        setSelection(next);
      } else {
        lastCheckedIndex.current = index;
      }
    },
    [],
  );

  const { allVisibleSelected, someVisibleSelected } = useMemo(() => {
    if (rows.length === 0) return { allVisibleSelected: false, someVisibleSelected: false };
    let count = 0;
    for (const r of rows) if (selection.has(r.id)) count++;
    return { allVisibleSelected: count === rows.length, someVisibleSelected: count > 0 };
  }, [rows, selection]);

  const toggleAllVisible = useCallback(() => {
    const current = rowsRef.current;
    if (current.length === 0) return;
    const { selection: sel, setSelection } = useUiStore.getState();
    const next = new Set(sel);
    const all = current.every((r) => next.has(r.id));
    if (all) for (const r of current) next.delete(r.id);
    else for (const r of current) next.add(r.id);
    setSelection(next);
  }, []);

  if (!paged) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (paged.projectTotal === 0) {
    return (
      <div className="flex min-w-0 flex-1 items-start justify-center overflow-y-auto p-8">
        <EmptyState
          icon={Inbox}
          title="No examples yet"
          description="Import a dataset file or paste raw data to start filling the forge."
          className="w-full max-w-lg animate-rise"
          action={
            <Link to="../import" className={buttonVariants({ variant: 'solid', size: 'sm' })}>
              Import data
            </Link>
          }
        />
      </div>
    );
  }

  if (paged.total === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-ink-dim">No matches. Adjust the filters.</p>
        <Button size="sm" variant="outline" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label="Dataset examples"
      aria-rowcount={rows.length + 1}
      className="min-w-0 flex-1 overflow-auto"
    >
      <div
        role="row"
        aria-rowindex={1}
        className={cn(
          GRID_TEMPLATE,
          'sticky top-0 z-10 h-9 border-b border-l-2 border-hairline border-l-transparent bg-surface',
        )}
      >
        <div role="columnheader" className="flex justify-center">
          <Checkbox
            checked={allVisibleSelected}
            indeterminate={someVisibleSelected && !allVisibleSelected}
            onCheckedChange={toggleAllVisible}
            aria-label="Select all visible examples"
          />
        </div>
        <div role="columnheader" className="tech-label text-right">
          #
        </div>
        <div role="columnheader" className="tech-label">
          Type
        </div>
        <div role="columnheader" className="tech-label">
          Content
        </div>
        <div role="columnheader" className="tech-label text-right">
          Turns
        </div>
        <div role="columnheader" className="tech-label text-right">
          Tokens
        </div>
        <div role="columnheader" className="tech-label text-center">
          Score
        </div>
        <div role="columnheader" className="tech-label text-center">
          Split
        </div>
        <div role="columnheader" className="tech-label text-center">
          <span aria-hidden="true">⚑</span>
          <span className="sr-only">Flags</span>
        </div>
        <div role="columnheader" className="tech-label">
          Updated
        </div>
      </div>
      <div
        role="rowgroup"
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const example = rows[vi.index];
          if (!example) return null;
          return (
            <Row
              key={example.id}
              example={example}
              index={vi.index}
              start={vi.start}
              selected={selection.has(example.id)}
              active={example.id === activeId}
              onOpen={handleOpen}
              onToggle={toggleSelect}
              onCheckboxClick={handleCheckboxClick}
            />
          );
        })}
      </div>
    </div>
  );
}
