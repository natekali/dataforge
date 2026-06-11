import { Tip } from '@/components/ui/Tooltip';
import { cn, fmtNum } from '@/lib/utils';

export interface HistogramBucket {
  label: string;
  count: number;
}

/**
 * CSS-only vertical histogram: flat amber bars rising from surface tracks,
 * mono bucket labels beneath, exact counts on hover via Tip.
 */
export function Histogram({
  buckets,
  className,
}: {
  buckets: HistogramBucket[];
  className?: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className={cn('flex items-end gap-2', className)}>
      {buckets.map((b) => (
        <div key={b.label} className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Tip
            label={
              <span className="font-mono tabular-nums">
                {b.label} tok · {fmtNum(b.count)} {b.count === 1 ? 'example' : 'examples'}
              </span>
            }
          >
            <div
              role="img"
              aria-label={`${b.label} tokens: ${fmtNum(b.count)} examples`}
              className="group flex h-36 items-end rounded-[3px] bg-surface-3/50"
            >
              {b.count > 0 && (
                <div
                  className="w-full rounded-[3px] bg-ember-500 transition-colors duration-150 group-hover:bg-ember-400"
                  style={{ height: `${Math.max((b.count / max) * 100, 2)}%` }}
                />
              )}
            </div>
          </Tip>
          <div className="truncate text-center font-mono text-[11px] tabular-nums text-ink-faint">
            {b.label}
          </div>
        </div>
      ))}
    </div>
  );
}
