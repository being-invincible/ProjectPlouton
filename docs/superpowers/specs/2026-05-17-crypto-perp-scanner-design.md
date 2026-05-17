# Project Hermes v2 — Crypto Perp Scanner Design

**Date:** 2026-05-17  
**Status:** Approved  
**Replaces:** Gold Futures (GC=F) single-instrument bot

---

## Overview

Replace the Gold Futures bot with a 10-coin async crypto perpetual scanner running against Hyperliquid via ccxt. When a clean Fibonacci Retracement setup fires on any coin, the bot:

1. Generates a TradingView-style chart PNG (colored Fib bands, trade box, candles)
2. Posts a Discord embed + chart image to `#trading-alerts`
3. Executes a paper trade with risk-aware position sizing
4. Logs the trade to DuckDB with full analysis metadata attached

---

## Coins

| Symbol | Hyperliquid Perp | Rationale |
|--------|-----------------|-----------|
| BTC | BTC/USDC:USDC | Strategic reserve + ETF anchor |
| ETH | ETH/USDC:USDC | Fusaka upgrade, DeFi base |
| SOL | SOL/USDC:USDC | Tx volume leader, Firedancer |
| XRP | XRP/USDC:USDC | SEC cleared, institutional runway |
| BNB | BNB/USDC:USDC | Quarterly burn + opBNB |
| SUI | SUI/USDC:USDC | Fast mover, new cycle entrant |
| TAO | TAO/USDC:USDC | Top AI crypto, #1 by market cap |
| LINK | LINK/USDC:USDC | Commerce Dept deal + spot ETF |
| HYPE | HYPE/USDC:USDC | Native HL token, 60% YTD |
| ADA | ADA/USDC:USDC | Van Rossem fork + Leios upgrade |

---

## Architecture

```
Hyperliquid Public API
      │  (ccxt, no key needed)
      ▼
AsyncCoinScanner  ──── 10 coins in parallel (asyncio.gather)
      │
      ├── fetch_multi_timeframe()   5m + 15m + 1h per coin
      ├── DuckDB store (deduplicated OHLCV)
      ├── MTF trend gate (1h must agree before analysis)
      ├── FibonacciRetracement.analyze()
      ├── QualityFilter (rejects weak setups)
      └── On signal ──►  RiskManager.size_position()
                     ──►  ChartGenerator.render_png()
                     ──►  DiscordNotifier.send_alert()
                     ──►  PaperBroker.execute()
                     ──►  DuckDB trade record (with metadata)
```

**Preserved from v1:** DuckDB store, FastAPI server, React dashboard, PaperBroker, RiskManager, FibonacciRetracement strategy, OrderManager  
**Replaced:** yfinance → ccxt/Hyperliquid, CME market hours check removed, PocketBase client removed, single-coin loop → async 10-coin scanner  
**Added:** ChartGenerator, DiscordNotifier, quality filter, per-coin position sizing

---

## Timeframes

| Timeframe | Role |
|-----------|------|
| 1h | Trend gate — 1h must be bullish (LONG) or bearish (SHORT) before any signal fires |
| 15m | Confirmation — must agree with 1h direction |
| 5m | Execution — Fib setup detected and entry triggered on this TF |

Crypto trades 24/7. No market hours check.

---

## Strategy: Fibonacci Retracement

Same parameters for all 10 coins (configurable via Settings page).

**Signal conditions (all must be true):**
1. 1h VMA slope is trending (bullish or bearish)
2. 15m confirms same direction
3. Price retraces to 38.2% or 61.8% Fib level on 5m
4. Candle closes at or near the level (not a wick blow-through)
5. Quality filter: retracement must be ≥ 30% of swing range (avoids tiny swings)

**Levels:**
- Entry: 38.2% or 61.8%
- Stop Loss: 78.6% (hard)
- Take Profit: R:R 1:2 (configurable)
- Swing detection: rolling 1h high/low over configurable lookback

**Signal frequency goal:** High quality, not high frequency. Expect 1–5 signals per day across all 10 coins combined.

---

## Position Sizing

Risk-aware, calculated per signal:

```
risk_amount      = balance × risk_per_trade_pct      (default 1%)
stop_distance    = abs(entry_price - stop_loss)
quantity         = risk_amount / stop_distance
notional         = quantity × entry_price
suggested_leverage = ceil(notional / balance)         (display only)
suggested_leverage = min(suggested_leverage, max_leverage)  (hard cap 10×)
```

`suggested_leverage` is shown in the Discord alert as guidance — the paper broker does not enforce it (it tracks notional value). On live Hyperliquid, the user sets leverage manually.

**Hard limits:**
- Max risk per trade: 1% of balance
- Max open concurrent trades: 3
- Max daily loss: 5% of balance (bot pauses if hit)
- Max leverage: 10× (suggested, not enforced by paper broker)

The Discord alert shows: qty, notional, suggested leverage, exact $ at risk.

---

## Chart Generation

Library: `plotly` → `kaleido` for PNG export (800×500px)

**Visual spec (matches TradingView Fibonacci tool):**

| Element | Style |
|---------|-------|
| Background | `#131722` (TradingView dark) |
| Candles | Green `#26a69a` / Red `#ef5350` |
| Fib lines | Solid horizontal lines at each level |
| 0% / 100% | `#787b86` grey (swing high / swing low anchors) |
| 23.6% line | `#ef5350` red |
| 38.2% line | `#ffc107` amber — entry zone |
| 50% line | `#4caf50` green, dotted |
| 61.8% line | `#26a69a` teal — entry zone |
| 78.6% line | `#2196f3` blue |
| Band fills (between levels, low opacity ~0.15) | |
| 0%→23.6% | `#b71c1c` dark maroon |
| 23.6%→38.2% | `#e65100` dark amber |
| 38.2%→50% | `#33691e` dark olive |
| 50%→61.8% | `#1b5e20` dark green |
| 61.8%→78.6% | `#006064` dark teal |
| 78.6%→100% | `#0d47a1` dark blue |
| Labels | LEFT axis: `ratio (price)` format, e.g. `0.382 (145.20)` |
| Diagonal connector | Grey dashed line from swing high → swing low (same as TV Fib tool) |
| Trade box | Green filled rect (entry→TP, right margin), red filled rect (entry→SL, right margin) |
| Entry line | Blue horizontal solid, label `LONG` or `SHORT` |
| Volume bars | Below candles, same green/red color |

Chart spans: 100 candles before signal + 20 after (right margin for trade box).

---

## Discord Alert

Webhook POST to `#trading-alerts`. One message per signal containing:

**Embed fields:**
- Title: `📈 SOL/USDC — LONG Signal` (color-coded border: green=LONG, red=SHORT)
- Entry / Stop Loss / Take Profit (monospace prices)
- Fib level triggered (e.g. `38.2% ★`)
- R:R ratio
- Position sizing block: balance, qty, notional, suggested leverage, $ at risk
- MTF trend summary: `1h ↑ BULL · 15m ↑ CONFIRMING · 5m RETRACING to 38.2%`
- Swing context: `Swing high $X → low $Y · drawn over 1h`

**Attachment:** Chart PNG (TradingView style, as described above)

**Footer:** `Paper trade executed · Hermes v2 · timestamp UTC`

**Setup:** New Discord server, `#trading-alerts` channel, webhook URL stored in `.env` as `DISCORD_WEBHOOK_URL`.

---

## UI Bug Fixes (included in this release)

Two known bugs from v1 fixed as part of this work:

1. **KPIs not updating after trades** — Dashboard balance/PnL stat cards not reflecting closed trades. Root cause: `balance` in DuckDB `bot_state` not updated when paper trade closes. Fix: `OrderManager.close_trade()` must call `update_bot_state()` with new balance + recalculated stats.

2. **Trade detail chart shows fake data** — `TradeDetail.jsx` renders random candle data. Fix: fetch real candles from DuckDB API (`/api/candles?instrument=X&timeframe=5m`) centered around trade timestamp, render with real OHLCV data.

---

## New Files

| File | Purpose |
|------|---------|
| `backend/data/hyperliquid_fetcher.py` | ccxt Hyperliquid OHLCV fetcher, replaces yfinance |
| `backend/notifications/discord_notifier.py` | Discord webhook client, embed builder |
| `backend/notifications/chart_generator.py` | plotly chart PNG generator (TradingView style) |
| `backend/scanner/coin_scanner.py` | Per-coin async analysis unit |
| `backend/scanner/async_runner.py` | Orchestrates 10 CoinScanner instances with asyncio |
| `backend/engine/quality_filter.py` | Rejects weak Fib setups before alerting |

---

## Modified Files

| File | Change |
|------|--------|
| `backend/bot.py` | Replace main loop with AsyncRunner |
| `backend/config/settings.py` | Add: coins list, Discord webhook URL, max leverage, quality filter params |
| `backend/data/market_data.py` | Remove CME market hours logic |
| `backend/engine/order_manager.py` | Fix: update bot state on trade close |
| `backend/broker/paper_broker.py` | Add: per-trade position sizing output |
| `frontend/src/pages/TradeDetail.jsx` | Fix: fetch real candles from API |
| `frontend/src/lib/api.js` | Update default instrument from `GC=F` to `BTC` |
| `backend/requirements.txt` | Add: ccxt, plotly, kaleido; remove: yfinance |
| `.env.example` | Add: DISCORD_WEBHOOK_URL, COINS, MAX_LEVERAGE |

---

## .env Changes

```env
# New in v2
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
COINS=BTC,ETH,SOL,XRP,BNB,SUI,TAO,LINK,HYPE,ADA
MAX_LEVERAGE=10
RISK_PER_TRADE=0.01
MAX_DAILY_LOSS=0.05
MAX_OPEN_TRADES=3

# Removed
# INSTRUMENT=GC=F  (replaced by COINS list)
# FORCE_MARKET_OPEN=false  (crypto is 24/7)
```

---

## Out of Scope (v2)

- Live trading on Hyperliquid (paper only)
- Per-coin strategy param tuning
- Multiple strategies (RSI, VWAP reclaim)
- Backtesting UI
- Mobile app
