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
- **Strategy**: Fibonacci Retracement (entry at 38.2%/61.8%, SL at 78.6%, R:R 1:2)
- **Risk**: 1% per trade, max 3 open positions, 5% daily loss limit
- **Execution**: Real-time async order execution with position tracking

## Future Broker Plans
- **Zerodha Kite** (existing Indian account, may need NRI conversion)
  - Order execution: free for personal use
  - Real-time data: ₹500/month
- **Interactive Brokers** (UK entity option for global futures)
