import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Radio, TrendingUp, TrendingDown, BarChart3,
  Clock, Zap, Activity, RefreshCw, AlertCircle,
} from 'lucide-react';
import api from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCard } from '../components/ui/StatCard';

const COIN_COLORS = {
  BTC: '#f7931a', ETH: '#627eea', SOL: '#9945ff',
  XRP: '#346aa9', BNB: '#f3ba2f', SUI: '#4ca3ff',
  TAO: '#7affd4', LINK: '#2a5ada', HYPE: '#e91e8c', ADA: '#0033ad',
};

function timeSince(isoStr) {
  if (!isoStr) return null;
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function formatPrice(p) {
  if (p == null) return '—';
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}

function CoinCard({ coin, delay, onClick }) {
  const color = COIN_COLORS[coin.coin] || '#64748b';
  const scanAge = coin.last_scan ? (Date.now() - new Date(coin.last_scan).getTime()) / 1000 : null;
  const isRecent = scanAge != null && scanAge < 600;
  const hasSignal = coin.last_signal_time != null;

  return (
    <div
      className="animate-fade-in"
      onClick={onClick}
      style={{
        animationDelay: `${delay}s`,
        padding: '20px',
        borderRadius: '16px',
        background: coin.has_data
          ? `linear-gradient(145deg, rgba(${hexToRgb(color)}, 0.06) 0%, rgba(255,255,255,0.015) 100%)`
          : 'rgba(255,255,255,0.015)',
        border: coin.has_data
          ? `1px solid rgba(${hexToRgb(color)}, 0.2)`
          : '1px solid rgba(255,255,255,0.05)',
        position: 'relative', overflow: 'hidden',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = `0 8px 32px rgba(${hexToRgb(color)}, 0.18)`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Glow blob */}
      {coin.has_data && (
        <div style={{
          position: 'absolute', top: '-20px', right: '-20px',
          width: '80px', height: '80px', borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${hexToRgb(color)}, 0.12) 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Coin avatar */}
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: `rgba(${hexToRgb(color)}, 0.15)`,
            border: `1px solid rgba(${hexToRgb(color)}, 0.25)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', fontWeight: 800, color,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            {coin.coin.slice(0, 3)}
          </div>
          <div>
            <p style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>
              {coin.coin}
            </p>
            <p style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>
              Hyperliquid Perp
            </p>
          </div>
        </div>

        {/* Status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            display: 'inline-block',
            width: '7px', height: '7px', borderRadius: '50%',
            background: coin.has_data ? (isRecent ? '#10b981' : '#f59e0b') : '#334155',
            boxShadow: coin.has_data && isRecent ? '0 0 8px #10b98180' : 'none',
          }} />
          <span style={{
            fontSize: '10px', fontWeight: 600,
            color: coin.has_data ? (isRecent ? '#10b981' : '#f59e0b') : '#475569',
          }}>
            {coin.has_data ? (isRecent ? 'Live' : 'Stale') : 'No data'}
          </span>
        </div>
      </div>

      {/* Price */}
      <p style={{
        fontSize: '20px', fontWeight: 700,
        fontFamily: 'JetBrains Mono, monospace',
        color: coin.has_data ? '#f1f5f9' : '#334155',
        letterSpacing: '-0.03em', marginBottom: '12px',
      }}>
        {formatPrice(coin.last_price)}
      </p>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {/* Candles */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '4px 8px', borderRadius: '6px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <BarChart3 style={{ width: '11px', height: '11px', color: '#64748b' }} />
          <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
            {coin.candle_count.toLocaleString()}
          </span>
        </div>

        {/* Signals */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '4px 8px', borderRadius: '6px',
          background: hasSignal ? `rgba(${hexToRgb(color)}, 0.08)` : 'rgba(255,255,255,0.04)',
          border: hasSignal ? `1px solid rgba(${hexToRgb(color)}, 0.15)` : '1px solid rgba(255,255,255,0.06)',
        }}>
          <Zap style={{ width: '11px', height: '11px', color: hasSignal ? color : '#64748b' }} />
          <span style={{ fontSize: '11px', color: hasSignal ? color : '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
            {coin.signal_count} signals
          </span>
        </div>

        {/* Last signal direction */}
        {hasSignal && coin.last_signal_direction && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '4px 8px', borderRadius: '6px',
            background: coin.last_signal_direction === 'LONG'
              ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: coin.last_signal_direction === 'LONG'
              ? '1px solid rgba(16,185,129,0.15)' : '1px solid rgba(239,68,68,0.15)',
          }}>
            {coin.last_signal_direction === 'LONG'
              ? <TrendingUp style={{ width: '11px', height: '11px', color: '#10b981' }} />
              : <TrendingDown style={{ width: '11px', height: '11px', color: '#ef4444' }} />}
            <span style={{
              fontSize: '11px', fontWeight: 600,
              color: coin.last_signal_direction === 'LONG' ? '#10b981' : '#ef4444',
            }}>
              {coin.last_signal_direction}
            </span>
            {coin.last_signal_confidence != null && (
              <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '2px' }}>
                {coin.last_signal_confidence.toFixed(0)}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer: last scan time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '12px' }}>
        <Clock style={{ width: '12px', height: '12px', color: '#475569', flexShrink: 0 }} />
        <span style={{ fontSize: '11px', color: '#475569' }}>
          {coin.last_scan ? `Last scan ${timeSince(coin.last_scan)}` : 'Not yet scanned'}
        </span>
      </div>
    </div>
  );
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export default function Monitor() {
  const navigate = useNavigate();
  const [coins, setCoins] = useState([]);
  const [botState, setBotState] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    try {
      const [monitorData, state, rt] = await Promise.all([
        api.getMonitor(),
        api.getBotState(),
        api.getRuntime(),
      ]);
      if (Array.isArray(monitorData)) setCoins(monitorData);
      if (state && Object.keys(state).length > 0) setBotState(state);
      if (rt && Object.keys(rt).length > 0) setRuntime(rt);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Monitor fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }

  const totalCoins = coins.length;
  const activeCoins = coins.filter(c => c.has_data).length;
  const totalSignals = coins.reduce((s, c) => s + (c.signal_count || 0), 0);
  const totalCandles = coins.reduce((s, c) => s + (c.candle_count || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Header */}
      <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.025em' }}>
            Monitoring
          </h1>
          <p style={{ fontSize: '14px', color: '#475569', marginTop: '6px' }}>
            Live scan status for all {totalCoins} Hyperliquid perp coins
          </p>
        </div>
        <button
          onClick={fetchData}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 14px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#64748b', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#94a3b8'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#64748b'; }}
        >
          <RefreshCw style={{ width: '13px', height: '13px' }} />
          Refresh
        </button>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <StatCard
          icon={Radio}
          label="Monitored Coins"
          value={totalCoins}
          color="#3b82f6"
          highlighted
          subValue={{ text: 'Hyperliquid perps', color: '#3b82f6' }}
          delay={0.05}
        />
        <StatCard
          icon={Activity}
          label="With Data"
          value={activeCoins}
          color="#10b981"
          subValue={{ text: activeCoins === totalCoins ? 'All active' : `${totalCoins - activeCoins} pending`, color: activeCoins === totalCoins ? '#10b981' : '#f59e0b' }}
          delay={0.1}
        />
        <StatCard
          icon={Zap}
          label="Total Signals"
          value={totalSignals}
          color="#a78bfa"
          subValue={{ text: 'All time', color: '#a78bfa' }}
          delay={0.15}
        />
        <StatCard
          icon={BarChart3}
          label="Candles Stored"
          value={totalCandles >= 1000 ? `${(totalCandles / 1000).toFixed(1)}k` : totalCandles}
          color="#f59e0b"
          subValue={{ text: '5m timeframe', color: '#f59e0b' }}
          delay={0.2}
        />
      </div>

      {/* Bot alive banner */}
      {runtime && !runtime.bot_alive && (
        <div className="animate-fade-in" style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '16px 20px', borderRadius: '12px',
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.15)',
        }}>
          <AlertCircle style={{ width: '16px', height: '16px', color: '#ef4444', flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444' }}>Bot is not running</p>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
              Run <code style={{ fontFamily: 'JetBrains Mono, monospace', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: '4px' }}>python run.py</code> to start scanning.
              {runtime.heartbeat_age_sec != null && ` Last heartbeat ${runtime.heartbeat_age_sec}s ago.`}
            </p>
          </div>
        </div>
      )}

      {/* Coin grid */}
      {loading ? (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px',
        }}>
          {[...Array(10)].map((_, i) => (
            <div key={i} style={{
              height: '160px', borderRadius: '16px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.04)',
              animation: 'shimmer 1.5s ease-in-out infinite',
              backgroundSize: '200% 100%',
            }} />
          ))}
        </div>
      ) : coins.length === 0 ? (
        <Card>
          <CardContent>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '200px', gap: '14px',
            }}>
              <div style={{
                width: '52px', height: '52px', borderRadius: '16px',
                background: 'rgba(59,130,246,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Radio style={{ width: '24px', height: '24px', color: 'rgba(59,130,246,0.5)' }} />
              </div>
              <p style={{ fontSize: '13px', color: '#475569' }}>
                No coin data. Start the bot to begin scanning.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '16px',
        }}>
          {coins.map((coin, i) => (
            <CoinCard
              key={coin.coin}
              coin={coin}
              delay={0.03 * i}
              onClick={() => navigate(`/chart?coin=${coin.coin}`)}
            />
          ))}
        </div>
      )}

      {/* Last refresh */}
      {lastRefresh && (
        <p style={{ fontSize: '11px', color: '#334155', textAlign: 'center' }}>
          Updated {lastRefresh.toLocaleTimeString()} · auto-refreshes every 30s
        </p>
      )}
    </div>
  );
}
