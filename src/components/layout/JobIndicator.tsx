/**
 * Live indicator for active jobs across ALL projects. Hidden when idle.
 * Pure display — cancel controls live on the pages that started the jobs.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Progress, Spinner } from '@/components/ui/Controls';
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
          className="flex h-7 items-center gap-1.5 rounded-(--radius-control) px-2 text-ink-dim transition-colors duration-100 hover:bg-surface-3 hover:text-ink"
        >
          <Spinner className="size-3" />
          <span className="font-mono text-[11px] tabular-nums">
            {jobs.length} {noun}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel>Active jobs</DropdownMenuLabel>
        {jobs.map((job) => (
          <div key={job.id} className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium text-ink">
                {KIND_LABELS[job.kind]}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-dim">
                {fmtNum(job.done)} / {fmtNum(job.total)}
              </span>
            </div>
            <Progress value={job.progress} className="mt-1.5" />
            {job.detail ? (
              <p className="mt-1 truncate text-[11px] text-ink-faint">{job.detail}</p>
            ) : null}
            {job.failed > 0 ? (
              <p className="mt-0.5 font-mono text-[11px] tabular-nums text-danger">
                {fmtNum(job.failed)} failed
              </p>
            ) : null}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
