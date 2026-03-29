import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { createChart } from 'lightweight-charts';
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

const FIB_COLORS = {
  0: '#94a3b8', 0.236: '#60a5fa', 0.382: '#34d399',
  0.5: '#fbbf24', 0.618: '#f97316', 0.786: '#ef4444', 1: '#94a3b8',
};

const FIB_LABELS = {
  0: '0% (Swing High)', 0.236: '23.6%', 0.382: '38.2% ★',
  0.5: '50%', 0.618: '61.8% ★', 0.786: '78.6% (Stop Loss)', 1: '100% (Swing Low)',
};

function InfoRow({ label, value, icon: Icon, iconColor }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0">
      <span className="text-[13px] text-slate-500 flex items-center gap-2">
        {Icon && <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />}
        {label}
      </span>
      <span className="text-[13px] text-slate-200">{value}</span>
    </div>
  );
}

export default function TradeDetail() {
  const { id } = useParams();
  const [trade, setTrade] = useState(null);
  const [loading, setLoading] = useState(true);
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    fetchTrade();
  }, [id]);

  useEffect(() => {
    if (trade && chartContainerRef.current) renderChart();
    return () => {
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [trade]);

  async function fetchTrade() {
    try {
      const record = await api.getTrade(id);
      setTrade(record);
    } catch (err) {
      console.error('Failed to fetch trade:', err);
    } finally {
      setLoading(false);
    }
  }

  function renderChart() {
    if (chartRef.current) chartRef.current.remove();

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#546380', fontSize: 11 },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.04)' },
      timeScale: { borderColor: 'rgba(255, 255, 255, 0.04)', timeVisible: true },
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });

    const entryPrice = trade.entry_price;
    const metadata = trade.signal_metadata || {};
    const fibLevels = metadata.fib_levels || {};
    const baseTime = Math.floor(new Date(trade.timestamp).getTime() / 1000);

    const candles = [];
    const range = entryPrice * 0.02;
    for (let i = -30; i <= 10; i++) {
      const t = baseTime + i * 300;
      const noise = (Math.random() - 0.5) * range;
      const open = entryPrice + noise;
      const close = open + (Math.random() - 0.5) * range * 0.5;
      const high = Math.max(open, close) + Math.random() * range * 0.3;
      const low = Math.min(open, close) - Math.random() * range * 0.3;
      candles.push({ time: t, open, high, low, close });
    }
    candleSeries.setData(candles);

    if (Object.keys(fibLevels).length > 0) {
      Object.entries(fibLevels).forEach(([ratio, price]) => {
        const r = parseFloat(ratio);
        candleSeries.createPriceLine({
          price, color: FIB_COLORS[r] || '#64748b',
          lineWidth: 1, lineStyle: 2, axisLabelVisible: true,
          title: `Fib ${(r * 100).toFixed(1)}%`,
        });
      });
    }

    candleSeries.createPriceLine({
      price: trade.entry_price,
      color: trade.direction === 'LONG' ? '#10b981' : '#ef4444',
      lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'Entry',
    });

    if (trade.stop_loss) {
      candleSeries.createPriceLine({
        price: trade.stop_loss, color: '#ef4444',
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Stop Loss',
      });
    }
    if (trade.take_profit) {
      candleSeries.createPriceLine({
        price: trade.take_profit, color: '#10b981',
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Take Profit',
      });
    }
    if (trade.exit_price) {
      candleSeries.createPriceLine({
        price: trade.exit_price, color: '#f59e0b',
        lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'Exit',
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    });
    resizeObserver.observe(chartContainerRef.current);
    chart.timeScale().fitContent();
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="w-9 h-9 rounded-xl" />
          <div>
            <Skeleton className="h-7 w-40 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Card><CardContent><Skeleton className="w-full h-[400px]" /></CardContent></Card>
        <div className="grid grid-cols-2 gap-6">
          <Card><CardContent><Skeleton className="h-64" /></CardContent></Card>
          <Card><CardContent><Skeleton className="h-64" /></CardContent></Card>
        </div>
      </div>
    );
  }

  if (!trade) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
          <Target className="w-8 h-8 text-red-400/60" />
        </div>
        <p className="text-slate-400">Trade not found</p>
        <Link to="/trades">
          <Button variant="secondary" size="sm">
            <ArrowLeft className="w-4 h-4" /> Back to trades
          </Button>
        </Link>
      </div>
    );
  }

  const pnl = formatPnL(trade.pnl);
  const metadata = trade.signal_metadata || {};
  const fibLevels = metadata.fib_levels || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 animate-fade-in">
        <Link to="/trades">
          <Button variant="secondary" size="sm" className="!px-2.5">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Trade Detail
            </h1>
            <Badge
              variant={trade.status === 'OPEN' ? 'info' : trade.pnl > 0 ? 'success' : 'danger'}
              dot
            >
              {trade.status === 'OPEN' ? 'Open' :
               trade.pnl > 0 ? 'Win' : 'Loss'}
            </Badge>
          </div>
          <p className="text-sm mt-1 text-slate-500">
            {trade.instrument} · {trade.strategy_name} · {formatDateTime(trade.timestamp)}
          </p>
        </div>
      </div>

      {/* Chart */}
      <Card className="animate-fade-in" style={{ animationDelay: '0.05s' }}>
        <CardHeader>
          <CardTitle icon={BarChart3} iconColor="#3b82f6">
            Price Chart & Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={chartContainerRef} className="w-full rounded-xl overflow-hidden" />
        </CardContent>
      </Card>

      {/* Info Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trade Information */}
        <Card className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <CardHeader>
            <CardTitle icon={BarChart3} iconColor="#3b82f6">
              Trade Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <InfoRow label="Direction" value={
                <span className="flex items-center gap-1.5">
                  {trade.direction === 'LONG'
                    ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                    : <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />}
                  <span className={`font-semibold ${trade.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {trade.direction}
                  </span>
                </span>
              } />
              <InfoRow label="Entry Price" value={<span className="font-mono">{formatCurrency(trade.entry_price)}</span>} />
              <InfoRow label="Exit Price" value={<span className="font-mono">{trade.exit_price ? formatCurrency(trade.exit_price) : '—'}</span>} />
              <InfoRow label="Quantity" value={<span className="font-mono">{trade.quantity?.toFixed(4)}</span>} />
              <InfoRow label="P&L" value={
                <span className={`font-mono font-semibold ${pnl.className}`}>
                  {trade.status === 'CLOSED' ? pnl.text : '—'}
                </span>
              } />
              <InfoRow label="Exit Reason" value={trade.exit_reason || '—'} />
              <InfoRow label="Status" value={
                <Badge
                  variant={trade.status === 'OPEN' ? 'info' : trade.status === 'CLOSED' ? 'success' : 'warning'}
                  dot
                >
                  {trade.status}
                </Badge>
              } />
            </div>
          </CardContent>
        </Card>

        {/* Strategy Analysis */}
        <Card className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
          <CardHeader>
            <CardTitle icon={Target} iconColor="#a78bfa">
              Strategy Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <InfoRow label="VWAP" icon={TrendingUp} iconColor="#3b82f6"
                value={<span className="font-mono">{metadata.vwap_value ? formatCurrency(metadata.vwap_value) : '—'}</span>}
              />
              <InfoRow label="Trend" value={
                <Badge variant={metadata.trend_direction === 'UP' ? 'success' : 'danger'}>
                  {metadata.trend_direction || '—'}
                </Badge>
              } />
              <InfoRow label="Triggered Level" value={
                <span className="font-mono font-semibold text-amber-400">
                  {metadata.triggered_level ? `${(metadata.triggered_level * 100).toFixed(1)}%` : '—'}
                </span>
              } />
              <InfoRow label="Stop Loss" icon={Shield} iconColor="#ef4444"
                value={<span className="font-mono text-red-400">{formatCurrency(trade.stop_loss)}</span>}
              />
              <InfoRow label="Take Profit" icon={Target} iconColor="#10b981"
                value={<span className="font-mono text-emerald-400">{formatCurrency(trade.take_profit)}</span>}
              />

              {/* Fibonacci Levels */}
              {Object.keys(fibLevels).length > 0 && (
                <div className="mt-5 pt-4 border-t border-white/[0.06]">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
                    Fibonacci Levels
                  </p>
                  <div className="space-y-1">
                    {Object.entries(fibLevels)
                      .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
                      .map(([ratio, price]) => {
                        const r = parseFloat(ratio);
                        const isTriggered = r === metadata.triggered_level;
                        return (
                          <div key={ratio}
                            className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                              isTriggered ? 'bg-amber-500/10 border border-amber-500/20' : 'hover:bg-white/[0.03]'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FIB_COLORS[r] || '#64748b' }} />
                              <span className="text-slate-400">
                                {FIB_LABELS[r] || `${(r * 100).toFixed(1)}%`}
                              </span>
                              {isTriggered && <span className="text-amber-400 font-semibold">← Entry</span>}
                            </span>
                            <span className="font-mono text-slate-200">
                              {formatCurrency(price)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
