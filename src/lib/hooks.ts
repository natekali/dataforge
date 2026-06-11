/**
 * Shared live-data hooks. ALL UI data access goes through these so that
 * filtering, sorting and pagination behave identically across surfaces.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type {
  DatasetType,
  Example,
  Job,
  Project,
  ProviderConfig,
  SplitName,
} from '@/engine/types';

export function useProjects(): Project[] | undefined {
  return useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray(), []);
}

export function useProject(projectId: string | undefined): Project | undefined {
  return useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  );
}

export function useProjectCounts(): Record<string, number> | undefined {
  return useLiveQuery(async () => {
    const projects = await db.projects.toArray();
    const counts: Record<string, number> = {};
    await Promise.all(
      projects.map(async (p) => {
        counts[p.id] = await db.examples.where('projectId').equals(p.id).count();
      }),
    );
    return counts;
  }, []);
}

export interface ExampleFilters {
  split?: SplitName | 'all';
  type?: DatasetType | 'all';
  search?: string;
  flaggedOnly?: boolean;
  unreviewedOnly?: boolean;
  maxScore?: number | null; // "show examples scoring below X"
  withIssuesOnly?: boolean;
  tag?: string | null;
}

export interface PagedExamples {
  rows: Example[];
  total: number; // total AFTER filters
  projectTotal: number; // total in project
}

function exampleText(e: Example): string {
  const parts = [
    ...e.messages.map((m) => m.content),
    ...(e.chosen?.map((m) => m.content) ?? []),
    ...(e.rejected?.map((m) => m.content) ?? []),
    ...(e.completion?.map((m) => m.content) ?? []),
    e.answer ?? '',
    ...e.tags,
  ];
  return parts.join('\n').toLowerCase();
}

export function matchesFilters(e: Example, f: ExampleFilters): boolean {
  if (f.split && f.split !== 'all' && e.split !== f.split) return false;
  if (f.type && f.type !== 'all' && e.type !== f.type) return false;
  if (f.flaggedOnly && !e.flagged) return false;
  if (f.unreviewedOnly && e.reviewed) return false;
  if (f.maxScore != null && (e.qualityScore == null || e.qualityScore > f.maxScore))
    return false;
  if (f.withIssuesOnly && e.qualityIssues.length === 0) return false;
  if (f.tag && !e.tags.includes(f.tag)) return false;
  if (f.search) {
    const q = f.search.toLowerCase().trim();
    if (q && !exampleText(e).includes(q)) return false;
  }
  return true;
}

/**
 * Filtered + paged examples. Filtering runs in memory over the project's rows
 * (projectId is indexed); fine to ~100k examples. Debounce search input.
 */
export function useFilteredExamples(
  projectId: string | undefined,
  filters: ExampleFilters,
  page: { offset: number; limit: number },
): PagedExamples | undefined {
  return useLiveQuery(async () => {
    if (!projectId) return { rows: [], total: 0, projectTotal: 0 };
    const all = await db.examples.where('projectId').equals(projectId).toArray();
    const filtered = all.filter((e) => matchesFilters(e, filters));
    filtered.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      rows: filtered.slice(page.offset, page.offset + page.limit),
      total: filtered.length,
      projectTotal: all.length,
    };
  }, [projectId, JSON.stringify(filters), page.offset, page.limit]);
}

/** Ordered ids of ALL filtered examples (for prev/next navigation in the inspector). */
export function useFilteredIds(
  projectId: string | undefined,
  filters: ExampleFilters,
): string[] | undefined {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    const all = await db.examples.where('projectId').equals(projectId).toArray();
    return all
      .filter((e) => matchesFilters(e, filters))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((e) => e.id);
  }, [projectId, JSON.stringify(filters)]);
}

export function useExample(id: string | null | undefined): Example | undefined {
  return useLiveQuery(() => (id ? db.examples.get(id) : undefined), [id]);
}

export function useActiveJobs(projectId?: string): Job[] | undefined {
  return useLiveQuery(async () => {
    let jobs = await db.jobs.where('status').anyOf(['pending', 'running']).toArray();
    if (projectId) jobs = jobs.filter((j) => j.projectId === projectId);
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }, [projectId]);
}

export function useRecentJobs(projectId: string | undefined, limit = 10): Job[] | undefined {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    const jobs = await db.jobs.where('projectId').equals(projectId).toArray();
    return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }, [projectId, limit]);
}

export function useProviderConfigs(): ProviderConfig[] | undefined {
  return useLiveQuery(() => db.providers.toArray(), []);
}

export function useSetting<T>(key: string, fallback: T): T | undefined {
  return useLiveQuery(async () => {
    const row = await db.settings.get(key);
    return row ? (row.value as T) : fallback;
  }, [key]);
}
