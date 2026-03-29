import { cn } from '../../lib/utils';

export function StatCard({ icon: Icon, label, value, subValue, color, delay = 0, highlighted = false, className }) {
  return (
    <div
      className={cn(
        'group relative rounded-2xl flex flex-col justify-between',
        'transition-all duration-300 hover:-translate-y-0.5',
        'animate-fade-in',
        className
      )}
      style={{
        animationDelay: `${delay}s`,
        padding: '24px',
        minHeight: '152px',
        background: highlighted
          ? `linear-gradient(135deg, ${color}22, ${color}10)`
          : 'rgba(255,255,255,0.025)',
        border: highlighted
          ? `1px solid ${color}30`
          : '1px solid rgba(255,255,255,0.06)',
        boxShadow: highlighted
          ? `0 4px 24px ${color}15, inset 0 1px 0 ${color}12`
          : '0 2px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      {/* Top row: label + icon */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '13px',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: highlighted ? color : '#94a3b8',
        }}>
          {label}
        </span>
        {/* Colored icon container — from the old design */}
        <div
          className="flex items-center justify-center w-10 h-10 rounded-xl transition-transform duration-300 group-hover:scale-110"
          style={{
            background: `linear-gradient(135deg, ${color}20, ${color}08)`,
            border: `1px solid ${color}22`,
          }}
        >
          {Icon && <Icon className="w-[18px] h-[18px]" style={{ color }} />}
        </div>
      </div>

      {/* Big number */}
      <p style={{
        fontSize: '30px',
        fontWeight: 700,
        letterSpacing: '-0.03em',
        lineHeight: 1,
        color: '#f8fafc',
        marginTop: '16px',
      }}>
        {value}
      </p>

      {/* Sub-value badge */}
      <div style={{ marginTop: '14px' }}>
        {subValue && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11px',
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: '6px',
              color: subValue.color,
              background: `${subValue.color}15`,
            }}
          >
            {subValue.text}
          </span>
        )}
      </div>
    </div>
  );
}
