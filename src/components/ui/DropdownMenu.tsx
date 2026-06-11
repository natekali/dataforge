import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuSeparator = () => (
  <DropdownPrimitive.Separator className="my-1 h-px bg-hairline" />
);

export function DropdownMenuContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={4}
        align="end"
        className={cn(
          'z-50 min-w-44 panel bg-surface-2 py-1 shadow-xl shadow-black/40',
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2 px-3 py-2 text-[13px] outline-none',
        '[&_svg]:size-4 [&_svg]:text-ink-faint',
        destructive
          ? 'text-danger data-[highlighted]:bg-danger/10 [&_svg]:text-danger'
          : 'text-ink-dim data-[highlighted]:bg-surface-3 data-[highlighted]:text-ink',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="tech-label px-3 pb-1 pt-2">{children}</div>;
}
