import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

const variants = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)] hover:shadow-[0_0_28px_rgba(59,130,246,0.3)]',
  secondary:
    'bg-white/[0.06] text-slate-300 border border-white/[0.08] hover:bg-white/[0.1] hover:border-white/[0.14] hover:text-white',
  ghost:
    'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
  danger:
    'bg-red-600/90 text-white hover:bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.15)]',
  success:
    'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]',
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className,
  children,
  ...props
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-200 cursor-pointer',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}
