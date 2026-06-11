/**
 * PreferenceSection — build on-policy DPO pairs from SFT examples.
 *
 * Wraps buildPreferencePairs(): per source example it samples N candidates,
 * has the model rank them, and stores best vs worst as a new preference
 * example. Ties produce no pair, so the created count can be lower than the
 * processed count. Created ids come back on params.createdIds for undo.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { GitCompare } from 'lucide-react';
import type { Job } from '@/engine/types';
import { buildPreferencePairs } from '@/lib/ai/preference';
import { db } from '@/lib/db';
import { fmtNum } from '@/lib/utils';
import type { ProviderSelection } from '@/components/shared/ProviderModelPicker';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Controls';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import {
  JobProgress,
  jobCreatedIds,
  undoCreatedAction,
  type ActiveJobHandle,
} from './JobProgress';
import { TargetPicker, type TargetPickerHandle } from './TargetPicker';

export function PreferenceSection({
  projectId,
  provider,
}: {
  projectId: string;
  provider: ProviderSelection | null;
}) {
  const targetsRef = useRef<TargetPickerHandle>(null);

  const [candidates, setCandidates] = useState('3');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ActiveJobHandle | null>(null);

  const ready = provider !== null && provider.model.trim() !== '';
  const locked = !ready || busy;

  function announce(final: Job) {
    const created = jobCreatedIds(final);
    if (final.status === 'completed') {
      const ties = Math.max(0, final.done - created.length);
      const notes: string[] = [];
      if (ties > 0) notes.push(`${fmtNum(ties)} ties skipped.`);
      if (final.failed > 0) notes.push(`${fmtNum(final.failed)} examples failed.`);
      toast.success(
        <span>
          {fmtNum(created.length)} pairs created.{' '}
          <Link
            to={`/p/${projectId}/data?type=preference`}
            className="text-accent hover:underline"
          >
            Open pairs
          </Link>
        </span>,
        {
          ...(notes.length > 0 ? { description: notes.join(' ') } : {}),
          ...(created.length > 0 ? { action: undoCreatedAction(created, 'pairs') } : {}),
        },
      );
    } else if (final.status === 'failed') {
      toast.error(final.error ? `Pair building failed: ${final.error}` : 'Pair building failed.');
    } else if (created.length > 0) {
      toast(`Stopped early. ${fmtNum(created.length)} pairs were kept.`, {
        action: undoCreatedAction(created, 'pairs'),
      });
    }
  }

  async function handleRun() {
    if (provider === null || provider.model.trim() === '' || busy) return;
    const resolved = (await targetsRef.current?.resolve()) ?? [];
    // Candidate sampling only makes sense on SFT sources; drop anything else.
    const sftIds = new Set<string>(
      (await db.examples
        .where('[projectId+type]')
        .equals([projectId, 'sft'])
        .primaryKeys()) as string[],
    );
    const ids = resolved.filter((id) => sftIds.has(id));
    const skipped = resolved.length - ids.length;
    if (skipped > 0) toast(`Skipped ${fmtNum(skipped)} non-SFT examples.`);
    if (ids.length === 0) {
      toast.error('No SFT examples match the target.');
      return;
    }
    setBusy(true);
    try {
      const handle = buildPreferencePairs({
        projectId,
        exampleIds: ids,
        provider: provider.config,
        model: provider.model,
        candidates: Number(candidates),
      });
      setRun({ jobId: handle.jobId, cancel: handle.cancel });
      announce(await handle.promise);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pair building failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="tech-label">Preference pairs</h2>
        <span className="text-[11px] text-ink-faint">New DPO examples from SFT sources.</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <p className="text-[13px] leading-relaxed text-ink-dim">
          Builds DPO pairs. Samples {candidates} answers from your model, judges them, keeps best
          and worst.
        </p>

        <div className="max-w-40">
          <Label>Candidates</Label>
          <Select value={candidates} onValueChange={setCandidates} disabled={locked}>
            <SelectTrigger aria-label="Candidates per example">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TargetPicker
          ref={targetsRef}
          projectId={projectId}
          label="Source examples"
          typeFilter="sft"
          disabled={locked}
        />

        <div className="flex items-center gap-3">
          {!ready && (
            <p className="text-[11px] text-ink-faint">
              Pick a provider and model above to run this.
            </p>
          )}
          <Button
            variant="solid"
            size="sm"
            className="ml-auto"
            disabled={locked}
            onClick={() => void handleRun()}
          >
            {busy ? (
              <Spinner className="size-3 border-accent-ink/30 border-t-accent-ink" />
            ) : (
              <GitCompare />
            )}
            Build pairs
          </Button>
        </div>

        {run && <JobProgress jobId={run.jobId} cancel={run.cancel} />}
      </div>
    </section>
  );
}
