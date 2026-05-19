import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, ArrowDownRight,
  Target, Shield, TrendingUp, BarChart3,
} from 'lucide-react';
import api from '../lib/api';
import { formatCurrency, formatPnL, formatDateTime } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';

function InfoRow({ label, value, icon: Icon, iconColor }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ fontSize: 13, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={14} style={{ color: iconColor }} />}
        {label}
      </span>
      <span style={{ fontSize: 13, color: '#cbd5e1' }}>{value}</span>
    </div>
  );
}

export default function TradeDetail() {
  const { id } = useParams();
  const [trade, setTrade] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState('final');

  useEffect(() => {
    api.getTrade(id).then(t => { setTrade(t); setLoading(false); });
  }, [id]);

  if (loading) {
    return <div style={{ padding: 24 }}><Skeleton className="h-96" /></div>;
  }
  if (!trade || !trade.id) {
    return <p style={{ padding: 24, color: '#94a3b8' }}>Trade not found</p>;
  }

  const pnl = formatPnL(trade.pnl);
  const hasInitial = !!trade.chart_initial_png;
  const hasFinal = !!trade.chart_final_png;
  const chartUrl = api.tradeChartUrl(id, chartType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/trades"><Button variant="secondary" size="sm"><ArrowLeft size={16} /></Button></Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
            {trade.instrument} · {trade.direction} · {trade.strategy_name}
          </h1>
          <p style={{ fontSize: 13, color: '#64748b' }}>{formatDateTime(trade.timestamp)}</p>
        </div>
        <Badge variant={trade.status === 'OPEN' ? 'info' : trade.pnl > 0 ? 'success' : 'danger'} dot>
          {trade.status === 'OPEN' ? 'Open' : trade.pnl > 0 ? 'Win' : 'Loss'}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={BarChart3} iconColor="#3b82f6">Price Chart & Analysis</CardTitle>
          {hasInitial && hasFinal && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant={chartType === 'final' ? 'primary' : 'secondary'} onClick={() => setChartType('final')}>Exit chart</Button>
              <Button size="sm" variant={chartType === 'initial' ? 'primary' : 'secondary'} onClick={() => setChartType('initial')}>Signal chart</Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {(hasInitial || hasFinal) ? (
            <img src={chartUrl} alt="Trade chart" style={{ width: '100%', height: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }} />
          ) : (
            <p style={{ color: '#64748b' }}>No chart available for this trade.</p>
          )}
        </CardContent>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <Card>
          <CardHeader><CardTitle icon={BarChart3} iconColor="#3b82f6">Trade Information</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Direction" value={
              <span style={{ color: trade.direction === 'LONG' ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                {trade.direction === 'LONG' ? <ArrowUpRight size={14} style={{ display: 'inline' }} /> : <ArrowDownRight size={14} style={{ display: 'inline' }} />}
                {trade.direction}
              </span>
            } />
            <InfoRow label="Entry" value={<span style={{ fontFamily: 'monospace' }}>{formatCurrency(trade.entry_price)}</span>} />
            <InfoRow label="Exit" value={<span style={{ fontFamily: 'monospace' }}>{trade.exit_price ? formatCurrency(trade.exit_price) : '—'}</span>} />
            <InfoRow label="Quantity" value={<span style={{ fontFamily: 'monospace' }}>{Number(trade.quantity).toFixed(4)}</span>} />
            <InfoRow label="P&L" value={<span style={{ fontFamily: 'monospace', color: trade.pnl > 0 ? '#10b981' : '#ef4444' }}>{trade.status === 'CLOSED' ? pnl.text : '—'}</span>} />
            <InfoRow label="Exit Reason" value={trade.exit_reason || '—'} />
            <InfoRow label="Confidence" value={<span style={{ color: '#fbbf24' }}>{Number(trade.confidence || 0).toFixed(0)}%</span>} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle icon={Target} iconColor="#a78bfa">Position Details</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Notional" value={<span style={{ fontFamily: 'monospace' }}>{formatCurrency(trade.notional)}</span>} />
            <InfoRow label="Leverage" value={<span style={{ fontFamily: 'monospace' }}>{Number(trade.leverage || 1).toFixed(0)}×</span>} />
            <InfoRow label="Initial Margin" value={<span style={{ fontFamily: 'monospace' }}>{formatCurrency(trade.initial_margin)}</span>} />
            <InfoRow label="Liquidation" value={<span style={{ fontFamily: 'monospace', color: '#ef4444' }}>{trade.liquidation_price ? formatCurrency(trade.liquidation_price) : '—'}</span>} />
            <InfoRow label="Stop Loss" icon={Shield} iconColor="#ef4444" value={<span style={{ fontFamily: 'monospace', color: '#ef4444' }}>{formatCurrency(trade.stop_loss)}</span>} />
            <InfoRow label="TP1" value={<span style={{ fontFamily: 'monospace', color: '#10b981' }}>{trade.tp1_price ? formatCurrency(trade.tp1_price) : '—'}</span>} />
            <InfoRow label="TP2" value={<span style={{ fontFamily: 'monospace', color: '#10b981' }}>{trade.tp2_price ? formatCurrency(trade.tp2_price) : '—'}</span>} />
            <InfoRow label="Funding/hr" value={<span style={{ fontFamily: 'monospace' }}>{((trade.funding_rate_hr || 0) * 100).toFixed(4)}%</span>} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
