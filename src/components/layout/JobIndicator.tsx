/**
 * Live indicator for active jobs across ALL projects. Hidden when idle.
 * Each row carries a dismiss control that marks the job cancelled, so a job
 * orphaned by a reload never spins here forever.
 */
import { X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Progress, Spinner } from '@/components/ui/Controls';
import { db } from '@/lib/db';
import { useActiveJobs } from '@/lib/hooks';
import { fmtNum } from '@/lib/utils';
import type { JobKind } from '@/engine/types';

const KIND_LABELS: Record<JobKind, string> = {
  enhance: 'Enhancing examples',
  'generate-synthetic': 'Generating synthetic data',
  'generate-from-document': 'Generating from document',
  'build-preference-pairs': 'Building preference pairs',
  'quality-scan': 'Quality scan',
  dedup: 'Duplicate detection',
  'llm-judge': 'LLM judge',
};

function dismissJob(id: string): void {
  void db.jobs.update(id, { status: 'cancelled', updatedAt: Date.now() });
}

export function JobIndicator() {
  const jobs = useActiveJobs();
  if (!jobs || jobs.length === 0) return null;

  const noun = jobs.length === 1 ? 'job' : 'jobs';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${jobs.length} active ${noun}: view progress`}
          className="flex h-8 items-center gap-1.5 rounded-(--radius-control) px-2 text-ink-dim transition-colors duration-100 hover:bg-surface-3 hover:text-ink"
        >
          <Spinner className="size-3.5" />
          <span className="font-mono text-xs tabular-nums">
            {jobs.length} {noun}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel>Active jobs</DropdownMenuLabel>
        {jobs.map((job) => (
          <div key={job.id} className="px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-medium text-ink">
                {KIND_LABELS[job.kind]}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="font-mono text-xs tabular-nums text-ink-dim">
                  {fmtNum(job.done)} / {fmtNum(job.total)}
                </span>
                <button
                  type="button"
                  aria-label={`Dismiss ${KIND_LABELS[job.kind]}`}
                  onClick={() => dismissJob(job.id)}
                  className="rounded-(--radius-control) p-0.5 text-ink-faint transition-colors duration-100 hover:bg-surface-3 hover:text-ink"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            </div>
            <Progress value={job.progress} className="mt-1.5" />
            {job.detail ? (
              <p className="mt-1 truncate text-xs text-ink-faint">{job.detail}</p>
            ) : null}
            {job.failed > 0 ? (
              <p className="mt-0.5 font-mono text-xs tabular-nums text-danger">
                {fmtNum(job.failed)} failed
              </p>
            ) : null}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
