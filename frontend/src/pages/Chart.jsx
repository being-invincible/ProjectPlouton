import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, AreaSeries, createSeriesMarkers } from 'lightweight-charts';
import {
  TrendingUp, TrendingDown, BarChart3, Activity, RefreshCw, Zap, Clock,
  Triangle, ArrowDownUp, Layers, Sun, Waves, GitBranch, BarChart2, Box,
} from 'lucide-react';
import api from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';

const TIMEFRAMES = [
  { value: '1m', label: '1min' },
  { value: '5m', label: '5min' },
  { value: '15m', label: '15min' },
  { value: '30m', label: '30min' },
  { value: '1h', label: '1H' },
];

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

// ── Indicator catalog ─────────────────────────────────────────
// Single source of truth. Add to this list to expose a new toggle.
const INDICATORS = [
  { key: 'sma20',        icon: Activity,     label: 'SMA 20',           color: '#2196f3' },
  { key: 'sma50',        icon: Activity,     label: 'SMA 50',           color: 'rgba(255,255,255,0.6)' },
  { key: 'volume',       icon: BarChart2,    label: 'Volume',           color: 'rgba(148,163,184,0.6)' },
  { key: 'choch',        icon: Zap,          label: 'BOS / CHoCH',      color: '#f97316' },
  { key: 'fvg',          icon: Layers,       label: 'FVG zones',        color: '#10b981' },
  { key: 'fvgMid',       icon: Triangle,     label: 'FVG midpoint (CE)', color: '#facc15' },
  { key: 'rsi',          icon: Waves,        label: 'RSI pane',         color: '#22d3ee' },
  { key: 'nyOpen',       icon: Sun,          label: 'NY 9:30 band',     color: 'rgba(180,200,220,0.6)' },
  // Lower priority — off by default to avoid label clutter with BOS/CHoCH.
  { key: 'zigzag',       icon: ArrowDownUp,  label: 'ZigZag line',      color: '#a855f7' },
  { key: 'zigzagArrows', icon: ArrowDownUp,  label: 'Market structure (HH/HL/LH/LL)', color: '#22c55e' },
  { key: 'zzConfirm',    icon: GitBranch,    label: 'ZZ Confirm line',  color: '#a855f7' },
  { key: 'fibExt',       icon: Box,          label: 'Fib extensions',   color: '#fb923c' },
];

const DEFAULT_OVERLAYS = INDICATORS.reduce((acc, i) => {
  acc[i.key] = ['sma20', 'sma50', 'volume', 'choch', 'fvg', 'nyOpen', 'rsi', 'zigzagArrows'].includes(i.key);
  return acc;
}, {});

function IndicatorToolbar({ overlays, onToggle }) {
  const [hovered, setHovered] = useState(null);
  return (
    <div style={{
      position: 'absolute', top: 6, left: 6, zIndex: 5,
      display: 'flex', flexDirection: 'column', gap: 3,
      padding: 4, borderRadius: 8,
      background: 'rgba(15,23,42,0.7)',
      backdropFilter: 'blur(6px)',
      border: '1px solid rgba(255,255,255,0.06)',
      userSelect: 'none',
    }}>
      {INDICATORS.map(ind => {
        const Icon = ind.icon;
        const on = overlays[ind.key];
        return (
          <div key={ind.key} style={{ position: 'relative' }}
               onMouseEnter={() => setHovered(ind.key)}
               onMouseLeave={() => setHovered(null)}>
            <button
              onClick={() => onToggle(ind.key)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: 5,
                background: on ? `${ind.color}1f` : 'transparent',
                border: on ? `1px solid ${ind.color}55` : '1px solid transparent',
                cursor: 'pointer', padding: 0,
                transition: 'background 0.12s, border-color 0.12s',
              }}
              aria-label={ind.label}
              aria-pressed={on}
            >
              <Icon style={{
                width: 14, height: 14,
                color: on ? ind.color : '#475569',
                strokeWidth: 2,
              }} />
            </button>
            {hovered === ind.key && (
              <div style={{
                position: 'absolute', left: 32, top: 3,
                whiteSpace: 'nowrap',
                padding: '3px 8px', borderRadius: 4,
                background: 'rgba(15,23,42,0.95)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontSize: 11, color: '#cbd5e1',
                fontFamily: 'JetBrains Mono, monospace',
                pointerEvents: 'none',
              }}>
                {ind.label}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// True when timestamp falls inside the NY session.
// Approximates EDT (UTC-4): 9:30 ET = 13:30 UTC, 16:00 ET = 20:00 UTC.
// Weekday-only (Mon-Fri).
function inNySession(unixSec) {
  const d = new Date(unixSec * 1000);
  const utcDay = d.getUTCDay();
  if (utcDay === 0 || utcDay === 6) return false;
  const minutesUTC = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutesUTC >= 13 * 60 + 30 && minutesUTC < 20 * 60;
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
  const [zigzag, setZigzag] = useState(null);
  const [fvgData, setFvgData] = useState(null);
  const [structure, setStructure] = useState(null);
  const [rsiCloud, setRsiCloud] = useState(null);
  const [fibExt, setFibExt] = useState(null);
  const [overlays, setOverlays] = useState(DEFAULT_OVERLAYS);
  const [nyBands, setNyBands] = useState([]);  // [{ left: px, width: px }, ...]

  // Mutable refs to chart objects so toggle effect can mutate them.
  const refs = useRef({
    chart: null,
    candle: null,
    volume: null,
    sma20: null,
    sma50: null,
    zigzag: null,
    fvgEdges: [],         // LineSeries pairs
    fvgMids: [],          // LineSeries midpoints
    chochSeries: null,    // dummy series carrying CHoCH markers
    rsiZones: [],         // LineSeries top/bottom of each shaded zone? — we'll color candles instead
    nyOpenLines: [],      // vertical line markers actually drawn as PriceLine on each NY open? we'll use markers
    fibLines: [],         // PriceLine refs
    zzConfirmLine: null,
  });

  useEffect(() => {
    const urlCoin = searchParams.get('coin');
    if (urlCoin && urlCoin !== instrument) setInstrument(urlCoin);
  }, [searchParams]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60000);
    return () => clearInterval(interval);
  }, [timeframe, instrument]);

  async function fetchAll() {
    try {
      setLoading(true);
      const apiTf = timeframe === '30m' ? '5m' : timeframe;
      const ovTf = timeframe === '30m' ? '5m' : timeframe;
      const [candleData, trend, monitorAll, zz, fvg, struct, rsi, fib] = await Promise.all([
        api.getCandles(instrument, apiTf, 5000),
        api.getMtfTrend(instrument),
        api.getMonitor(),
        api.getZigZag(instrument, ovTf, { periods: 1000, atrMult: 2.0 }).catch(() => null),
        api.getFvg(instrument, ovTf, { periods: 500, minSizeAtr: 0.25, unfilledOnly: true }).catch(() => null),
        api.getStructure(instrument, ovTf, { periods: 1000, atrMult: 2.0 }).catch(() => null),
        api.getRsiCloud(instrument, ovTf, { periods: 500 }).catch(() => null),
        api.getFibExtensions(instrument, ovTf, { periods: 1000, atrMult: 2.0 }).catch(() => null),
      ]);
      const raw = Array.isArray(candleData) ? candleData : [];
      setCandles(timeframe === '30m' ? resampleCandles(raw, 30) : raw);
      setMtfTrend(trend);
      setZigzag(zz);
      setFvgData(fvg);
      setStructure(struct);
      setRsiCloud(rsi);
      setFibExt(fib);
      if (Array.isArray(monitorAll)) {
        setCoinMonitor(monitorAll.find(c => c.coin === instrument) || null);
      }
    } catch (err) {
      console.error('Failed to fetch chart data:', err);
    } finally {
      setLoading(false);
    }
  }

  function switchCoin(coin) {
    setInstrument(coin);
    setSearchParams({ coin });
  }

  // Build chart whenever underlying data changes — markers/series are
  // recomputed each time so toggles can drive both visibility AND content.
  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;
    if (refs.current.chart) { refs.current.chart.remove(); refs.current.chart = null; }

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

    const chartData = candles.map(c => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close,
      volume: c.volume || 0,
    }));

    const plainCandles = chartData.map(c => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    candleSeries.setData(plainCandles);

    volumeSeries.setData(chartData.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
    })));

    const computeSMA = (data, period) =>
      data.reduce((acc, c, i) => {
        if (i < period - 1) return acc;
        const avg = data.slice(i - period + 1, i + 1).reduce((s, x) => s + x.close, 0) / period;
        acc.push({ time: c.time, value: avg });
        return acc;
      }, []);

    const sma20Series = chart.addSeries(LineSeries, {
      color: '#2196f3', lineWidth: 1, crosshairMarkerVisible: false,
      lastValueVisible: true, priceLineVisible: false, title: 'SMA20',
    });
    sma20Series.setData(computeSMA(chartData, 20));

    const sma50Series = chart.addSeries(LineSeries, {
      color: 'rgba(255,255,255,0.6)', lineWidth: 1, crosshairMarkerVisible: false,
      lastValueVisible: true, priceLineVisible: false, title: 'SMA50',
    });
    sma50Series.setData(computeSMA(chartData, 50));

    refs.current = {
      chart,
      candle: candleSeries,
      volume: volumeSeries,
      sma20: sma20Series,
      sma50: sma50Series,
      zigzag: null,
      fvgFills: [],       // stacked lines that visually fill each gap
      fvgMids: [],
      chochSeries: null,
      rsiSeries: null,
      rsiUpperLine: null,
      rsiLowerLine: null,
      rsiZones: [],
      fibLines: [],
      zzConfirmLine: null,
    };

    const candleTimes = new Set(chartData.map(c => c.time));
    const lastTime = chartData[chartData.length - 1]?.time;
    const r = refs.current;

    // ZigZag connecting line (visibility toggled later)
    if (zigzag && Array.isArray(zigzag.pivots) && zigzag.pivots.length >= 2) {
      const pivotPoints = zigzag.pivots
        .map(p => ({
          time: Math.floor(new Date(p.time).getTime() / 1000),
          value: p.price, kind: p.kind, confirmed: p.confirmed,
        }))
        .filter(p => Number.isFinite(p.time) && Number.isFinite(p.value) && candleTimes.has(p.time))
        .sort((a, b) => a.time - b.time);

      if (pivotPoints.length >= 2) {
        try {
          const zigSeries = chart.addSeries(LineSeries, {
            color: '#a855f7', lineWidth: 2, lineStyle: 0,
            crosshairMarkerVisible: false, lastValueVisible: false,
            priceLineVisible: false, title: 'ZigZag',
          });
          zigSeries.setData(pivotPoints.map(p => ({ time: p.time, value: p.value })));
          r.zigzag = zigSeries;
        } catch (_) {}
      }
    }

    // ── FVG filled boxes (LuxAlgo-style) ──
    // lightweight-charts has no native rectangle primitive that fills between
    // two arbitrary prices over a time range without custom plugins. Stack a
    // handful of thin LineSeries between top and bottom to fake a filled box.
    // 6 lines × low opacity = smooth visual fill, cheap to draw.
    if (fvgData && Array.isArray(fvgData.fvgs)) {
      const FILL_LINES = 8;
      for (const fvg of fvgData.fvgs.slice(-30)) {
        const t0 = Math.floor(new Date(fvg.time).getTime() / 1000);
        if (!Number.isFinite(t0) || !lastTime || t0 > lastTime) continue;
        // BULL: green band   BEAR: red band   mitigated: half alpha
        const baseAlpha = fvg.mitigated ? 0.10 : 0.20;
        const edgeAlpha = fvg.mitigated ? 0.30 : 0.55;
        const rgb = fvg.kind === 'BULL' ? '16,185,129' : '239,68,68';
        const group = [];
        for (let k = 0; k <= FILL_LINES; k++) {
          const frac = k / FILL_LINES;
          const price = fvg.bottom + frac * (fvg.top - fvg.bottom);
          const isEdge = k === 0 || k === FILL_LINES;
          const alpha = isEdge ? edgeAlpha : baseAlpha;
          try {
            const line = chart.addSeries(LineSeries, {
              color: `rgba(${rgb},${alpha})`,
              lineWidth: isEdge ? 1 : 2,
              lineStyle: 0,
              crosshairMarkerVisible: false,
              lastValueVisible: false,
              priceLineVisible: false,
              title: '',
            });
            line.setData([{ time: t0, value: price }, { time: lastTime, value: price }]);
            group.push(line);
          } catch (_) {}
        }
        r.fvgFills.push(group);

        if (fvg.midpoint != null) {
          try {
            const midLine = chart.addSeries(LineSeries, {
              color: 'rgba(250,204,21,0.9)', lineWidth: 1, lineStyle: 2,
              crosshairMarkerVisible: false, lastValueVisible: false,
              priceLineVisible: false, title: '',
            });
            midLine.setData([{ time: t0, value: fvg.midpoint }, { time: lastTime, value: fvg.midpoint }]);
            r.fvgMids.push(midLine);
          } catch (_) {}
        }
      }
    }

    // CHoCH / BOS labels carried on a dummy invisible series so we can hide them.
    if (structure && Array.isArray(structure.events)) {
      const dummy = chart.addSeries(LineSeries, {
        color: 'transparent', lastValueVisible: false, priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      dummy.setData(chartData.map(c => ({ time: c.time, value: c.close })));
      r.chochSeries = dummy;
    }

    // ── RSI in its own bottom pane (paneIndex=1) ──
    if (rsiCloud && Array.isArray(rsiCloud.points) && rsiCloud.points.length > 0) {
      try {
        // Explicit pane creation — without this, addSeries(paneIndex=1) attaches
        // but the pane has zero height. addPane() then setStretchFactor allocates space.
        const rsiPane = chart.addPane();
        try { rsiPane.setStretchFactor(0.3); } catch {}
        const rsiData = rsiCloud.points.map(p => ({
          time: Math.floor(new Date(p.time).getTime() / 1000),
          value: p.rsi,
          color:
            p.zone === 'overbought' ? '#ef4444' :
            p.zone === 'oversold'   ? '#22c55e' : '#a855f7',
        }));
        const rsiSeries = chart.addSeries(LineSeries, {
          color: '#a855f7',
          lineWidth: 2,
          crosshairMarkerVisible: true,
          lastValueVisible: true,
          priceLineVisible: false,
          title: 'RSI(14)',
        }, 1);
        rsiSeries.setData(rsiData);
        r.rsiSeries = rsiSeries;

        // Cloud bands — solid 70/30 reference lines on the same pane.
        const rsiUpper = chart.addSeries(LineSeries, {
          color: 'rgba(239,68,68,0.35)', lineWidth: 1, lineStyle: 2,
          crosshairMarkerVisible: false, lastValueVisible: false,
          priceLineVisible: false, title: '',
        }, 1);
        rsiUpper.setData(rsiData.map(p => ({ time: p.time, value: 70 })));
        r.rsiUpperLine = rsiUpper;

        const rsiLower = chart.addSeries(LineSeries, {
          color: 'rgba(34,197,94,0.35)', lineWidth: 1, lineStyle: 2,
          crosshairMarkerVisible: false, lastValueVisible: false,
          priceLineVisible: false, title: '',
        }, 1);
        rsiLower.setData(rsiData.map(p => ({ time: p.time, value: 30 })));
        r.rsiLowerLine = rsiLower;

        // Cloud shading inside zones — one LineSeries per contiguous zone span,
        // drawn at the band edge with thick lineWidth to fake a filled cloud.
        if (Array.isArray(rsiCloud.zones)) {
          for (const z of rsiCloud.zones.slice(-40)) {
            const t0 = Math.floor(new Date(z.start_time).getTime() / 1000);
            const t1 = Math.floor(new Date(z.end_time).getTime() / 1000);
            if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) continue;
            const isOver = z.kind === 'overbought';
            const rgb = isOver ? '239,68,68' : '34,197,94';
            // 4 lines stacked between the band edge (70 or 30) and the more
            // extreme edge (100 or 0) but bounded near band so cloud sits inside.
            const lo = isOver ? 70 : 0;
            const hi = isOver ? 100 : 30;
            for (let k = 1; k < 5; k++) {
              const v = lo + (k / 5) * (hi - lo);
              try {
                const seg = chart.addSeries(LineSeries, {
                  color: `rgba(${rgb},0.18)`, lineWidth: 4,
                  crosshairMarkerVisible: false, lastValueVisible: false,
                  priceLineVisible: false, title: '',
                }, 1);
                seg.setData([{ time: t0, value: v }, { time: t1, value: v }]);
                r.rsiZones.push(seg);
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }

    // 5-wave Fib extension price lines on candle series
    if (fibExt && fibExt.setup) {
      for (const proj of (fibExt.setup.projections || [])) {
        try {
          const line = candleSeries.createPriceLine({
            price: proj.price,
            color: proj.hit ? 'rgba(251,146,60,0.85)' : 'rgba(251,146,60,0.45)',
            lineWidth: 1, lineStyle: 1,
            axisLabelVisible: true,
            title: `Fib ${proj.level}${proj.hit ? ' ✓' : ''}`,
          });
          r.fibLines.push(line);
        } catch (_) {}
      }
    }

    // ZZ confirmation price line
    if (zigzag && zigzag.confirmation_price != null) {
      try {
        r.zzConfirmLine = candleSeries.createPriceLine({
          price: zigzag.confirmation_price,
          color: 'rgba(168,85,247,0.7)',
          lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: 'ZZ Confirm',
        });
      } catch (_) {}
    }

    // RSI cloud: colour candle wicks to indicate zone — implemented by tinting
    // candle backgrounds via setData "color" field. Simpler than drawing two
    // bands across the chart area, and matches the inevitrade-style highlight.
    if (rsiCloud && Array.isArray(rsiCloud.points)) {
      const zoneByTime = new Map();
      for (const p of rsiCloud.points) {
        zoneByTime.set(Math.floor(new Date(p.time).getTime() / 1000), p.zone);
      }
      // Tinted candle data — replace candleSeries with a second tinted overlay
      // sitting below it via lineWidth-0 line series? Easiest: tint volume bars.
      const tinted = chartData.map(c => {
        const z = zoneByTime.get(c.time);
        const colour =
          z === 'overbought' ? 'rgba(239,68,68,0.35)' :
          z === 'oversold'   ? 'rgba(34,197,94,0.35)' :
          (c.close >= c.open ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)');
        return { time: c.time, value: c.volume, color: colour };
      });
      volumeSeries.setData(tinted);
      // Mark zone storage so we can revert when RSI toggled off.
      r.rsiTintedData = tinted;
      r.rsiPlainData = chartData.map(c => ({
        time: c.time, value: c.volume,
        color: c.close >= c.open ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
      }));
    }

    chartRef.current = chart;

    const totalBars = chartData.length;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, totalBars - 120),
      to: totalBars + 50,
    });

    // Compute NY session bands as pixel rects on the chart's main pane.
    // Walks the candle series, groups contiguous NY-session bars into start/end
    // pairs, converts to pixel x using timeScale().timeToCoordinate. Re-run on
    // visible range change so panning/zooming keeps bands aligned.
    function recomputeNyBands() {
      const ts = chart.timeScale();
      const intervals = [];
      let runStart = null;
      let runEnd = null;
      for (const c of chartData) {
        if (inNySession(c.time)) {
          if (runStart === null) runStart = c.time;
          runEnd = c.time;
        } else if (runStart !== null) {
          intervals.push([runStart, runEnd]);
          runStart = runEnd = null;
        }
      }
      if (runStart !== null) intervals.push([runStart, runEnd]);

      const rects = [];
      for (const [a, b] of intervals) {
        const xa = ts.timeToCoordinate(a);
        const xb = ts.timeToCoordinate(b);
        if (xa == null || xb == null) continue;
        const left = Math.min(xa, xb);
        const width = Math.max(2, Math.abs(xb - xa));
        rects.push({ left, width });
      }
      setNyBands(rects);
    }
    recomputeNyBands();
    const unsub = chart.timeScale().subscribeVisibleLogicalRangeChange(recomputeNyBands);

    const handleResize = () => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      recomputeNyBands();
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(recomputeNyBands); } catch {}
      chart.remove();
      refs.current.chart = null;
    };
  }, [candles, zigzag, fvgData, structure, rsiCloud, fibExt]);

  // Markers are recomputed whenever overlays change so each group can be hidden.
  useEffect(() => {
    const r = refs.current;
    if (!r.candle) return;

    const candleTimes = new Set(candles.map(c => Math.floor(new Date(c.timestamp).getTime() / 1000)));
    const markers = [];

    if (overlays.zigzagArrows && zigzag && Array.isArray(zigzag.pivots)) {
      for (const p of zigzag.pivots) {
        const t = Math.floor(new Date(p.time).getTime() / 1000);
        if (!candleTimes.has(t)) continue;
        // HH/HL = bullish-structure (green); LH/LL = bearish-structure (orange).
        // Tentative pivots faded purple regardless of label.
        const lbl = p.label || (p.kind === 'HIGH' ? 'H' : 'L');
        const bullish = lbl === 'HH' || lbl === 'HL';
        const color = p.confirmed
          ? (bullish ? '#22c55e' : '#f97316')
          : 'rgba(168,85,247,0.55)';
        markers.push({
          time: t,
          position: p.kind === 'HIGH' ? 'aboveBar' : 'belowBar',
          color,
          shape: p.kind === 'HIGH' ? 'arrowDown' : 'arrowUp',
          text: lbl,
          size: p.confirmed ? 2 : 1,
        });
      }
    }

    if (overlays.choch && structure && Array.isArray(structure.events)) {
      for (const ev of structure.events.slice(-20)) {
        const t = Math.floor(new Date(ev.time).getTime() / 1000);
        if (!candleTimes.has(t)) continue;
        const up = ev.kind.endsWith('UP');
        const isChoCh = ev.kind.startsWith('CHOCH');
        markers.push({
          time: t,
          position: up ? 'aboveBar' : 'belowBar',
          color: isChoCh ? '#ef4444' : '#3b82f6',
          shape: up ? 'arrowUp' : 'arrowDown',
          text: isChoCh ? 'CHoCH' : 'BOS',
          size: 1,
        });
      }
    }

    // NY open: the visual band is candle-tint based (toggled by overlays.nyOpen
    // in the visibility effect). No marker needed.

    // Dedup + sort
    const seen = new Set();
    const dedup = markers
      .sort((a, b) => a.time - b.time || a.position.localeCompare(b.position))
      .filter(m => {
        const key = `${m.time}-${m.shape}-${m.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    try { createSeriesMarkers(r.candle, dedup); } catch (_) {}
  }, [overlays, candles, zigzag, structure, fvgData]);

  // Series visibility toggles
  useEffect(() => {
    const r = refs.current;
    if (!r.candle) return;
    const setVis = (s, k) => { try { s?.applyOptions({ visible: !!overlays[k] }); } catch {} };
    setVis(r.sma20, 'sma20');
    setVis(r.sma50, 'sma50');
    setVis(r.zigzag, 'zigzag');
    setVis(r.volume, 'volume');

    // FVG fills are arrays-of-arrays (each gap = group of stacked lines).
    for (const group of r.fvgFills || []) {
      for (const s of group) setVis(s, 'fvg');
    }
    for (const s of r.fvgMids || []) setVis(s, 'fvgMid');

    // RSI pane (series + reference bands + cloud shading) all share one toggle.
    setVis(r.rsiSeries, 'rsi');
    setVis(r.rsiUpperLine, 'rsi');
    setVis(r.rsiLowerLine, 'rsi');
    for (const s of r.rsiZones || []) setVis(s, 'rsi');

    for (const s of r.fibLines || []) {
      try { s?.applyOptions({ lineVisible: !!overlays.fibExt, axisLabelVisible: !!overlays.fibExt }); } catch {}
    }
    if (r.zzConfirmLine) {
      try { r.zzConfirmLine.applyOptions({ lineVisible: !!overlays.zzConfirm, axisLabelVisible: !!overlays.zzConfirm }); } catch {}
    }

  }, [overlays, candles, zigzag, fvgData, fibExt, rsiCloud, structure]);

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

      <div className="animate-fade-in" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {COINS.map(coin => {
          const c = COIN_COLORS[coin] || '#64748b';
          const active = coin === instrument;
          return (
            <button
              key={coin}
              onClick={() => switchCoin(coin)}
              style={{
                padding: '6px 14px', borderRadius: '8px',
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

      <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
        <CardHeader>
          <CardTitle icon={Activity} iconColor={coinColor}>
            {instrument} · Candlestick Chart
          </CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {TIMEFRAMES.map(tf => (
              <button key={tf.value} onClick={() => setTimeframe(tf.value)} style={{
                padding: '5px 13px', borderRadius: '7px', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600, transition: 'all 0.15s',
                background: timeframe === tf.value ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: timeframe === tf.value ? '#3b82f6' : '#64748b',
                border: 'none',
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
            <div style={{ position: 'relative' }}>
              <div ref={chartContainerRef} style={{ height: '560px', padding: '0 8px 8px' }} />

              {/* NY session bands — DOM overlay positioned via timeScale coordinates.
                  Sits behind toolbar but above chart pane via z-index. Pointer-events
                  off so chart interactions still work. */}
              {overlays.nyOpen && nyBands.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0,
                  height: 'calc(70% - 8px)',  // main pane only; RSI pane sits below
                  pointerEvents: 'none',
                  overflow: 'hidden',
                }}>
                  {nyBands.map((b, i) => (
                    <div key={i} style={{
                      position: 'absolute',
                      top: 0, bottom: 0,
                      left: `${b.left + 8}px`,  // +8 to match container padding
                      width: `${b.width}px`,
                      background: 'rgba(180,200,220,0.06)',
                      borderLeft: '1px solid rgba(180,200,220,0.10)',
                      borderRight: '1px solid rgba(180,200,220,0.10)',
                    }} />
                  ))}
                </div>
              )}

              <IndicatorToolbar overlays={overlays} onToggle={(k) => setOverlays(o => ({ ...o, [k]: !o[k] }))} />
            </div>
          )}
        </CardContent>
      </Card>

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
          {['4h', '1h', '15m', '5m'].map(tf => {
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
    </div>
  );
}
