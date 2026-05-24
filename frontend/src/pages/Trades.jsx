import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, Plus, X, Filter } from 'lucide-react';
import api from '../lib/api';
import { formatCurrency, formatPnL, formatDateTime } from '../lib/utils';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { SkeletonTable } from '../components/ui/Skeleton';

const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'SUI', 'TAO', 'LINK', 'HYPE', 'ADA'];

function isBreakeven(trade) {
  const entry = parseFloat(trade.entry_price || 0);
  const sl = parseFloat(trade.stop_loss || 0);
  return entry > 0 && sl > 0 && Math.abs(entry - sl) / entry < 0.0005;
}

function exitLabel(trade) {
  const r = (trade.exit_reason || '').toUpperCase();
  const be = isBreakeven(trade);
  if (r.includes('TP2') || r.includes('BACKTEST_TP2')) return { text: 'TP2 Hit', color: '#10b981' };
  if (r.includes('TP1')) return { text: 'TP1 Hit', color: '#10b981' };
  if ((r.includes('SL') || r.includes('STOP')) && be) return { text: 'Breakeven Exit', color: '#60a5fa' };
  if (r.includes('SL') || r.includes('STOP')) return { text: 'Stopped Out', color: '#ef4444' };
  if (r.includes('MANUAL') || r.includes('CLOSED')) return { text: 'Closed', color: '#94a3b8' };
  if (trade.pnl > 0) return { text: 'TP Hit', color: '#10b981' };
  if (trade.pnl < 0 && be) return { text: 'Breakeven Exit', color: '#60a5fa' };
  if (trade.pnl < 0) return { text: 'Stopped Out', color: '#ef4444' };
  return { text: trade.exit_reason || '—', color: '#64748b' };
}

const COIN_COLORS = {
  BTC: '#f59e0b', ETH: '#6366f1', SOL: '#a855f7', XRP: '#06b6d4',
  BNB: '#eab308', SUI: '#3b82f6', TAO: '#10b981', LINK: '#2563eb',
  HYPE: '#ec4899', ADA: '#0ea5e9',
};

function CoinDot({ coin }) {
  const color = COIN_COLORS[coin] || '#64748b';
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: color, marginRight: 7, flexShrink: 0,
      boxShadow: `0 0 5px ${color}60`,
    }} />
  );
}

// ── Backtest Entry Modal ──────────────────────────────────────────────────────

function BacktestModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    instrument: 'BTC',
    direction: 'LONG',
    entry_price: '',
    exit_price: '',
    stop_loss: '',
    tp1_price: '',
    tp2_price: '',
    quantity: '',
    pnl: '',
    timestamp: new Date().toISOString().slice(0, 16),
    exit_timestamp: '',
    analysis_notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  // Auto-calculate PnL when prices + qty are filled
  useEffect(() => {
    const entry = parseFloat(form.entry_price);
    const exit = parseFloat(form.exit_price);
    const qty = parseFloat(form.quantity);
    if (entry && exit && qty) {
      const pnl = form.direction === 'LONG'
        ? (exit - entry) * qty
        : (entry - exit) * qty;
      set('pnl', pnl.toFixed(4));
    }
  }, [form.entry_price, form.exit_price, form.quantity, form.direction]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.entry_price || !form.quantity) {
      setError('Entry price and quantity are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        instrument: form.instrument,
        direction: form.direction,
        entry_price: parseFloat(form.entry_price),
        stop_loss: parseFloat(form.stop_loss) || 0,
        take_profit: parseFloat(form.tp2_price || form.tp1_price) || 0,
        quantity: parseFloat(form.quantity),
        timestamp: new Date(form.timestamp).toISOString(),
        trade_type: 'backtest',
        status: form.exit_price ? 'CLOSED' : 'OPEN',
        ...(form.exit_price && { exit_price: parseFloat(form.exit_price) }),
        ...(form.exit_timestamp && { exit_timestamp: new Date(form.exit_timestamp).toISOString() }),
        ...(form.pnl && { pnl: parseFloat(form.pnl) }),
        ...(form.tp1_price && { tp1_price: parseFloat(form.tp1_price) }),
        ...(form.tp2_price && { tp2_price: parseFloat(form.tp2_price) }),
        ...(form.analysis_notes && { analysis_notes: form.analysis_notes }),
      };
      await api.createTrade(payload);
      onSaved();
    } catch (err) {
      setError('Failed to save trade. Check console.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
    color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box',
    fontFamily: 'JetBrains Mono, monospace',
  };
  const labelStyle = { fontSize: 11, color: '#475569', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, display: 'block' };
  const row2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: 'rgba(15,23,42,0.98)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 16, padding: '28px 32px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>New Backtest Trade</h2>
            <p style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>Record a manually reviewed trade</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 4 }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Instrument + Direction */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Instrument</label>
              <select value={form.instrument} onChange={e => set('instrument', e.target.value)} style={inputStyle}>
                {COINS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Direction</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['LONG', 'SHORT'].map(d => (
                  <button key={d} type="button" onClick={() => set('direction', d)} style={{
                    flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: `1px solid ${form.direction === d
                      ? (d === 'LONG' ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)')
                      : 'rgba(255,255,255,0.09)'}`,
                    background: form.direction === d
                      ? (d === 'LONG' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)')
                      : 'rgba(255,255,255,0.03)',
                    color: form.direction === d
                      ? (d === 'LONG' ? '#10b981' : '#ef4444')
                      : '#64748b',
                  }}>{d}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Entry / Exit */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Entry Price</label>
              <input type="number" step="any" placeholder="e.g. 655.01"
                value={form.entry_price} onChange={e => set('entry_price', e.target.value)} style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Exit Price</label>
              <input type="number" step="any" placeholder="Leave blank if open"
                value={form.exit_price} onChange={e => set('exit_price', e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* SL / TP1 / TP2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Stop Loss</label>
              <input type="number" step="any" placeholder="SL"
                value={form.stop_loss} onChange={e => set('stop_loss', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>TP1</label>
              <input type="number" step="any" placeholder="TP1"
                value={form.tp1_price} onChange={e => set('tp1_price', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>TP2</label>
              <input type="number" step="any" placeholder="TP2"
                value={form.tp2_price} onChange={e => set('tp2_price', e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Quantity / PnL */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Quantity (contracts)</label>
              <input type="number" step="any" placeholder="e.g. 10.5"
                value={form.quantity} onChange={e => set('quantity', e.target.value)} style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>P&amp;L ($) — auto-calc</label>
              <input type="number" step="any" placeholder="Auto-calculated"
                value={form.pnl} onChange={e => set('pnl', e.target.value)} style={{
                  ...inputStyle,
                  color: parseFloat(form.pnl) > 0 ? '#10b981' : parseFloat(form.pnl) < 0 ? '#ef4444' : '#e2e8f0',
                }} />
            </div>
          </div>

          {/* Timestamps */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Entry Date &amp; Time</label>
              <input type="datetime-local" value={form.timestamp}
                onChange={e => set('timestamp', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Exit Date &amp; Time</label>
              <input type="datetime-local" value={form.exit_timestamp}
                onChange={e => set('exit_timestamp', e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea rows={2} placeholder="e.g. Strong bounce off 0.618 fib, clean wick rejection..."
              value={form.analysis_notes} onChange={e => set('analysis_notes', e.target.value)}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          {error && <p style={{ color: '#ef4444', fontSize: 12, margin: 0 }}>{error}</p>}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
              color: '#64748b', cursor: 'pointer',
            }}>Cancel</button>
            <button type="submit" disabled={saving} style={{
              flex: 2, padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 700,
              background: saving ? 'rgba(139,92,246,0.4)' : 'rgba(139,92,246,0.15)',
              border: '1px solid rgba(139,92,246,0.35)', color: '#a78bfa',
              cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
            }}>{saving ? 'Saving…' : 'Save Trade'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Trades Page ──────────────────────────────────────────────────────────

export default function Trades() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [dirFilter, setDirFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 25;

  useEffect(() => {
    fetchTrades();
    const id = setInterval(fetchTrades, 30000);
    return () => clearInterval(id);
  }, [statusFilter, dirFilter, page]);

  async function fetchTrades() {
    try {
      setLoading(true);
      let list = await api.getTrades(300, statusFilter || null);
      if (!Array.isArray(list)) list = [];
      if (dirFilter) list = list.filter(t => t.direction === dirFilter);
      setTrades(list);
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  const totalPages = Math.ceil(trades.length / perPage) || 1;
  const visible = trades.slice((page - 1) * perPage, page * perPage);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {showModal && (
        <BacktestModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchTrades(); }}
        />
      )}

      {/* Controls bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#475569' }}>
          <Filter style={{ width: 14, height: 14 }} />
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Filter
          </span>
        </div>

        {[
          { value: '', label: 'All' },
          { value: 'OPEN', label: 'Open' },
          { value: 'CLOSED', label: 'Closed' },
        ].map(opt => (
          <button key={opt.value} onClick={() => { setStatusFilter(opt.value); setPage(1); }} style={{
            padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.12s',
            background: statusFilter === opt.value ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${statusFilter === opt.value ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.07)'}`,
            color: statusFilter === opt.value ? '#60a5fa' : '#64748b',
          }}>{opt.label}</button>
        ))}

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', margin: '0 2px' }} />

        {[
          { value: '', label: 'Both' },
          { value: 'LONG', label: 'Long' },
          { value: 'SHORT', label: 'Short' },
        ].map(opt => (
          <button key={opt.value} onClick={() => { setDirFilter(opt.value); setPage(1); }} style={{
            padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.12s',
            background: dirFilter === opt.value ? 'rgba(139,92,246,0.1)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${dirFilter === opt.value ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.07)'}`,
            color: dirFilter === opt.value ? '#a78bfa' : '#64748b',
          }}>{opt.label}</button>
        ))}

        <button onClick={() => setShowModal(true)} style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 16px', borderRadius: 9, fontSize: 12, fontWeight: 700,
          background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)',
          color: '#a78bfa', cursor: 'pointer', transition: 'all 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(139,92,246,0.18)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(139,92,246,0.1)'}
        >
          <Plus style={{ width: 14, height: 14 }} />
          New Backtest
        </button>
      </div>

      {/* Table card */}
      <Card hover={false} style={{ overflow: 'hidden' }}>
        {loading ? (
          <CardContent style={{ padding: 0 }}><SkeletonTable rows={8} /></CardContent>
        ) : trades.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#475569', fontSize: 13 }}>
            No trades found.
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {['Coin', 'Direction', 'Entry', 'Exit', 'P&L', 'Status'].map((h, i) => (
                      <th key={h} style={{
                        padding: '13px 18px',
                        paddingLeft: i === 0 ? 24 : 18,
                        textAlign: i >= 2 ? 'right' : 'left',
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.09em',
                        textTransform: 'uppercase', color: '#334155',
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((trade, i) => {
                    const isOpen = trade.status === 'OPEN';
                    const pnl = parseFloat(trade.pnl);
                    const margin = parseFloat(trade.initial_margin || 0);
                    const lev = parseFloat(trade.leverage || 1);
                    const rowBg = isOpen ? 'rgba(59,130,246,0.03)' : i % 2 === 1 ? 'rgba(255,255,255,0.01)' : 'transparent';

                    return (
                      <Link key={trade.id} to={`/trades/${trade.id}`} className="contents">
                        <tr
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.025)',
                            borderLeft: `3px solid ${isOpen ? 'rgba(59,130,246,0.35)' : 'transparent'}`,
                            background: rowBg, cursor: 'pointer', transition: 'background 0.12s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.035)'}
                          onMouseLeave={e => e.currentTarget.style.background = rowBg}
                        >
                          {/* Coin */}
                          <td style={{ padding: '15px 18px', paddingLeft: 22 }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              <CoinDot coin={trade.instrument} />
                              <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 13 }}>
                                {trade.instrument}
                              </span>
                              {trade.trade_type === 'backtest' && (
                                <span style={{
                                  marginLeft: 8, fontSize: 9, fontWeight: 700,
                                  padding: '1px 5px', borderRadius: 4,
                                  background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                                  letterSpacing: '0.05em',
                                }}>BT</span>
                              )}
                            </div>
                            <div style={{ fontSize: 10, color: '#334155', marginTop: 3, paddingLeft: 14 }}>
                              {formatDateTime(trade.timestamp)}
                            </div>
                          </td>

                          {/* Direction */}
                          <td style={{ padding: '15px 18px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              {trade.direction === 'LONG'
                                ? <ArrowUpRight style={{ width: 13, height: 13, color: '#10b981' }} />
                                : <ArrowDownRight style={{ width: 13, height: 13, color: '#ef4444' }} />}
                              <span style={{ fontWeight: 700, fontSize: 12,
                                color: trade.direction === 'LONG' ? '#10b981' : '#ef4444' }}>
                                {trade.direction}
                              </span>
                            </div>
                          </td>

                          {/* Entry */}
                          <td style={{ padding: '15px 18px', textAlign: 'right' }}>
                            <div style={{ fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0', fontWeight: 600 }}>
                              {formatCurrency(trade.entry_price)}
                            </div>
                            {margin > 0 && (
                              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                <span style={{ fontSize: 10, color: '#334155' }}>invested</span>
                                <span style={{ fontSize: 11, fontWeight: 600, color: '#60a5fa', fontFamily: 'JetBrains Mono, monospace' }}>
                                  ${margin.toFixed(2)}
                                </span>
                                {lev > 1 && <span style={{ fontSize: 10, color: '#334155' }}>{lev.toFixed(0)}×</span>}
                              </div>
                            )}
                            {trade.stop_loss && (
                              isBreakeven(trade) ? (
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                                    background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}>SL → BE</span>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                  <span style={{ fontSize: 10, color: '#334155' }}>SL</span>
                                  <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#ef4444' }}>
                                    {formatCurrency(trade.stop_loss)}
                                  </span>
                                </div>
                              )
                            )}
                          </td>

                          {/* Exit */}
                          <td style={{ padding: '15px 18px', textAlign: 'right' }}>
                            {isOpen ? (
                              <div>
                                <span style={{ fontSize: 11, color: '#3b82f6', fontFamily: 'JetBrains Mono, monospace' }}>live</span>
                                {trade.tp1_price && (
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                    <span style={{ fontSize: 10, color: '#334155' }}>TP1</span>
                                    <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#10b981' }}>
                                      {formatCurrency(trade.tp1_price)}
                                    </span>
                                  </div>
                                )}
                                {trade.tp2_price && (
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                    <span style={{ fontSize: 10, color: '#334155' }}>TP2</span>
                                    <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#10b981' }}>
                                      {formatCurrency(trade.tp2_price)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : trade.exit_price ? (
                              <div>
                                <div style={{ fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0', fontWeight: 600 }}>
                                  {formatCurrency(trade.exit_price)}
                                </div>
                                {(() => { const lbl = exitLabel(trade); return (
                                  <div style={{ marginTop: 3 }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                                      background: `${lbl.color}18`, color: lbl.color,
                                      letterSpacing: '0.04em',
                                    }}>{lbl.text}</span>
                                  </div>
                                ); })()}
                              </div>
                            ) : (
                              <span style={{ color: '#1e293b' }}>—</span>
                            )}
                          </td>

                          {/* P&L */}
                          <td style={{ padding: '15px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                            {isOpen ? (
                              <span style={{ color: '#334155', fontSize: 12 }}>—</span>
                            ) : (
                              <span style={{ color: pnl > 0 ? '#10b981' : pnl < 0 ? '#ef4444' : '#64748b' }}>
                                {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}
                              </span>
                            )}
                          </td>

                          {/* Status */}
                          <td style={{ padding: '15px 18px', textAlign: 'right' }}>
                            <Badge
                              variant={isOpen ? 'info' : pnl > 0 ? 'success' : 'danger'}
                              dot={isOpen}
                            >
                              {isOpen ? (trade.tp1_hit ? 'BE' : 'Open') : pnl > 0 ? 'Win' : 'Loss'}
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
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '16px', borderTop: '1px solid rgba(255,255,255,0.04)',
              }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{
                  padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                  color: page <= 1 ? '#1e293b' : '#64748b', cursor: page <= 1 ? 'not-allowed' : 'pointer',
                }}>Prev</button>
                <span style={{ fontSize: 12, color: '#334155' }}>{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{
                  padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                  color: page >= totalPages ? '#1e293b' : '#64748b', cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                }}>Next</button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
