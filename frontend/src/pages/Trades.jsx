import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, ArrowDownRight, Filter,
  ChevronLeft, ChevronRight, ArrowLeftRight,
} from 'lucide-react';
import api from '../lib/api';
import { formatCurrency, formatPnL, formatDateTime } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Input';
import { SkeletonTable } from '../components/ui/Skeleton';

export default function Trades() {
  const [trades, setTrades] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', direction: '' });
  const perPage = 20;

  useEffect(() => {
    fetchTrades();
    // Poll every 30s
    const interval = setInterval(fetchTrades, 30000);
    return () => clearInterval(interval);
  }, [page, filter]);

  async function fetchTrades() {
    try {
      setLoading(true);
      const allTrades = await api.getTrades(200, filter.status || null);
      let filtered = Array.isArray(allTrades) ? allTrades : [];
      if (filter.direction) {
        filtered = filtered.filter(t => t.direction === filter.direction);
      }
      setTotalPages(Math.ceil(filtered.length / perPage) || 1);
      const start = (page - 1) * perPage;
      setTrades(filtered.slice(start, start + perPage));
    } catch (err) {
      console.error('Failed to fetch trades:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Filters */}
      <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.05s' }}>
        <CardContent style={{ paddingTop: '20px', paddingBottom: '20px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569' }}>
              <Filter style={{ width: '15px', height: '15px' }} />
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Filters</span>
            </div>

            <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.06)' }} />

            <Select
              style={{ width: 'auto', minWidth: '140px' }}
              value={filter.status}
              onChange={(e) => { setFilter(f => ({ ...f, status: e.target.value })); setPage(1); }}
            >
              <option value="">All Status</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>

            <Select
              style={{ width: 'auto', minWidth: '150px' }}
              value={filter.direction}
              onChange={(e) => { setFilter(f => ({ ...f, direction: e.target.value })); setPage(1); }}
            >
              <option value="">All Directions</option>
              <option value="LONG">Long</option>
              <option value="SHORT">Short</option>
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
                    {['Date & Time', 'Instrument', 'Direction', 'Entry Price', 'Exit Price', 'P&L', 'Status', 'Strategy'].map((h, i) => (
                      <th key={h}
                        style={{
                          padding: '18px 20px',
                          fontSize: '10px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          color: '#475569',
                          textAlign: ['Entry Price', 'Exit Price', 'P&L'].includes(h) ? 'right' :
                            h === 'Status' ? 'center' : 'left',
                          paddingLeft: i === 0 ? '24px' : undefined,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => {
                    const pnl = formatPnL(trade.pnl);
                    return (
                      <Link key={trade.id} to={`/trades/${trade.id}`} className="contents">
                        <tr
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            cursor: 'pointer',
                            transition: 'background 0.15s',
                            background: i % 2 === 1 ? 'rgba(255,255,255,0.012)' : 'transparent',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.035)'}
                          onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? 'rgba(255,255,255,0.012)' : 'transparent'}
                        >
                          <td style={{ padding: '18px 20px', paddingLeft: '24px', color: '#94a3b8' }}>
                            {formatDateTime(trade.timestamp)}
                          </td>
                          <td style={{ padding: '18px 20px', fontWeight: 500, color: '#e2e8f0' }}>
                            {trade.instrument}
                          </td>
                          <td style={{ padding: '18px 20px' }}>
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
                          <td style={{ padding: '18px 20px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0' }}>
                            {formatCurrency(trade.entry_price)}
                          </td>
                          <td style={{ padding: '18px 20px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>
                            {trade.exit_price ? formatCurrency(trade.exit_price) : '—'}
                          </td>
                          <td style={{
                            padding: '18px 20px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                            color: trade.pnl > 0 ? '#10b981' : trade.pnl < 0 ? '#ef4444' : '#94a3b8',
                          }}>
                            {trade.status === 'CLOSED' ? pnl.text : '—'}
                          </td>
                          <td style={{ padding: '18px 20px', textAlign: 'center' }}>
                            <Badge
                              variant={trade.status === 'OPEN' ? 'info' : trade.pnl > 0 ? 'success' : 'danger'}
                              dot
                            >
                              {trade.status === 'OPEN' ? 'Open' :
                               trade.pnl > 0 ? 'Win' : 'Loss'}
                            </Badge>
                          </td>
                          <td style={{ padding: '18px 20px', color: '#475569' }}>
                            {trade.strategy_name || 'Fibonacci'}
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </Button>
                <span style={{ fontSize: '12px', color: '#475569' }}>
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
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
