import { cn } from '../../lib/utils';

export function InputField({ label, hint, accentColor, className, children }) {
  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className="flex items-center gap-2 text-[13px] font-medium text-slate-300">
          {accentColor && (
            <span
              className="w-0.5 h-3.5 rounded-full shrink-0"
              style={{ background: accentColor }}
            />
          )}
          {label}
        </label>
      )}
      {children}
      {hint && (
        <p className="text-[11px] text-slate-500 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'w-full px-3.5 py-3 rounded-xl text-[13px] font-mono',
        'bg-white/[0.035] border border-white/[0.08] text-slate-200 placeholder-slate-600',
        'transition-all duration-200',
        'focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.06] focus:ring-1 focus:ring-blue-500/20',
        'hover:border-white/[0.14] hover:bg-white/[0.045]',
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }) {
  return (
    <select
      className={cn(
        'w-full px-3.5 py-3 rounded-xl text-[13px]',
        'bg-white/[0.035] border border-white/[0.08] text-slate-200',
        'transition-all duration-200',
        'focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.06] focus:ring-1 focus:ring-blue-500/20',
        'hover:border-white/[0.14] hover:bg-white/[0.045]',
        'cursor-pointer appearance-none',
        '[background-image:url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%2712%27%20height%3D%2712%27%20viewBox%3D%270%200%2024%2024%27%20fill%3D%27none%27%20stroke%3D%27%2364748b%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%3E%3Cpath%20d%3D%27m6%209%206%206%206-6%27%2F%3E%3C%2Fsvg%3E")]',
        'bg-no-repeat bg-[right_12px_center]',
        'pr-10',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}
