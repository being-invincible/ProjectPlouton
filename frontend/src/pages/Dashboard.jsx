import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Target,
  Activity, BarChart3, ArrowUpRight, ArrowDownRight, ArrowLeftRight,
} from 'lucide-react';
import api from '../lib/api';
import { formatCurrency, formatPnL, formatPercent, formatDateTime } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCard } from '../components/ui/StatCard';
import { SkeletonCard, SkeletonChart, SkeletonTable } from '../components/ui/Skeleton';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      borderRadius: '12px',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(15,23,42,0.95)',
      backdropFilter: 'blur(16px)',
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>{label}</p>
      <p style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9', fontFamily: 'JetBrains Mono, monospace' }}>
        ${payload[0].value.toFixed(2)}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const [botState, setBotState] = useState(null);
  const [trades, setTrades] = useState([]);
  const [pnlData, setPnlData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    // Poll every 30s instead of PocketBase realtime
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    try {
      const state = await api.getBotState();
      if (state && Object.keys(state).length > 0) setBotState(state);

      const allTrades = await api.getTrades(200);
      setTrades(Array.isArray(allTrades) ? allTrades.slice(0, 10) : []);

      // Build cumulative P&L from closed trades
      const closedTrades = (Array.isArray(allTrades) ? allTrades : [])
        .filter(t => t.status === 'CLOSED')
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      let cumPnl = 0;
      const chartData = closedTrades.map((t) => {
        cumPnl += t.pnl || 0;
        return {
          date: new Date(t.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          pnl: parseFloat(cumPnl.toFixed(2)),
        };
      });
      setPnlData(chartData);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div>
          <div style={{ height: '32px', width: '192px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', marginBottom: '8px' }} />
          <div style={{ height: '16px', width: '256px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <Card><CardContent><SkeletonChart className="h-[300px]" /></CardContent></Card>
        <Card><CardContent><SkeletonTable rows={5} /></CardContent></Card>
      </div>
    );
  }

  const balance = botState?.balance ?? 500;
  const initialBalance = botState?.initial_balance ?? 500;
  const totalPnl = balance - initialBalance;
  const winRate = botState?.total_trades
    ? ((botState.winning_trades || 0) / botState.total_trades * 100)
    : 0;
  const pnlFormatted = formatPnL(totalPnl);
  const dailyPnl = formatPnL(botState?.daily_pnl ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Stats Grid — 4 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <StatCard
          icon={DollarSign}
          label="Balance"
          value={formatCurrency(balance)}
          color="#3b82f6"
          highlighted
          subValue={{ text: 'Paper trading', color: '#3b82f6' }}
          delay={0.05}
        />
        <StatCard
          icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
          label="Total P&L"
          value={pnlFormatted.text}
          subValue={{
            text: formatPercent(totalPnl / initialBalance * 100),
            color: totalPnl >= 0 ? '#10b981' : '#ef4444',
          }}
          color={totalPnl >= 0 ? '#10b981' : '#ef4444'}
          delay={0.1}
        />
        <StatCard
          icon={Target}
          label="Win Rate"
          value={formatPercent(winRate)}
          color="#a78bfa"
          subValue={{ text: `${botState?.winning_trades ?? 0} wins`, color: '#a78bfa' }}
          delay={0.15}
        />
        <StatCard
          icon={BarChart3}
          label="Total Trades"
          value={botState?.total_trades ?? 0}
          color="#f59e0b"
          subValue={{ text: 'All time', color: '#f59e0b' }}
          delay={0.2}
        />
      </div>

      {/* Second row: Today's P&L as a highlighted banner */}
      <div
        className="animate-fade-in"
        style={{
          animationDelay: '0.25s',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '20px 24px',
          borderRadius: '14px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <Activity style={{ width: '18px', height: '18px', color: botState?.daily_pnl >= 0 ? '#10b981' : '#ef4444' }} />
        <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Today's P&L</span>
        <span style={{
          fontSize: '18px',
          fontWeight: 700,
          fontFamily: 'JetBrains Mono, monospace',
          color: botState?.daily_pnl >= 0 ? '#10b981' : '#ef4444',
          marginLeft: '4px',
        }}>
          {dailyPnl.text}
        </span>
      </div>

      {/* P&L Chart */}
      <Card className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
        <CardHeader>
          <CardTitle icon={TrendingUp} iconColor="#3b82f6">
            Cumulative P&L
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pnlData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={pnlData}>
                <defs>
                  <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#475569', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.04)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#475569', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="pnl"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#pnlGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#3b82f6', stroke: '#0f172a', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '200px', gap: '14px',
            }}>
              <div style={{
                width: '52px', height: '52px', borderRadius: '16px',
                background: 'rgba(59,130,246,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <BarChart3 style={{ width: '24px', height: '24px', color: 'rgba(59,130,246,0.5)' }} />
              </div>
              <p style={{ fontSize: '13px', color: '#475569' }}>
                No trades yet. Start the bot to see P&L data.
              </p>
              <Link to="/settings" style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 600, textDecoration: 'none' }}>
                Configure strategy →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Trades */}
      <Card className="animate-fade-in" style={{ animationDelay: '0.2s' }}>
        <CardHeader>
          <CardTitle icon={ArrowLeftRight} iconColor="#a78bfa">
            Recent Trades
          </CardTitle>
          <Link
            to="/trades"
            style={{ fontSize: '12px', fontWeight: 600, color: '#3b82f6', textDecoration: 'none', transition: 'color 0.2s' }}
          >
            View all →
          </Link>
        </CardHeader>
        <CardContent style={{ padding: '0' }}>
          {trades.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {['Time', 'Direction', 'Entry', 'Exit', 'P&L', 'Status'].map(h => (
                      <th key={h} style={{
                        padding: '14px 16px',
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: '#475569',
                        textAlign: ['Entry', 'Exit', 'P&L'].includes(h) ? 'right' : h === 'Status' ? 'center' : 'left',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => {
                    const pnl = formatPnL(trade.pnl);
                    return (
                      <tr key={trade.id || i}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.03)',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                          background: i % 2 === 1 ? 'rgba(255,255,255,0.01)' : 'transparent',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? 'rgba(255,255,255,0.01)' : 'transparent'}
                        onClick={() => window.location.href = `/trades/${trade.id}`}
                      >
                        <td style={{ padding: '18px 20px', color: '#94a3b8' }}>{formatDateTime(trade.timestamp)}</td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {trade.direction === 'LONG' ? (
                              <ArrowUpRight style={{ width: '14px', height: '14px', color: '#10b981' }} />
                            ) : (
                              <ArrowDownRight style={{ width: '14px', height: '14px', color: '#ef4444' }} />
                            )}
                            <span style={{
                              fontSize: '13px', fontWeight: 600,
                              color: trade.direction === 'LONG' ? '#10b981' : '#ef4444',
                            }}>
                              {trade.direction}
                            </span>
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0' }}>
                          {formatCurrency(trade.entry_price)}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>
                          {trade.exit_price ? formatCurrency(trade.exit_price) : '—'}
                        </td>
                        <td style={{
                          padding: '14px 16px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                          color: trade.pnl > 0 ? '#10b981' : trade.pnl < 0 ? '#ef4444' : '#94a3b8',
                        }}>
                          {trade.status === 'CLOSED' ? pnl.text : '—'}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          <Badge
                            variant={trade.status === 'OPEN' ? 'info' : trade.pnl > 0 ? 'success' : 'danger'}
                            dot
                          >
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
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '160px', gap: '14px', padding: '0 0 24px',
            }}>
              <div style={{
                width: '52px', height: '52px', borderRadius: '16px',
                background: 'rgba(139,92,246,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ArrowLeftRight style={{ width: '24px', height: '24px', color: 'rgba(139,92,246,0.5)' }} />
              </div>
              <p style={{ fontSize: '13px', color: '#475569' }}>
                No trades yet. The bot will populate this when it starts trading.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
