/**
 * DataForge V2 — IndexedDB persistence via Dexie.
 *
 * Storage strategy:
 *  - `examples` rows hold parsed, canonical Example objects. Large text lives
 *    inside unindexed fields (Dexie only indexes what's in the schema string).
 *  - Raw uploaded files are staged in OPFS by the import worker, not here.
 *  - Provider API keys live in `settings` (IndexedDB, never localStorage,
 *    never shipped anywhere — BYOK threat model documented in README).
 */
import Dexie, { type EntityTable } from 'dexie';
import type { Example, Job, Project, ProviderConfig } from '@/engine/types';

export interface CacheEntry {
  /** Hash of (provider, model, prompt) — enables resumable generation runs. */
  key: string;
  value: string;
  createdAt: number;
}

export interface SettingEntry {
  key: string;
  value: unknown;
}

export class DataForgeDB extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  examples!: EntityTable<Example, 'id'>;
  jobs!: EntityTable<Job, 'id'>;
  providers!: EntityTable<ProviderConfig, 'id'>;
  cache!: EntityTable<CacheEntry, 'key'>;
  settings!: EntityTable<SettingEntry, 'key'>;

  constructor() {
    super('dataforge-v2');
    this.version(1).stores({
      projects: 'id, updatedAt',
      // Index only small scalar fields; message bodies stay unindexed.
      examples:
        'id, projectId, [projectId+split], [projectId+type], [projectId+updatedAt], updatedAt',
      jobs: 'id, projectId, status, updatedAt',
      providers: 'id',
      cache: 'key, createdAt',
      settings: 'key',
    });
  }
}

export const db = new DataForgeDB();

/** Ask the browser not to evict our data (Safari purges after 7 idle days). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* unsupported — best effort */
  }
  return false;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  try {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    }
  } catch {
    /* unsupported */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Convenience queries used across the UI
// ---------------------------------------------------------------------------

export async function getProjectExampleCount(projectId: string): Promise<number> {
  return db.examples.where('projectId').equals(projectId).count();
}

export async function bulkAddExamples(examples: Example[]): Promise<void> {
  if (examples.length === 0) return;
  const projectId = examples[0]?.projectId;
  // One transaction so a mid-import failure (e.g. quota exhaustion) rolls the
  // whole import back instead of leaving a partial dataset. Chunked bulkPuts
  // inside it keep per-call memory bounded on 100k+ imports.
  await db.transaction('rw', [db.examples, db.projects], async () => {
    const CHUNK = 5000;
    for (let i = 0; i < examples.length; i += CHUNK) {
      await db.examples.bulkPut(examples.slice(i, i + CHUNK));
    }
    if (projectId) await db.projects.update(projectId, { updatedAt: Date.now() });
  });
}

export async function deleteProjectCascade(projectId: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.examples, db.jobs], async () => {
    await db.examples.where('projectId').equals(projectId).delete();
    await db.jobs.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  });
}
