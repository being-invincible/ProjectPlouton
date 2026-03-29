import { useState, useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { TrendingUp, TrendingDown, BarChart3, Activity, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';

const TIMEFRAMES = [
  { value: '5m',  label: '5min' },
  { value: '15m', label: '15min' },
  { value: '1h',  label: '1H' },
];

export default function Chart() {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [instrument, setInstrument] = useState('GC=F');
  const [timeframe, setTimeframe] = useState('5m');
  const [mtfTrend, setMtfTrend] = useState(null);

  useEffect(() => {
    fetchInstrument();
  }, []);

  useEffect(() => {
    fetchCandles();
    // Poll for new candles every 60s
    const interval = setInterval(fetchCandles, 60000);
    return () => clearInterval(interval);
  }, [timeframe, instrument]);

  async function fetchInstrument() {
    try {
      const state = await api.getBotState();
      if (state && state.instrument) {
        setInstrument(state.instrument);
      }
    } catch { /* ignore */ }
  }

  async function fetchCandles() {
    try {
      setLoading(true);
      const [candleData, trend] = await Promise.all([
        api.getCandles(instrument, timeframe, 5000),
        api.getMtfTrend(instrument),
      ]);
      setCandles(Array.isArray(candleData) ? candleData : []);
      setMtfTrend(trend);
    } catch (err) {
      console.error('Failed to fetch candles:', err);
    } finally {
      setLoading(false);
    }
  }

  // Build chart when candles are available
  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

    // Clear previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#64748b',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(59, 130, 246, 0.3)', width: 1, style: 2 },
        horzLine: { color: 'rgba(59, 130, 246, 0.3)', width: 1, style: 2 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
      },
      handleScroll: { vertTouchDrag: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b98199',
      wickDownColor: '#ef444499',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const chartData = candles.map(c => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = candles.map(c => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000),
      value: c.volume || 0,
      color: c.close >= c.open ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
    }));

    candleSeries.setData(chartData);
    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles]);

  // Compute stats
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const firstCandle = candles.length > 0 ? candles[0] : null;
  const currentPrice = lastCandle?.close ?? 0;
  const openPrice = firstCandle?.close ?? 0;
  const change = currentPrice - openPrice;
  const changePct = openPrice > 0 ? (change / openPrice * 100) : 0;
  const highPrice = candles.length > 0 ? Math.max(...candles.map(c => c.high)) : 0;
  const lowPrice = candles.length > 0 ? Math.min(...candles.map(c => c.low)) : 0;
  const totalVolume = candles.reduce((sum, c) => sum + (c.volume || 0), 0);

  const trendColor = (trend) => {
    if (trend === 'UP') return '#10b981';
    if (trend === 'DOWN') return '#ef4444';
    return '#64748b';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <StatCard
          icon={Activity}
          label="Current Price"
          value={formatCurrency(currentPrice)}
          color="#3b82f6"
          highlighted
          subValue={{ text: candles.length > 0 ? `${candles.length} candles` : 'No data', color: '#3b82f6' }}
          delay={0.05}
        />
        <StatCard
          icon={change >= 0 ? TrendingUp : TrendingDown}
          label="Session Change"
          value={`${change >= 0 ? '+' : ''}${formatCurrency(change)}`}
          color={change >= 0 ? '#10b981' : '#ef4444'}
          subValue={{ text: `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`, color: change >= 0 ? '#10b981' : '#ef4444' }}
          delay={0.1}
        />
        <StatCard
          icon={BarChart3}
          label="High / Low"
          value={candles.length > 0 ? `${formatCurrency(highPrice)}` : '—'}
          color="#a78bfa"
          subValue={{ text: candles.length > 0 ? `Low: ${formatCurrency(lowPrice)}` : 'No data', color: '#a78bfa' }}
          delay={0.15}
        />
        <StatCard
          icon={BarChart3}
          label="Volume"
          value={totalVolume > 0 ? totalVolume.toLocaleString() : '—'}
          color="#f59e0b"
          subValue={{ text: 'Total', color: '#f59e0b' }}
          delay={0.2}
        />
      </div>

      {/* MTF Trend Indicator */}
      {mtfTrend && (
        <div className="animate-fade-in" style={{
          display: 'flex', alignItems: 'center', gap: '20px',
          padding: '16px 24px', borderRadius: '14px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          animationDelay: '0.25s',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            MTF Trend
          </span>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.06)' }} />
          {['1h', '15m', '5m'].map(tf => {
            const t = mtfTrend[tf] || {};
            return (
              <div key={tf} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{tf}</span>
                <Badge variant={t.trend === 'UP' ? 'success' : t.trend === 'DOWN' ? 'danger' : 'secondary'} dot>
                  {t.trend || '?'}
                </Badge>
                <span style={{ fontSize: '10px', color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                  {t.slope != null ? `${t.slope > 0 ? '+' : ''}${t.slope}%` : ''}
                </span>
              </div>
            );
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Stack:</span>
            <Badge variant={mtfTrend.stacked ? 'success' : 'warning'}>
              {mtfTrend.stacked ? mtfTrend.direction : 'MIXED'}
            </Badge>
          </div>
        </div>
      )}

      {/* Chart with TF selector */}
      <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.3s' }}>
        <CardHeader>
          <CardTitle icon={Activity} iconColor="#3b82f6">
            {instrument} · Candlestick Chart
          </CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                  transition: 'all 0.15s',
                  background: timeframe === tf.value ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  color: timeframe === tf.value ? '#3b82f6' : '#64748b',
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent style={{ padding: 0 }}>
          {loading && candles.length === 0 ? (
            <div style={{ height: '460px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: '#475569' }}>
                <RefreshCw style={{ width: '24px', height: '24px', margin: '0 auto 12px', animation: 'spin 1s linear infinite' }} />
                <p style={{ fontSize: '13px' }}>Loading chart data…</p>
              </div>
            </div>
          ) : candles.length === 0 ? (
            <div style={{ height: '460px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: '56px', height: '56px', borderRadius: '16px',
                  background: 'rgba(59, 130, 246, 0.08)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
                }}>
                  <Activity style={{ width: '24px', height: '24px', color: '#3b82f6' }} />
                </div>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                  No market data yet
                </p>
                <p style={{ fontSize: '13px', color: '#475569' }}>
                  Start the bot to fetch candle data from DuckDB.
                </p>
              </div>
            </div>
          ) : (
            <div ref={chartContainerRef} style={{ height: '460px', padding: '0 8px 8px' }} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
