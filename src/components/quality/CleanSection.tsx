/**
 * Clean — configurable cleaning passes over the whole dataset. Preview runs
 * the cleaner on the first 100 examples; Apply runs everything in 1k chunks
 * inside withUndo so Ctrl+Z restores the pre-clean state.
 */
import { useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { Eraser, Eye } from 'lucide-react';

import { db } from '@/lib/db';
import { cleanExamples } from '@/lib/workerClient';
import { withUndo } from '@/lib/undo';
import { fmtNum } from '@/lib/utils';
import { DEFAULT_CLEANING, type CleaningOptions } from '@/engine/types';

import { Button } from '@/components/ui/Button';
import { Checkbox, Progress, Spinner } from '@/components/ui/Controls';

const PREVIEW_LIMIT = 100;
const APPLY_CHUNK = 1000;

const CLEANING_FIELDS: { key: keyof CleaningOptions; label: string; hint: string }[] = [
  {
    key: 'removeEmptyMessages',
    label: 'Remove empty messages',
    hint: 'Drops messages with no content, tool calls or reasoning.',
  },
  {
    key: 'normalizeRoles',
    label: 'Normalize roles',
    hint: 'Maps aliases like human and gpt to standard roles.',
  },
  {
    key: 'fixEncoding',
    label: 'Fix encoding',
    hint: 'Repairs mojibake and removes null bytes.',
  },
  {
    key: 'normalizeWhitespace',
    label: 'Normalize whitespace',
    hint: 'Collapses extra blank lines and trims trailing spaces.',
  },
  {
    key: 'removeRefusals',
    label: 'Remove refusals',
    hint: 'Strips refusal openers from assistant turns.',
  },
  {
    key: 'maskPii',
    label: 'Mask PII',
    hint: 'Replaces emails, phone numbers, SSNs, cards and IPs with placeholders.',
  },
  {
    key: 'removeSpecialTokens',
    label: 'Remove special tokens',
    hint: 'Strips chat template control tokens from message text.',
  },
];

interface PreviewResult {
  sampled: number;
  changed: number;
  changes: number;
}

export function CleanSection({
  projectId,
  style,
}: {
  projectId: string;
  style?: CSSProperties;
}) {
  const [opts, setOpts] = useState<CleaningOptions>({ ...DEFAULT_CLEANING });
  const [busy, setBusy] = useState<'idle' | 'preview' | 'apply'>('idle');
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  function toggle(key: keyof CleaningOptions, checked: boolean): void {
    setOpts((prev) => ({ ...prev, [key]: checked }));
    setPreview(null);
  }

  async function runPreview(): Promise<void> {
    if (busy !== 'idle') return;
    setBusy('preview');
    try {
      const sample = await db.examples
        .where('projectId')
        .equals(projectId)
        .limit(PREVIEW_LIMIT)
        .toArray();
      if (sample.length === 0) {
        toast.error('No examples to preview.');
        return;
      }
      const results = await cleanExamples(sample, opts);
      setPreview({
        sampled: sample.length,
        changed: results.filter((r) => r.changed.length > 0).length,
        changes: results.reduce((acc, r) => acc + r.changed.length, 0),
      });
    } catch (err) {
      toast.error(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  }

  async function runApply(): Promise<void> {
    if (busy !== 'idle') return;
    setBusy('apply');
    setProgress(0);
    const toastId = toast.loading('Cleaning dataset…');
    try {
      const all = await db.examples.where('projectId').equals(projectId).toArray();
      if (all.length === 0) {
        toast.error('No examples to clean.', { id: toastId });
        return;
      }
      const allIds = all.map((e) => e.id);
      let changedTotal = 0;
      await withUndo('Clean dataset', allIds, async () => {
        const now = Date.now();
        for (let i = 0; i < all.length; i += APPLY_CHUNK) {
          const slice = all.slice(i, i + APPLY_CHUNK);
          const results = await cleanExamples(slice, opts);
          const dirty = results
            .filter((r) => r.changed.length > 0)
            .map((r) => ({ ...r.example, updatedAt: now }));
          if (dirty.length > 0) await db.examples.bulkPut(dirty);
          changedTotal += dirty.length;
          setProgress(Math.min(1, (i + slice.length) / all.length));
        }
      });
      if (changedTotal > 0) {
        await db.projects.update(projectId, { updatedAt: Date.now() });
        toast.success(
          `Cleaned ${fmtNum(changedTotal)} ${changedTotal === 1 ? 'example' : 'examples'}`,
          { id: toastId, description: 'Press Ctrl+Z to undo.' },
        );
      } else {
        toast.success('No changes were needed.', { id: toastId });
      }
      setPreview(null);
    } catch (err) {
      toast.error(`Clean failed: ${err instanceof Error ? err.message : String(err)}`, {
        id: toastId,
      });
    } finally {
      setBusy('idle');
    }
  }

  return (
    <section className="panel animate-rise" style={style}>
      <div className="panel-header">
        <h2 className="tech-label">Clean</h2>
        <span className="text-xs text-ink-faint">
          Safe fixes are on by default. Destructive ones are opt-in.
        </span>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-2">
        {CLEANING_FIELDS.map((field) => (
          <label key={field.key} className="flex cursor-pointer items-start gap-2.5">
            <Checkbox
              checked={opts[field.key]}
              onCheckedChange={(value) => toggle(field.key, value === true)}
              disabled={busy !== 'idle'}
              className="mt-0.5"
              aria-label={field.label}
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-[13px] font-medium text-ink">{field.label}</span>
              <span className="text-xs text-ink-dim">{field.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-3 py-2">
        <Button variant="outline" onClick={() => void runPreview()} disabled={busy !== 'idle'}>
          {busy === 'preview' ? <Spinner className="size-3.5" /> : <Eye />}
          Preview
        </Button>
        {preview && (
          <span className="text-[13px] text-ink-dim">
            <span className="font-mono tabular-nums text-ink">{fmtNum(preview.changed)}</span> of{' '}
            <span className="font-mono tabular-nums">{fmtNum(preview.sampled)}</span> would change
            (<span className="font-mono tabular-nums">{fmtNum(preview.changes)}</span> total
            changes)
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {busy === 'apply' && <Progress value={progress} className="w-28" />}
          <Button variant="solid" onClick={() => void runApply()} disabled={busy !== 'idle'}>
            {busy === 'apply' ? (
              <Spinner className="size-3.5 border-accent-ink/30 border-t-accent-ink" />
            ) : (
              <Eraser />
            )}
            Apply to all
          </Button>
        </div>
      </div>
    </section>
  );
}
