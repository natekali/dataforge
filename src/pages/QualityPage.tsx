/**
 * Quality workbench — /p/:projectId/quality.
 *
 * Four stacked tools over the project's examples: scan (score + issues),
 * clean (configurable fixes), dedup (exact + near groups) and decontaminate
 * (benchmark n-gram screen). Heavy work runs in the engine worker; every
 * bulk write is undoable.
 */
import { Link, useParams } from 'react-router-dom';
import { ShieldCheck, Upload } from 'lucide-react';

import { useProject, useProjectCounts } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScanSection } from '@/components/quality/ScanSection';
import { CleanSection } from '@/components/quality/CleanSection';
import { DedupSection } from '@/components/quality/DedupSection';
import { DecontaminateSection } from '@/components/quality/DecontaminateSection';

export function QualityPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = useProject(projectId);
  const counts = useProjectCounts();
  const total = projectId ? counts?.[projectId] : undefined;

  if (!projectId) return null;

  if (!project || total === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-6">
        <EmptyState
          icon={ShieldCheck}
          title="Nothing to check yet"
          description="Quality tools work on existing examples. Import data first, then scan, clean and dedup it here."
          action={
            <Link to="../import" className={cn(buttonVariants({ variant: 'solid', size: 'sm' }))}>
              <Upload />
              Import data
            </Link>
          }
          className="w-full max-w-xl"
        />
      </div>
    );
  }

  let riseIdx = 0;
  const rise = () => ({ animationDelay: `${riseIdx++ * 40}ms` });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <header>
          <h1 className="text-lg font-semibold text-ink">Quality</h1>
          <p className="mt-0.5 text-[13px] text-ink-dim">
            Scan, clean, dedup and decontaminate before export.
          </p>
        </header>

        <ScanSection projectId={projectId} project={project} style={rise()} />
        <CleanSection projectId={projectId} style={rise()} />
        <DedupSection projectId={projectId} style={rise()} />
        <DecontaminateSection projectId={projectId} style={rise()} />
      </div>
    </div>
  );
}
