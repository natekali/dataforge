/**
 * Snapshot-based undo/redo for example mutations (V1 had none).
 *
 * Usage:
 *   await withUndo('Delete 3 examples', ids, async () => { await deleteExamples(ids); });
 * Creations: return the new ids from the action so undo can remove them:
 *   await withUndo('Generate 10 examples', [], async () => createdIds);
 *
 * Bound to Ctrl+Z / Ctrl+Shift+Z by the workbench shell.
 */
import { create } from 'zustand';
import { db } from '@/lib/db';
import type { Example } from '@/engine/types';

interface StateSnapshot {
  /** Examples that existed (full copies). */
  present: Example[];
  /** Ids that did NOT exist at snapshot time. */
  absent: string[];
}

interface UndoEntry {
  label: string;
  before: StateSnapshot;
  after: StateSnapshot;
}

const MAX_DEPTH = 50;

interface UndoState {
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  push: (entry: UndoEntry) => void;
  clear: () => void;
}

export const useUndoStore = create<UndoState>((set) => ({
  undoStack: [],
  redoStack: [],
  push: (entry) =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-(MAX_DEPTH - 1)), entry],
      redoStack: [],
    })),
  clear: () => set({ undoStack: [], redoStack: [] }),
}));

async function snapshot(ids: string[]): Promise<StateSnapshot> {
  const unique = [...new Set(ids)];
  const rows = await db.examples.where('id').anyOf(unique).toArray();
  const found = new Set(rows.map((r) => r.id));
  return {
    present: rows.map((r) => structuredClone(r)),
    absent: unique.filter((id) => !found.has(id)),
  };
}

async function applySnapshot(snap: StateSnapshot): Promise<void> {
  await db.transaction('rw', db.examples, async () => {
    if (snap.present.length) await db.examples.bulkPut(snap.present.map((e) => structuredClone(e)));
    if (snap.absent.length) await db.examples.bulkDelete(snap.absent);
  });
}

/**
 * Run a mutation with undo capture. `affectedIds` = ids touched by the action
 * that exist beforehand (edits/deletes). If the action CREATES examples,
 * return their ids from the callback.
 */
export async function withUndo(
  label: string,
  affectedIds: string[],
  action: () => Promise<string[] | void>,
): Promise<void> {
  const before = await snapshot(affectedIds);
  const created = (await action()) ?? [];
  const after = await snapshot([...affectedIds, ...created]);
  // Mark created ids as absent in `before` so undo deletes them.
  const beforeIds = new Set([...before.present.map((e) => e.id), ...before.absent]);
  for (const id of created) {
    if (!beforeIds.has(id)) before.absent.push(id);
  }
  useUndoStore.getState().push({ label, before, after });
}

export async function undo(): Promise<string | null> {
  const { undoStack, redoStack } = useUndoStore.getState();
  const entry = undoStack[undoStack.length - 1];
  if (!entry) return null;
  await applySnapshot(entry.before);
  useUndoStore.setState({
    undoStack: undoStack.slice(0, -1),
    redoStack: [...redoStack, entry],
  });
  return entry.label;
}

export async function redo(): Promise<string | null> {
  const { undoStack, redoStack } = useUndoStore.getState();
  const entry = redoStack[redoStack.length - 1];
  if (!entry) return null;
  await applySnapshot(entry.after);
  useUndoStore.setState({
    undoStack: [...undoStack, entry],
    redoStack: redoStack.slice(0, -1),
  });
  return entry.label;
}
