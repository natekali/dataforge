/**
 * UI-only state (Zustand). Data state lives in Dexie (useLiveQuery);
 * network state in TanStack Query. Keep this store small on purpose.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Selected example ids in the data grid (bulk operations). */
  selection: Set<string>;
  setSelection: (ids: Set<string>) => void;
  clearSelection: () => void;
  /** Example id open in the inspector panel. */
  inspectorId: string | null;
  setInspectorId: (id: string | null) => void;
  /** True while the inspector holds unsaved draft edits. */
  inspectorDirty: boolean;
  setInspectorDirty: (dirty: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      selection: new Set<string>(),
      setSelection: (selection) => set({ selection }),
      clearSelection: () => set({ selection: new Set() }),
      inspectorId: null,
      setInspectorId: (inspectorId) => set({ inspectorId }),
      inspectorDirty: false,
      setInspectorDirty: (inspectorDirty) => set({ inspectorDirty }),
      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
    }),
    {
      name: 'dataforge-ui',
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
);
