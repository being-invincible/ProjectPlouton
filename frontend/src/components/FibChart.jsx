import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { RefreshCw } from 'lucide-react';
import api from '../lib/api';

// RSI(14) with simple rolling means — matches the backend SMC strategy's _rsi().
function computeRSI(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    let avgGain = 0, avgLoss = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const diff = closes[k] - closes[k - 1];
      if (diff > 0) avgGain += diff; else avgLoss += -diff;
    }
    avgGain /= period;
    avgLoss /= period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

// Levels matched to the TMA Fib Retracement template:
// 0, 0.382, 0.5, 0.618, 1 + the negative downside extensions (-0.382 / -0.618 / -1.618)
const FIB_SPECS = [
  { key: '-1.618', ratio: -1.618, color: '#22c55e', lineStyle: 2, width: 1, label: '-1.618' },
  { key: '-0.618', ratio: -0.618, color: '#22c55e', lineStyle: 2, width: 1, label: '-0.618' },
  { key: '-0.382', ratio: -0.382, color: '#22c55e', lineStyle: 2, width: 1, label: '-0.382' },
  { key: '0',      ratio: 0,      color: '#94a3b8', lineStyle: 0, width: 1, label: '0' },
  { key: '0.382',  ratio: 0.382,  color: '#e2e8f0', lineStyle: 2, width: 1, label: '0.382' },
  { key: '0.5',    ratio: 0.5,    color: '#ffc107', lineStyle: 0, width: 1, label: '0.5' },
  { key: '0.618',  ratio: 0.618,  color: '#ffc107', lineStyle: 0, width: 1, label: '0.618' },
  { key: '1',      ratio: 1,      color: '#e2e8f0', lineStyle: 0, width: 1, label: '1' },
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
  const [lastUpdated, setLastUpdated] = useState(null);

  const coin = extractCoin(trade?.instrument);

  function fetchCandles() {
    if (!coin) return;
    setLoading(true);
    setError(null);
    api.getLiveCandles(coin, '4h', 300)
      .then(data => {
        setCandles(Array.isArray(data) ? data : []);
        setLastUpdated(new Date());
      })
      .catch(() => setError('Failed to load live candles'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchCandles();
    // Auto-refresh every 5 minutes to keep chart live
    const id = setInterval(fetchCandles, 5 * 60 * 1000);
    return () => clearInterval(id);
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

    // ── RSI(14) sub-pane (matches the SMC strategy's RSI gate) ──────────────
    const closes = candles.map(c => c.close);
    const rsiVals = computeRSI(closes, 14);
    const rsiData = candles
      .map((c, i) => ({ time: Math.floor(new Date(c.timestamp).getTime() / 1000), value: rsiVals[i] }))
      .filter(d => d.value != null);
    let rsiSeries = null;
    if (rsiData.length > 0) {
      // paneIndex 1 → creates a separate pane below the price chart
      rsiSeries = chart.addSeries(LineSeries, {
        color: '#a78bfa', lineWidth: 2,
        priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      }, 1);
      rsiSeries.setData(rsiData);
      // Classic overbought / oversold
      rsiSeries.createPriceLine({ price: 70, color: 'rgba(239,68,68,0.25)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' });
      rsiSeries.createPriceLine({ price: 30, color: 'rgba(16,185,129,0.25)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' });
      rsiSeries.createPriceLine({ price: 50, color: 'rgba(255,255,255,0.12)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false });
      // SMC gate levels — solid, brighter: above 65 blocks LONGs, below 35 blocks SHORTs
      rsiSeries.createPriceLine({ price: 65, color: '#ef4444', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: 'LONG block 65' });
      rsiSeries.createPriceLine({ price: 35, color: '#10b981', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: 'SHORT block 35' });
      // Keep the price pane dominant, RSI compact
      try {
        const panes = chart.panes();
        if (panes[0]) panes[0].setHeight(280);
        if (panes[1]) panes[1].setHeight(90);
      } catch (_) { /* setHeight optional across builds */ }
    }

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

    // Entry marker on the price chart (v5 API)
    if (entryTs && entry_price) {
      try {
        createSeriesMarkers(candleSeries, [{
          time: entryTs,
          position: direction === 'LONG' ? 'belowBar' : 'aboveBar',
          color: '#3b82f6',
          shape: direction === 'LONG' ? 'arrowUp' : 'arrowDown',
          text: 'Entry',
        }]);
      } catch (_) { /* markers optional across builds */ }

      // Matching marker on the RSI line at the entry bar, labelled with the
      // RSI the bot recorded at entry (trade.rsi) — falls back to chart-computed.
      if (rsiSeries) {
        const entryRsi = trade.rsi != null
          ? Number(trade.rsi)
          : (rsiData.find(d => d.time >= entryTs)?.value ?? null);
        try {
          createSeriesMarkers(rsiSeries, [{
            time: entryTs,
            position: direction === 'LONG' ? 'belowBar' : 'aboveBar',
            color: '#a78bfa',
            shape: 'circle',
            text: entryRsi != null ? `RSI ${entryRsi.toFixed(1)}` : 'Entry',
          }]);
        } catch (_) { /* markers optional across builds */ }
      }
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
      <span style={{ fontSize: 13 }}>Loading live candles…</span>
    </div>
  );

  if (error) return (
    <div style={{ padding: 20, color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
      {error}
      <button onClick={fetchCandles} style={{
        padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444',
      }}>Retry</button>
    </div>
  );

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

      {/* Live badge + manual refresh */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '0 16px' }}>
        <span style={{ fontSize: 10, color: '#475569' }}>
          4h · {lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : ''}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
          background: 'rgba(16,185,129,0.1)', color: '#10b981',
          border: '1px solid rgba(16,185,129,0.2)',
        }}>● LIVE</span>
        <button onClick={fetchCandles} title="Refresh" style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b',
        }}>
          <RefreshCw style={{ width: 12, height: 12 }} /> Refresh
        </button>
      </div>

      <div ref={containerRef} style={{ height: 400 }} />

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
