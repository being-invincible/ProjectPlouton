import { useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function FibChart({ trade }) {
  if (!trade) {
    return <div style={{ padding: '20px', color: '#64748b' }}>No trade data</div>;
  }

  const {
    entry_price,
    tp1_price,
    tp2_price,
    sl_price,
    direction,
    high_price,
    low_price,
  } = trade;

  // Calculate Fibonacci levels
  const levels = useMemo(() => {
    if (!entry_price || !sl_price) return [];

    const isLong = direction === 'LONG';
    const range = Math.abs(entry_price - sl_price);
    
    const fib_levels = [
      { level: '0%', price: isLong ? entry_price : sl_price, color: '#64748b', label: 'Entry' },
      { level: '23.6%', price: isLong ? entry_price - (range * 0.236) : entry_price + (range * 0.236), color: '#3b82f6' },
      { level: '38.2%', price: isLong ? entry_price - (range * 0.382) : entry_price + (range * 0.382), color: '#06b6d4' },
      { level: '50%', price: isLong ? entry_price - (range * 0.5) : entry_price + (range * 0.5), color: '#8b5cf6' },
      { level: '61.8%', price: isLong ? entry_price - (range * 0.618) : entry_price + (range * 0.618), color: '#f59e0b' },
      { level: '78.6%', price: isLong ? entry_price - (range * 0.786) : entry_price + (range * 0.786), color: '#ef4444', label: 'SL' },
      { level: '100%', price: sl_price, color: '#ef4444', label: 'Stop Loss' },
    ];

    return fib_levels;
  }, [entry_price, sl_price, direction]);

  if (levels.length === 0) {
    return <div style={{ padding: '20px', color: '#64748b' }}>Unable to calculate Fibonacci levels</div>;
  }

  const min_price = Math.min(...levels.map(l => l.price), tp1_price || Infinity, tp2_price || Infinity, high_price || Infinity, low_price || Infinity);
  const max_price = Math.max(...levels.map(l => l.price), tp1_price || 0, tp2_price || 0, high_price || 0, low_price || 0);
  const range_display = max_price - min_price;
  const isLong = direction === 'LONG';

  return (
    <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: 8, padding: '16px', minHeight: 300 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Fibonacci levels visualization */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          {/* Chart area */}
          <div style={{ flex: 1, minHeight: 240 }}>
            <svg width="100%" height="240" style={{ background: 'rgba(15,23,42,0.6)', borderRadius: 6 }}>
              {/* Draw Fibonacci levels */}
              {levels.map((fib, idx) => {
                const y = 240 - ((fib.price - min_price) / range_display) * 240;
                return (
                  <g key={idx}>
                    <line
                      x1="40"
                      y1={y}
                      x2="100%"
                      y2={y}
                      stroke={fib.color}
                      strokeWidth="1"
                      strokeDasharray="4,4"
                      opacity="0.4"
                    />
                    <text
                      x="45"
                      y={y - 4}
                      fontSize="10"
                      fill={fib.color}
                      opacity="0.7"
                    >
                      {fib.level}
                    </text>
                  </g>
                );
              })}
              
              {/* Mark entry, TP1, TP2, SL */}
              {entry_price && (
                <circle cx="50%" cy={(240 - ((entry_price - min_price) / range_display) * 240)} r="4" fill="#10b981" opacity="0.8" />
              )}
              {tp1_price && (
                <circle cx="55%" cy={(240 - ((tp1_price - min_price) / range_display) * 240)} r="4" fill="#60a5fa" opacity="0.8" />
              )}
              {tp2_price && (
                <circle cx="60%" cy={(240 - ((tp2_price - min_price) / range_display) * 240)} r="4" fill="#3b82f6" opacity="0.8" />
              )}
              {sl_price && (
                <circle cx="45%" cy={(240 - ((sl_price - min_price) / range_display) * 240)} r="4" fill="#ef4444" opacity="0.8" />
              )}
            </svg>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', minWidth: '140px' }}>
            {entry_price && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981' }} />
                <span>Entry: <span style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>${entry_price.toFixed(2)}</span></span>
              </div>
            )}
            {tp1_price && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#60a5fa' }} />
                <span>TP1: <span style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>${tp1_price.toFixed(2)}</span></span>
              </div>
            )}
            {tp2_price && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#3b82f6' }} />
                <span>TP2: <span style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>${tp2_price.toFixed(2)}</span></span>
              </div>
            )}
            {sl_price && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }} />
                <span>SL: <span style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>${sl_price.toFixed(2)}</span></span>
              </div>
            )}
          </div>
        </div>

        {/* Direction & Range Info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '11px' }}>
          <div style={{ background: 'rgba(15,23,42,0.5)', padding: '10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', marginBottom: '4px' }}>
              {isLong ? <TrendingUp size={14} color="#10b981" /> : <TrendingDown size={14} color="#ef4444" />}
              <span>{isLong ? 'LONG' : 'SHORT'}</span>
            </div>
            <div style={{ color: '#cbd5e1', fontFamily: 'monospace', fontSize: '12px' }}>
              Range: ${range_display.toFixed(2)}
            </div>
          </div>
          <div style={{ background: 'rgba(15,23,42,0.5)', padding: '10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Risk:Reward</div>
            <div style={{ color: '#cbd5e1', fontFamily: 'monospace', fontSize: '12px' }}>
              {entry_price && tp1_price && sl_price
                ? `1:${((entry_price - tp1_price) / (entry_price - sl_price)).toFixed(2)}`
                : '—'
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
