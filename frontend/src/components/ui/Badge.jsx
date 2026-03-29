import { cn } from '../../lib/utils';

const variants = {
  success: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
    border: 'border-emerald-500/20',
  },
  danger: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    dot: 'bg-red-400',
    border: 'border-red-500/20',
  },
  warning: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
    border: 'border-amber-500/20',
  },
  info: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
    border: 'border-blue-500/20',
  },
  purple: {
    bg: 'bg-violet-500/10',
    text: 'text-violet-400',
    dot: 'bg-violet-400',
    border: 'border-violet-500/20',
  },
  secondary: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-400',
    dot: 'bg-slate-400',
    border: 'border-slate-500/20',
  },
};

export function Badge({ variant = 'info', dot = false, pulse = false, className, children, ...props }) {
  const v = variants[variant] || variants.info;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide border',
        v.bg, v.text, v.border,
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            v.dot,
            pulse && 'animate-pulse'
          )}
        />
      )}
      {children}
    </span>
  );
}
