/**
 * JobProgress — live readout for a persisted batch job (lib/ai/runner.ts).
 *
 * Given the { jobId, cancel } pair from a BatchHandle, it renders the Job row
 * reactively via useLiveQuery: progress bar, done/failed/total counters, the
 * runner's detail line, a cancel button while the job is active, and a final
 * status line once it settles. Shared by every section on the Generate page.
 *
 * Also exports two small job helpers used by sections that create examples:
 * jobCreatedIds() reads params.createdIds off a finished job, and
 * undoCreatedAction() builds a toast action that deletes those rows.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Square, XCircle } from 'lucide-react';
import type { Job } from '@/engine/types';
import { db } from '@/lib/db';
import { deleteExamples } from '@/lib/mutations';
import { fmtNum } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Progress, Spinner } from '@/components/ui/Controls';

/** The slice of a BatchHandle a section needs to keep in state. */
export interface ActiveJobHandle {
  jobId: string;
  cancel: () => void;
}

/** Created example ids recorded on the job by generate/preference modules. */
export function jobCreatedIds(job: Job): string[] {
  const raw = job.params['createdIds'];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Toast action that removes the examples a finished job created.
 * Asks for confirmation first; the delete itself is a plain bulk delete.
 */
export function undoCreatedAction(createdIds: string[], noun: string) {
  return {
    label: 'Undo',
    onClick: () => {
      const n = createdIds.length;
      if (!window.confirm(`Remove ${fmtNum(n)} created ${noun}?`)) return;
      deleteExamples(createdIds)
        .then(() => toast.success(`Removed ${fmtNum(n)} ${noun}`))
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : `Could not remove the ${noun}`),
        );
    },
  };
}

/** Cap rendered error text so a huge provider message cannot flood the panel. */
const ERROR_DISPLAY_LIMIT = 200;

function truncateError(message: string): string {
  return message.length > ERROR_DISPLAY_LIMIT
    ? `${message.slice(0, ERROR_DISPLAY_LIMIT)}…`
    : message;
}

export function JobProgress({ jobId, cancel }: ActiveJobHandle) {
  const job = useLiveQuery(() => db.jobs.get(jobId), [jobId]);
  if (!job) return null;

  const active = job.status === 'pending' || job.status === 'running';

  return (
    <div className="animate-rise flex flex-col gap-2 rounded-(--radius-control) border border-hairline bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          {active && <Spinner className="size-3.5" />}
          <span className="font-mono text-[13px] tabular-nums text-ink">
            {fmtNum(job.done)}/{fmtNum(job.total)} done
          </span>
          {job.failed > 0 && (
            <span className="font-mono text-[13px] tabular-nums text-danger">
              {fmtNum(job.failed)} failed
            </span>
          )}
        </span>
        {active && (
          <Button
            variant="ghost"
            size="xs"
            className="text-danger hover:bg-danger/10 hover:text-danger"
            onClick={cancel}
          >
            <Square />
            Cancel
          </Button>
        )}
      </div>

      <Progress value={job.progress} />
      <p className="font-mono text-xs tabular-nums text-ink-dim">{job.detail}</p>

      {job.status === 'completed' && (
        <p role="status" className="flex items-center gap-1.5 text-[13px] text-ok">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Done{job.failed > 0 ? `. ${fmtNum(job.failed)} items failed.` : '.'}
        </p>
      )}
      {job.status === 'completed' && job.failed > 0 && job.error !== undefined && (
        <p className="text-xs leading-snug text-danger">{truncateError(job.error)}</p>
      )}
      {job.status === 'failed' && (
        <p role="status" className="flex items-center gap-1.5 text-[13px] text-danger">
          <XCircle className="size-4 shrink-0" aria-hidden />
          Failed{job.error ? `: ${truncateError(job.error)}` : '.'}
        </p>
      )}
      {job.status === 'cancelled' && (
        <p role="status" className="flex items-center gap-1.5 text-[13px] text-ink-dim">
          <Ban className="size-4 shrink-0" aria-hidden />
          Cancelled.
        </p>
      )}
    </div>
  );
}
