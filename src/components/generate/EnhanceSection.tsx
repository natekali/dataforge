/**
 * EnhanceSection — rewrite existing examples in place with an LLM.
 *
 * Six operations map onto enhanceExamples(): five canned rewrites plus a
 * custom free-text instruction. Targets come from TargetPicker. Enhancement
 * mutates assistant turns of the stored conversations; failed items are left
 * untouched by the module and reported on the job.
 */
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Wand2 } from 'lucide-react';
import type { Job } from '@/engine/types';
import { enhanceExamples, type EnhanceOp } from '@/lib/ai/enhance';
import { db } from '@/lib/db';
import { withUndo } from '@/lib/undo';
import { cn, fmtNum } from '@/lib/utils';
import type { ProviderSelection } from '@/components/shared/ProviderModelPicker';
import { Button } from '@/components/ui/Button';
import { Label, Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Controls';
import { JobProgress, type ActiveJobHandle } from './JobProgress';
import { TargetPicker, type TargetPickerHandle } from './TargetPicker';

/** Above this many examples the pre-run snapshot would not fit in RAM. */
const UNDO_LIMIT = 20000;

const OPS: { id: EnhanceOp; name: string; blurb: string }[] = [
  { id: 'improve-quality', name: 'Improve quality', blurb: 'Clearer, more accurate responses.' },
  { id: 'add-reasoning', name: 'Add reasoning', blurb: 'Adds a thinking trace to the final answer.' },
  { id: 'expand', name: 'Expand', blurb: 'Longer, more thorough responses.' },
  { id: 'add-code-examples', name: 'Add code examples', blurb: 'Works code snippets into responses.' },
  { id: 'simplify', name: 'Simplify', blurb: 'Shorter, plainer responses.' },
  { id: 'custom', name: 'Custom', blurb: 'Apply your own instruction.' },
];

export function EnhanceSection({
  projectId,
  provider,
}: {
  projectId: string;
  provider: ProviderSelection | null;
}) {
  const customId = useId();
  const targetsRef = useRef<TargetPickerHandle>(null);

  const [op, setOp] = useState<EnhanceOp>('improve-quality');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ActiveJobHandle | null>(null);

  const ready = provider !== null && provider.model.trim() !== '';
  const locked = !ready || busy;

  function announce(final: Job) {
    if (final.status === 'completed') {
      toast.success(
        <span>
          Enhanced {fmtNum(final.done)} examples.{' '}
          <Link to={`/p/${projectId}/data`} className="text-accent hover:underline">
            Open data
          </Link>
        </span>,
        final.failed > 0 ? { description: `${fmtNum(final.failed)} examples failed.` } : undefined,
      );
    } else if (final.status === 'failed') {
      toast.error(final.error ? `Enhancement failed: ${final.error}` : 'Enhancement failed.');
    }
  }

  async function handleRun() {
    if (provider === null || provider.model.trim() === '' || busy) return;
    const instruction = custom.trim();
    if (op === 'custom' && instruction === '') {
      toast.error('Write an instruction first.');
      return;
    }
    const resolved = (await targetsRef.current?.resolve()) ?? [];
    if (resolved.length === 0) {
      toast.error('No examples match the target.');
      return;
    }
    // Enhancement rewrites assistant turns — only SFT examples benefit.
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
      const runJob = async (): Promise<Job> => {
        const handle = enhanceExamples({
          projectId,
          exampleIds: ids,
          op,
          provider: provider.config,
          model: provider.model,
          ...(op === 'custom' ? { customInstruction: instruction } : {}),
        });
        setRun({ jobId: handle.jobId, cancel: handle.cancel });
        return handle.promise;
      };
      if (ids.length > UNDO_LIMIT) {
        toast('Too many examples for undo. Changes are permanent.');
        announce(await runJob());
      } else {
        await withUndo(`Enhance ${ids.length} examples`, ids, async () => {
          announce(await runJob());
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enhancement failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="tech-label">Enhance</h2>
        <span className="text-[11px] text-ink-faint">Rewrites assistant turns in place.</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div
          role="radiogroup"
          aria-label="Enhancement operation"
          className="grid grid-cols-2 gap-2 md:grid-cols-3"
        >
          {OPS.map((o) => {
            const active = op === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={locked}
                onClick={() => setOp(o.id)}
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
                  {o.name}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-dim">
                  {o.blurb}
                </span>
              </button>
            );
          })}
        </div>

        {op === 'custom' && (
          <div>
            <Label htmlFor={customId}>Instruction</Label>
            <Textarea
              id={customId}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. Rewrite every assistant response in formal English"
              disabled={locked}
            />
          </div>
        )}

        <TargetPicker ref={targetsRef} projectId={projectId} disabled={locked} />

        <div className="flex items-center gap-3">
          <p className="text-[11px] text-ink-faint">
            {ready
              ? 'Responses are cached locally. Re-running the same input is free.'
              : 'Pick a provider and model above to run this.'}
          </p>
          <Button
            variant="solid"
            size="sm"
            className="ml-auto"
            disabled={locked}
            onClick={() => void handleRun()}
          >
            {busy ? <Spinner className="size-3 border-accent-ink/30 border-t-accent-ink" /> : <Wand2 />}
            Enhance
          </Button>
        </div>

        {run && <JobProgress jobId={run.jobId} cancel={run.cancel} />}
      </div>
    </section>
  );
}
