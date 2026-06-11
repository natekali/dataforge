/**
 * Dataset workbench filter row. Fully controlled: the page owns filter state
 * (synced to URL params) and the raw search text (debounced upstream).
 */
import { Flag, Search, TriangleAlert } from 'lucide-react';
import type { DatasetType, SplitName } from '@/engine/types';
import type { ExampleFilters } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { fmtNum } from '@/lib/utils';

export interface FilterBarProps {
  /** Raw (un-debounced) search text. */
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  filters: ExampleFilters;
  onPatch: (patch: Partial<ExampleFilters>) => void;
  onClear: () => void;
  filteredCount: number | undefined;
  totalCount: number | undefined;
}

export function FilterBar({
  searchInput,
  onSearchInputChange,
  filters,
  onPatch,
  onClear,
  filteredCount,
  totalCount,
}: FilterBarProps) {
  const split = filters.split ?? 'all';
  const type = filters.type ?? 'all';
  const hasActiveFilters =
    searchInput.trim() !== '' ||
    split !== 'all' ||
    type !== 'all' ||
    !!filters.flaggedOnly ||
    !!filters.withIssuesOnly;

  return (
    <div
      role="toolbar"
      aria-label="Example filters"
      className="flex flex-wrap items-center gap-2 border-b border-hairline bg-surface px-3 py-2"
    >
      <div className="relative w-60">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        />
        <Input
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          placeholder="Search content, tags…"
          aria-label="Search content and tags"
          className="h-8 pl-8 text-[13px]"
        />
      </div>

      <Select
        value={split}
        onValueChange={(v) => onPatch({ split: v as SplitName | 'all' })}
      >
        <SelectTrigger className="h-8 w-32 text-[13px]" aria-label="Filter by split">
          <SelectValue placeholder="All splits" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All splits</SelectItem>
          <SelectItem value="train">Train</SelectItem>
          <SelectItem value="validation">Validation</SelectItem>
          <SelectItem value="test">Test</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={type}
        onValueChange={(v) => onPatch({ type: v as DatasetType | 'all' })}
      >
        <SelectTrigger className="h-8 w-28 text-[13px]" aria-label="Filter by dataset type">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          <SelectItem value="sft">SFT</SelectItem>
          <SelectItem value="preference">DPO</SelectItem>
          <SelectItem value="kto">KTO</SelectItem>
          <SelectItem value="rl">RL</SelectItem>
        </SelectContent>
      </Select>

      <Button
        size="xs"
        variant={filters.flaggedOnly ? 'solid' : 'ghost'}
        aria-pressed={!!filters.flaggedOnly}
        onClick={() => onPatch({ flaggedOnly: !filters.flaggedOnly })}
      >
        <Flag />
        Flagged
      </Button>
      <Button
        size="xs"
        variant={filters.withIssuesOnly ? 'solid' : 'ghost'}
        aria-pressed={!!filters.withIssuesOnly}
        onClick={() => onPatch({ withIssuesOnly: !filters.withIssuesOnly })}
      >
        <TriangleAlert />
        Has issues
      </Button>

      <div className="ml-auto flex items-center gap-2">
        {hasActiveFilters && (
          <Button size="xs" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
        <span className="font-mono text-xs tabular-nums text-ink-dim">
          {fmtNum(filteredCount)}
          <span className="text-ink-faint"> / {fmtNum(totalCount)}</span>
        </span>
        <span className="tech-label">examples</span>
      </div>
    </div>
  );
}
