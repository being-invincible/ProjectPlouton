import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { RefreshCw } from 'lucide-react';
import api from '../lib/api';

const FIB_SPECS = [
  { key: '0',     ratio: 0,     color: '#64748b', lineStyle: 0, width: 1,   label: '0%' },
  { key: '0.236', ratio: 0.236, color: '#ef5350', lineStyle: 2, width: 1,   label: '23.6%' },
  { key: '0.382', ratio: 0.382, color: '#ffc107', lineStyle: 2, width: 1,   label: '38.2%' },
  { key: '0.5',   ratio: 0.5,   color: '#4caf50', lineStyle: 0, width: 1,   label: '50%' },
  { key: '0.618', ratio: 0.618, color: '#26a69a', lineStyle: 0, width: 1,   label: '61.8%' },
  { key: '0.786', ratio: 0.786, color: '#2196f3', lineStyle: 2, width: 1,   label: '78.6%' },
  { key: '1',     ratio: 1,     color: '#64748b', lineStyle: 0, width: 1,   label: '100%' },
];

function extractCoin(instrument) {
  return (instrument || '').replace(/-?\/?\s*USDC$/i, '').trim();
}

export default function FibChart({ trade }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const coin = extractCoin(trade?.instrument);

  useEffect(() => {
    if (!coin) return;
    setLoading(true);
    setError(null);
    api.getCandles(coin, '5m', 400)
      .then(data => setCandles(Array.isArray(data) ? data : []))
      .catch(() => setError('Failed to load candles'))
      .finally(() => setLoading(false));
  }, [coin]);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0 || !trade) return;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const { swing_high, swing_low, entry_price, stop_loss, tp1_price, tp2_price, direction, timestamp } = trade;
    if (!swing_high || !swing_low) return;

    const rng = swing_high - swing_low;

    // Direction-aware golden pocket:
    // LONG: price pulled back from swing_high — pocket is 38.2%–50% from bottom (61.8%–50% retrace from top)
    // SHORT: price bounced from swing_low — pocket is 50%–61.8% from bottom
    const gpUpper = direction === 'LONG' ? swing_low + 0.500 * rng : swing_low + 0.618 * rng;
    const gpLower = direction === 'LONG' ? swing_low + 0.382 * rng : swing_low + 0.500 * rng;

    const chart = createChart(containerRef.current, {
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
        vertLine: { color: 'rgba(59,130,246,0.3)', width: 1, style: 2 },
        horzLine: { color: 'rgba(59,130,246,0.3)', width: 1, style: 2 },
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

    candleSeries.setData(candles.map(c => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    // Standard Fib retracement lines (from swing_low upward)
    for (const fib of FIB_SPECS) {
      const price = swing_low + fib.ratio * rng;
      candleSeries.createPriceLine({
        price,
        color: fib.color,
        lineWidth: fib.width,
        lineStyle: fib.lineStyle,
        axisLabelVisible: true,
        title: fib.label,
      });
    }

    // Golden pocket — thick gold lines, direction-aware
    candleSeries.createPriceLine({ price: gpUpper, color: '#ffd700', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'GP Upper' });
    candleSeries.createPriceLine({ price: gpLower, color: '#ffd700', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'GP Lower' });

    // Trade levels
    if (entry_price) candleSeries.createPriceLine({ price: entry_price, color: '#3b82f6', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: `${direction || ''} Entry` });
    if (stop_loss)   candleSeries.createPriceLine({ price: stop_loss,   color: '#ef4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'SL' });
    if (tp1_price)   candleSeries.createPriceLine({ price: tp1_price,   color: '#10b981', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'TP1' });
    if (tp2_price)   candleSeries.createPriceLine({ price: tp2_price,   color: '#00e676', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'TP2' });

    // Scroll so entry candle is centred in view
    const entryTs = timestamp ? Math.floor(new Date(timestamp).getTime() / 1000) : null;
    const entryIdx = entryTs
      ? candles.findIndex(c => Math.floor(new Date(c.timestamp).getTime() / 1000) >= entryTs)
      : -1;
    const pivot = entryIdx >= 0 ? entryIdx : candles.length - 1;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, pivot - 80),
      to: Math.min(candles.length + 20, pivot + 40),
    });

    // Entry marker
    if (entryTs && entry_price) {
      try {
        candleSeries.setMarkers([{
          time: entryTs,
          position: direction === 'LONG' ? 'belowBar' : 'aboveBar',
          color: '#3b82f6',
          shape: direction === 'LONG' ? 'arrowUp' : 'arrowDown',
          text: 'Entry',
        }]);
      } catch (_) { /* setMarkers optional — skip if not available in this build */ }
    }

    chartRef.current = chart;

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, trade]);

  if (!trade) return <div style={{ padding: 20, color: '#64748b' }}>No trade data</div>;

  if (loading) return (
    <div style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#475569' }}>
      <RefreshCw style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: 13 }}>Loading candles…</span>
    </div>
  );

  if (error) return <div style={{ padding: 20, color: '#ef4444', fontSize: 13 }}>{error}</div>;

  if (!trade.swing_high || !trade.swing_low) return (
    <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>
      No swing data stored for this trade — chart unavailable.
    </div>
  );

  const { swing_high, swing_low, entry_price, stop_loss, tp1_price, tp2_price, direction } = trade;
  const rng = swing_high - swing_low;
  const isLong = direction === 'LONG';
  const fmt = p => p != null ? `$${p > 100 ? p.toFixed(2) : p.toFixed(4)}` : '—';

  const gpUpper = isLong ? swing_low + 0.500 * rng : swing_low + 0.618 * rng;
  const gpLower = isLong ? swing_low + 0.382 * rng : swing_low + 0.500 * rng;

  const rr = entry_price && tp2_price && stop_loss
    ? Math.abs(tp2_price - entry_price) / Math.abs(entry_price - stop_loss)
    : null;

  const legendRows = [
    { label: 'Swing High',         price: swing_high, color: '#64748b' },
    { label: 'Swing Low',          price: swing_low,  color: '#64748b' },
    { label: `GP Upper (${isLong ? '50%' : '61.8%'})`,  price: gpUpper, color: '#ffd700' },
    { label: `GP Lower (${isLong ? '38.2%' : '50%'})`,  price: gpLower, color: '#ffd700' },
    { label: `${direction || ''} Entry`, price: entry_price, color: '#3b82f6' },
    { label: 'Stop Loss (78.6%)',  price: stop_loss,  color: '#ef4444' },
    { label: 'TP1 (1:1.5)',        price: tp1_price,  color: '#10b981' },
    { label: 'TP2 (1.618 ext)',    price: tp2_price,  color: '#00e676' },
  ].filter(r => r.price != null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div ref={containerRef} style={{ height: 360 }} />

      {/* Legend table */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 11 }}>
        {legendRows.map(row => (
          <div key={row.label} style={{
            background: 'rgba(255,255,255,0.03)', borderRadius: 6,
            padding: '8px 10px', borderLeft: `3px solid ${row.color}`,
          }}>
            <div style={{ color: '#64748b', marginBottom: 2 }}>{row.label}</div>
            <div style={{ color: '#e2e8f0', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
              {fmt(row.price)}
            </div>
          </div>
        ))}
      </div>

      {rr != null && (
        <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right' }}>
          R:R (TP2) = 1:{rr.toFixed(2)}
        </div>
      )}
    </div>
  );
}
