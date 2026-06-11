/**
 * JudgeSection — score stored examples with an LLM rubric.
 *
 * Wraps judgeExamples(): each target is rendered as a transcript, scored on
 * helpfulness, correctness and clarity, and written back as a 0 to 100
 * qualityScore. Scores show up everywhere heat chips are rendered.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Scale } from 'lucide-react';
import type { Job } from '@/engine/types';
import { judgeExamples } from '@/lib/ai/judge';
import { fmtNum } from '@/lib/utils';
import type { ProviderSelection } from '@/components/shared/ProviderModelPicker';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';
import { JobProgress, type ActiveJobHandle } from './JobProgress';
import { TargetPicker, type TargetPickerHandle } from './TargetPicker';

export function JudgeSection({
  projectId,
  provider,
}: {
  projectId: string;
  provider: ProviderSelection | null;
}) {
  const targetsRef = useRef<TargetPickerHandle>(null);

  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ActiveJobHandle | null>(null);

  const ready = provider !== null && provider.model.trim() !== '';
  const locked = !ready || busy;

  function announce(final: Job) {
    if (final.status === 'completed') {
      toast.success(
        <span>
          Scored {fmtNum(final.done)} examples.{' '}
          <Link to={`/p/${projectId}/quality`} className="text-accent hover:underline">
            Open quality
          </Link>
        </span>,
        final.failed > 0 ? { description: `${fmtNum(final.failed)} examples failed.` } : undefined,
      );
    } else if (final.status === 'failed') {
      toast.error(final.error ? `Judging failed: ${final.error}` : 'Judging failed.');
    }
  }

  async function handleRun() {
    if (provider === null || provider.model.trim() === '' || busy) return;
    const ids = (await targetsRef.current?.resolve()) ?? [];
    if (ids.length === 0) {
      toast.error('No examples match the target.');
      return;
    }
    setBusy(true);
    try {
      const handle = judgeExamples({
        projectId,
        exampleIds: ids,
        provider: provider.config,
        model: provider.model,
      });
      setRun({ jobId: handle.jobId, cancel: handle.cancel });
      announce(await handle.promise);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Judging failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="tech-label">LLM judge</h2>
        <span className="text-[11px] text-ink-faint">Helpfulness, correctness, clarity.</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <p className="text-xs leading-relaxed text-ink-dim">
          Scores examples 0 to 100 with an LLM rubric. Writes the score onto each example.
        </p>

        <TargetPicker
          ref={targetsRef}
          projectId={projectId}
          label="Examples to score"
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
            {busy ? <Spinner className="size-3 border-accent-ink/30 border-t-accent-ink" /> : <Scale />}
            Judge
          </Button>
        </div>

        {run && <JobProgress jobId={run.jobId} cancel={run.cancel} />}
      </div>
    </section>
  );
}
