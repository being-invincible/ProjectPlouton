import { cn } from '../../lib/utils';

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        'rounded-xl bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]',
        'bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]',
        className
      )}
      {...props}
    />
  );
}

export function SkeletonCard({ className }) {
  return (
    <div className={cn('rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5', className)}>
      <Skeleton className="h-4 w-24 mb-3" />
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 border-b border-white/[0.06]">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-4 border-b border-white/[0.04]">
          {[...Array(6)].map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ className }) {
  return (
    <div className={cn('flex items-end gap-1 px-4', className)}>
      {[40, 55, 35, 65, 45, 70, 50, 60, 75, 55, 45, 65, 80, 60, 70, 50, 85, 65, 55, 75].map((h, i) => (
        <Skeleton
          key={i}
          className="flex-1 rounded-sm"
          style={{ height: `${h}%`, animationDelay: `${i * 0.05}s` }}
        />
      ))}
    </div>
  );
}
