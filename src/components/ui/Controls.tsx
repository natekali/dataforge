import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { Check, Minus } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export function Switch({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-hairline-strong bg-surface-3 transition-colors',
        'data-[state=checked]:border-ember-600 data-[state=checked]:bg-ember-600/40',
        'focus-visible:outline focus-visible:outline-accent disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-3.5 translate-x-0.5 rounded-full bg-ink-dim transition-transform',
          'data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-ember-400',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({
  className,
  indeterminate,
  ...props
}: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { indeterminate?: boolean }) {
  return (
    <CheckboxPrimitive.Root
      checked={indeterminate ? 'indeterminate' : props.checked}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-hairline-strong bg-surface-2',
        'data-[state=checked]:border-ember-600 data-[state=checked]:bg-ember-500 data-[state=checked]:text-accent-ink',
        'data-[state=indeterminate]:border-ember-600 data-[state=indeterminate]:text-ember-400',
        'focus-visible:outline focus-visible:outline-accent disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        {indeterminate ? <Minus className="size-3" /> : <Check className="size-3" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Progress({
  value,
  className,
  heat,
}: {
  value: number; // 0–1
  className?: string;
  /** Render the bar in ember accent (default) or steel info color. */
  heat?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <ProgressPrimitive.Root
      value={pct}
      className={cn(
        'relative h-1 w-full overflow-hidden rounded-full bg-surface-3',
        className,
      )}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full transition-transform duration-300',
          heat === false ? 'bg-info' : 'bg-ember-500',
        )}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-[1.5px] border-hairline-strong border-t-ember-500',
        className,
      )}
    />
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-hairline bg-surface-3 px-1 py-px font-mono text-[11px] text-ink-dim">
      {children}
    </kbd>
  );
}
