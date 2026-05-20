import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import {
  TrendingUp, TrendingDown, BarChart3, Activity, RefreshCw, Zap, Clock,
} from 'lucide-react';
import api from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';

const TIMEFRAMES = [
  { value: '5m', label: '5min' },
  { value: '15m', label: '15min' },
  { value: '30m', label: '30min' },
  { value: '1h', label: '1H' },
];

// 30m is not stored by the bot — resample from 5m candles client-side
function resampleCandles(candles, targetMinutes) {
  const bucketMs = targetMinutes * 60 * 1000;
  const groups = new Map();
  for (const c of candles) {
    const ts = new Date(c.timestamp).getTime();
    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    if (!groups.has(bucket)) {
      groups.set(bucket, {
        timestamp: new Date(bucket).toISOString(),
        open: c.open, high: c.high, low: c.low, close: c.close,
        volume: c.volume || 0,
      });
    } else {
      const g = groups.get(bucket);
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.volume += (c.volume || 0);
    }
  }
  return [...groups.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'SUI', 'TAO', 'LINK', 'HYPE', 'ADA'];

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
  return `${Math.round(diff / 3600)}h ago`;
}

export default function Chart() {
  const [searchParams, setSearchParams] = useSearchParams();
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [instrument, setInstrument] = useState(searchParams.get('coin') || 'BTC');
  const [timeframe, setTimeframe] = useState('5m');
  const [mtfTrend, setMtfTrend] = useState(null);
  const [coinMonitor, setCoinMonitor] = useState(null);

  // Sync instrument to URL param
  useEffect(() => {
    const urlCoin = searchParams.get('coin');
    if (urlCoin && urlCoin !== instrument) setInstrument(urlCoin);
  }, [searchParams]);

  useEffect(() => {
    fetchCandles();
    const interval = setInterval(fetchCandles, 60000);
    return () => clearInterval(interval);
  }, [timeframe, instrument]);

  async function fetchCandles() {
    try {
      setLoading(true);
      // 30m not stored by bot — fetch 5m and resample client-side
      const apiTf = timeframe === '30m' ? '5m' : timeframe;
      const [candleData, trend, monitorAll] = await Promise.all([
        api.getCandles(instrument, apiTf, 5000),
        api.getMtfTrend(instrument),
        api.getMonitor(),
      ]);
      const raw = Array.isArray(candleData) ? candleData : [];
      setCandles(timeframe === '30m' ? resampleCandles(raw, 30) : raw);
      setMtfTrend(trend);
      if (Array.isArray(monitorAll)) {
        setCoinMonitor(monitorAll.find(c => c.coin === instrument) || null);
      }
    } catch (err) {
      console.error('Failed to fetch candles:', err);
    } finally {
      setLoading(false);
    }
  }

  function switchCoin(coin) {
    setInstrument(coin);
    setSearchParams({ coin });
  }

  // Build chart when candles available
  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

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
      timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
      handleScroll: { vertTouchDrag: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b98199', wickDownColor: '#ef444499',
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    candleSeries.setData(candles.map(c => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    volumeSeries.setData(candles.map(c => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000),
      value: c.volume || 0,
      color: c.close >= c.open ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
    })));

    // Show last 120 candles with ~50 empty bars on the right so the current
    // bar sits at ~70% of the chart width, leaving breathing room like TradingView.
    const totalBars = candles.length;
    const visibleBars = 120;
    const rightPad = 50;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, totalBars - visibleBars),
      to: totalBars + rightPad,
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); chart.remove(); chartRef.current = null; };
  }, [candles]);

  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const firstCandle = candles.length > 0 ? candles[0] : null;
  const currentPrice = lastCandle?.close ?? 0;
  const openPrice = firstCandle?.close ?? 0;
  const change = currentPrice - openPrice;
  const changePct = openPrice > 0 ? (change / openPrice * 100) : 0;
  const highPrice = candles.length > 0 ? Math.max(...candles.map(c => c.high)) : 0;
  const lowPrice = candles.length > 0 ? Math.min(...candles.map(c => c.low)) : 0;
  const coinColor = COIN_COLORS[instrument] || '#3b82f6';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Coin selector tabs */}
      <div className="animate-fade-in" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {COINS.map(coin => {
          const c = COIN_COLORS[coin] || '#64748b';
          const active = coin === instrument;
          return (
            <button
              key={coin}
              onClick={() => switchCoin(coin)}
              style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none',
                cursor: 'pointer', fontSize: '12px', fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace',
                transition: 'all 0.15s',
                background: active ? `rgba(${parseInt(c.slice(1,3),16)},${parseInt(c.slice(3,5),16)},${parseInt(c.slice(5,7),16)},0.18)` : 'rgba(255,255,255,0.04)',
                color: active ? c : '#64748b',
                border: active ? `1px solid rgba(${parseInt(c.slice(1,3),16)},${parseInt(c.slice(3,5),16)},${parseInt(c.slice(5,7),16)},0.3)` : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {coin}
            </button>
          );
        })}
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <StatCard icon={Activity} label="Current Price" value={formatCurrency(currentPrice)} color={coinColor} highlighted
          subValue={{ text: candles.length > 0 ? `${candles.length} candles` : 'No data', color: coinColor }} delay={0.05} />
        <StatCard icon={change >= 0 ? TrendingUp : TrendingDown}
          label="Session Change" value={`${change >= 0 ? '+' : ''}${formatCurrency(change)}`}
          color={change >= 0 ? '#10b981' : '#ef4444'}
          subValue={{ text: `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`, color: change >= 0 ? '#10b981' : '#ef4444' }} delay={0.1} />
        <StatCard icon={BarChart3} label="High / Low"
          value={candles.length > 0 ? formatCurrency(highPrice) : '—'}
          color="#a78bfa"
          subValue={{ text: candles.length > 0 ? `Low: ${formatCurrency(lowPrice)}` : 'No data', color: '#a78bfa' }} delay={0.15} />
        <StatCard icon={BarChart3} label="Volume"
          value={candles.reduce((s, c) => s + (c.volume || 0), 0) > 0 ? candles.reduce((s, c) => s + (c.volume || 0), 0).toLocaleString() : '—'}
          color="#f59e0b" subValue={{ text: 'Total', color: '#f59e0b' }} delay={0.2} />
      </div>

      {/* Chart */}
      <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
        <CardHeader>
          <CardTitle icon={Activity} iconColor={coinColor}>
            {instrument} · Candlestick Chart
          </CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {TIMEFRAMES.map(tf => (
              <button key={tf.value} onClick={() => setTimeframe(tf.value)} style={{
                padding: '5px 13px', borderRadius: '7px', border: 'none', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600, transition: 'all 0.15s',
                background: timeframe === tf.value ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: timeframe === tf.value ? '#3b82f6' : '#64748b',
              }}>
                {tf.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent style={{ padding: 0 }}>
          {loading && candles.length === 0 ? (
            <div style={{ height: '440px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: '#475569' }}>
                <RefreshCw style={{ width: '22px', height: '22px', margin: '0 auto 10px', animation: 'spin 1s linear infinite' }} />
                <p style={{ fontSize: '13px' }}>Loading…</p>
              </div>
            </div>
          ) : candles.length === 0 ? (
            <div style={{ height: '440px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: `rgba(${parseInt(coinColor.slice(1,3),16)},${parseInt(coinColor.slice(3,5),16)},${parseInt(coinColor.slice(5,7),16)},0.08)`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                  <Activity style={{ width: '22px', height: '22px', color: coinColor }} />
                </div>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>No data for {instrument}</p>
                <p style={{ fontSize: '12px', color: '#475569' }}>Bot fetches candle data on each scan cycle.</p>
              </div>
            </div>
          ) : (
            <div ref={chartContainerRef} style={{ height: '440px', padding: '0 8px 8px' }} />
          )}
        </CardContent>
      </Card>

      {/* Scan details */}
      {coinMonitor && (
        <div className="animate-fade-in" style={{
          display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap',
          padding: '12px 20px', borderRadius: '12px',
          background: `rgba(${parseInt(coinColor.slice(1,3),16)},${parseInt(coinColor.slice(3,5),16)},${parseInt(coinColor.slice(5,7),16)},0.05)`,
          border: `1px solid rgba(${parseInt(coinColor.slice(1,3),16)},${parseInt(coinColor.slice(3,5),16)},${parseInt(coinColor.slice(5,7),16)},0.12)`,
        }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: coinColor }}>{instrument}</span>
          <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.06)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <BarChart3 style={{ width: '12px', height: '12px', color: '#64748b' }} />
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {coinMonitor.candle_count.toLocaleString()} candles
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Zap style={{ width: '12px', height: '12px', color: coinColor }} />
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {coinMonitor.signal_count} signals
            </span>
            {coinMonitor.last_signal_direction && (
              <Badge variant={coinMonitor.last_signal_direction === 'LONG' ? 'success' : 'danger'} dot>
                {coinMonitor.last_signal_direction} {coinMonitor.last_signal_confidence != null ? `${coinMonitor.last_signal_confidence.toFixed(0)}%` : ''}
              </Badge>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock style={{ width: '12px', height: '12px', color: '#64748b' }} />
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {coinMonitor.last_scan ? `Last scan ${timeSince(coinMonitor.last_scan)}` : 'Not yet scanned'}
            </span>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <Badge variant={coinMonitor.has_data ? 'success' : 'secondary'} dot>
              {coinMonitor.has_data ? 'Live data' : 'No data'}
            </Badge>
          </div>
        </div>
      )}

      {/* MTF Trend */}
      {mtfTrend && (
        <div className="animate-fade-in" style={{
          display: 'flex', alignItems: 'center', gap: '20px',
          padding: '14px 20px', borderRadius: '12px',
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            MTF Trend
          </span>
          <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.06)' }} />
          {['1h', '15m', '5m'].map(tf => {
            const t = mtfTrend[tf] || {};
            return (
              <div key={tf} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{tf}</span>
                <Badge variant={t.trend === 'UP' ? 'success' : t.trend === 'DOWN' ? 'danger' : 'secondary'} dot>
                  {t.trend || '?'}
                </Badge>
                <span style={{ fontSize: '10px', color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                  {t.slope != null ? `${t.slope > 0 ? '+' : ''}${(t.slope * 100).toFixed(2)}%` : ''}
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
    </div>
  );
}
