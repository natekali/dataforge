import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const inputVariants = cva(
  "flex w-full rounded-lg text-sm transition-all duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-input bg-background/50 backdrop-blur-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-primary/50",
        ghost:
          "border-none bg-transparent focus-visible:bg-muted/50",
        filled:
          "border-none bg-muted/50 focus-visible:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring",
        glow:
          "border border-primary/30 bg-primary/5 focus-visible:border-primary focus-visible:shadow-glow-sm focus-visible:ring-0",
      },
      inputSize: {
        default: "h-10 px-3 py-2",
        sm: "h-9 px-2.5 py-1.5 text-xs",
        lg: "h-11 px-4 py-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      inputSize: "default",
    },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, inputSize, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant, inputSize }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input, inputVariants };
