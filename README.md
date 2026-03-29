# 🤖 TradingBot — Automated Futures Trading System

An automated paper-trading system for **Gold Futures** using the **Fibonacci Retracement** strategy, with a full dashboard UI.

Project architecture, conventions, and current phase tracking are documented in `CLAUDE.md` (source of truth for AI and docs alignment).

## Architecture

- **Backend**: Python 3.11+ — strategy engine, indicators, risk management
- **Database/API**: PocketBase — built-in REST API, real-time SSE, admin UI
- **Frontend**: React (Vite) + Tailwind CSS + shadcn/ui
- **Charts**: TradingView lightweight-charts
- **Data**: yfinance (development) → Broker API (production)

## Quick Start

### 1. Install Python dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Start PocketBase
```bash
cd pocketbase
./pocketbase serve
```
Admin UI will be available at `http://127.0.0.1:8090/_/`

### 3. Start the trading bot
```bash
python run.py
```

### 4. Start the dashboard (development)
```bash
cd frontend
npm install
npm run dev
```
Dashboard at `http://localhost:5173`

## Configuration

Copy `.env.example` to `.env` and adjust:
- `INSTRUMENT` — trading symbol (default: `GC=F` for Gold Futures)
- `TIMEFRAME` — candle interval (default: `5m`)
- `PAPER_BALANCE` — starting balance (default: `500`)
- `TRADING_MODE` — `paper` or `live`

Strategy parameters are configurable via the dashboard Settings page.

## Project Structure

```
TradingBot/
├── backend/           # Python trading engine
│   ├── config/        # Pydantic settings
│   ├── data/          # Market data fetching
│   ├── strategy/      # Trading strategies (Fibonacci)
│   ├── engine/        # Signal generation, risk, orders
│   ├── broker/        # Paper & live broker adapters
│   └── bot.py         # Main trading loop
├── frontend/          # React dashboard
├── pocketbase/        # PocketBase binary + data
└── run.py             # Top-level runner
```
