"""
FastAPI server — serves DuckDB data to the React frontend.

Replaces PocketBase as the API layer. All data comes from DuckDB.
Runs alongside the bot on port 8090 (same port PocketBase used,
so the frontend needs zero URL changes).
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

from fastapi import FastAPI, Query
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data.duckdb_store import DuckDBStore
from data.market_data import MarketDataFetcher

logger = logging.getLogger(__name__)

app = FastAPI(title="TradingBot API", version="2.0")

# CORS for the React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DuckDB connection (read-only for the API)
_store: DuckDBStore | None = None
_shared_store: DuckDBStore | None = None


def set_store(store: DuckDBStore | None) -> None:
    """Optionally inject a shared DuckDB store (used by in-process runner)."""
    global _shared_store
    _shared_store = store


def get_store() -> DuckDBStore:
    if _shared_store is not None:
        return _shared_store

    global _store
    if _store is None:
        db_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "data", "tradingbot.duckdb",
        )
        _store = DuckDBStore(db_path, read_only=True)
    return _store


def _serialize(obj):
    """Make DuckDB results JSON-serializable."""
    import pandas as pd
    from datetime import datetime
    import numpy as np
    if isinstance(obj, (datetime, pd.Timestamp)):
        return obj.isoformat()
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if pd.isna(obj):
        return None
    return obj


def _clean(records):
    """Clean a list of dicts for JSON serialization."""
    if isinstance(records, dict):
        return {k: _serialize(v) for k, v in records.items()}
    return [{k: _serialize(v) for k, v in r.items()} for r in records]


def _parse_iso_ts(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


class SettingsPatch(BaseModel):
    instrument: str | None = None
    balance: float | None = None
    trading_mode: str | None = None
    force_market_open: bool | None = None


# ── Health ───────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    store = get_store()
    return {"code": 200, "message": "OK", "data": {"duckdb": store.health_check()}}


# ── Bot State ────────────────────────────────────────────────────

@app.get("/api/bot_state")
async def get_bot_state():
    store = get_store()
    state = store.get_bot_state()
    return _clean(state) if state else {}


@app.get("/api/runtime")
async def get_runtime():
    """Bot runtime diagnostics (alive heartbeat + actual/effective market state)."""
    store = get_store()
    state = store.get_bot_state() or {}

    heartbeat = _parse_iso_ts(state.get("last_heartbeat") or state.get("last_updated"))
    now = datetime.now(timezone.utc)
    heartbeat_age_sec = int((now - heartbeat).total_seconds()) if heartbeat else None

    # 5m cycle by default. Consider alive up to 2 cycles (+ buffer) without heartbeat.
    alive_threshold_sec = 660
    status = str(state.get("status", "STOPPED")).upper()
    bot_alive = bool(
        heartbeat_age_sec is not None
        and heartbeat_age_sec <= alive_threshold_sec
        and status in {"RUNNING", "WAITING"}
    )

    force_open = bool(state.get("force_market_open", False))
    market_info = MarketDataFetcher.get_market_hours_display(force_market_open=force_open)

    return _clean({
        "bot_alive": bot_alive,
        "heartbeat_age_sec": heartbeat_age_sec,
        "alive_threshold_sec": alive_threshold_sec,
        "last_heartbeat": heartbeat,
        "market_actual_open": market_info.get("actual_open", False),
        "market_effective_open": market_info.get("is_open", False),
        "force_market_open": force_open,
        "market_display": market_info.get("next_event", ""),
    })


@app.get("/api/settings")
async def get_settings_state():
    store = get_store()
    state = store.get_bot_state() or {}
    return _clean({
        "instrument": state.get("instrument", "GC=F"),
        "balance": state.get("balance", 500.0),
        "trading_mode": state.get("trading_mode", "paper"),
        "force_market_open": state.get("force_market_open", False),
    })


@app.patch("/api/settings")
async def patch_settings(payload: SettingsPatch):
    store = get_store()
    updates = {}

    if payload.instrument is not None:
        updates["instrument"] = payload.instrument

    if payload.balance is not None:
        updates["balance"] = float(payload.balance)

    if payload.trading_mode is not None:
        mode = payload.trading_mode.lower().strip()
        if mode not in {"paper", "live"}:
            return JSONResponse(status_code=400, content={"error": "trading_mode must be 'paper' or 'live'"})
        updates["trading_mode"] = mode

    if payload.force_market_open is not None:
        updates["force_market_open"] = bool(payload.force_market_open)

    if not updates:
        return {"ok": True, "updated": 0}

    store.update_bot_state(updates)
    return {"ok": True, "updated": len(updates)}


# ── Candles ──────────────────────────────────────────────────────

@app.get("/api/candles")
async def get_candles(
    instrument: str = "GC=F",
    timeframe: str = "5m",
    limit: int = 500,
):
    store = get_store()
    df = store.get_candles(
        instrument=instrument,
        timeframe=timeframe,
        periods=limit,
    )
    if df.empty:
        return []
    # Convert to list of dicts with standard column names
    df = df.reset_index()
    df.columns = ["timestamp", "open", "high", "low", "close", "volume"]
    records = df.to_dict("records")
    return _clean(records)


# ── Trades ───────────────────────────────────────────────────────

@app.get("/api/trades")
async def get_trades(
    limit: int = 50,
    status: str | None = None,
    sort: str = "-timestamp",
):
    store = get_store()
    sort_desc = sort.startswith("-")
    trades = store.get_trades(limit=limit, status=status, sort_desc=sort_desc)
    return _clean(trades)


@app.get("/api/trades/{trade_id}")
async def get_trade(trade_id: str):
    store = get_store()
    trade = store.get_trade(trade_id)
    if trade is None:
        return JSONResponse(status_code=404, content={"error": "Trade not found"})
    return _clean(trade)


# ── Signals ──────────────────────────────────────────────────────

@app.get("/api/signals")
async def get_signals(limit: int = 50):
    store = get_store()
    signals = store.get_signals(limit=limit)
    return _clean(signals)


# ── Strategy Configs ─────────────────────────────────────────────

@app.get("/api/strategy_configs")
async def get_strategy_configs():
    store = get_store()
    configs = store.get_strategy_configs()
    return _clean(configs)


@app.get("/api/strategy_configs/active")
async def get_active_strategy():
    store = get_store()
    config = store.get_active_strategy()
    return _clean(config) if config else {}


# ── MTF Trend ────────────────────────────────────────────────────

@app.get("/api/mtf_trend")
async def get_mtf_trend(instrument: str = "GC=F"):
    store = get_store()
    trend = store.compute_mtf_trend(instrument=instrument)
    return _clean(trend)


# ── Analytics ────────────────────────────────────────────────────

@app.get("/api/stats")
async def get_stats():
    """Summary stats for the dashboard."""
    store = get_store()
    state = store.get_bot_state() or {}
    candle_counts = {}
    for tf in ["5m", "15m", "1h"]:
        candle_counts[tf] = store.get_candle_count(
            instrument=state.get("instrument", "GC=F"),
            timeframe=tf,
        )
    return _clean({
        "bot_state": state,
        "candle_counts": candle_counts,
        "instruments": store.get_instruments(),
    })


@app.get("/api/trades/{trade_id}/chart")
def get_trade_chart(trade_id: str, type: str = "final"):
    """Stream the saved chart PNG. type=initial|final, defaults to final (falls back to initial)."""
    store = get_store()
    trade = store.get_trade(trade_id)
    if not trade:
        return Response(status_code=404)

    if type == "initial":
        png = trade.get("chart_initial_png")
    else:
        png = trade.get("chart_final_png") or trade.get("chart_initial_png")

    if not png:
        return Response(status_code=404)
    if isinstance(png, memoryview):
        png = bytes(png)
    return Response(content=png, media_type="image/png")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8090, log_level="info")
