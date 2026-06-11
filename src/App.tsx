import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { db } from '@/lib/db';
import { useGlobalHotkeys } from '@/lib/hotkeys';
import { useUiStore } from '@/lib/store';

import { WorkbenchLayout } from '@/components/layout/WorkbenchLayout';
import { HomePage } from '@/pages/HomePage';
import { DatasetPage } from '@/pages/DatasetPage';
import { ImportPage } from '@/pages/ImportPage';
import { GeneratePage } from '@/pages/GeneratePage';
import { QualityPage } from '@/pages/QualityPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { ExportPage } from '@/pages/ExportPage';
import { SettingsPage } from '@/pages/SettingsPage';

export default function App() {
  const theme = useUiStore((s) => s.theme);
  useGlobalHotkeys();

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  // Jobs interrupted by a reload would spin forever; fail stale ones once at
  // startup. The 60s grace period spares live jobs running in another tab.
  useEffect(() => {
    const cutoff = Date.now() - 60_000;
    void db.jobs
      .where('status')
      .anyOf(['pending', 'running'])
      .filter((j) => j.updatedAt < cutoff)
      .modify({
        status: 'failed',
        error: 'Interrupted by page reload',
        updatedAt: Date.now(),
      });
  }, []);

  return (
    <TooltipProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/p/:projectId" element={<WorkbenchLayout />}>
          <Route index element={<Navigate to="data" replace />} />
          <Route path="data" element={<DatasetPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="generate" element={<GeneratePage />} />
          <Route path="quality" element={<QualityPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="export" element={<ExportPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CommandPalette />
      <Toaster
        position="bottom-right"
        theme={theme}
        toastOptions={{
          style: {
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-hairline)',
            color: 'var(--color-ink)',
            fontSize: '13px',
          },
        }}
      />
    </TooltipProvider>
  );
}
