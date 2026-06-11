import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const fieldClasses = [
  'w-full rounded-(--radius-control) border border-hairline bg-surface-2 px-2.5 text-[13px] text-ink',
  'placeholder:text-ink-faint transition-colors duration-100',
  'hover:border-hairline-strong focus:border-accent/70 focus:outline-none',
  'disabled:opacity-45 disabled:pointer-events-none',
].join(' ');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldClasses, 'h-8', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldClasses, 'min-h-20 py-2 leading-relaxed resize-y', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1 block text-xs font-medium text-ink-dim', className)}
      {...props}
    />
  );
}
