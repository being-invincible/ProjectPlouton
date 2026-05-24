"""
One-shot script: inserts the XRP/USD Fib Short backtest trade into DuckDB.
Run this ONLY when the bot is stopped (run.py is not running), otherwise
DuckDB will reject the write connection with a "database is locked" error.

Usage:
    python insert_backtest.py
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

try:
    from data.duckdb_store import DuckDBStore
except ImportError as e:
    print(f"ERROR: could not import DuckDBStore: {e}")
    sys.exit(1)

DB_PATH = os.path.join(os.path.dirname(__file__), "backend", "data", "tradingbot.duckdb")

# ── Trade parameters ──────────────────────────────────────────────────────────
# XRP/USD Fib Retracement Short — 19 May 2026 — 5m chart
# Swing measured from Fib levels shown on chart:
#   0.5 = 1.3704, 0.618 = 1.3722  →  range = 0.01525
#   swing_low = 1.3628, swing_high = 1.3780
ENTRY           = 1.3715
STOP_LOSS       = 1.3790
TP1             = 1.3607
TP2             = 1.3546
QUANTITY        = 1333.0      # XRP
SWING_HIGH      = 1.3780
SWING_LOW       = 1.3628
LEVERAGE        = 9.0
NOTIONAL        = 1830.0      # USD
INITIAL_MARGIN  = 10.0        # USD (5% of $200 account)
INSTRUMENT      = "XRP"
DIRECTION       = "SHORT"
ENTRY_TS        = "2026-05-19T17:00:00"
TP1_TS          = "2026-05-19T18:30:00"
EXIT_TS         = "2026-05-19T20:00:00"

# Two-stage PnL: 50% at TP1, 50% at TP2
half = QUANTITY / 2
tp1_pnl = half * (ENTRY - TP1)            # SHORT: profit = entry - exit
tp2_pnl = half * (ENTRY - TP2)
total_pnl = round(tp1_pnl + tp2_pnl, 4)

sl_dist = STOP_LOSS - ENTRY
rr_tp1 = round((ENTRY - TP1) / sl_dist, 2)
rr_tp2 = round((ENTRY - TP2) / sl_dist, 2)

fib_range = SWING_HIGH - SWING_LOW
# At entry 1.3715: retrace from swing_high = (1.3780 - 1.3715) / 0.0152 = 0.428 → ~57% retrace
fib_triggered = round((ENTRY - SWING_LOW) / fib_range, 3)

trade_id = str(uuid.uuid4())[:16]

trade = {
    "id":                   trade_id,
    "timestamp":            ENTRY_TS,
    "instrument":           INSTRUMENT,
    "direction":            DIRECTION,
    "entry_price":          ENTRY,
    "stop_loss":            STOP_LOSS,
    "take_profit":          TP2,
    "tp1_price":            TP1,
    "tp2_price":            TP2,
    "tp1_hit":              True,
    "exit_price":           TP2,
    "exit_timestamp":       EXIT_TS,
    "exit_reason":          "TP2",
    "pnl":                  total_pnl,
    "quantity":             QUANTITY,
    "status":               "CLOSED",
    "strategy_name":        "golden_pocket",
    "asset_class":          "crypto",
    "trade_type":           "backtest",
    "leverage":             LEVERAGE,
    "notional":             NOTIONAL,
    "initial_margin":       INITIAL_MARGIN,
    "swing_high":           SWING_HIGH,
    "swing_low":            SWING_LOW,
    "fib_zone_upper":       round(SWING_LOW + 0.618 * fib_range, 4),  # SHORT: GP upper = 0.618
    "fib_zone_lower":       round(SWING_LOW + 0.500 * fib_range, 4),  # SHORT: GP lower = 0.5
    "fib_level_triggered":  fib_triggered,
    "rr_tp1":               rr_tp1,
    "rr_tp2":               rr_tp2,
    "confidence":           80.0,
    "analysis_notes":       (
        "Fib retracement SHORT. Entry in golden pocket (0.5–0.618 bounce zone of down swing). "
        "Confirmation: descending MA + bearish rejection candle. "
        "Account $200, Risk $10 (5%), 1333 XRP @ ~9x leverage. "
        "Swing computed from chart Fib levels: 0.5=1.3704, 0.618=1.3722."
    ),
}

events = [
    {"id": str(uuid.uuid4())[:16], "trade_id": trade_id, "event_type": "entry",
     "price": ENTRY, "pnl_partial": None, "timestamp": ENTRY_TS},
    {"id": str(uuid.uuid4())[:16], "trade_id": trade_id, "event_type": "TP1_hit",
     "price": TP1, "pnl_partial": round(tp1_pnl, 4), "timestamp": TP1_TS},
    {"id": str(uuid.uuid4())[:16], "trade_id": trade_id, "event_type": "TP2",
     "price": TP2, "pnl_partial": round(total_pnl, 4), "timestamp": EXIT_TS},
]

print(f"\nInserting XRP SHORT backtest trade — ID: {trade_id}")
print(f"  Entry:  SHORT @ {ENTRY}  |  SL: {STOP_LOSS}  |  TP1: {TP1}  |  TP2: {TP2}")
print(f"  Swing:  H={SWING_HIGH}  L={SWING_LOW}  |  Fib triggered: {fib_triggered:.1%}")
print(f"  PnL:    TP1 ${tp1_pnl:.2f} + TP2 ${tp2_pnl:.2f} = ${total_pnl:.2f}")
print(f"  R:R:    TP1 {rr_tp1}:1  |  TP2 {rr_tp2}:1\n")

try:
    store = DuckDBStore(db_path=DB_PATH)
    store.insert_trade(trade)

    for ev in events:
        cols = list(ev.keys())
        vals = [ev[c] for c in cols]
        store.conn.execute(
            f"INSERT INTO trade_events ({', '.join(cols)}) VALUES ({', '.join(['?']*len(cols))})",
            vals,
        )
        print(f"  Event logged: {ev['event_type']} @ {ev['price']}")

    store.close()
    print(f"\nDone. Trade {trade_id} inserted. Open the dashboard to see it.")

except Exception as e:
    if "lock" in str(e).lower() or "exclusive" in str(e).lower():
        print("ERROR: DuckDB is locked — the bot is still running.")
        print("Stop the bot first (close the terminal running run.py), then retry.")
    else:
        print(f"ERROR: {e}")
        raise
