/**
 * Shared import preview — used by the File, Paste and Hugging Face tabs.
 * Shows the detected schema, warnings, conversion errors and a sample of the
 * converted examples, then commits via withUndo + bulkAddExamples.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Plus, TriangleAlert } from 'lucide-react';
import type { Example, ImportResult } from '@/engine/types';
import { bulkAddExamples } from '@/lib/db';
import { withUndo } from '@/lib/undo';
import { cn, fmtNum } from '@/lib/utils';
import { Badge, TypeBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';

const SAMPLE_COUNT = 5;
const ERROR_COUNT = 5;
const PREVIEW_LEN = 110;
/** Above this, undo snapshots would double the import's memory — skip them. */
const UNDO_LIMIT = 20_000;

function isQuotaError(err: unknown, message: string): boolean {
  return (err instanceof Error && err.name === 'QuotaExceededError') || /quota/i.test(message);
}

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_LEN ? `${oneLine.slice(0, PREVIEW_LEN)}…` : oneLine;
}

function firstUserContent(e: Example): string {
  const msg = e.messages.find((m) => m.role === 'user') ?? e.messages[0];
  return msg ? clip(msg.content) : '';
}

export function ImportPreview({
  result,
  onDiscard,
  className,
}: {
  result: ImportResult;
  onDiscard: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);

  const { examples, schema, skipped, errors } = result;
  const count = examples.length;

  async function handleAdd() {
    if (adding || count === 0) return;
    setAdding(true);
    try {
      if (count > UNDO_LIMIT) {
        await bulkAddExamples(examples);
        toast.success(`Added ${fmtNum(count)} examples`);
      } else {
        await withUndo(`Import ${fmtNum(count)} examples`, [], async () => {
          await bulkAddExamples(examples);
          return examples.map((e) => e.id);
        });
        toast.success(`Added ${fmtNum(count)} examples. Ctrl+Z to undo.`);
      }
      navigate('../data');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        isQuotaError(err, message)
          ? 'Not enough browser storage. Free space in Settings, then retry.'
          : `Import failed: ${message}`,
      );
      setAdding(false);
    }
  }

  return (
    <section className={cn('panel animate-rise', className)} aria-label="Import preview">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <h3 className="tech-label">Preview</h3>
          <Badge tone="accent">{schema.format}</Badge>
        </div>
        <span className="font-mono text-xs tabular-nums text-ink-dim">
          {Math.round(schema.confidence * 100)}% confidence
        </span>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <p className="font-mono text-[13px] tabular-nums text-ink">
          {fmtNum(count)} examples
          <span className="text-ink-faint"> · {fmtNum(skipped)} skipped</span>
        </p>

        {schema.warnings.length > 0 && (
          <ul className="flex flex-col gap-1">
            {schema.warnings.map((w) => (
              <li key={w} className="flex items-start gap-1.5 text-[13px] text-warn">
                <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}

        {errors.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setErrorsOpen((v) => !v)}
              aria-expanded={errorsOpen}
              className="flex items-center gap-1 text-[13px] text-danger hover:underline"
            >
              {errorsOpen ? (
                <ChevronDown className="size-4" aria-hidden />
              ) : (
                <ChevronRight className="size-4" aria-hidden />
              )}
              <span className="font-mono tabular-nums">{fmtNum(errors.length)}</span> errors
            </button>
            {errorsOpen && (
              <ul className="mt-1.5 flex flex-col gap-1 border-l border-danger/30 pl-3">
                {errors.slice(0, ERROR_COUNT).map((e, i) => (
                  <li key={i} className="font-mono text-xs leading-relaxed text-ink-dim">
                    {clip(e)}
                  </li>
                ))}
                {errors.length > ERROR_COUNT && (
                  <li className="font-mono text-xs tabular-nums text-ink-faint">
                    +{fmtNum(errors.length - ERROR_COUNT)} more not shown
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {count > 0 ? (
          <div className="overflow-hidden rounded-(--radius-control) border border-hairline">
            <table className="w-full">
              <thead>
                <tr className="border-b border-hairline bg-surface-2">
                  <th className="tech-label px-2 py-1.5 text-left font-medium">Type</th>
                  <th className="tech-label w-full px-2 py-1.5 text-left font-medium">
                    First user turn
                  </th>
                  <th className="tech-label px-2 py-1.5 text-right font-medium">Turns</th>
                </tr>
              </thead>
              <tbody>
                {examples.slice(0, SAMPLE_COUNT).map((e) => (
                  <tr key={e.id} className="border-b border-hairline/60 last:border-b-0">
                    <td className="px-2 py-1.5 align-top">
                      <TypeBadge type={e.type} />
                    </td>
                    <td className="max-w-0 truncate px-2 py-1.5 text-[13px] text-ink">
                      {firstUserContent(e) || (
                        <span className="italic text-ink-faint">no user turn</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-[13px] tabular-nums text-ink-dim">
                      {e.messages.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 text-[13px] text-warn">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
            Nothing converted. Check the source format.
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button variant="solid" size="sm" onClick={handleAdd} disabled={adding || count === 0}>
            {adding ? <Spinner className="border-accent-ink/30 border-t-accent-ink" /> : <Plus />}
            Add {fmtNum(count)} examples
          </Button>
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={adding}>
            Discard
          </Button>
        </div>
      </div>
    </section>
  );
}
