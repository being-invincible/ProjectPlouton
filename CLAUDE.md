# CLAUDE.md — Project Memory

> This file is the default memory for any AI agent working on this project.
> Update this whenever architecture, conventions, or status changes.

## Project Overview

**TradingBot** — Automated paper-trading system for futures (starting with Gold `GC=F`) using technical analysis strategies (starting with Fibonacci Retracement). Includes a React dashboard for monitoring trades.

## Current Status

🟡 **Phase 1 — Scaffolding & PocketBase Setup** (in progress)

### What's Done
- ✅ Project directory structure (backend packages: config, data, strategy, engine, broker)
- ✅ `requirements.txt` — Python deps (pydantic, pandas, pandas-ta, yfinance, httpx)
- ✅ `.env.example` / `.env` — Config with defaults (GC=F, 5m, $500 balance)
- ✅ `config/settings.py` — Pydantic BaseSettings with all trading parameters
- ✅ `pocketbase_client.py` — REST API wrapper with CRUD, pagination, upsert, health check
- ✅ `README.md` — Architecture overview and quickstart

### What's Next
- PocketBase binary download + collection schema setup
- Phase 2: Market data fetcher (yfinance)
- Phase 3: Strategy engine (indicators + Fibonacci)
- Phase 4: Paper broker ($500 default)
- Phase 5: React dashboard (Vite + Tailwind + shadcn/ui)
- Phase 6: Bot loop integration
- Phase 7: Testing

## Architecture

```
Python Bot ──writes──► PocketBase (REST API) ◄──reads── React Dashboard
                         │                                    │
                    SQLite (internal)              Real-time SSE updates
```

- **Backend**: Python 3.11+ — bot loop, strategy engine, risk manager, paper broker
- **Database/API**: PocketBase — single binary, built-in REST + real-time SSE + admin UI
- **Frontend**: React (Vite) + Tailwind CSS + shadcn/ui + TradingView lightweight-charts
- **Data**: yfinance (`GC=F`) for development → broker API for production

## Key Conventions

### Backend (Python)
- Settings via `config/settings.py` (Pydantic BaseSettings), loaded from `.env`
- Runtime-configurable params stored in PocketBase `strategy_configs` collection
- PocketBase accessed via `backend/pocketbase_client.py` (`pb` singleton)
- All strategies inherit from `strategy/base.py` abstract class
- All brokers implement `broker/base.py` abstract interface

### PocketBase Collections
- `candles` — OHLCV market data
- `trades` — executed trades with metadata
- `signals` — generated signals with indicator values
- `strategy_configs` — per-strategy configurable params (read by bot at runtime)
- `bot_state` — bot status, balance, current instrument

### Frontend (React)
- Vite + Tailwind CSS + shadcn/ui for consistent components
- PocketBase JS SDK for data fetching + real-time SSE subscriptions
- TradingView `lightweight-charts` for candlestick charts
- Pages: Dashboard `/`, Trades `/trades`, Trade Detail `/trades/:id`, Settings `/settings`

## Trading Defaults
- **Instrument**: `GC=F` (Gold Futures) — configurable
- **Timeframe**: 5 minutes — configurable
- **Paper balance**: $500 — configurable from Settings page
- **Strategy**: Fibonacci Retracement (entry at 38.2%/61.8%, SL at 78.6%, R:R 1:2)
- **Risk**: 1% per trade, max 3 open positions, 5% daily loss limit

## Future Broker Plans
- **Zerodha Kite** (existing Indian account, may need NRI conversion)
  - Order execution: free for personal use
  - Real-time data: ₹500/month
- **Interactive Brokers** (UK entity option for global futures)
