# Project Hermes v2 — Crypto Perp Scanner Design

**Date:** 2026-05-17
**Status:** Revised v2 (golden pocket focus, Hyperliquid-aware sizing, confidence scoring, chart history)
**Replaces:** Gold Futures (GC=F) single-instrument bot

---

## Overview

Replace the Gold Futures bot with a 10-coin async crypto perpetual scanner running against Hyperliquid via ccxt. When a clean **Golden Pocket** Fibonacci setup fires on any coin, the bot:

1. Generates a TradingView-style chart PNG (colored Fib bands, golden pocket highlighted, trade box, ATR, candles)
2. Posts a Discord embed + chart image to `#trading-alerts` with a **confidence score**
3. Executes a paper trade with **Hyperliquid-aware** position sizing
4. Logs the trade to DuckDB with full analysis metadata + initial chart snapshot
5. On trade close: regenerates the chart showing actual exit and saves it again — viewable in the app's Trade Detail page

---

## Coins

| Symbol | Hyperliquid Perp | Max Leverage | Rationale |
|--------|-----------------|--------------|-----------|
| BTC | BTC/USDC:USDC | 50× | Strategic reserve + ETF anchor |
| ETH | ETH/USDC:USDC | 50× | Fusaka upgrade, DeFi base |
| SOL | SOL/USDC:USDC | 20× | Tx volume leader, Firedancer |
| XRP | XRP/USDC:USDC | 20× | SEC cleared, institutional runway |
| BNB | BNB/USDC:USDC | 10× | Quarterly burn + opBNB |
| SUI | SUI/USDC:USDC | 10× | Fast mover, new cycle entrant |
| TAO | TAO/USDC:USDC | 5× | Top AI crypto, #1 by market cap |
| LINK | LINK/USDC:USDC | 20× | Commerce Dept deal + spot ETF |
| HYPE | HYPE/USDC:USDC | 10× | Native HL token, 60% YTD |
| ADA | ADA/USDC:USDC | 20× | Van Rossem fork + Leios upgrade |

Max leverage values reflect Hyperliquid's current published per-asset caps. Bot fetches actual live values at startup and caches them (don't trust hardcoded — they can change).

---

## Architecture

```
Hyperliquid Public API
      │  (ccxt, no key needed for market data)
      ▼
AsyncCoinScanner  ──── 10 coins in parallel (asyncio.gather)
      │
      ├── fetch_multi_timeframe()    5m + 15m + 1h per coin
      ├── DuckDB store (deduplicated OHLCV)
      ├── MTF trend gate (1h must agree before analysis)
      ├── GoldenPocketStrategy.analyze()  ← only 50%–61.8% zone
      ├── ConfidenceScorer (heuristic v1, historical v2)
      ├── QualityFilter (rejects weak setups)
      └── On signal ──►  RiskManager.size_position()    [Hyperliquid-aware]
                     ──►  ChartGenerator.render_png()    [initial snapshot]
                     ──►  DiscordNotifier.send_alert()
                     ──►  PaperBroker.execute()
                     ──►  DuckDB trade record (with chart blob + metadata)

On SL/TP hit ──►  ChartGenerator.render_png()    [exit snapshot, replaces or appends]
              ──►  DuckDB trade update with final chart
              ──►  DiscordNotifier.send_close()
```

**Preserved from v1:** DuckDB store, FastAPI server, React dashboard, PaperBroker (extended), OrderManager
**Replaced:** yfinance → ccxt/Hyperliquid, CME market hours check removed, PocketBase client removed, single-coin loop → async 10-coin scanner, `FibonacciRetracement` → `GoldenPocketStrategy`
**Added:** ChartGenerator (with snapshot save), DiscordNotifier, ConfidenceScorer, Hyperliquid-aware position sizing, in-app help tooltips

---

## Timeframes

| Timeframe | Role |
|-----------|------|
| 1h | Trend gate — 1h slope must be strongly trending (bullish or bearish) before any signal fires |
| 15m | Confirmation TF — must agree with 1h direction. **Can also be execution TF** if signal strength is HIGH (see below) |
| 5m | Default execution TF — golden pocket touch + bounce candle |

**15m execution rule:** If the 1h trend strength is in the top quartile (slope above 0.5%/candle) AND 15m shows golden pocket touch with confluence, the bot uses 15m as execution TF instead of 5m. This gives wider stops, larger targets, cleaner setups for strong trends. Documented in code as `GoldenPocketStrategy.choose_execution_tf()`.

Crypto trades 24/7. No market hours check.

---

## Strategy: Golden Pocket Fibonacci

Only the **Golden Pocket** (50% to 61.8% retracement zone) triggers signals. The 38.2% level is drawn on the chart for reference but does not trigger entries.

### Signal Conditions (all must be true)

1. 1h VMA slope is trending strongly (slope magnitude > min_slope_pct, configurable, default 0.2%)
2. 15m confirms same direction (slope sign matches 1h)
3. Price enters the golden pocket zone (50%–61.8%) on the execution TF
4. Candle closes **inside the golden pocket** (not just a wick through — body close required)
5. Quality filter: original swing range ≥ 1.5× ATR (avoids tiny swings on flat coins)
6. No active trade already open on this coin

### Entry, Stop Loss, Take Profit (researched, configurable defaults)

**Entry:** Price at the close of the qualifying golden pocket candle. Limit order placed at the more favorable of the two golden pocket levels (50% for LONG, 61.8% for retracement-deep entries).

**Stop Loss (hybrid — whichever is FURTHER from entry):**

```
sl_fib_break  = 78.6% Fib level (structure invalidation)
sl_atr_offset = entry - (1.5 × ATR_14)     [LONG]
              = entry + (1.5 × ATR_14)     [SHORT]

# Pick the level FURTHER from entry (more room, less likely to be wicked out):
stop_loss     = MIN(sl_fib_break, sl_atr_offset)   [LONG  — lower price = further]
              = MAX(sl_fib_break, sl_atr_offset)   [SHORT — higher price = further]
```

**Why hybrid?** Pure 78.6% can be too tight on volatile coins (HYPE/SUI/TAO). Pure ATR ignores structure. Hybrid gives the trade either structural room OR volatility room, whichever is wider — protects against fake-out wicks common in crypto.

**Take Profit (two-stage):**

```
swing_range   = swing_high - swing_low
TP1 (50% off) = entry + (1.5 × (entry - stop_loss))    [LONG]   — R:R 1:1.5
TP2 (runner)  = swing_high + (0.618 × swing_range)             — Fib 1.618 extension
              = swing_low  - (0.618 × swing_range)     [SHORT]
```

After TP1 hits, stop loss moves to break-even (entry price). The runner targets the 1.618 Fib extension or trails with a chandelier exit, whichever triggers first.

**References on these methods:** TradingView education library (Fibonacci Retracement), Crypto trading practice (78.6% as invalidation is well-established), ATR-based stops (Wilder's original ATR work), Fib extensions for targets (standard Elliott Wave / TA practice).

### Confidence Score

Each signal carries a 0–100% confidence score shown in the Discord alert and stored with the trade. **v1 = heuristic.** Once enough paper trades accumulate (≥ 50 closed), **v2** replaces the heuristic with actual historical win rate of similar setups.

**v1 heuristic (sums to ≤ 100):**

| Factor | Weight | How |
|--------|--------|-----|
| MTF alignment | 25% | 3 TFs aligned = full, 2 = 60%, 1 = 0% |
| 1h slope strength | 20% | Linear scale: 0.2% slope = 0, 1%+ = full |
| Candle pattern at level | 20% | Engulfing/hammer = full, pin bar = 75%, doji = 40%, none = 0 |
| Volume on entry candle | 15% | > 1.5× 20-period avg = full, < 0.5× = 0 |
| EMA confluence | 10% | Entry within 0.5×ATR of 50-EMA or 200-EMA = full |
| ATR sanity (swing not too small) | 10% | Swing range / ATR ≥ 3 = full, < 1.5 = 0 |

Cap at 95% (never claim certainty).

**v2 historical** (post-paper-trading data accumulation): Replace each weighted heuristic with empirical win rate of past setups matching the same MTF + pattern + coin signature. Expected accuracy: confidence % ≈ realized win rate ± 10%.

---

## Position Sizing — Hyperliquid-Aware

Computed per signal with explicit awareness of Hyperliquid's perp mechanics:

```
risk_pct          = settings.risk_per_trade_pct      (default 3%, configurable, no hard cap)
risk_amount       = balance × risk_pct
stop_distance     = abs(entry - stop_loss)
quantity          = risk_amount / stop_distance
notional          = quantity × entry_price
suggested_leverage = ceil(notional / balance)
suggested_leverage = min(suggested_leverage, coin.max_leverage)    [per-coin cap]
initial_margin    = notional / suggested_leverage
maintenance_pct   = 0.0125                                          [Hyperliquid default ~1.25%]
maintenance_margin = notional × maintenance_pct
liquidation_price = entry × (1 - (initial_margin - maintenance_margin) / notional)   [LONG]
                  = entry × (1 + (initial_margin - maintenance_margin) / notional)   [SHORT]
funding_rate_hr   = fetched from HL API at signal time (informational)
```

**Hard limits (configurable):**

| Setting | Default | Notes |
|---------|---------|-------|
| `risk_per_trade_pct` | 3% | No cap — user can set 10% if desired |
| `max_open_trades` | 3 | Across all coins |
| `daily_loss_limit_pct` | 15% | Bot pauses 24h if hit. Configurable 10–25%. |
| `coin.max_leverage` | per table above | Capped at HL's published per-asset max |

The Discord alert and Trade Detail page show: **qty, notional, suggested leverage, initial margin, liquidation price, current funding rate, exact $ at risk**.

### Hyperliquid Mechanics — In-App Help

Each of the position-sizing fields appears with a **?** tooltip in the Settings page and Trade Detail page. Click reveals a plain-English explanation. ADHD-friendly: nothing memorized, everything one click away.

| Field | Tooltip text |
|-------|------|
| Notional | "Total trade size. If you buy 0.5 SOL at $145, notional = $72.50. This is the amount that moves with price, not what you put up." |
| Initial Margin | "Cash locked as collateral for this trade. With 5× leverage, you put up 1/5 of notional. Hyperliquid uses USDC." |
| Maintenance Margin | "Minimum equity Hyperliquid requires to keep the trade open. If your equity falls below this, you get liquidated. ~1.25% for most assets." |
| Liquidation Price | "Price at which Hyperliquid closes your position automatically because your equity hit maintenance margin. Higher leverage = closer liquidation = more dangerous." |
| Funding Rate | "Hourly fee paid (or received) on perps to keep price aligned to spot. Positive = longs pay shorts. Shown per hour. Annualize ×24×365." |
| Cross vs Isolated Margin | "Cross: all your USDC backs every trade — one liquidation drains everything. Isolated: each trade has its own margin pool. Paper trading simulates isolated for clean accounting." |
| R:R Ratio | "Risk-to-reward. 1:2 means risk $1 to make $2. Win rate × avg_reward > loss_rate × avg_loss = profitable system." |
| Golden Pocket | "Fibonacci zone between 50% and 61.8% retracement. Crypto reverses here most often when in a strong trend." |
| ATR (Average True Range) | "Average price movement over the last 14 candles. Used to set stops that respect this coin's volatility." |
| Confidence Score | "Bot's estimate of signal quality, 0–100%. v1 = rule-based heuristic. After ~50 closed trades, replaced by your actual historical win rate." |

Also documented at `docs/hyperliquid-mechanics.md` for reference outside the app.

---

## Chart Generation

Library: `plotly` → `kaleido` for PNG export (1600×800px — wide for plenty of candle context)

### Visual Spec (matches TradingView Fibonacci tool)

**General:**
| Element | Style |
|---------|-------|
| Background | `#131722` (TradingView dark) |
| Candles | Green `#26a69a` / Red `#ef5350` |

**Fib lines:**
| Level | Color |
|-------|-------|
| 0% / 100% | `#787b86` grey (swing anchors) |
| 23.6% | `#ef5350` red |
| 38.2% | `#ffc107` amber (reference only, not entry zone) |
| 50% | **`#4caf50` green, SOLID — Golden Pocket edge** |
| 61.8% | **`#26a69a` teal, SOLID — Golden Pocket edge** |
| 78.6% | `#2196f3` blue |

**Golden Pocket highlight (KEY VISUAL):**
- Fill between 50% and 61.8% with **`#ffd700` gold @ 0.18 opacity**
- Border on top and bottom of zone with `#ffd700` solid 2px
- Center label: **"GOLDEN POCKET"** in `#ffd700` bold, positioned in right-margin area
- This zone visually pops more than any other Fib band

**Other band fills (between non-golden-pocket levels, low opacity ~0.10):**
| Range | Color |
|-------|-------|
| 0%→23.6% | `#b71c1c` dark maroon |
| 23.6%→38.2% | `#e65100` dark amber |
| 38.2%→50% | `#33691e` dark olive |
| 61.8%→78.6% | `#006064` dark teal |
| 78.6%→100% | `#0d47a1` dark blue |

**Trade overlay:**
| Element | Style |
|---------|-------|
| Entry line | Blue `#2196f3` solid 2px, label `LONG @ price` or `SHORT @ price` |
| TP1 line | Green `#26a69a` dashed, label `TP1 (1:1.5)` |
| TP2 line | Bright green `#00e676` dashed, label `TP2 (1.618 ext)` |
| Stop loss | Red `#ef4444` dashed, label `SL @ price` |
| Trade box (right margin) | Green rect entry→TP1, lime rect TP1→TP2, red rect entry→SL |
| Diagonal swing connector | Grey `#787b86` dashed from swing high → swing low |

**Other:**
| Element | Style |
|---------|-------|
| ATR sub-band | Optional shaded band ±1.5×ATR around price for context |
| Volume bars | Below candles, green/red matching candle color |
| Labels | LEFT axis: `ratio (price)` format, e.g. `0.618 (78,316.9)` |
| Title bar | `SOL/USDC · 5m · Golden Pocket Long · Confidence 72%` |

**Candle range (configurable via Settings page):**

| Setting | Default | Purpose |
|---------|---------|---------|
| `chart_candles_before_signal` | 400 | Historical context — see how trend formed, prior structure, S/R, prior reversals at similar levels |
| `chart_candles_after_signal` | 100 | Forward room for trade progression and exit marker |
| **Total visible** | **~500 candles** | Roughly 41 hours on 5m, 5 days on 15m, 20 days on 1h |

Why this much: a few hundred candles lets you spot pattern repetitions, prior golden pocket reactions, divergences in trend structure — context that's invaluable when reviewing trades later to spot what the bot got right or wrong. If a coin is reacting differently than the strategy expects, you can see it in the chart.

**Density management:** With 500 candles on a 1600px wide chart, each candle gets ~3px which is the TradingView default density. Still readable.

**Settings tooltip** for these fields: "How many candles to show in the trade chart. More = more context for spotting patterns, less = bigger candles. 500 is a good balance."

### Chart Snapshots

**On signal:** Initial chart generated, stored as PNG bytes in DuckDB column `trades.chart_initial_png` (BLOB), and sent to Discord.

**On trade close (SL hit, TP hit, manual close):** Chart regenerated showing the actual price path through the trade with the exit marker. Stored as `trades.chart_final_png`. Replaces the placeholder in the Trade Detail page chart panel.

**Frontend Trade Detail page:** Shows the final chart (or initial if trade still open). Includes a toggle "View signal chart / View exit chart" if both are present.

API endpoint: `GET /api/trades/{id}/chart?type=initial|final` → streams the PNG.

---

## Discord Alert

Webhook POST to `#trading-alerts`. Two alerts per trade lifecycle:

### Signal Alert

**Embed:**
- Title: `📈 SOL/USDC — LONG (Golden Pocket)` (color: green for LONG, red for SHORT)
- Confidence: `🎯 72% confidence` (badge-style, prominent)
- Entry / SL / TP1 / TP2 (monospace prices)
- Fib level triggered: `61.8% — Golden Pocket lower edge`
- R:R: `1:1.5 (TP1) · 1:3.2 (TP2)`
- Position sizing block:
  - Balance: $500
  - Qty: 0.735 SOL
  - Notional: $106.72
  - Suggested leverage: 5× *(coin cap: 20×)*
  - Initial margin: $21.34
  - Liquidation price: $137.20
  - Funding rate: +0.012%/hr
  - $ at risk: $15.00 (3%)
- MTF trend: `1h ↑ BULL (slope 0.42%) · 15m ↑ CONFIRMING · 5m IN GOLDEN POCKET`
- Swing context: `Swing high $158.90 → low $134.10 (drawn over 1h, ATR 14: $3.20)`

**Attachment:** Initial chart PNG

**Footer:** `Paper trade executed · Hermes v2 · 2026-05-17 14:32 UTC`

### Close Alert

**Embed:**
- Title: `✅ SOL/USDC LONG closed — WIN +$32.40` (green) or `❌ ... LOSS -$15.00` (red)
- Exit reason: `TP1 hit` / `TP2 hit` / `SL hit` / `Manual close`
- P&L: `+$32.40 (+6.48%)` with realized R:R achieved
- Duration: `2h 14m`
- Confidence at entry: `72%` (so we can correlate confidence → outcome over time)

**Attachment:** Final chart PNG (shows the full price path with exit)

---

## UI Bug Fixes (included in this release)

1. **KPIs not updating after trades** — Dashboard balance/PnL stat cards not reflecting closed trades. Root cause: `balance` in DuckDB `bot_state` not updated when paper trade closes. Fix: `OrderManager.close_trade()` must call `update_bot_state()` with new balance + recalculated stats (total_trades, winning_trades, total_pnl, daily_pnl).

2. **Trade detail chart shows fake data** — `TradeDetail.jsx` renders random candle data. Fix: replace with the stored chart PNG (from `trades.chart_final_png` or `chart_initial_png`) served from `/api/trades/{id}/chart`. No more JS chart rendering on detail page — display the same PNG that went to Discord. Faster, consistent, and matches what user already saw in their alerts.

---

## New Files

| File | Purpose |
|------|---------|
| `backend/data/hyperliquid_fetcher.py` | ccxt Hyperliquid OHLCV fetcher + per-asset max leverage fetch |
| `backend/notifications/discord_notifier.py` | Discord webhook client, embed builder for signal + close |
| `backend/notifications/chart_generator.py` | plotly chart PNG generator (TradingView style with golden pocket highlight) |
| `backend/scanner/coin_scanner.py` | Per-coin async analysis unit |
| `backend/scanner/async_runner.py` | Orchestrates 10 CoinScanner instances with asyncio.gather |
| `backend/strategy/golden_pocket.py` | Golden pocket strategy (replaces fibonacci.py logic) |
| `backend/engine/confidence_scorer.py` | Heuristic v1 + interface for historical v2 |
| `backend/engine/quality_filter.py` | Rejects weak setups before scoring |
| `backend/engine/position_sizer.py` | Hyperliquid-aware sizing (notional, margin, liquidation) |
| `frontend/src/components/HelpTooltip.jsx` | Reusable `?` tooltip component for ADHD-friendly help |
| `docs/hyperliquid-mechanics.md` | Plain-English reference doc for Hyperliquid perp mechanics |

---

## Modified Files

| File | Change |
|------|--------|
| `backend/bot.py` | Replace main loop with AsyncRunner |
| `backend/config/settings.py` | Add: coins list, Discord webhook URL, daily loss limit, exec TF rules, confidence threshold |
| `backend/data/market_data.py` | Remove CME market hours logic; delegate to hyperliquid_fetcher |
| `backend/data/duckdb_store.py` | Add: `chart_initial_png` and `chart_final_png` BLOB columns to trades, `confidence` column |
| `backend/engine/order_manager.py` | Fix bot state update on close + trigger chart regen + send close alert |
| `backend/broker/paper_broker.py` | Add: notional/margin tracking, two-stage TP, BE move after TP1 |
| `backend/api_server.py` | Add: `/api/trades/{id}/chart?type=initial\|final` endpoint streaming PNG |
| `frontend/src/pages/TradeDetail.jsx` | Replace random chart with PNG fetched from API + initial/exit toggle |
| `frontend/src/pages/Settings.jsx` | Add HelpTooltip components on all numeric/technical fields |
| `frontend/src/lib/api.js` | Update default instrument from `GC=F` to `BTC`; add chart fetch |
| `backend/requirements.txt` | Add: ccxt, plotly, kaleido; remove: yfinance |
| `.env.example` | Add: DISCORD_WEBHOOK_URL, COINS, DAILY_LOSS_LIMIT_PCT, RISK_PER_TRADE_PCT |

---

## .env Changes

```env
# New in v2
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
COINS=BTC,ETH,SOL,XRP,BNB,SUI,TAO,LINK,HYPE,ADA
RISK_PER_TRADE_PCT=0.03            # 3% default, no hard cap
DAILY_LOSS_LIMIT_PCT=0.15          # 15% default, range 10–25
MAX_OPEN_TRADES=3
MIN_CONFIDENCE_PCT=60              # signals below this don't fire
EXECUTION_TF_DEFAULT=5m            # 15m used when 1h slope is strong
ATR_PERIOD=14
ATR_SL_MULTIPLIER=1.5
CHART_CANDLES_BEFORE_SIGNAL=400    # historical context in trade charts
CHART_CANDLES_AFTER_SIGNAL=100     # forward room for trade progression

# Removed
# INSTRUMENT=GC=F                  (replaced by COINS list)
# FORCE_MARKET_OPEN=false          (crypto is 24/7)
```

---

## Out of Scope (v2)

- Live trading execution on Hyperliquid (paper only; v3 adds live)
- Per-coin strategy param tuning (all coins use same golden pocket params)
- Multiple strategies alongside golden pocket (RSI, VWAP) — add later
- Backtesting UI
- Mobile app
- v2 historical confidence (replaces heuristic) — built but disabled until 50 closed trades exist

---

## Open Items For User Decision Before Implementation

None blocking — the spec includes researched defaults. User can adjust via Settings page after first run:
- `RISK_PER_TRADE_PCT` (default 3%, raise if comfortable)
- `DAILY_LOSS_LIMIT_PCT` (default 15%)
- `MIN_CONFIDENCE_PCT` (default 60%, raise to be more selective)
- `EXECUTION_TF_DEFAULT` (default 5m, set to 15m for slower signals only)
