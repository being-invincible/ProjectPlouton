# TradingBot Backend

Python trading engine for the TradingBot project.

## Purpose

The backend is responsible for:
- Fetching market data
- Running strategy logic and indicators
- Risk checks and order flow
- Paper broker execution
- Persisting and reading state via PocketBase

Primary project context lives in the root `CLAUDE.md`.

## Structure

- `config/` - settings and environment configuration
- `data/` - market data and local store helpers
- `strategy/` - strategy interfaces and Fibonacci strategy
- `engine/` - signal, risk, and order management
- `broker/` - broker abstractions and paper broker
- `bot.py` - main bot loop
- `api_server.py` - backend API surface

## Setup

```bash
cd backend
pip install -r requirements.txt
```

Run from project root:

```bash
python run.py
```

## Key Conventions

- Read runtime configuration through `config/settings.py`.
- Use `pocketbase_client.py` for PocketBase access.
- Keep strategy and broker implementations behind base interfaces.
- Keep default behavior aligned with risk/strategy settings in `../CLAUDE.md`.
