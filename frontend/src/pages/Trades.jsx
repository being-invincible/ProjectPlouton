import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, ArrowDownRight, Filter,
  ChevronLeft, ChevronRight, ArrowLeftRight, Layers,
} from 'lucide-react';
import api from '../lib/api';
import { formatCurrency, formatPnL, formatDateTime } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Input';
import { SkeletonTable } from '../components/ui/Skeleton';

const TYPE_STYLES = {
  paper:     { bg: 'rgba(59,130,246,0.12)',  color: '#60a5fa', label: 'Paper' },
  live:      { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', label: 'Live' },
  backtest:  { bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24', label: 'Backtest' },
};

function TradeTypePill({ type }) {
  const s = TYPE_STYLES[type] || TYPE_STYLES.paper;
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '5px',
      background: s.bg, color: s.color, letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  );
}


export default function Trades() {
  const [trades, setTrades] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', direction: '', trade_type: '' });
  const perPage = 20;

  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, 30000);
    return () => clearInterval(interval);
  }, [page, filter]);

  async function fetchTrades() {
    try {
      setLoading(true);
      const allTrades = await api.getTrades(200, filter.status || null);
      let filtered = Array.isArray(allTrades) ? allTrades : [];
      if (filter.direction) filtered = filtered.filter(t => t.direction === filter.direction);
      if (filter.trade_type) filtered = filtered.filter(t => (t.trade_type || 'paper') === filter.trade_type);
      setTotalPages(Math.ceil(filtered.length / perPage) || 1);
      const start = (page - 1) * perPage;
      setTrades(filtered.slice(start, start + perPage));
    } catch (err) {
      console.error('Failed to fetch trades:', err);
    } finally {
      setLoading(false);
    }
  }

  // Open positions summary
  const openTrades = trades.filter(t => t.status === 'OPEN');
  const totalMarginDeployed = openTrades.reduce((s, t) => s + parseFloat(t.initial_margin || 0), 0);
  const totalNotional = openTrades.reduce((s, t) => s + parseFloat(t.notional || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Open positions capital summary — only when there are open trades */}
      {openTrades.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(openTrades.length + 1, 4)}, 1fr)`,
          gap: 12,
        }}>
          {/* Total deployed */}
          <Card hover={false} style={{ background: 'rgba(59,130,246,0.04)', borderColor: 'rgba(59,130,246,0.12)' }}>
            <CardContent style={{ padding: '16px 20px' }}>
              <p style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Capital Deployed
              </p>
              <p style={{ fontSize: 20, fontWeight: 700, color: '#60a5fa', fontFamily: 'JetBrains Mono, monospace' }}>
                ${totalMarginDeployed.toFixed(2)}
              </p>
              <p style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                ${Math.round(totalNotional).toLocaleString()} notional · {openTrades.length} position{openTrades.length !== 1 ? 's' : ''}
              </p>
            </CardContent>
          </Card>

          {/* Per open trade */}
          {openTrades.slice(0, 3).map(t => {
            const margin = parseFloat(t.initial_margin || 0);
            const notional = parseFloat(t.notional || 0);
            const lev = parseFloat(t.leverage || 1);
            const entry = parseFloat(t.entry_price || 0);
            const tp2 = parseFloat(t.tp2_price || 0);
            const tp1Hit = t.tp1_hit;
            return (
              <Link key={t.id} to={`/trades/${t.id}`} style={{ textDecoration: 'none' }}>
                <Card hover style={{ height: '100%', borderColor: tp1Hit ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)' }}>
                  <CardContent style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 14 }}>{t.instrument}</span>
                      {tp1Hit && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '1px 6px', borderRadius: 4 }}>
                          TP1 ✓ BE
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 19, fontWeight: 700, color: '#e2e8f0', fontFamily: 'JetBrains Mono, monospace' }}>
                      ${margin.toFixed(2)}
                    </p>
                    <p style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
                      margin · ${Math.round(notional).toLocaleString()} @ {lev.toFixed(0)}×
                    </p>
                    <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b' }}>
                      <span>Entry {formatCurrency(entry)}</span>
                      <span>TP2 {formatCurrency(tp2)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.05s' }}>
        <CardContent style={{ padding: '18px 28px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569' }}>
              <Filter style={{ width: '15px', height: '15px' }} />
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Filters</span>
            </div>
            <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.06)' }} />
            <Select style={{ width: 'auto', minWidth: '140px' }} value={filter.status}
              onChange={(e) => { setFilter(f => ({ ...f, status: e.target.value })); setPage(1); }}>
              <option value="">All Status</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
            </Select>
            <Select style={{ width: 'auto', minWidth: '150px' }} value={filter.direction}
              onChange={(e) => { setFilter(f => ({ ...f, direction: e.target.value })); setPage(1); }}>
              <option value="">All Directions</option>
              <option value="LONG">Long</option>
              <option value="SHORT">Short</option>
            </Select>
            <Select style={{ width: 'auto', minWidth: '150px' }} value={filter.trade_type}
              onChange={(e) => { setFilter(f => ({ ...f, trade_type: e.target.value })); setPage(1); }}>
              <option value="">All Types</option>
              <option value="paper">Paper Trade</option>
              <option value="live">Live Trade</option>
              <option value="backtest">Backtest</option>
            </Select>
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#475569' }}>
              Page {page} of {totalPages || 1}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.1s', overflow: 'hidden' }}>
        {loading ? (
          <CardContent style={{ padding: '0' }}>
            <SkeletonTable rows={8} />
          </CardContent>
        ) : trades.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '220px', gap: '14px',
          }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '16px',
              background: 'rgba(139,92,246,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ArrowLeftRight style={{ width: '24px', height: '24px', color: 'rgba(139,92,246,0.5)' }} />
            </div>
            <p style={{ fontSize: '13px', color: '#475569' }}>
              No trades found. Adjust your filters or start the bot.
            </p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.015)' }}>
                    {[
                      { label: 'Date & Time', align: 'left' },
                      { label: 'Instrument', align: 'left' },
                      { label: 'Type', align: 'left' },
                      { label: 'Direction', align: 'left' },
                      { label: 'Entry / Capital', align: 'right', hint: 'Entry price · margin invested · leverage' },
                      { label: 'Exit', align: 'right' },
                      { label: 'P&L', align: 'right' },
                      { label: 'Status', align: 'center' },
                    ].map((h, i) => (
                      <th key={h.label}
                        style={{
                          padding: '14px 16px',
                          fontSize: '10px', fontWeight: 600,
                          textTransform: 'uppercase', letterSpacing: '0.08em',
                          color: '#475569', textAlign: h.align,
                          paddingLeft: i === 0 ? '24px' : undefined,
                          whiteSpace: 'nowrap',
                        }}
                        title={h.hint || ''}
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => {
                    const pnl = formatPnL(trade.pnl);
                    const tradeType = trade.trade_type || 'paper';
                    const isBacktest = tradeType === 'backtest';
                    const isOpen = trade.status === 'OPEN';

                    const rowBg = isBacktest
                      ? 'rgba(251,191,36,0.03)'
                      : isOpen
                      ? 'rgba(59,130,246,0.04)'
                      : i % 2 === 1 ? 'rgba(255,255,255,0.012)' : 'transparent';

                    return (
                      <Link key={trade.id} to={`/trades/${trade.id}`} className="contents">
                        <tr
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            cursor: 'pointer',
                            transition: 'background 0.15s',
                            background: rowBg,
                            borderLeft: isBacktest
                              ? '2px solid rgba(251,191,36,0.3)'
                              : isOpen
                              ? '2px solid rgba(59,130,246,0.4)'
                              : '2px solid transparent',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                          onMouseLeave={e => e.currentTarget.style.background = rowBg}
                        >
                          {/* Date */}
                          <td style={{ padding: '16px', paddingLeft: '24px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                            {formatDateTime(trade.timestamp)}
                          </td>

                          {/* Instrument */}
                          <td style={{ padding: '16px', fontWeight: 600, color: '#e2e8f0' }}>
                            {trade.instrument}
                          </td>

                          {/* Type */}
                          <td style={{ padding: '16px' }}>
                            <TradeTypePill type={tradeType} />
                          </td>

                          {/* Direction */}
                          <td style={{ padding: '16px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              {trade.direction === 'LONG'
                                ? <ArrowUpRight style={{ width: '14px', height: '14px', color: '#10b981' }} />
                                : <ArrowDownRight style={{ width: '14px', height: '14px', color: '#ef4444' }} />}
                              <span style={{ fontSize: 13, fontWeight: 600,
                                color: trade.direction === 'LONG' ? '#10b981' : '#ef4444' }}>
                                {trade.direction}
                              </span>
                            </span>
                          </td>

                          {/* Entry + Capital */}
                          <td style={{ padding: '16px', textAlign: 'right' }}>
                            <div style={{ fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0', fontWeight: 600 }}>
                              {formatCurrency(trade.entry_price)}
                            </div>
                            {parseFloat(trade.initial_margin || 0) > 0 && (
                              <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                                <span style={{ color: '#94a3b8', fontWeight: 500 }}>
                                  ${parseFloat(trade.initial_margin).toFixed(2)}
                                </span>
                                {trade.leverage > 1 && (
                                  <span style={{ color: '#475569' }}> · {parseFloat(trade.leverage).toFixed(0)}×</span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Exit */}
                          <td style={{ padding: '16px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>
                            {trade.exit_price ? formatCurrency(trade.exit_price) : (
                              isOpen ? (
                                <Badge variant="info" dot style={{ fontSize: 10 }}>Live</Badge>
                              ) : '—'
                            )}
                          </td>

                          {/* P&L */}
                          <td style={{
                            padding: '16px', textAlign: 'right',
                            fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                            color: trade.pnl > 0 ? '#10b981' : trade.pnl < 0 ? '#ef4444' : '#94a3b8',
                          }}>
                            {trade.status === 'CLOSED' ? pnl.text : '—'}
                          </td>

                          {/* Status */}
                          <td style={{ padding: '16px', textAlign: 'center' }}>
                            <Badge
                              variant={isOpen ? 'info' : trade.pnl > 0 ? 'success' : 'danger'}
                              dot
                            >
                              {isOpen
                                ? (trade.tp1_hit ? 'BE' : 'Open')
                                : trade.pnl > 0 ? 'Win' : 'Loss'}
                            </Badge>
                          </td>
                        </tr>
                      </Link>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 28px', borderTop: '1px solid rgba(255,255,255,0.05)',
              }}>
                <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft className="w-4 h-4" /> Previous
                </Button>
                <span style={{ fontSize: '12px', color: '#475569' }}>Page {page} of {totalPages}</span>
                <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
