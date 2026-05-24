# CLAUDE.md — Project Memory

> This file is the default memory for any AI agent working on this project.
> Update this whenever architecture, conventions, or status changes.

## Project Overview

**Hermes V2** — Production-ready automated trading bot for Hyperliquid crypto perpetuals with real-time execution, event-driven trade lifecycle, advanced risk management, and real-time monitoring dashboard.

## Current Status

🟢 **Phase Complete — Production Deployment Ready**

### What's Built
- ✅ **Hyperliquid API Integration** — Async order execution, position tracking, liquidation prevention
- ✅ **Event-Driven Trade Lifecycle** — Entry → TP1 partial → TP2 close with partial fills
- ✅ **DuckDB Time-Series Store** — Crash-safe with WAL, market data + event log persistence
- ✅ **Advanced Risk Management** — Position sizing, confidence scoring, quality filters
- ✅ **Multi-Strategy Support** — ATR volatility, Fibonacci retracement, Golden Pocket
- ✅ **Real-Time Monitoring** — React dashboard, TradingView charts, Discord notifications
- ✅ **Async Coin Scanner** — Multi-instrument monitoring with signal aggregation
- ✅ **Order Manager** — Event sourcing with atomic state, partial fills handling
- ✅ **Comprehensive Test Suite** — Broker correctness, strategy validation, engine tests
- ✅ **Configuration** — Environment-based, runtime-tunable strategy params

### What's Next
- Manual verification of live trading execution
- Performance monitoring & optimization
- Strategy refinement based on paper trading data
- Multi-exchange support (Interactive Brokers, Zerodha)

## Architecture

```
Python Bot ──async──► Hyperliquid API (Live Orders)
    │                       │
    ├──► DuckDB (Persistence)
    │       ├─ OHLCV candles
    │       ├─ Trade lifecycle events
    │       └─ Order journal
    │
    ├──► Discord (Notifications + Charts)
    │
    └──► React Dashboard ◄── Read-only API access
            │
         TradingView Charts
```

- **Backend**: Python 3.11+ with asyncio — bot loop, strategy engine, risk manager, broker
- **Exchange**: Hyperliquid REST + WebSocket — order execution, position tracking, real-time fills
- **Database**: DuckDB with WAL — local time-series store, event log, crash safety
- **Frontend**: React (Vite) + Tailwind CSS + shadcn/ui + TradingView lightweight-charts
- **Notifications**: Discord bot with TradingView embedded chart previews
- **Strategies**: Async signal generation with multi-timeframe support

## Key Conventions

### Backend (Python)
- Settings via `config/settings.py` (Pydantic BaseSettings), loaded from `.env`
- Data access to Hyperliquid via async methods in `broker/base.py` + implementations
- DuckDB persistence via `data/duckdb_store.py` (crash-safe with WAL)
- All strategies inherit from `strategy/base.py` abstract class
- All brokers implement `broker/base.py` abstract interface
- Order manager handles event sourcing + partial fill tracking via `engine/order_manager.py`

### DuckDB Collections (Tables)
- `candles` — OHLCV market data (timestamp, instrument, open, high, low, close, volume)
- `trades` — executed trades with metadata (entry, TP1, TP2, SL, status, PnL)
- `trade_events` — event log (entry, TP1_hit, TP2_hit, closed, etc.) with timestamps
- `signals` — generated signals with indicator values (strategy, instrument, direction, confidence)
- `positions` — open positions tracking (margin, unrealised PnL, liquidation distance)

### Frontend (React)
- Vite + Tailwind CSS + shadcn/ui for consistent components
- Fetches data from Python backend via REST API
- TradingView `lightweight-charts` for candlestick charts
- Pages: Dashboard `/`, Trades `/trades`, Trade Detail `/trades/:id`, Settings `/settings`
- Real-time updates via polling or WebSocket from backend

## Trading Defaults
- **Instrument**: Hyperliquid perpetual futures (configurable) — e.g., BTC, ETH, SOL
- **Timeframe**: 5 minutes — configurable
- **Paper balance**: Configurable per session (starts from `.env`)
- **Strategy**: Golden Pocket Fibonacci (see full logic below)
- **Risk**: 1% per trade, max 3 open positions, 5% daily loss limit
- **Execution**: Real-time async order execution with position tracking

## Golden Pocket Strategy — Full Logic

File: `backend/strategy/golden_pocket.py`. Runs every 5-minute scan cycle on each coin.

### Signal Gate — ALL conditions must pass in order

**1. Enough data**
- Need ≥ 50 candles on the 5m timeframe

**2. SMA crossover direction**
- Compute SMA20 (last 20 closes) and SMA50 (last 50 closes)
- SMA20 > SMA50 → LONG bias (golden cross = uptrend)
- SMA20 < SMA50 → SHORT bias (death cross = downtrend)
- SMA20 == SMA50 → reject

**3. SMA separation guard (anti-whipsaw)**
- `abs(sma20 - sma50) / sma50 < 0.1%` → reject
- Tangled SMAs = market is chopping sideways = Fibonacci setups are unreliable
- On a $2130 coin this means SMAs must be >$2.13 apart

**4. SMA50 slope guard (anti-flat)**
- Compare current SMA50 vs SMA50 from 5 candles ago
- LONG: SMA50 must be rising ≥ 0.02% over 5 candles
- SHORT: SMA50 must be falling ≤ -0.02% over 5 candles
- Flat SMA50 = ranging market = no trend = reject

**5. Swing detection** (`detect_swing`, lookback=66 candles = ~5.5h)
- Pivot window = 5 candles either side
- Pivot high: close ≥ all neighbors in window
- Pivot low: close ≤ all neighbors in window
- Most recent pivot high + most recent pivot low define the swing
- `direction = "DOWN"` if last pivot high is more recent than last pivot low (retracing)
- `direction = "UP"` if last pivot low is more recent (bouncing)

**6. Swing direction must match trend**
- LONG signal requires `swing.direction == "DOWN"` (price retracing down from a high into the pocket)
- SHORT signal requires `swing.direction == "UP"` (price bouncing up from a low into the pocket)

**7. Price inside Golden Pocket**
- Golden Pocket zone = 50%–61.8% Fibonacci retracement of the swing
- `lower = swing_low + 0.5 × range`
- `upper = swing_low + 0.618 × range`
- `zone.lower ≤ last_close ≤ zone.upper` → in pocket → proceed
- Price outside zone → reject

**8. Swing quality (ATR filter)**
- `swing_range < 1.5 × ATR` → reject (swing is noise, not a real structure)

### Trade Levels (when signal fires)

- **Entry**: last close price (market order on next scan)
- **Stop Loss**: below/above 0.382 Fib level with 0.5×ATR buffer
  - LONG: `SL = (swing_low + 0.382 × range) - 0.5 × ATR`
  - SHORT: `SL = (swing_high - 0.382 × range) + 0.5 × ATR`
- **Take Profit (single target)**: between 1.272 and 1.414 Fibonacci extensions
  - LONG: `TP = (swing_high + 0.272 × range) + 0.382 × (0.142 × range)`
  - SHORT: mirror of above below swing_low
  - TP2 is always None — single target design

### Monitor Page Quality Indicators
Each coin card shows:
- **UPTREND / DOWNTREND** badge — SMA crossover direction
- **SMA20 / SMA50** price pills
- **Fib ready** (green) — all SMA guards pass, bot will fire Fibonacci if price enters pocket
- **Tangled** (red) — separation < 0.1%, bot blocked
- **Flat SMA50** (amber) — slope guard failed, bot blocked

## Future Broker Plans
- **Zerodha Kite** (existing Indian account, may need NRI conversion)
  - Order execution: free for personal use
  - Real-time data: ₹500/month
- **Interactive Brokers** (UK entity option for global futures)
