import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none',
    'rounded-(--radius-control) font-medium transition-colors duration-100',
    'disabled:pointer-events-none disabled:opacity-45',
    'focus-visible:outline focus-visible:outline-accent focus-visible:outline-offset-1',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        solid: 'bg-accent text-accent-ink hover:bg-accent-hover active:translate-y-px',
        outline:
          'border border-hairline-strong bg-transparent text-ink hover:border-accent/60 hover:text-accent',
        ghost: 'text-ink-dim hover:bg-surface-3 hover:text-ink',
        danger:
          'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 hover:border-danger/70',
        link: 'text-accent underline-offset-4 hover:underline px-0',
      },
      size: {
        xs: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4 text-sm',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'outline', size: 'sm' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
