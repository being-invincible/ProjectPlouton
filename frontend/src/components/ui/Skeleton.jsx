import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-lg bg-muted", className)}
      {...props}
    />
  );
}

function SkeletonTable({ rows = 5 }) {
  return (
    <div style={{ padding: '8px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
          <Skeleton style={{ height: '20px', width: `${60 + (i % 3) * 15}%` }} />
        </div>
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Skeleton style={{ height: '14px', width: '40%' }} />
      <Skeleton style={{ height: '32px', width: '60%' }} />
      <Skeleton style={{ height: '12px', width: '50%' }} />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Skeleton style={{ height: '14px', width: '30%' }} />
      <Skeleton style={{ height: '180px', width: '100%' }} />
    </div>
  );
}

export { Skeleton, SkeletonTable, SkeletonCard, SkeletonChart };
