import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all",
  {
    variants: {
      variant: {
        default:    "bg-primary/10 text-primary border-primary/20",
        secondary:  "bg-white/[0.06] text-slate-400 border-white/[0.08]",
        success:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        danger:     "bg-red-500/10 text-red-400 border-red-500/20",
        destructive:"bg-red-500/10 text-red-400 border-red-500/20",
        info:       "bg-blue-500/10 text-blue-400 border-blue-500/20",
        warning:    "bg-amber-500/10 text-amber-400 border-amber-500/20",
        outline:    "border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({ className, variant = "default", dot = false, pulse = false, children, ...props }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className={cn("inline-block w-1.5 h-1.5 rounded-full bg-current flex-shrink-0", pulse && "animate-pulse")}
        />
      )}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
