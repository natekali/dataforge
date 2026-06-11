/**
 * Dataset workbench — /p/:projectId/data.
 *
 * Layout: FilterBar on top, BulkActionBar when a selection exists, then the
 * virtualized DataGrid with the inspector docked right (overlay below lg).
 * Filter state lives in component state and mirrors into URL params
 * (split, type, q, flagged, issues) so views are shareable; the selected
 * example travels in the `ex` param.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useFilteredIds, useProjectCounts, type ExampleFilters } from '@/lib/hooks';
import { useUiStore } from '@/lib/store';
import { BulkActionBar } from '@/components/dataset/BulkActionBar';
import { DataGrid } from '@/components/dataset/DataGrid';
import { FilterBar } from '@/components/dataset/FilterBar';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';

const DEFAULT_FILTERS: ExampleFilters = {
  split: 'all',
  type: 'all',
  search: '',
  flaggedOnly: false,
  withIssuesOnly: false,
};

function filtersFromParams(params: URLSearchParams): ExampleFilters {
  const split = params.get('split');
  const type = params.get('type');
  return {
    split:
      split === 'train' || split === 'validation' || split === 'test' ? split : 'all',
    type:
      type === 'sft' || type === 'preference' || type === 'kto' || type === 'rl'
        ? type
        : 'all',
    search: params.get('q') ?? '',
    flaggedOnly: params.get('flagged') === '1',
    withIssuesOnly: params.get('issues') === '1',
  };
}

function writeFiltersToParams(prev: URLSearchParams, f: ExampleFilters): URLSearchParams {
  const next = new URLSearchParams(prev);
  const apply = (key: string, value: string | null) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  apply('split', f.split && f.split !== 'all' ? f.split : null);
  apply('type', f.type && f.type !== 'all' ? f.type : null);
  apply('q', f.search?.trim() ? f.search : null);
  apply('flagged', f.flaggedOnly ? '1' : null);
  apply('issues', f.withIssuesOnly ? '1' : null);
  return next;
}

export function DatasetPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState<ExampleFilters>(() =>
    filtersFromParams(searchParams),
  );
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') ?? '');

  const selectionCount = useUiStore((s) => s.selection.size);
  const clearSelection = useUiStore((s) => s.clearSelection);

  const filteredIds = useFilteredIds(projectId, filters);
  const counts = useProjectCounts();

  // A selection from another project must never feed bulk actions here.
  useEffect(() => {
    clearSelection();
  }, [projectId, clearSelection]);

  // Mirror filter state into the URL (preserving ?ex) so views are shareable.
  useEffect(() => {
    setSearchParams((prev) => writeFiltersToParams(prev, filters), { replace: true });
  }, [filters, setSearchParams]);

  // Debounce free-text search before it hits the live query.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((prev) =>
        prev.search === searchInput ? prev : { ...prev, search: searchInput },
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const patchFilters = useCallback((patch: Partial<ExampleFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setFilters({ ...DEFAULT_FILTERS });
  }, []);

  const exampleId = searchParams.get('ex');

  const openExample = useCallback(
    (id: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('ex', id);
        return next;
      });
    },
    [setSearchParams],
  );

  const navigateExample = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('ex', id);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const closeInspector = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('ex');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  if (!projectId) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Dataset</h1>
      <FilterBar
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        filters={filters}
        onPatch={patchFilters}
        onClear={clearFilters}
        filteredCount={filteredIds?.length}
        totalCount={counts?.[projectId]}
      />
      {selectionCount > 0 && <BulkActionBar />}
      <div className="flex min-h-0 flex-1">
        <DataGrid
          projectId={projectId}
          filters={filters}
          activeId={exampleId}
          onOpen={openExample}
          onClearFilters={clearFilters}
        />
        {exampleId && (
          <aside
            aria-label="Example inspector"
            className="w-[440px] shrink-0 overflow-hidden border-l border-hairline bg-surface max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:max-w-full max-lg:shadow-2xl max-lg:shadow-black/50"
          >
            <InspectorPanel
              exampleId={exampleId}
              onClose={closeInspector}
              filteredIds={filteredIds}
              onNavigate={navigateExample}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
