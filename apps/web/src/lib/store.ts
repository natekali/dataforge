/**
 * Global State Store
 *
 * Zustand store for application-wide state management.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  // Current project
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;

  // Target model (for export)
  targetModel: string | null;
  setTargetModel: (model: string | null) => void;

  // UI state
  currentStep: 'import' | 'edit' | 'export';
  setCurrentStep: (step: 'import' | 'edit' | 'export') => void;

  // Detected format from import
  detectedFormat: string | null;
  setDetectedFormat: (format: string | null) => void;

  // Reset to initial state
  reset: () => void;
}

const initialState = {
  currentProjectId: null,
  targetModel: null,
  currentStep: 'import' as const,
  detectedFormat: null,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialState,

      setCurrentProjectId: (id) => set({ currentProjectId: id }),
      setTargetModel: (model) => set({ targetModel: model }),
      setCurrentStep: (step) => set({ currentStep: step }),
      setDetectedFormat: (format) => set({ detectedFormat: format }),

      reset: () => set(initialState),
    }),
    {
      name: 'dataforge-storage',
      partialize: (state) => ({
        currentProjectId: state.currentProjectId,
        targetModel: state.targetModel,
      }),
    }
  )
);
