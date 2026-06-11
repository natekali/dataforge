import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex items-center gap-0.5 rounded-(--radius-control) border border-hairline bg-surface-2 p-0.5',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'rounded-[3px] px-3 py-1.5 text-[13px] font-medium text-ink-dim transition-colors',
        'hover:text-ink data-[state=active]:bg-surface-3 data-[state=active]:text-accent',
        'focus-visible:outline focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  );
}
