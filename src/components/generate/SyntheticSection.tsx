/**
 * SyntheticSection — create brand-new examples with an LLM.
 *
 * Four techniques map directly onto generateSynthetic(): Self-Instruct and
 * Evol-Instruct take seed examples via TargetPicker, Persona and Magpie-style
 * take a free-text topic (required for Magpie). Created ids are read back
 * from the finished job (params.createdIds) so the success toast can offer
 * a one-click undo that deletes exactly those rows.
 */
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import type { Job } from '@/engine/types';
import { generateSynthetic, type SyntheticTechnique } from '@/lib/ai/generate';
import { cn, fmtNum } from '@/lib/utils';
import type { ProviderSelection } from '@/components/shared/ProviderModelPicker';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Controls';
import {
  JobProgress,
  jobCreatedIds,
  undoCreatedAction,
  type ActiveJobHandle,
} from './JobProgress';
import { TargetPicker, type TargetPickerHandle } from './TargetPicker';

const TECHNIQUES: { id: SyntheticTechnique; name: string; blurb: string }[] = [
  { id: 'self-instruct', name: 'Self-Instruct', blurb: 'New tasks from your seed examples.' },
  { id: 'evol-instruct', name: 'Evol-Instruct', blurb: 'Harder variants of existing tasks.' },
  { id: 'persona', name: 'Persona', blurb: 'Same topics asked by different people.' },
  { id: 'magpie-style', name: 'Magpie-style', blurb: 'Cold generation from a topic.' },
];

export function SyntheticSection({
  projectId,
  provider,
}: {
  projectId: string;
  provider: ProviderSelection | null;
}) {
  const countId = useId();
  const tempId = useId();
  const topicId = useId();
  const seedsRef = useRef<TargetPickerHandle>(null);

  const [technique, setTechnique] = useState<SyntheticTechnique>('self-instruct');
  const [countStr, setCountStr] = useState('25');
  const [topic, setTopic] = useState('');
  const [temperature, setTemperature] = useState(0.8);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ActiveJobHandle | null>(null);

  const ready = provider !== null && provider.model.trim() !== '';
  const locked = !ready || busy;
  const needsSeeds = technique === 'self-instruct' || technique === 'evol-instruct';
  const needsTopic = technique === 'persona' || technique === 'magpie-style';

  function announce(final: Job) {
    const created = jobCreatedIds(final);
    if (final.status === 'completed') {
      toast.success(
        <span>
          Created {fmtNum(created.length)} examples.{' '}
          <Link to={`/p/${projectId}/data`} className="text-accent hover:underline">
            Open data
          </Link>
        </span>,
        {
          ...(final.failed > 0 ? { description: `${fmtNum(final.failed)} batches failed.` } : {}),
          ...(created.length > 0 ? { action: undoCreatedAction(created, 'examples') } : {}),
        },
      );
    } else if (final.status === 'failed') {
      toast.error(final.error ? `Generation failed: ${final.error}` : 'Generation failed.');
    } else if (created.length > 0) {
      toast(`Stopped early. ${fmtNum(created.length)} examples were kept.`, {
        action: undoCreatedAction(created, 'examples'),
      });
    }
  }

  async function handleRun() {
    if (provider === null || provider.model.trim() === '' || busy) return;
    const count = Math.floor(Number(countStr));
    if (!Number.isFinite(count) || count < 1 || count > 500) {
      toast.error('Count must be between 1 and 500.');
      return;
    }
    if (technique === 'magpie-style' && topic.trim() === '') {
      toast.error('Add a topic first.');
      return;
    }
    let seedIds: string[] = [];
    if (needsSeeds) {
      seedIds = (await seedsRef.current?.resolve()) ?? [];
      if (seedIds.length === 0) {
        toast.error('Pick at least one seed example.');
        return;
      }
    }
    setBusy(true);
    try {
      const handle = generateSynthetic({
        projectId,
        technique,
        count,
        provider: provider.config,
        model: provider.model,
        temperature,
        ...(needsSeeds ? { seedExampleIds: seedIds } : {}),
        ...(topic.trim() !== '' ? { topic: topic.trim() } : {}),
      });
      setRun({ jobId: handle.jobId, cancel: handle.cancel });
      announce(await handle.promise);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="tech-label">Synthetic data</h2>
        <span className="text-xs text-ink-faint">Creates new examples in this project.</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div
          role="radiogroup"
          aria-label="Generation technique"
          className="grid grid-cols-2 gap-2 md:grid-cols-4"
        >
          {TECHNIQUES.map((t) => {
            const active = technique === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={locked}
                onClick={() => setTechnique(t.id)}
                className={cn(
                  'rounded-(--radius-control) border px-2.5 py-2 text-left transition-colors duration-100',
                  'focus-visible:outline focus-visible:outline-accent focus-visible:outline-offset-1',
                  'disabled:pointer-events-none disabled:opacity-45',
                  active
                    ? 'border-ember-600/60 bg-ember-500/10'
                    : 'border-hairline bg-surface-2 hover:border-hairline-strong',
                )}
              >
                <span
                  className={cn('block text-[13px] font-medium', active ? 'text-accent' : 'text-ink')}
                >
                  {t.name}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-dim">
                  {t.blurb}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={countId}>Count</Label>
            <Input
              id={countId}
              type="number"
              min={1}
              max={500}
              value={countStr}
              onChange={(e) => setCountStr(e.target.value)}
              disabled={locked}
              className="font-mono tabular-nums"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor={tempId} className="mb-0">
                Temperature
              </Label>
              <span className="font-mono text-xs tabular-nums text-ink">
                {temperature.toFixed(2)}
              </span>
            </div>
            <input
              id={tempId}
              type="range"
              min={0}
              max={1.2}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              disabled={locked}
              className="mt-3 block w-full cursor-pointer accent-accent disabled:opacity-45"
            />
          </div>
        </div>

        {needsTopic && (
          <div>
            <Label htmlFor={topicId}>
              Topic{technique === 'persona' ? ' (optional)' : ''}
            </Label>
            <Input
              id={topicId}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. PostgreSQL performance tuning"
              disabled={locked}
            />
          </div>
        )}

        {needsSeeds && (
          <TargetPicker
            ref={seedsRef}
            projectId={projectId}
            label="Seed examples"
            disabled={locked}
          />
        )}

        <div className="flex items-center gap-3">
          {!ready && (
            <p className="text-xs text-ink-faint">
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
            {busy ? <Spinner className="size-3.5 border-accent-ink/30 border-t-accent-ink" /> : <Sparkles />}
            Generate
          </Button>
        </div>

        {run && <JobProgress jobId={run.jobId} cancel={run.cancel} />}
      </div>
    </section>
  );
}
