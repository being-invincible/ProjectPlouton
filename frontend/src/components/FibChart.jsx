/**
 * FibChart — TradingView-style Fibonacci analysis chart.
 *
 * Visuals:
 *   1. Candlesticks + volume
 *   2. Fib levels via createPriceLine (labeled, reliable)
 *   3. Golden Pocket zone fill (BaselineSeries, full-width)
 *   4. Swing H/L arrow markers + large Entry marker
 *   5. Entry / SL / TP1 / TP2 / Exit price lines
 *   6. Diagonal Fib-tool handle (swing H → swing L)
 */

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  BaselineSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import api from '../lib/api';

const BG   = '#131722';
const GRID = 'rgba(255,255,255,0.04)';
const UP   = '#26a69a';
const DOWN = '#ef5350';

const toUnix   = iso => Math.floor(new Date(iso).getTime() / 1000);
const fibPrice = (hi, lo, lvl) => lo + lvl * (hi - lo);

function LegendRow({ color, dash, fill, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
      <div style={{
        width: 22,
        height: fill ? 8 : 2,
        flexShrink: 0,
        borderRadius: fill ? 2 : 1,
        background: fill
          ? 'rgba(255,215,0,0.18)'
          : dash ? 'transparent' : color,
        borderTop: (!fill && dash) ? `2px dashed ${color}` : 'none',
        border: fill ? `1px solid ${color}` : 'none',
      }} />
      <span style={{ color: '#cbd5e1', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  );
}

export default function FibChart({ trade }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const [status, setStatus] = useState('loading');
  const [msg,    setMsg]    = useState('');

  useEffect(() => {
    if (!trade?.instrument) return;
    let alive = true;

    (async () => {
      try {
        setStatus('loading');
        const raw = await api.getCandles(trade.instrument, '5m', 5000);
        if (!alive) return;

        if (!Array.isArray(raw) || raw.length === 0) {
          setStatus('error');
          setMsg('No candle data — bot must scan this coin first');
          return;
        }
        if (!containerRef.current) return;

        // ── Sort candles ──────────────────────────────────────────
        const chartData = raw
          .map(c => ({
            time:   toUnix(c.timestamp),
            open:   c.open, high: c.high, low: c.low, close: c.close,
            volume: c.volume || 0,
          }))
          .sort((a, b) => a.time - b.time);

        // ── Parse trade fields ────────────────────────────────────
        const entry     = parseFloat(trade.entry_price);
        const slRaw     = parseFloat(trade.stop_loss);
        const tp1       = trade.tp1_price   ? parseFloat(trade.tp1_price)   : null;
        const tp2       = trade.tp2_price   ? parseFloat(trade.tp2_price)   : null;
        const exitPrice = trade.exit_price  ? parseFloat(trade.exit_price)  : null;
        const direction = trade.direction;

        // When old TP1_PARTIAL code moved SL to TP1, recover the original SL
        // from the 1.5R formula: TP1 = entry ± 1.5*risk, so risk = |tp1-entry|/1.5
        const slMoved = tp1 !== null && Math.abs(slRaw - tp1) < 0.001;
        const sl = slMoved
          ? (direction === 'LONG'
              ? entry - (tp1 - entry) / 1.5
              : entry + (entry - tp1) / 1.5)
          : slRaw;
        const entryUnix = trade.timestamp   ? toUnix(trade.timestamp)       : chartData[chartData.length - 1].time;
        const exitUnix  = trade.exit_timestamp && trade.exit_timestamp !== 'NaT'
          ? toUnix(trade.exit_timestamp)
          : trade.closed_at ? toUnix(trade.closed_at) : null;

        // Snap to nearest candle time
        const snap = (targetUnix) =>
          chartData.reduce((best, c) =>
            Math.abs(c.time - targetUnix) < Math.abs(best.time - targetUnix) ? c : best,
            chartData[0]).time;

        // Compute simple moving average — returns array of { time, value } skipping warmup nulls
        const computeSMA = (data, period) =>
          data.reduce((acc, c, i) => {
            if (i < period - 1) return acc;
            const slice = data.slice(i - period + 1, i + 1);
            const avg = slice.reduce((s, x) => s + x.close, 0) / period;
            acc.push({ time: c.time, value: avg });
            return acc;
          }, []);

        const entrySnapped = snap(entryUnix);

        // Swing H/L — use saved values or compute from 100 candles before entry
        let swHigh = trade.swing_high ? parseFloat(trade.swing_high) : null;
        let swLow  = trade.swing_low  ? parseFloat(trade.swing_low)  : null;
        if (!swHigh || !swLow) {
          const before = chartData.filter(c => c.time <= entrySnapped).slice(-100);
          if (before.length >= 10) {
            swHigh = Math.max(...before.map(c => c.high));
            swLow  = Math.min(...before.map(c => c.low));
          }
        }

        // ── Build chart ───────────────────────────────────────────
        const chart = createChart(containerRef.current, {
          layout: {
            background:  { color: BG },
            textColor:   '#787b86',
            fontFamily:  'Inter, system-ui, sans-serif',
            fontSize:    11,
          },
          grid: {
            vertLines: { color: GRID },
            horzLines: { color: GRID },
          },
          crosshair: {
            vertLine: { color: 'rgba(59,130,246,0.5)', width: 1, style: 2 },
            horzLine: { color: 'rgba(59,130,246,0.5)', width: 1, style: 2 },
          },
          timeScale: {
            borderColor:    'rgba(255,255,255,0.08)',
            timeVisible:    true,
            secondsVisible: false,
          },
          rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
          handleScroll:    { vertTouchDrag: false },
        });

        // ── Candles ───────────────────────────────────────────────
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor:        UP,   downColor:        DOWN,
          borderUpColor:  UP,   borderDownColor:  DOWN,
          wickUpColor:    UP + '99', wickDownColor: DOWN + '99',
        });
        candleSeries.setData(chartData);

        // ── Volume ────────────────────────────────────────────────
        const volSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' }, priceScaleId: 'vol',
        });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } });
        volSeries.setData(chartData.map(c => ({
          time:  c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(38,166,154,0.18)' : 'rgba(239,83,80,0.18)',
        })));

        // ── SMA overlays ─────────────────────────────────────────
        const sma20data = computeSMA(chartData, 20);
        const sma50data = computeSMA(chartData, 50);

        const sma20Series = chart.addSeries(LineSeries, {
          color:                   '#2196f3',
          lineWidth:               1,
          crosshairMarkerVisible:  false,
          lastValueVisible:        false,
          priceLineVisible:        false,
          title:                   'SMA20',
        });
        sma20Series.setData(sma20data);

        const sma50Series = chart.addSeries(LineSeries, {
          color:                   'rgba(255,255,255,0.65)',
          lineWidth:               1,
          crosshairMarkerVisible:  false,
          lastValueVisible:        false,
          priceLineVisible:        false,
          title:                   'SMA50',
        });
        sma50Series.setData(sma50data);

        // ── Markers (accumulate, sort, then set once) ─────────────
        const markers = [];
        let swHighTime = null;
        let swLowTime  = null;

        // Draws a horizontal fib line from anchorTime to lastCandleTime (floating, not full-width)
        const addFibLine = (anchorTime, lastTime, price, color, lineWidth, label) => {
          try {
            const s = chart.addSeries(LineSeries, {
              color,
              lineWidth,
              lineStyle: 0,
              crosshairMarkerVisible: false,
              lastValueVisible: true,
              priceLineVisible: false,
              title: label,
            });
            s.setData([
              { time: anchorTime, value: price },
              { time: lastTime,   value: price },
            ]);
          } catch (_) {}
        };

        // ── Fibonacci overlays ────────────────────────────────────
        if (swHigh && swLow) {
          const before = chartData.filter(c => c.time <= entrySnapped);

          // Find candles whose high/low best match the swing prices
          const swHighCandle = before.length
            ? before.reduce((b, c) => Math.abs(c.high - swHigh) < Math.abs(b.high - swHigh) ? c : b)
            : null;
          const swLowCandle = before.length
            ? before.reduce((b, c) => Math.abs(c.low - swLow) < Math.abs(b.low - swLow) ? c : b)
            : null;

          swHighTime = swHighCandle?.time ?? (entrySnapped - 3600 * 3);
          swLowTime  = swLowCandle?.time  ?? (entrySnapped - 3600 * 1);

          // Swing markers on the candle chart
          markers.push({
            time:     swHighTime,
            position: 'aboveBar',
            color:    '#ffd700',
            shape:    'arrowDown',
            text:     `Swing H  ${swHigh.toFixed(4)}`,
            size:     2,
          });
          markers.push({
            time:     swLowTime,
            position: 'belowBar',
            color:    '#ffd700',
            shape:    'arrowUp',
            text:     `Swing L  ${swLow.toFixed(4)}`,
            size:     2,
          });

          // Floating fib retracement lines — bounded LineSeries (anchorTime → lastCandleTime)
          const lastCandleTime = chartData[chartData.length - 1].time;
          const fibAnchorTime  = Math.min(swHighTime, swLowTime);

          const FLOAT_FIB_LEVELS = [
            { level: 0.382, label: '0.382', color: '#f59e0b', width: 1 },
            { level: 0.5,   label: '0.5',   color: '#22c55e', width: 2 },
            { level: 0.618, label: '0.618', color: '#22c55e', width: 2 },
            { level: 1.0,   label: '1.0',   color: 'rgba(200,200,200,0.7)', width: 1 },
          ];

          for (const fib of FLOAT_FIB_LEVELS) {
            const price = fibPrice(swHigh, swLow, fib.level);
            addFibLine(fibAnchorTime, lastCandleTime, price, fib.color, fib.width,
              `${fib.label}  ${price.toFixed(2)}`);
          }

          // Extension lines above swing high (1.272 gold, 1.414 red, 1.618 blue)
          const rng = swHigh - swLow;
          const EXT_LEVELS = [
            { mult: 0.272, label: '1.272', color: '#f59e0b', width: 2 },
            { mult: 0.414, label: '1.414', color: '#ef5350', width: 2 },
            { mult: 0.618, label: '1.618', color: '#2196f3', width: 2 },
          ];
          for (const ext of EXT_LEVELS) {
            const price = swHigh + ext.mult * rng;
            addFibLine(fibAnchorTime, lastCandleTime, price, ext.color, ext.width,
              `${ext.label}  ${price.toFixed(2)}`);
          }

          // Golden Pocket zone fill — BaselineSeries with full candle data ensures render
          const gp50  = fibPrice(swHigh, swLow, 0.5);
          const gp618 = fibPrice(swHigh, swLow, 0.618);
          try {
            const gpZone = chart.addSeries(BaselineSeries, {
              baseValue:        { type: 'price', price: gp50 },
              topLineColor:     'transparent',
              topFillColor1:    'rgba(255,215,0,0.22)',
              topFillColor2:    'rgba(255,215,0,0.08)',
              bottomLineColor:  'transparent',
              bottomFillColor1: 'transparent',
              bottomFillColor2: 'transparent',
              lineWidth:         0,
              crosshairMarkerVisible: false,
              lastValueVisible:  false,
              priceLineVisible:  false,
              title:             '',
            });
            // Use all candle times — avoids the 2-point rendering gap issue
            gpZone.setData(chartData.map(c => ({ time: c.time, value: gp618 })));
          } catch (_) { /* GP price lines above already mark the zone */ }

          // Diagonal Fib-tool handle: visually shows WHERE the measurement was drawn
          try {
            const diagSeries = chart.addSeries(LineSeries, {
              color: 'rgba(255,215,0,0.5)',
              lineWidth: 1,
              lineStyle: 1,
              crosshairMarkerVisible: false,
              lastValueVisible:       false,
              priceLineVisible:       false,
              title:                  '',
            });
            diagSeries.setData([
              { time: swHighTime, value: swHigh },
              { time: swLowTime,  value: swLow  },
            ]);
          } catch (_) { /* not critical */ }
        }

        // ── Entry marker ──────────────────────────────────────────
        markers.push({
          time:     entrySnapped,
          position: direction === 'LONG' ? 'belowBar' : 'aboveBar',
          color:    '#2196f3',
          shape:    direction === 'LONG' ? 'arrowUp' : 'arrowDown',
          text:     `ENTRY  ${entry.toFixed(4)}`,
          size:     3,
        });

        // ── TP1 marker (milestone — position not closed here) ─────
        if (tp1 !== null && trade.tp1_hit) {
          const afterEntry = chartData.filter(c => c.time > entrySnapped);
          const tp1Candle = direction === 'LONG'
            ? afterEntry.find(c => c.high >= tp1)
            : afterEntry.find(c => c.low  <= tp1);
          if (tp1Candle) {
            markers.push({
              time:     tp1Candle.time,
              position: direction === 'LONG' ? 'aboveBar' : 'belowBar',
              color:    '#26a69a',
              shape:    'circle',
              text:     `TP1  ${tp1.toFixed(4)}`,
              size:     1,
            });
          }
        }

        // ── Exit marker — use timestamp if available, else find by price ──
        let exitSnapped = null;
        if (exitPrice) {
          if (exitUnix) {
            exitSnapped = snap(exitUnix);
          } else {
            // Fallback: first candle after entry where price was hit
            const afterEntry = chartData.filter(c => c.time > entrySnapped);
            const hitCandle = direction === 'LONG'
              ? afterEntry.find(c => c.high >= exitPrice)   // exit hit on high
              : afterEntry.find(c => c.low  <= exitPrice);  // exit hit on low
            if (hitCandle) exitSnapped = hitCandle.time;
          }
          if (exitSnapped) {
            markers.push({
              time:     exitSnapped,
              position: direction === 'LONG' ? 'aboveBar' : 'belowBar',
              color:    '#f59e0b',
              shape:    direction === 'LONG' ? 'arrowDown' : 'arrowUp',
              text:     `EXIT(${trade.exit_reason || 'CLOSE'})  ${exitPrice.toFixed(4)}`,
              size:     2,
            });
          }
        }

        markers.sort((a, b) => a.time - b.time);
        createSeriesMarkers(candleSeries, markers);

        // ── Trade level price lines ────────────────────────────────
        candleSeries.createPriceLine({
          price: entry, color: '#2196f3', lineWidth: 2, lineStyle: 0,
          axisLabelVisible: true, title: `${direction} ENTRY`,
        });
        candleSeries.createPriceLine({
          price: sl, color: '#ef4444', lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: 'SL',
        });
        if (tp1 !== null) {
          candleSeries.createPriceLine({
            price: tp1, color: '#26a69a', lineWidth: 1, lineStyle: 2,
            axisLabelVisible: true, title: 'TP1',
          });
        }
        if (tp2 !== null) {
          candleSeries.createPriceLine({
            price: tp2, color: '#00e676', lineWidth: 2, lineStyle: 0,
            axisLabelVisible: true, title: 'TP2',
          });
        }
        if (exitPrice !== null) {
          candleSeries.createPriceLine({
            price: exitPrice, color: '#f59e0b', lineWidth: 1, lineStyle: 1,
            axisLabelVisible: true, title: `EXIT(${trade.exit_reason || 'CLOSE'})`,
          });
        }

        // ── Zoom: from earliest swing marker to exit (+ padding) ──
        const PAD = 8;
        const swingFromTime = swHigh && swLow
          ? Math.min(
              chartData.findIndex(c => c.time >= (swHighTime ?? 0)),
              chartData.findIndex(c => c.time >= (swLowTime  ?? 0)),
            )
          : 0;
        const swingFromIdx  = swingFromTime >= 0 ? swingFromTime : 0;
        const entryIdx      = chartData.findIndex(c => c.time >= entrySnapped);
        const exitIdx       = exitSnapped
          ? chartData.findIndex(c => c.time >= exitSnapped)
          : entryIdx + 40;
        const toIdx         = exitIdx >= 0 ? exitIdx : chartData.length - 1;

        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, swingFromIdx - PAD),
          to:   toIdx + PAD,
        });

        chartRef.current = chart;
        setStatus('ready');

        const onResize = () => {
          if (containerRef.current && chart) {
            chart.applyOptions({ width: containerRef.current.clientWidth });
          }
        };
        window.addEventListener('resize', onResize);
        chart._onResize = onResize;

      } catch (err) {
        if (!alive) return;
        console.error('FibChart error:', err);
        setStatus('error');
        setMsg('Chart render failed — check console');
      }
    })();

    return () => {
      alive = false;
      if (chartRef.current?._onResize) window.removeEventListener('resize', chartRef.current._onResize);
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [trade?.id]);

  const entry  = trade?.entry_price ? parseFloat(trade.entry_price) : null;
  const slRaw  = trade?.stop_loss   ? parseFloat(trade.stop_loss)   : null;
  const tp1    = trade?.tp1_price   ? parseFloat(trade.tp1_price)   : null;
  const tp2    = trade?.tp2_price   ? parseFloat(trade.tp2_price)   : null;
  const slMoved = entry != null && tp1 != null && slRaw != null && Math.abs(slRaw - tp1) < 0.001;
  const sl = slMoved
    ? (trade?.direction === 'LONG'
        ? entry - (tp1 - entry) / 1.5
        : entry + (entry - tp1) / 1.5)
    : slRaw;

  return (
    <div style={{ position: 'relative', background: BG, borderRadius: 8, overflow: 'hidden', height: 520 }}>
      <div ref={containerRef} style={{ height: 520 }} />

      {status !== 'ready' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: BG,
        }}>
          {status === 'loading'
            ? <span style={{ color: '#787b86', fontSize: 13 }}>Loading chart…</span>
            : <span style={{ color: '#ef4444', fontSize: 13 }}>{msg}</span>}
        </div>
      )}

      {status === 'ready' && (
        <div style={{
          position: 'absolute', top: 12, left: 14,
          display: 'flex', flexDirection: 'column', gap: 5,
          padding: '8px 12px', borderRadius: 6,
          background: 'rgba(19,23,34,0.88)',
          backdropFilter: 'blur(4px)',
          border: '1px solid rgba(255,255,255,0.06)',
          pointerEvents: 'none',
          maxWidth: 230,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#d1d4dc', marginBottom: 3, letterSpacing: '0.05em' }}>
            {trade.instrument} · {trade.direction} · Golden Pocket
          </div>
          {trade.swing_high && trade.swing_low && (() => {
            const sh = parseFloat(trade.swing_high);
            const sl_ = parseFloat(trade.swing_low);
            const r = sh - sl_;
            return <>
              <LegendRow color="rgba(200,200,200,0.7)" label={`1.0  ${sh.toFixed(2)}`} />
              <LegendRow color="#22c55e" label={`0.618  ${(sl_ + 0.618 * r).toFixed(2)}`} />
              <LegendRow color="#22c55e" label={`0.5   ${(sl_ + 0.5   * r).toFixed(2)}`} />
              <LegendRow color="#f59e0b" label={`0.382  ${(sl_ + 0.382 * r).toFixed(2)}`} />
              <LegendRow color="#f59e0b" fill label="GP Zone  50% – 61.8%" />
              <LegendRow color="#f59e0b" label={`1.272  ${(sh + 0.272 * r).toFixed(2)}`} />
              <LegendRow color="#ef5350" label={`1.414  ${(sh + 0.414 * r).toFixed(2)}`} />
              <LegendRow color="#2196f3" label={`1.618  ${(sh + 0.618 * r).toFixed(2)}`} />
            </>;
          })()}
          {entry != null && <LegendRow color="#2196f3" label={`Entry  ${entry.toFixed(4)}`} />}
          {sl    != null && <LegendRow color="#ef4444" dash label={`SL  ${sl.toFixed(4)}`} />}
          {tp1   != null && <LegendRow color="#26a69a" dash label={`TP1  ${tp1.toFixed(4)}`} />}
          {tp2   != null && <LegendRow color="#00e676" label={`TP2  ${tp2.toFixed(4)}`} />}
          {trade.exit_price && (
            <LegendRow color="#f59e0b" label={`Exit(${trade.exit_reason})  ${parseFloat(trade.exit_price).toFixed(4)}`} />
          )}
          <LegendRow color="#2196f3" label="SMA 20" />
          <LegendRow color="rgba(255,255,255,0.65)" label="SMA 50" />
        </div>
      )}

      {status === 'ready' && trade.timestamp && (
        <div style={{
          position: 'absolute', top: 12, right: 14,
          fontSize: 11, color: '#787b86',
          fontFamily: 'JetBrains Mono, monospace',
          padding: '4px 10px', borderRadius: 5,
          background: 'rgba(19,23,34,0.88)',
          border: '1px solid rgba(255,255,255,0.06)',
          pointerEvents: 'none',
        }}>
          Entry: {new Date(trade.timestamp).toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
          })}
        </div>
      )}
    </div>
  );
}
