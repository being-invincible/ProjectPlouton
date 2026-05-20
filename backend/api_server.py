"""
FastAPI server — serves DuckDB data to the React frontend.

Replaces PocketBase as the API layer. All data comes from DuckDB.
Runs alongside the bot on port 8090 (same port PocketBase used,
so the frontend needs zero URL changes).
"""

import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone

from fastapi import FastAPI, Query, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data.duckdb_store import DuckDBStore

logger = logging.getLogger(__name__)

app = FastAPI(title="Plouton API", version="2.0")


@app.exception_handler(AttributeError)
async def none_store_handler(request, exc):
    if "NoneType" in str(exc):
        return JSONResponse(
            status_code=503,
            content={"error": "Database not available. Start the bot first.", "bot_started": False},
        )
    raise exc


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

# Bot subprocess (when started via the UI)
_bot_process: subprocess.Popen | None = None
_RUN_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "run.py")

# Sentinel set by run.py when the bot is running in the same process.
# Prevents the UI "Start" button from spawning a duplicate subprocess after
# the laptop wakes from sleep (heartbeat goes stale but bot is still alive).
_bot_running_in_process: bool = False


def set_bot_running_in_process(running: bool) -> None:
    global _bot_running_in_process
    _bot_running_in_process = running


def set_store(store: DuckDBStore | None) -> None:
    """Optionally inject a shared DuckDB store (used by in-process runner)."""
    global _shared_store
    _shared_store = store


def get_store() -> DuckDBStore | None:
    if _shared_store is not None:
        return _shared_store

    global _store
    if _store is None:
        db_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "data", "tradingbot.duckdb",
        )
        # Standalone API opens read-only so the bot subprocess can hold the write lock.
        # If the DB doesn't exist yet (first run), _store stays None until bot creates it.
        try:
            _store = DuckDBStore(db_path, read_only=True)
        except Exception:
            _store = None
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
    try:
        import pandas as pd
        if pd.isnull(value):
            return None
    except (TypeError, ValueError):
        pass
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


class BacktestTradePayload(BaseModel):
    instrument: str
    direction: str                       # LONG | SHORT
    entry_price: float
    stop_loss: float
    tp1_price: float
    tp2_price: float
    exit_price: float
    pnl: float
    quantity: float
    notional: float
    leverage: int
    initial_margin: float
    liquidation_price: float | None = None
    swing_high: float | None = None
    swing_low: float | None = None
    fib_zone_upper: float | None = None
    fib_zone_lower: float | None = None
    fib_level_triggered: float | None = None
    rr_tp1: float | None = None
    rr_tp2: float | None = None
    confidence: float | None = None
    timestamp: str                       # ISO8601
    exit_timestamp: str | None = None
    analysis_notes: str | None = None


# ── Health ───────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    store = get_store()
    db_ok = store.health_check() if store else False
    return {"code": 200, "message": "OK", "data": {"duckdb": db_ok}}


# ── Bot Process Control ──────────────────────────────────────────

def _bot_process_alive() -> bool:
    return _bot_process is not None and _bot_process.poll() is None


@app.post("/api/bot/start")
async def bot_start():
    global _bot_process
    if _bot_running_in_process:
        return {"ok": True, "status": "already_running_in_process"}
    if _bot_process_alive():
        return {"ok": True, "status": "already_running", "pid": _bot_process.pid}
    try:
        _bot_process = subprocess.Popen(
            [sys.executable, os.path.abspath(_RUN_PY), "--no-api"],
            cwd=os.path.dirname(os.path.abspath(_RUN_PY)),
        )
        return {"ok": True, "status": "started", "pid": _bot_process.pid}
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})


@app.post("/api/bot/stop")
async def bot_stop():
    global _bot_process
    if not _bot_process_alive():
        return {"ok": True, "status": "not_running"}
    try:
        _bot_process.terminate()
        try:
            _bot_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _bot_process.kill()
        _bot_process = None
        return {"ok": True, "status": "stopped"}
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})


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
    # In-process bot (run.py) stays "alive" even when heartbeat is stale
    # (e.g. laptop woke from sleep — asyncio was paused, not killed).
    bot_alive = _bot_running_in_process or _bot_process_alive() or bool(
        heartbeat_age_sec is not None
        and heartbeat_age_sec <= alive_threshold_sec
        and status in {"RUNNING", "WAITING"}
    )

    return _clean({
        "bot_alive": bot_alive,
        "heartbeat_age_sec": heartbeat_age_sec,
        "alive_threshold_sec": alive_threshold_sec,
        "last_heartbeat": heartbeat,
        "market_actual_open": True,
        "market_effective_open": True,
        "force_market_open": True,
        "market_display": "Crypto perpetuals — 24/7",
    })


@app.get("/api/settings")
async def get_settings_state():
    store = get_store()
    state = store.get_bot_state() or {}
    return _clean({
        "instrument": state.get("instrument", "BTC"),
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
    instrument: str = "BTC",
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
    trade_type: str | None = None,
    sort: str = "-timestamp",
):
    store = get_store()
    sort_desc = sort.startswith("-")
    trades = store.get_trades(limit=limit, status=status, sort_desc=sort_desc)
    if trade_type:
        trades = [t for t in trades if (t.get("trade_type") or "paper") == trade_type]
    return _clean(trades)


@app.post("/api/trades/backtest")
async def create_backtest_trade(payload: BacktestTradePayload):
    """Insert a manually verified backtest trade for record-keeping."""
    import uuid
    store = get_store()
    trade_id = str(uuid.uuid4())[:16]
    row = {
        "id": trade_id,
        "timestamp": payload.timestamp,
        "instrument": payload.instrument,
        "direction": payload.direction,
        "entry_price": payload.entry_price,
        "exit_price": payload.exit_price,
        "quantity": payload.quantity,
        "stop_loss": payload.stop_loss,
        "take_profit": payload.tp2_price,
        "tp1_price": payload.tp1_price,
        "tp2_price": payload.tp2_price,
        "tp1_hit": True,
        "pnl": payload.pnl,
        "status": "CLOSED",
        "exit_reason": "BACKTEST_TP2_HIT",
        "exit_timestamp": payload.exit_timestamp or payload.timestamp,
        "strategy_name": "Golden Pocket",
        "asset_class": "crypto",
        "trade_type": "backtest",
        "notional": payload.notional,
        "leverage": float(payload.leverage),
        "initial_margin": payload.initial_margin,
        "liquidation_price": payload.liquidation_price,
        "swing_high": payload.swing_high,
        "swing_low": payload.swing_low,
        "fib_zone_upper": payload.fib_zone_upper,
        "fib_zone_lower": payload.fib_zone_lower,
        "fib_level_triggered": payload.fib_level_triggered,
        "rr_tp1": payload.rr_tp1,
        "rr_tp2": payload.rr_tp2,
        "confidence": payload.confidence,
        "analysis_notes": payload.analysis_notes,
    }
    row = {k: v for k, v in row.items() if v is not None}
    store.insert_trade(row)
    return {"ok": True, "id": trade_id}


@app.get("/api/trades/{trade_id}")
async def get_trade(trade_id: str):
    store = get_store()
    trade = store.get_trade(trade_id)
    if trade is None:
        return JSONResponse(status_code=404, content={"error": "Trade not found"})
    has_initial, has_final = store.get_trade_chart_flags(trade_id)
    trade["chart_initial_png"] = has_initial
    trade["chart_final_png"] = has_final
    return _clean(trade)


@app.get("/api/trades/{trade_id}/events")
async def get_trade_events(trade_id: str):
    store = get_store()
    if store is None:
        return []
    events = store.list_events_for_trade(trade_id)
    return _clean(events)


@app.delete("/api/trades/{trade_id}")
async def delete_trade(trade_id: str):
    store = get_store()
    trade = store.get_trade(trade_id)
    if trade is None:
        return JSONResponse(status_code=404, content={"error": "Trade not found"})
    store.delete_trade(trade_id)
    return {"ok": True, "deleted": trade_id}


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


@app.get("/api/monitor")
async def get_monitor():
    """Per-coin monitoring status: last scan, candle counts, signal stats."""
    from backend.config import settings as bot_settings
    store = get_store()
    coins = bot_settings.coins

    result = []
    for coin in coins:
        # Last 5m candle = proxy for last scan time
        last_candle = store.conn.execute(
            "SELECT MAX(timestamp) FROM candles WHERE instrument = ? AND timeframe = '5m'",
            [coin],
        ).fetchone()
        candle_count = store.conn.execute(
            "SELECT COUNT(*) FROM candles WHERE instrument = ? AND timeframe = '5m'",
            [coin],
        ).fetchone()[0]

        # Latest signal
        sig_row = store.conn.execute(
            """SELECT timestamp, direction, confidence
               FROM signals WHERE instrument = ?
               ORDER BY timestamp DESC LIMIT 1""",
            [coin],
        ).fetchone()
        signal_count = store.conn.execute(
            "SELECT COUNT(*) FROM signals WHERE instrument = ?", [coin]
        ).fetchone()[0]

        # Latest close price
        price_row = store.conn.execute(
            "SELECT close FROM candles WHERE instrument = ? AND timeframe = '5m' ORDER BY timestamp DESC LIMIT 1",
            [coin],
        ).fetchone()

        result.append(_clean({
            "coin": coin,
            "last_scan": last_candle[0] if last_candle else None,
            "candle_count": candle_count,
            "last_signal_time": sig_row[0] if sig_row else None,
            "last_signal_direction": sig_row[1] if sig_row else None,
            "last_signal_confidence": sig_row[2] if sig_row else None,
            "signal_count": signal_count,
            "last_price": price_row[0] if price_row else None,
            "has_data": candle_count > 0,
        }))

    return result



@app.put("/api/trades/{trade_id}/charts")
async def put_trade_charts(trade_id: str, request: Request):
    """Receive JSON with base64-encoded initial/final PNGs and store them."""
    import base64
    store = get_store()
    trade = store.get_trade(trade_id)
    if not trade:
        return JSONResponse(status_code=404, content={"error": "Trade not found"})
    body = await request.json()
    updates = {}
    if "initial" in body:
        updates["chart_initial_png"] = base64.b64decode(body["initial"])
    if "final" in body:
        updates["chart_final_png"] = base64.b64decode(body["final"])
    if updates:
        store.update_trade(trade_id, updates)
    return {"ok": True, "updated": list(updates.keys())}


@app.get("/api/trades/{trade_id}/chart")
def get_trade_chart(trade_id: str, type: str = "final"):
    """Stream the saved chart PNG. type=initial|final, defaults to final (falls back to initial)."""
    store = get_store()
    col = "chart_initial_png" if type == "initial" else "chart_final_png"
    fallback_col = "chart_initial_png"
    row = store.conn.execute(
        f"SELECT {col}, {fallback_col} FROM trades WHERE id = ?", [trade_id]
    ).fetchone()
    if not row:
        return Response(status_code=404)
    png = row[0] if row[0] else row[1]
    if not png:
        return Response(status_code=404)
    if isinstance(png, (memoryview, bytearray)):
        png = bytes(png)
    return Response(content=png, media_type="image/png")


@app.post("/api/trades/{trade_id}/generate_chart")
async def generate_trade_chart(trade_id: str):
    """Generate (or re-generate) Fibonacci analysis chart for a trade."""
    import sys, os
    import pandas as pd
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from charts.fib_chart import generate_fib_chart

    store = get_store()
    trade = store.get_trade(trade_id)
    if not trade:
        return JSONResponse(status_code=404, content={"error": "Trade not found"})

    instrument = str(trade.get("instrument", "BTC"))
    df = store.get_candles(instrument=instrument, timeframe="5m", periods=500)
    if df.empty:
        return JSONResponse(status_code=422, content={"error": f"No candle data for {instrument}"})

    df_reset = df.reset_index()
    df_reset.columns = ["timestamp", "open", "high", "low", "close", "volume"]
    trade_plain = {k: (v.item() if hasattr(v, "item") else v) for k, v in trade.items()}

    try:
        png = generate_fib_chart(df_reset, trade_plain, title_suffix="Analysis")
        store.update_trade(trade_id, {"chart_final_png": png, "chart_initial_png": png})
        return {"ok": True, "bytes": len(png)}
    except Exception as exc:
        logger.exception("Chart generation failed")
        return JSONResponse(status_code=500, content={"error": str(exc)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8090, log_level="info")
