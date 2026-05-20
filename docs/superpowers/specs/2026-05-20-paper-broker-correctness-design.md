# Paper Broker Correctness — Design Spec

**Date:** 2026-05-20  
**Status:** Approved  
**Scope:** Four bugs in the paper trading engine affecting position integrity, state persistence, and observability.

---

## Problem Summary

Four root bugs were found through analysis of live trade data (two simultaneous HYPE LONG positions on a $200 account). They must be fixed in dependency order.

---

## Bug 1 (Critical) — Margin Not Reserved on Position Open

### Root Cause
`PaperBroker.open_position()` stores a `PaperPosition` but never deducts `initial_margin` from `self.balance`. `_close_full()` adds PnL but never returns the margin. Balance stays flat at $200 forever, so `PositionSizer` always sizes against the full account — enabling two $193-margin trades on a $200 account.

`QualityFilter.accept()` only checks `open_trades_count`, not whether remaining capital covers the new position's margin.

### Fix

**`PaperBroker.open_position()`** — deduct `initial_margin` from `self.balance` immediately.  
**`PaperBroker._close_full()`** — return margin on close: `self.balance += pnl + pos.initial_margin`.  
**`PaperBroker.check_exits()` TP1_PARTIAL** — return 50% of margin to balance alongside the partial PnL.  
**`QualityFilter.accept()`** — add `available_margin: float` parameter; reject if `available_margin < position_margin`.  
**`CoinScanner.scan()`** — compute `available_margin = balance - sum(open position margins)` and pass to `QualityFilter`.

### Data Contract
`PaperBroker` exposes a `reserved_margin` property = sum of `initial_margin` across all open positions. `available_balance` = `self.balance - self.reserved_margin`.

---

## Bug 2 (Critical) — Open Positions Orphaned on Bot Restart

### Root Cause
`PaperBroker.__init__` sets `self.positions = {}` on every startup. `OrderManager.check_open_trades()` fetches open trades from DuckDB but delegates exit logic to `broker.check_exits()`, which iterates the empty in-memory dict — so no open trade from a previous session can ever exit.

### Fix

**`PaperBroker`** — add `rehydrate(open_trades: list[dict]) -> None` method that reconstructs `PaperPosition` objects from DB rows.  
**`TradingBot.initialize()`** — after broker connect, call `broker.rehydrate(duckdb_store.list_open_trades())`.

### Rehydration Rules
- Reconstruct `quantity` from DB (already reflects post-TP1 partial if `tp1_hit=True`).
- Use DB `stop_loss` value (which will be correct after Bug 3 is fixed).
- `tp1_hit` from DB drives whether TP1 check is skipped.

**Dependency:** Fix Bug 3 first. If Bug 2 is deployed before Bug 3, rehydration will load the wrong SL from DB.

---

## Bug 3 (High) — Wrong Stop-Loss Written to DB After TP1 Partial

### Root Cause
`OrderManager.check_open_trades()` line 75:
```python
self.store.update_trade(trade_id, {"tp1_hit": True, "stop_loss": exit_price})
```
`exit_price` = TP1 price (e.g. $48.94). The correct value is `entry_price` (breakeven, e.g. $48.19). In-memory `PaperBroker` is correct (`pos.stop_loss = pos.entry_price`) but DB is wrong. This causes the position to appear "already in profit" SL-wise in the DB, and will cause incorrect SL after Bug 2's rehydration.

### Fix
Change line 75 to:
```python
self.store.update_trade(trade_id, {"tp1_hit": True, "stop_loss": trade["entry_price"]})
```
Requires fetching the trade record before updating, or passing `entry_price` through the closure tuple. The closure tuple currently is `(trade_id, reason, exit_price, pnl)` — no change needed; just read from the trade dict fetched at the top of the closure loop.

**Fix order:** This must be deployed before Bug 2.

---

## Bug 4 (Medium) — No Trade Lifecycle Events in DB or UI

### Root Cause
No event log exists. `tp1_hit=True` is stored in the trades table but nothing records when it happened, at what price, or that SL moved. `TradeDetail.jsx` has no event timeline. Users cannot tell if a trade has already secured partial profit.

### Fix

**New DuckDB table: `trade_events`**
```sql
CREATE TABLE trade_events (
    id          VARCHAR PRIMARY KEY,
    trade_id    VARCHAR NOT NULL,
    event_type  VARCHAR NOT NULL,  -- TP1_PARTIAL | SL_MOVED | TP2_HIT | SL_HIT
    price       DOUBLE,
    pnl_partial DOUBLE,            -- PnL of the partial close (TP1 only)
    timestamp   TIMESTAMP NOT NULL
);
```

**`DuckDBStore`** — add `insert_trade_event(event: dict)` and `list_events_for_trade(trade_id: str) -> list[dict]`.

**`OrderManager.check_open_trades()`** — on `TP1_PARTIAL`, insert two events: `TP1_PARTIAL` (price=tp1, pnl_partial=partial_pnl) and `SL_MOVED` (price=entry_price).

**API** — add `GET /trades/{trade_id}/events` endpoint returning the event list.

**`TradeDetail.jsx`** — add a vertical timeline section below trade stats showing each event with icon, price, timestamp, and PnL where applicable.

**UI states:**
- `TP1_PARTIAL` → green chip "TP1 Hit · +$X.XX"
- `SL_MOVED` → blue chip "SL → Breakeven @ $X.XX"
- `TP2_HIT` → green chip "TP2 Hit · +$X.XX · Closed"
- `SL_HIT` → red chip "Stopped Out @ $X.XX"

---

## Fix Order (enforced by dependencies)

```
1. Bug 3 — fix SL persistence (one-line change, no dependency)
2. Bug 2 — rehydration (reads corrected SL from DB)
3. Bug 1 — margin reservation + QualityFilter margin check
4. Bug 4 — trade_events table + API + UI timeline
```

---

## Files Changed Per Bug

| Bug | Files |
|-----|-------|
| 3 | `backend/engine/order_manager.py` |
| 2 | `backend/broker/paper_broker.py`, `backend/bot.py` |
| 1 | `backend/broker/paper_broker.py`, `backend/engine/quality_filter.py`, `backend/scanner/coin_scanner.py` |
| 4 | `backend/data/duckdb_store.py`, `backend/engine/order_manager.py`, `backend/api_server.py`, `frontend/src/pages/TradeDetail.jsx` |

---

## Out of Scope

- Live/real broker integration
- Partial rehydration for partially-filled positions (not applicable in paper trading)
- Historical backfill of `trade_events` for existing trades
