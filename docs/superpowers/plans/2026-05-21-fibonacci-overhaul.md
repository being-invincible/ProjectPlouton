# Fibonacci Strategy + Chart Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Golden Pocket strategy's SL/TP logic with video methodology, and upgrade FibChart.jsx to render floating Fibonacci lines, extension levels, and SMA overlays matching TradingView's visual style.

**Architecture:** Backend changes are confined to `golden_pocket.py` — SL moves to below 0.382 level (with ATR buffer), single TP between 1.272 and 1.414 extensions. Frontend changes are confined to `FibChart.jsx` — replace full-width `createPriceLine()` calls with bounded `LineSeries` (2 data points each) for floating line appearance, add extension levels, add client-side SMA20/SMA50 computed from already-fetched candles.

**Tech Stack:** Python 3.11+ (backend), React + lightweight-charts v5 (frontend), DuckDB (data), existing `tp1_price`/`tp2_price` DB schema preserved.

---

## File Map

| File | Change |
|------|--------|
| `backend/strategy/golden_pocket.py` | SL formula → below 0.382; TP formula → between 1.272 and 1.414 |
| `frontend/src/components/FibChart.jsx` | Replace createPriceLine fib lines → LineSeries; add extensions; add SMA20/SMA50 |
| `tests/strategy/test_golden_pocket.py` | Update SL/TP assertions to new formulas |

---

## Task 1: Fix SL — place below 0.382 with ATR buffer

**Files:**
- Modify: `backend/strategy/golden_pocket.py:90-100`
- Test: `tests/strategy/test_golden_pocket.py`

Context: Current SL uses `swing_high - 0.786 * rng` (78.6% fib) or `1.5*ATR`. New rule: SL = `0.382 level - 0.5*ATR` for LONG (below the 0.382 structural support). For SHORT: SL = `(swing_high - 0.382*rng) + 0.5*ATR` (above 0.382 resistance). The 0.382 level is the nearest structural support below the golden pocket entry zone — if price breaks it, the retracement has failed.

- [ ] **Step 1: Find the existing test file or create it**

```bash
ls tests/strategy/ 2>/dev/null || mkdir -p tests/strategy && touch tests/strategy/__init__.py
```

- [ ] **Step 2: Write the failing test**

In `tests/strategy/test_golden_pocket.py`, add:

```python
import pandas as pd
import numpy as np
import pytest
from unittest.mock import patch
from backend.strategy.golden_pocket import GoldenPocketStrategy


def _make_df(n=100, base=100.0):
    """Synthetic OHLCV dataframe with non-zero volume."""
    idx = pd.date_range("2024-01-01", periods=n, freq="5min")
    closes = np.linspace(base, base * 1.1, n)
    df = pd.DataFrame({
        "Open":   closes * 0.999,
        "High":   closes * 1.002,
        "Low":    closes * 0.998,
        "Close":  closes,
        "Volume": np.ones(n) * 1000,
    }, index=idx)
    return df


def test_sl_long_below_0382():
    strat = GoldenPocketStrategy()
    swing_high, swing_low = 2000.0, 1000.0
    rng = swing_high - swing_low
    fib_0382 = swing_low + 0.382 * rng   # = 1382.0
    atr = 50.0
    entry = swing_low + 0.55 * rng       # inside golden pocket

    sl = strat._stop_loss(entry, atr, swing_high, swing_low, "LONG")

    expected = fib_0382 - 0.5 * atr      # = 1357.0
    assert abs(sl - expected) < 0.01, f"SL={sl}, expected={expected}"
    assert sl < fib_0382, "SL must be below 0.382 level"


def test_sl_short_above_0382():
    strat = GoldenPocketStrategy()
    swing_high, swing_low = 2000.0, 1000.0
    rng = swing_high - swing_low
    fib_0382_short = swing_high - 0.382 * rng  # = 1618.0
    atr = 50.0
    entry = swing_high - 0.55 * rng            # inside golden pocket short

    sl = strat._stop_loss(entry, atr, swing_high, swing_low, "SHORT")

    expected = fib_0382_short + 0.5 * atr      # = 1643.0
    assert abs(sl - expected) < 0.01, f"SL={sl}, expected={expected}"
    assert sl > fib_0382_short, "SL must be above 0.382 level for SHORT"
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /Users/hash/Documents/GitHub/ProjectHermes
python -m pytest tests/strategy/test_golden_pocket.py::test_sl_long_below_0382 tests/strategy/test_golden_pocket.py::test_sl_short_above_0382 -v
```

Expected: FAIL — assertions fail with old 78.6% formula.

- [ ] **Step 4: Update `_stop_loss` in golden_pocket.py**

Replace the entire `_stop_loss` method at line 90–100:

```python
def _stop_loss(self, entry: float, atr: float, swing_high: float, swing_low: float, direction: str) -> float:
    """SL below/above 0.382 Fib level with 0.5*ATR buffer — structural invalidation."""
    rng = swing_high - swing_low
    if direction == "LONG":
        fib_0382 = swing_low + 0.382 * rng
        return fib_0382 - 0.5 * atr
    else:
        fib_0382 = swing_high - 0.382 * rng
        return fib_0382 + 0.5 * atr
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
python -m pytest tests/strategy/test_golden_pocket.py::test_sl_long_below_0382 tests/strategy/test_golden_pocket.py::test_sl_short_above_0382 -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/strategy/golden_pocket.py tests/strategy/test_golden_pocket.py tests/strategy/__init__.py
git commit -m "fix: SL moves to below 0.382 fib level with 0.5*ATR buffer"
```

---

## Task 2: Fix TP — single target between 1.272 and 1.414 extensions

**Files:**
- Modify: `backend/strategy/golden_pocket.py:102-112`
- Also modify: `Signal` dataclass at line 28–40 — drop `tp2`, keep `tp1`
- Test: `tests/strategy/test_golden_pocket.py`

Context: TP = `fib_1272 + 0.382 * (fib_1414 - fib_1272)`. This places the single target 38.2% of the way between the 1.272 and 1.414 extension levels — logical cluster resistance, not mechanical swing math. The existing DB schema uses `tp1_price` and `tp2_price` columns. We keep `tp1_price` = new TP, `tp2_price` = `None`. The `Signal` dataclass keeps `tp1` and `tp2` fields to avoid rippling changes; `tp2` always set to `None`.

- [ ] **Step 1: Write the failing test**

Add to `tests/strategy/test_golden_pocket.py`:

```python
def test_tp_between_1272_and_1414_long():
    strat = GoldenPocketStrategy()
    swing_high, swing_low = 2000.0, 1000.0
    rng = swing_high - swing_low
    fib_1272 = swing_high + 0.272 * rng   # = 2272.0
    fib_1414 = swing_high + 0.414 * rng   # = 2414.0
    atr = 50.0
    entry = swing_low + 0.55 * rng        # = 1550.0
    sl = swing_low + 0.382 * rng - 0.5 * atr

    tp1, tp2 = strat._take_profits(entry, sl, swing_high, swing_low, "LONG")

    expected_tp1 = fib_1272 + 0.382 * (fib_1414 - fib_1272)  # = 2326.3
    assert abs(tp1 - expected_tp1) < 0.01, f"TP1={tp1}, expected={expected_tp1}"
    assert tp2 is None, "tp2 must be None — single target design"


def test_tp_between_1272_and_1414_short():
    strat = GoldenPocketStrategy()
    swing_high, swing_low = 2000.0, 1000.0
    rng = swing_high - swing_low
    fib_1272_short = swing_low - 0.272 * rng   # = 728.0
    fib_1414_short = swing_low - 0.414 * rng   # = 586.0
    atr = 50.0
    entry = swing_high - 0.55 * rng             # = 1450.0
    sl = swing_high - 0.382 * rng + 0.5 * atr

    tp1, tp2 = strat._take_profits(entry, sl, swing_high, swing_low, "SHORT")

    expected_tp1 = fib_1272_short - 0.382 * (fib_1272_short - fib_1414_short)  # = 673.6
    assert abs(tp1 - expected_tp1) < 0.01, f"TP1={tp1}, expected={expected_tp1}"
    assert tp2 is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python -m pytest tests/strategy/test_golden_pocket.py::test_tp_between_1272_and_1414_long tests/strategy/test_golden_pocket.py::test_tp_between_1272_and_1414_short -v
```

Expected: FAIL.

- [ ] **Step 3: Update `_take_profits` in golden_pocket.py**

Replace the entire `_take_profits` method at line 102–112:

```python
def _take_profits(self, entry: float, stop_loss: float, swing_high: float, swing_low: float, direction: str) -> tuple[float, None]:
    """Single TP — 38.2% of the way between 1.272 and 1.414 Fib extensions."""
    rng = swing_high - swing_low
    if direction == "LONG":
        fib_1272 = swing_high + 0.272 * rng
        fib_1414 = swing_high + 0.414 * rng
        tp1 = fib_1272 + 0.382 * (fib_1414 - fib_1272)
    else:
        fib_1272 = swing_low - 0.272 * rng
        fib_1414 = swing_low - 0.414 * rng
        tp1 = fib_1272 - 0.382 * (fib_1272 - fib_1414)
    return tp1, None
```

- [ ] **Step 4: Update Signal construction at bottom of `analyze()` (~line 168)**

The `Signal` dataclass has `tp1` and `tp2` fields. The `analyze()` method sets both. Change the return to null out tp2:

```python
return Signal(
    coin=coin,
    direction=direction,
    entry_price=entry,
    stop_loss=sl,
    tp1=tp1,
    tp2=None,          # single target design — tp2 always None
    fib_level_triggered=fib_triggered,
    swing_high=swing.high,
    swing_low=swing.low,
    atr=atr,
    timestamp=df.index[-1],
)
```

- [ ] **Step 5: Run all strategy tests**

```bash
python -m pytest tests/strategy/test_golden_pocket.py -v
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/strategy/golden_pocket.py tests/strategy/test_golden_pocket.py
git commit -m "fix: single TP at 38.2% between 1.272 and 1.414 fib extensions"
```

---

## Task 3: FibChart — replace createPriceLine with bounded LineSeries for floating lines

**Files:**
- Modify: `frontend/src/components/FibChart.jsx`

Context: `createPriceLine()` always spans the full chart width. To get TradingView's floating line appearance (line starts at swing anchor, ends at right edge of data, does NOT extend left of the swing), use `LineSeries` with exactly 2 data points: `{ time: anchorTime, value: price }` and `{ time: lastCandleTime, value: price }`. The label appears at the right edge via the `title` option on the series. `priceLineVisible: false`, `lastValueVisible: true` with custom formatting gives the price label on the right axis.

Remove all `createPriceLine()` calls for fib levels. Keep the `createPriceLine()` calls for ENTRY, SL, TP, EXIT (those should still span full width — they're trade levels, not fib tool lines).

Match video colors exactly:
- 0.382 → gold `#f59e0b`, width 1, dashed
- 0.5 → `#22c55e` green, width 2, solid
- 0.618 → `#22c55e` green, width 2, solid
- 1.0 → `rgba(200,200,200,0.7)` white, width 1, dashed
- 1.272 → `#f59e0b` gold, width 2, solid (extension)
- 1.414 → `#ef5350` red, width 2, solid (extension)
- 1.618 → `#2196f3` blue, width 2, solid (extension)

- [ ] **Step 1: Add helper function at top of the `useEffect` async block (after `chartData` is built)**

Locate the comment `// ── Fibonacci overlays ────────────────────────────` in FibChart.jsx (~line 184). Just before it, add this helper inside the async IIFE:

```js
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
```

- [ ] **Step 2: Replace the fib level price lines block**

Find this block in FibChart.jsx (~line 217–228):

```js
// Fib level price lines — createPriceLine is reliable and labeled
for (const fib of FIB_LEVELS) {
  const price = fibPrice(swHigh, swLow, fib.level);
  candleSeries.createPriceLine({
    price,
    color:            fib.color,
    lineWidth:        fib.width,
    lineStyle:        fib.style,
    axisLabelVisible: true,
    title:            `${fib.label}  ${price.toFixed(4)}`,
  });
}
```

Replace with:

```js
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
```

- [ ] **Step 3: Remove the old `FIB_LEVELS` constant at the top of the file**

Delete lines 29–37 (the `const FIB_LEVELS = [...]` array) — it is replaced by `FLOAT_FIB_LEVELS` inline.

- [ ] **Step 4: Add extension lines above swing high**

Immediately after the retracement lines block added in Step 2, add:

```js
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
```

- [ ] **Step 5: Update legend rows in the JSX to match new levels**

Find the legend section (~line 441–444):

```jsx
{trade.swing_high && trade.swing_low && <>
  <LegendRow color="#ffd700" label={`Swing H  ${parseFloat(trade.swing_high).toFixed(4)}`} />
  <LegendRow color="#ffd700" label={`Swing L  ${parseFloat(trade.swing_low).toFixed(4)}`} />
  <LegendRow color="#ffd700" fill label="GP Zone  50% – 61.8%" />
</>}
```

Replace with:

```jsx
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
```

- [ ] **Step 6: Verify chart renders — start dev server**

```bash
cd /Users/hash/Documents/GitHub/ProjectHermes/frontend
npm run dev
```

Open `http://localhost:5173`, navigate to any trade detail page. Verify:
- Fib lines start at swing anchor, end at last candle — not full-width
- 0.382 gold, 0.5/0.618 green, 1.0 white
- 1.272/1.414/1.618 extension lines visible above swing high
- Legend shows all levels with prices

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/FibChart.jsx
git commit -m "feat: floating fib lines via LineSeries + extension levels 1.272/1.414/1.618"
```

---

## Task 4: FibChart — add SMA20 (blue) and SMA50 (white) overlays

**Files:**
- Modify: `frontend/src/components/FibChart.jsx`

Context: The bot's trend engine uses VMA-20 internally, but the chart should show SMA20 + SMA50 matching what the video displays for visual trend confirmation. Candle data is already fetched (5000 candles). Compute SMAs client-side — no extra API call needed. SMA-N at index `i` = mean of `closes[i-N+1 .. i]`, returning `null` for the first N-1 points (lightweight-charts skips null points automatically when using `LineSeries`).

- [ ] **Step 1: Add SMA computation helper after the `snap` function (~line 117)**

In FibChart.jsx, after the `const snap = ...` block, add:

```js
// Compute simple moving average — returns array of { time, value } skipping warmup nulls
const computeSMA = (data, period) =>
  data.reduce((acc, c, i) => {
    if (i < period - 1) return acc;
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, x) => s + x.close, 0) / period;
    acc.push({ time: c.time, value: avg });
    return acc;
  }, []);
```

- [ ] **Step 2: Add SMA series after the volume series block (~line 177)**

After `chart.priceScale('vol').applyOptions(...)` and before the markers block, add:

```js
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
```

- [ ] **Step 3: Add SMA legend rows**

In the legend JSX block (~line 446), after the entry/SL/TP rows, add:

```jsx
<LegendRow color="#2196f3" label="SMA 20" />
<LegendRow color="rgba(255,255,255,0.65)" label="SMA 50" />
```

- [ ] **Step 4: Verify visually**

With dev server still running, reload a trade detail page. Verify:
- Blue SMA20 line curves across candles
- White SMA50 line curves across candles (slower, smoother)
- Both lines match the visual from the video screenshot

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FibChart.jsx
git commit -m "feat: add SMA20 (blue) and SMA50 (white) overlays to FibChart"
```

---

## Task 5: Update GP zone fill to match corrected zone (50%–61.8% confirmed correct)

**Files:**
- Modify: `frontend/src/components/FibChart.jsx`

Context: The GP zone fill (BaselineSeries gold shading between 50% and 61.8%) is already correct per the video. But the `BaselineSeries` base value should be `gp50` (lower bound) and fill up to `gp618`. Confirm the existing implementation is correct and tighten the golden fill opacity to match video (subtle, not heavy).

- [ ] **Step 1: Verify current GP zone fill is correct**

In FibChart.jsx, find the `gpZone` BaselineSeries block (~line 233). Confirm:
- `baseValue: { type: 'price', price: gp50 }` — base at 50%
- `gpZone.setData` uses `value: gp618` — fills up to 61.8%
- `topFillColor1: 'rgba(255,215,0,0.22)'` — gold fill

This is correct. Only change: reduce fill opacity slightly to match video's subtle zone:

Find:
```js
topFillColor1:    'rgba(255,215,0,0.22)',
topFillColor2:    'rgba(255,215,0,0.08)',
```

Replace with:
```js
topFillColor1:    'rgba(255,215,0,0.15)',
topFillColor2:    'rgba(255,215,0,0.05)',
```

- [ ] **Step 2: Verify chart still shows zone**

Reload trade detail page. GP zone should show subtle gold shading between 0.5 and 0.618 lines.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FibChart.jsx
git commit -m "fix: reduce GP zone fill opacity to match video style"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|---|---|
| SL below 0.382 with ATR buffer | Task 1 |
| Single TP between 1.272 and 1.414 | Task 2 |
| tp2 = None, schema preserved | Task 2 Step 4 |
| Floating fib lines (not full-width) | Task 3 |
| Extension levels 1.272, 1.414, 1.618 | Task 3 Step 4 |
| Video color scheme | Task 3 Step 2 |
| SMA20 blue + SMA50 white overlays | Task 4 |
| GP zone fill correct | Task 5 |
| No 78.6% line | Task 3 (not included in FLOAT_FIB_LEVELS) ✅ |

**Placeholder scan:** None found.

**Type consistency:**
- `_stop_loss` returns `float` → `analyze()` uses it as `sl: float` ✅
- `_take_profits` returns `tuple[float, None]` → `tp1, tp2 = ...` destructures correctly ✅
- `addFibLine` helper defined before first use ✅
- `computeSMA` defined before first use ✅
- `fibAnchorTime` defined before `EXT_LEVELS` loop uses it ✅
