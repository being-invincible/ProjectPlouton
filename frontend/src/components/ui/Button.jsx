import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/85 shadow-[0_0_20px_rgba(59,130,246,0.18)]",
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/85 shadow-[0_0_20px_rgba(59,130,246,0.18)]",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20",
        danger:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20",
        success:
          "bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20 border border-[var(--success)]/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 gap-1 rounded-md px-2 text-xs",
        sm: "h-7 gap-1.5 rounded-md px-2.5 text-xs",
        default: "h-8 gap-2 px-3",
        md: "h-8 gap-2 px-3",
        lg: "h-9 gap-2 px-4",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled = false,
  children,
  ...props
}) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </ButtonPrimitive>
  );
}

export { buttonVariants };
