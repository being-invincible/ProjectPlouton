import { cn } from '../../lib/utils';

export function Card({ className, children, hover = true, ...props }) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border border-white/[0.06] bg-white/[0.025] backdrop-blur-xl overflow-hidden',
        'shadow-[0_4px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.03)]',
        hover && 'transition-all duration-300 hover:border-white/[0.1] hover:bg-white/[0.04] hover:shadow-[0_8px_40px_rgba(0,0,0,0.3)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-7 pt-6 pb-5 border-b border-white/[0.04]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, icon: Icon, iconColor, children, ...props }) {
  return (
    <h3
      className={cn('text-[14px] font-semibold tracking-tight flex items-center gap-3 text-slate-100', className)}
      {...props}
    >
      {Icon && (
        <span
          className="flex items-center justify-center w-9 h-9 rounded-xl"
          style={{ background: `${iconColor}15`, color: iconColor }}
        >
          <Icon className="w-4 h-4" />
        </span>
      )}
      {children}
    </h3>
  );
}

export function CardContent({ className, children, ...props }) {
  return (
    <div className={cn('px-7 pb-7 pt-5', className)} {...props}>
      {children}
    </div>
  );
}

export function CardDescription({ className, children }) {
  return (
    <p className={cn('text-[13px] text-slate-500 mt-1.5', className)}>
      {children}
    </p>
  );
}

export function Separator({ className }) {
  return (
    <div className={cn('h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent', className)} />
  );
}
