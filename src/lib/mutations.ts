/**
 * Shared write operations. Every mutation stamps updatedAt and touches the
 * parent project so "last updated" ordering stays correct everywhere.
 */
import { db } from '@/lib/db';
import type {
  DatasetType,
  Example,
  Message,
  Project,
  SplitName,
} from '@/engine/types';

async function touchProject(projectId: string): Promise<void> {
  await db.projects.update(projectId, { updatedAt: Date.now() });
}

export async function createProject(input: {
  name: string;
  description?: string;
  targetModelId?: string | null;
  datasetType?: DatasetType;
}): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    targetModelId: input.targetModelId ?? null,
    datasetType: input.datasetType ?? 'sft',
    createdAt: now,
    updatedAt: now,
  };
  await db.projects.add(project);
  return project;
}

export async function updateProject(
  projectId: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'targetModelId' | 'datasetType'>>,
): Promise<void> {
  await db.projects.update(projectId, { ...patch, updatedAt: Date.now() });
}

export async function updateExample(
  id: string,
  patch: Partial<Omit<Example, 'id' | 'projectId' | 'createdAt'>>,
): Promise<void> {
  const ex = await db.examples.get(id);
  if (!ex) return;
  await db.examples.update(id, { ...patch, updatedAt: Date.now() });
  await touchProject(ex.projectId);
}

export async function updateMessages(id: string, messages: Message[]): Promise<void> {
  await updateExample(id, { messages });
}

export async function deleteExamples(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const first = await db.examples.get(ids[0]);
  await db.examples.bulkDelete(ids);
  if (first) await touchProject(first.projectId);
}

export async function setSplitForExamples(ids: string[], split: SplitName): Promise<void> {
  const now = Date.now();
  await db.examples.where('id').anyOf(ids).modify({ split, updatedAt: now });
  const first = await db.examples.get(ids[0]);
  if (first) await touchProject(first.projectId);
}

export async function setFlagged(ids: string[], flagged: boolean): Promise<void> {
  await db.examples.where('id').anyOf(ids).modify({ flagged, updatedAt: Date.now() });
}

export async function setReviewed(ids: string[], reviewed: boolean): Promise<void> {
  await db.examples.where('id').anyOf(ids).modify({ reviewed, updatedAt: Date.now() });
}

export async function addTagToExamples(ids: string[], tag: string): Promise<void> {
  const t = tag.trim();
  if (!t) return;
  await db.examples
    .where('id')
    .anyOf(ids)
    .modify((e) => {
      if (!e.tags.includes(t)) e.tags.push(t);
      e.updatedAt = Date.now();
    });
}

export async function duplicateExample(id: string): Promise<string | null> {
  const ex = await db.examples.get(id);
  if (!ex) return null;
  const now = Date.now();
  const copy: Example = {
    ...structuredClone(ex),
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    meta: { ...ex.meta, duplicatedFrom: ex.id },
  };
  await db.examples.add(copy);
  await touchProject(ex.projectId);
  return copy.id;
}

/**
 * Random stratified split assignment. Ratios must sum to ~1; validation/test
 * get at least 1 example when their ratio > 0 and the dataset is non-trivial.
 */
export async function autoSplit(
  projectId: string,
  ratios: { train: number; validation: number; test: number },
  seed = 42,
): Promise<{ train: number; validation: number; test: number }> {
  const ids = await db.examples.where('projectId').equals(projectId).primaryKeys();
  // Deterministic shuffle (mulberry32) so re-running with the same seed is stable.
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...ids].sort(() => rand() - 0.5);
  const n = shuffled.length;
  const nVal = ratios.validation > 0 ? Math.max(n > 2 ? 1 : 0, Math.round(n * ratios.validation)) : 0;
  const nTest = ratios.test > 0 ? Math.max(n > 2 ? 1 : 0, Math.round(n * ratios.test)) : 0;
  const valIds = shuffled.slice(0, nVal);
  const testIds = shuffled.slice(nVal, nVal + nTest);
  const trainIds = shuffled.slice(nVal + nTest);
  const now = Date.now();
  await db.transaction('rw', db.examples, async () => {
    await db.examples.where('id').anyOf(trainIds as string[]).modify({ split: 'train', updatedAt: now });
    await db.examples.where('id').anyOf(valIds as string[]).modify({ split: 'validation', updatedAt: now });
    await db.examples.where('id').anyOf(testIds as string[]).modify({ split: 'test', updatedAt: now });
  });
  await touchProject(projectId);
  return { train: trainIds.length, validation: valIds.length, test: testIds.length };
}
