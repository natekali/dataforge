import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn, heatClasses } from '@/lib/utils';
import type { DatasetType } from '@/engine/types';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-(--radius-control) border px-1.5 py-px font-mono text-[11px] font-medium uppercase tracking-wide',
  {
    variants: {
      tone: {
        neutral: 'border-hairline text-ink-dim',
        accent: 'border-ember-600/50 bg-ember-500/10 text-ember-400',
        ok: 'border-ok/40 bg-ok/10 text-ok',
        warn: 'border-warn/40 bg-warn/10 text-warn',
        danger: 'border-danger/40 bg-danger/10 text-danger',
        info: 'border-info/40 bg-info/10 text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Quality score rendered as forge heat — the signature V2 visual. */
export function HeatBadge({
  score,
  className,
}: {
  score: number | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn('heat-chip', heatClasses(score), className)}
      title={score == null ? 'Not scored yet' : `Quality score ${Math.round(score)}/100`}
    >
      {score == null ? '··' : Math.round(score)}
    </span>
  );
}

const TYPE_TONES: Record<DatasetType, BadgeProps['tone']> = {
  sft: 'info',
  preference: 'accent',
  kto: 'warn',
  rl: 'ok',
};

const TYPE_LABELS: Record<DatasetType, string> = {
  sft: 'SFT',
  preference: 'DPO',
  kto: 'KTO',
  rl: 'RL',
};

/** Dataset-type chip used in grids, headers and export panels. */
export function TypeBadge({ type, className }: { type: DatasetType; className?: string }) {
  return (
    <Badge tone={TYPE_TONES[type]} className={className}>
      {TYPE_LABELS[type]}
    </Badge>
  );
}
