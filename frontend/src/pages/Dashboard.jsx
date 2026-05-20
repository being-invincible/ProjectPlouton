import { useState, useEffect } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Target,
  Activity, BarChart3, ArrowUpRight, ArrowDownRight, ArrowLeftRight,
  Radio, Zap,
} from 'lucide-react';
import api from '../lib/api';
import { formatCurrency, formatPnL, formatPercent, formatDateTime } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCard } from '../components/ui/StatCard';
import { SkeletonCard, SkeletonChart, SkeletonTable } from '../components/ui/Skeleton';

const COIN_COLORS = {
  BTC: '#f7931a', ETH: '#627eea', SOL: '#9945ff',
  XRP: '#346aa9', BNB: '#f3ba2f', SUI: '#4ca3ff',
  TAO: '#7affd4', LINK: '#2a5ada', HYPE: '#e91e8c', ADA: '#0033ad',
};

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(16px)',
      padding: '10px 14px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>{label}</p>
      <p style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9', fontFamily: 'JetBrains Mono, monospace' }}>
        ${payload[0].value.toFixed(2)}
      </p>
    </div>
  );
}

function CoinPill({ coin }) {
  const color = COIN_COLORS[coin.coin] || '#64748b';
  return (
    <Link
      to={`/chart?coin=${coin.coin}`}
      style={{
        display: 'flex', alignItems: 'center', gap: '7px',
        padding: '5px 11px', borderRadius: '8px', flexShrink: 0,
        background: coin.has_data ? `rgba(${hexToRgb(color)}, 0.08)` : 'rgba(255,255,255,0.03)',
        border: coin.has_data ? `1px solid rgba(${hexToRgb(color)}, 0.18)` : '1px solid rgba(255,255,255,0.05)',
        textDecoration: 'none', transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >
      <span style={{
        width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0,
        background: coin.has_data ? color : '#334155',
        boxShadow: coin.has_data ? `0 0 5px rgba(${hexToRgb(color)}, 0.6)` : 'none',
      }} />
      <span style={{ fontSize: '11px', fontWeight: 700, color: coin.has_data ? color : '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
        {coin.coin}
      </span>
      {coin.signal_count > 0 && (
        <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
          {coin.signal_count}
        </span>
      )}
    </Link>
  );
}

const TYPE_LABELS = { paper: 'paper trades', live: 'live trades', backtest: 'backtests' };

export default function Dashboard() {
  const { tradeType } = useOutletContext();
  const [botState, setBotState] = useState(null);
  const [trades, setTrades] = useState([]);
  const [monitorData, setMonitorData] = useState([]);
  const [totalSignals, setTotalSignals] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    try {
      const [state, allTrades, monitor, signals] = await Promise.all([
        api.getBotState(),
        api.getTrades(200),
        api.getMonitor(),
        api.getSignals(500),
      ]);

      if (state && Object.keys(state).length > 0) setBotState(state);
      setTrades(Array.isArray(allTrades) ? allTrades : []);
      if (Array.isArray(monitor)) setMonitorData(monitor);
      if (Array.isArray(signals)) setTotalSignals(signals.length);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
          {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <Card><CardContent><SkeletonChart /></CardContent></Card>
          <Card><CardContent><SkeletonTable rows={6} /></CardContent></Card>
        </div>
      </div>
    );
  }

  const balance = botState?.balance ?? 200;
  const initialBalance = botState?.initial_balance ?? 200;
  const activeCoins = monitorData.filter(c => c.has_data).length;

  // All stats scoped to selected trade type
  const typedTrades = trades.filter(t => (t.trade_type || 'paper') === tradeType);
  const typedClosed = typedTrades.filter(t => t.status === 'CLOSED');
  const typedWins = typedClosed.filter(t => (t.pnl || 0) > 0).length;
  const typedTotalPnl = typedClosed.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const typedWinRate = typedClosed.length ? (typedWins / typedClosed.length) * 100 : 0;

  const pnlFormatted = formatPnL(typedTotalPnl);
  const dailyPnl = formatPnL(botState?.daily_pnl ?? 0);

  // Recent trades list (capped at 15)
  const filteredTrades = typedTrades.slice(0, 15);

  // P&L chart — cumulative over time, closed trades only
  const closedSorted = [...typedClosed].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let cumPnl = 0;
  const pnlData = closedSorted.map(t => {
    cumPnl += t.pnl || 0;
    return {
      date: new Date(t.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      pnl: parseFloat(cumPnl.toFixed(2)),
    };
  });

  const typeLabel = TYPE_LABELS[tradeType] || 'trades';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* KPI row — 5 cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '14px' }}>
        <StatCard
          icon={DollarSign}
          label="Balance"
          value={formatCurrency(balance)}
          color="#3b82f6"
          highlighted
          subValue={{ text: 'Paper trading', color: '#3b82f6' }}
          delay={0.04}
        />
        <StatCard
          icon={typedTotalPnl >= 0 ? TrendingUp : TrendingDown}
          label="Total P&L"
          value={pnlFormatted.text}
          subValue={{ text: formatPercent(typedTotalPnl / initialBalance * 100), color: typedTotalPnl >= 0 ? '#10b981' : '#ef4444' }}
          color={typedTotalPnl >= 0 ? '#10b981' : '#ef4444'}
          delay={0.08}
        />
        <StatCard
          icon={Target}
          label="Win Rate"
          value={formatPercent(typedWinRate)}
          color="#a78bfa"
          subValue={{ text: `${typedWins} wins`, color: '#a78bfa' }}
          delay={0.12}
        />
        <StatCard
          icon={BarChart3}
          label="Total Trades"
          value={typedTrades.length}
          color="#f59e0b"
          subValue={{ text: `${typedClosed.length} closed`, color: '#f59e0b' }}
          delay={0.16}
        />
        <StatCard
          icon={Zap}
          label="Signals"
          value={totalSignals}
          color="#ec4899"
          subValue={{ text: `${activeCoins}/${monitorData.length} coins live`, color: '#ec4899' }}
          delay={0.20}
        />
      </div>

      {/* Status row: Today P&L + Monitoring strip */}
      <div className="animate-fade-in" style={{
        animationDelay: '0.22s',
        display: 'flex', alignItems: 'center', gap: '16px',
        padding: '14px 20px', borderRadius: '12px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
      }}>
        {/* Today P&L */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <Activity style={{ width: '14px', height: '14px', color: botState?.daily_pnl >= 0 ? '#10b981' : '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: '#475569', fontWeight: 500 }}>Today</span>
          <span style={{
            fontSize: '16px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
            color: botState?.daily_pnl >= 0 ? '#10b981' : '#ef4444', letterSpacing: '-0.02em',
          }}>
            {dailyPnl.text}
          </span>
        </div>

        <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />

        {/* Monitoring coins strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <Radio style={{ width: '12px', height: '12px', color: '#3b82f6' }} />
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#3b82f6' }}>
              {monitorData.length > 0 ? `${activeCoins}/${monitorData.length}` : '—'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '1px', minWidth: 0 }}>
            {monitorData.length > 0
              ? monitorData.map(c => <CoinPill key={c.coin} coin={c} />)
              : <span style={{ fontSize: '11px', color: '#475569' }}>start bot to activate</span>
            }
          </div>
        </div>

        <Link to="/monitor" style={{ fontSize: '11px', color: '#3b82f6', fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
          Monitor →
        </Link>
      </div>

      {/* Main content: P&L chart + Trades side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '42% 58%', gap: '16px', alignItems: 'start' }}>

        {/* P&L Chart */}
        <Card className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
          <CardHeader>
            <CardTitle icon={TrendingUp} iconColor="#3b82f6">Cumulative P&L</CardTitle>
          </CardHeader>
          <CardContent>
            {pnlData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={pnlData}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.04)' }} tickLine={false} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="pnl" stroke="#3b82f6" strokeWidth={2} fill="url(#pnlGrad)" dot={false}
                    activeDot={{ r: 4, fill: '#3b82f6', stroke: '#0f172a', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '320px', gap: '12px' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(59,130,246,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <BarChart3 style={{ width: '20px', height: '20px', color: 'rgba(59,130,246,0.4)' }} />
                </div>
                <p style={{ fontSize: '12px', color: '#475569' }}>No closed trades yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Trades */}
        <Card className="animate-fade-in" style={{ animationDelay: '0.18s' }}>
          <CardHeader>
            <CardTitle icon={ArrowLeftRight} iconColor="#a78bfa">Recent Trades</CardTitle>
            <Link to="/trades" style={{ fontSize: '12px', fontWeight: 600, color: '#3b82f6', textDecoration: 'none' }}>
              View all →
            </Link>
          </CardHeader>
          <CardContent style={{ padding: 0 }}>
            {filteredTrades.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      {['Coin', 'Dir', 'Entry', 'Exit', 'P&L', 'Status'].map(h => (
                        <th key={h} style={{
                          padding: '10px 14px', fontSize: '10px', fontWeight: 600,
                          textTransform: 'uppercase', letterSpacing: '0.07em', color: '#475569',
                          textAlign: ['Entry', 'Exit', 'P&L'].includes(h) ? 'right' : h === 'Status' ? 'center' : 'left',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map((trade, i) => {
                      const pnl = formatPnL(trade.pnl);
                      const coinColor = COIN_COLORS[trade.instrument] || '#64748b';
                      return (
                        <tr key={trade.id || i}
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer', transition: 'background 0.12s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          onClick={() => window.location.href = `/trades/${trade.id}`}
                        >
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 700, color: coinColor, fontFamily: 'JetBrains Mono, monospace' }}>
                              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: coinColor, flexShrink: 0 }} />
                              {trade.instrument || '—'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {trade.direction === 'LONG'
                                ? <ArrowUpRight style={{ width: '12px', height: '12px', color: '#10b981' }} />
                                : <ArrowDownRight style={{ width: '12px', height: '12px', color: '#ef4444' }} />}
                              <span style={{ fontSize: '11px', fontWeight: 600, color: trade.direction === 'LONG' ? '#10b981' : '#ef4444' }}>
                                {trade.direction}
                              </span>
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0', fontSize: '11px' }}>
                            {formatCurrency(trade.entry_price)}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8', fontSize: '11px' }}>
                            {trade.exit_price ? formatCurrency(trade.exit_price) : '—'}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: '11px', color: trade.pnl > 0 ? '#10b981' : trade.pnl < 0 ? '#ef4444' : '#94a3b8' }}>
                            {trade.status === 'CLOSED' ? pnl.text : '—'}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                            <Badge variant={trade.status === 'OPEN' ? 'info' : trade.pnl > 0 ? 'success' : 'danger'} dot>
                              {trade.status === 'OPEN' ? 'Open' : trade.pnl > 0 ? 'Win' : 'Loss'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '220px', gap: '12px' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(139,92,246,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ArrowLeftRight style={{ width: '20px', height: '20px', color: 'rgba(139,92,246,0.4)' }} />
                </div>
                <p style={{ fontSize: '12px', color: '#475569' }}>No {typeLabel} yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
