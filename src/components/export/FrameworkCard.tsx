import { Check } from 'lucide-react';
import type { FrameworkId } from '@/engine/types';
import { Tip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';

export interface FrameworkCardProps {
  id: FrameworkId;
  name: string;
  /** One-line description, version included where it matters. */
  description: string;
  selected: boolean;
  disabled?: boolean;
  /** Tooltip shown when the card is disabled. */
  disabledReason?: string;
  onSelect: (id: FrameworkId) => void;
}

/** One selectable export target in the framework grid. */
export function FrameworkCard({
  id,
  name,
  description,
  selected,
  disabled = false,
  disabledReason,
  onSelect,
}: FrameworkCardProps) {
  // aria-disabled (not disabled) so the tooltip still opens on hover/focus.
  const card = (
    <button
      type="button"
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onSelect(id);
      }}
      className={cn(
        'panel flex h-full w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors',
        selected ? 'border-accent bg-ember-500/5' : 'hover:border-hairline-strong',
        disabled && 'cursor-not-allowed opacity-45 hover:border-hairline',
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="font-semibold text-ink">{name}</span>
        {selected && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
      </span>
      <span className="text-[13px] leading-snug text-ink-dim">{description}</span>
    </button>
  );

  if (disabled && disabledReason !== undefined) {
    return <Tip label={disabledReason}>{card}</Tip>;
  }
  return card;
}
