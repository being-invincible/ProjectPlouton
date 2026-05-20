# Paper Broker Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four bugs in the paper trading engine: wrong stop-loss persisted after TP1 hit, open positions orphaned on bot restart, margin not reserved when opening positions, and trade lifecycle events missing from DB and UI.

**Architecture:** Four tasks executed in strict dependency order. Task 1 corrects the DB before Task 2 rehydrates from it. Task 3 adds margin accounting after positions can survive restarts. Task 4 adds observability on top of the correct foundation.

**Tech Stack:** Python 3.11+, DuckDB, FastAPI, React (JSX), pytest

---

## File Map

| File | Task | Change |
|------|------|--------|
| `backend/engine/order_manager.py` | 1, 4 | fetch trade before TP1_PARTIAL check; insert lifecycle events |
| `backend/broker/paper_broker.py` | 2, 3 | add `rehydrate()`; deduct/return margin |
| `backend/bot.py` | 2 | call `rehydrate()` after broker connect |
| `backend/engine/quality_filter.py` | 3 | add `position_margin` param |
| `backend/scanner/coin_scanner.py` | 3 | move sizing before quality check |
| `backend/data/duckdb_store.py` | 4 | `trade_events` table + `insert_trade_event` + `list_events_for_trade` |
| `backend/api_server.py` | 4 | `GET /trades/{trade_id}/events` endpoint |
| `frontend/src/pages/TradeDetail.jsx` | 4 | lifecycle events timeline section |
| `frontend/src/lib/api.js` | 4 | `getTradeEvents(id)` method |
| `tests/engine/test_order_manager.py` | 1 | new file |
| `tests/broker/__init__.py` | 2 | new file (empty) |
| `tests/broker/test_paper_broker.py` | 2, 3 | new file |
| `tests/engine/test_quality_filter.py` | 3 | extend existing |
| `tests/data/test_duckdb_store_events.py` | 4 | new file |

---

## Task 1: Fix wrong stop-loss written to DB after TP1 partial (closes #1)

**Files:**
- Modify: `backend/engine/order_manager.py:73-76`
- Create: `tests/engine/test_order_manager.py`

The bug: `OrderManager.check_open_trades()` receives a `TP1_PARTIAL` closure where `exit_price` is the TP1 price. It then writes `stop_loss = exit_price` to DB — but it should write `stop_loss = trade["entry_price"]` (breakeven). The `trade` dict is currently fetched only *after* the TP1_PARTIAL early-continue, so it isn't available for the fix. Solution: fetch the trade once at the start of the closure loop.

- [ ] **Step 1: Create the test file**

```python
# tests/engine/test_order_manager.py
import asyncio
from unittest.mock import AsyncMock, MagicMock
import pandas as pd
import pytest

from backend.engine.order_manager import OrderManager


def _make_om():
    broker = MagicMock()
    store = MagicMock()
    discord = AsyncMock()
    chart_gen = MagicMock()
    fetcher = MagicMock()
    om = OrderManager(
        broker=broker, duckdb_store=store, discord=discord,
        chart_generator=chart_gen, fetcher=fetcher,
    )
    return om, broker, store, discord, fetcher


def _price_df(price: float) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=1, freq="5min")
    return pd.DataFrame(
        {"Open": price, "High": price, "Low": price, "Close": price, "Volume": 1000},
        index=idx,
    )


def test_tp1_partial_writes_entry_price_as_new_stop_loss():
    """After TP1 hit, DB stop_loss must be entry_price (breakeven), NOT tp1_price."""
    om, broker, store, _, fetcher = _make_om()

    trade_id = "trade-abc"
    entry_price = 48.193
    tp1_price = 48.9425  # TP1 hit price — must NOT be written as SL

    store.list_open_trades.return_value = [
        {"instrument": "HYPE", "id": trade_id, "entry_price": entry_price}
    ]
    store.get_trade.return_value = {"id": trade_id, "entry_price": entry_price}
    store.list_all_trades.return_value = []
    fetcher.fetch_ohlcv.return_value = _price_df(49.0)
    broker.check_exits.return_value = [(trade_id, "TP1_PARTIAL", tp1_price, 3.5)]

    asyncio.get_event_loop().run_until_complete(om.check_open_trades())

    store.update_trade.assert_called_once_with(
        trade_id, {"tp1_hit": True, "stop_loss": entry_price}
    )


def test_tp1_partial_does_not_write_tp1_price_as_stop_loss():
    """Regression guard: tp1_price must never appear as the new stop_loss."""
    om, broker, store, _, fetcher = _make_om()

    trade_id = "trade-xyz"
    entry_price = 100.0
    tp1_price = 102.5

    store.list_open_trades.return_value = [
        {"instrument": "BTC", "id": trade_id, "entry_price": entry_price}
    ]
    store.get_trade.return_value = {"id": trade_id, "entry_price": entry_price}
    store.list_all_trades.return_value = []
    fetcher.fetch_ohlcv.return_value = _price_df(103.0)
    broker.check_exits.return_value = [(trade_id, "TP1_PARTIAL", tp1_price, 12.5)]

    asyncio.get_event_loop().run_until_complete(om.check_open_trades())

    call_args = store.update_trade.call_args
    assert call_args[0][1]["stop_loss"] != tp1_price
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd /Users/hash/Documents/GitHub/ProjectHermes
python -m pytest tests/engine/test_order_manager.py -v
```

Expected: `FAILED — AssertionError` (stop_loss is tp1_price, not entry_price).

- [ ] **Step 3: Apply the fix in order_manager.py**

Open `backend/engine/order_manager.py`. Find `check_open_trades` (line ~59). Change the closure loop so the trade is fetched **before** the `TP1_PARTIAL` check, then use `trade["entry_price"]` for the SL update:

```python
        closures = self.broker.check_exits(coin, current_price)
        for trade_id, reason, exit_price, pnl in closures:
            trade = self.store.get_trade(trade_id)          # ← moved up

            if reason == "TP1_PARTIAL":
                self.store.update_trade(trade_id, {
                    "tp1_hit": True,
                    "stop_loss": trade["entry_price"],       # ← was exit_price
                })
                continue

            final_chart = await self._regenerate_chart_for_trade(trade, exit_price, reason)
```

The `trade` variable is already used below in the non-TP1 path — removing the duplicate `trade = self.store.get_trade(trade_id)` line that was there.

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
python -m pytest tests/engine/test_order_manager.py -v
```

Expected: both tests `PASSED`.

- [ ] **Step 5: Run the full test suite — confirm no regressions**

```bash
python -m pytest tests/ -v
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/engine/order_manager.py tests/engine/test_order_manager.py
git commit -m "fix(order_manager): write entry_price as SL after TP1 partial, not tp1_price

Closes #1"
```

---

## Task 2: Rehydrate open positions on bot restart (closes #2)

**Files:**
- Modify: `backend/broker/paper_broker.py`
- Modify: `backend/bot.py`
- Create: `tests/broker/__init__.py`
- Create: `tests/broker/test_paper_broker.py`

The bug: `PaperBroker.positions` is always empty on startup. Add `rehydrate(open_trades)` that reconstructs `PaperPosition` objects from DB rows. Call it in `TradingBot.initialize()` after `broker.connect()`.

- [ ] **Step 1: Create the broker test directory and file**

```bash
touch tests/broker/__init__.py
```

```python
# tests/broker/test_paper_broker.py
import asyncio
import pytest
from backend.broker.paper_broker import PaperBroker


def test_rehydrate_restores_single_position():
    broker = PaperBroker(initial_balance=200.0)
    open_trades = [
        {
            "id": "t1", "instrument": "HYPE", "direction": "LONG",
            "entry_price": 48.193, "quantity": 6.0, "stop_loss": 48.193,
            "tp1_price": 48.9425, "tp2_price": 49.276818, "take_profit": 49.276818,
            "tp1_hit": True, "notional": 289.0, "leverage": 3,
            "initial_margin": 96.45, "liquidation_price": 32.73, "funding_rate_hr": 0.0,
        }
    ]
    broker.rehydrate(open_trades)

    assert "t1" in broker.positions
    pos = broker.positions["t1"]
    assert pos.coin == "HYPE"
    assert pos.direction == "LONG"
    assert pos.entry_price == pytest.approx(48.193)
    assert pos.stop_loss == pytest.approx(48.193)
    assert pos.tp1 == pytest.approx(48.9425)
    assert pos.tp2 == pytest.approx(49.276818)
    assert pos.quantity == pytest.approx(6.0)
    assert pos.tp1_hit is True


def test_rehydrate_empty_list_leaves_positions_empty():
    broker = PaperBroker(initial_balance=200.0)
    broker.rehydrate([])
    assert broker.positions == {}


def test_rehydrate_multiple_positions():
    broker = PaperBroker(initial_balance=200.0)
    open_trades = [
        {
            "id": "t1", "instrument": "BTC", "direction": "LONG",
            "entry_price": 100000.0, "quantity": 0.001, "stop_loss": 98000.0,
            "tp1_price": 102000.0, "tp2_price": 104000.0, "take_profit": 104000.0,
            "tp1_hit": False, "notional": 100.0, "leverage": 1,
            "initial_margin": 100.0, "liquidation_price": 90000.0, "funding_rate_hr": 0.0,
        },
        {
            "id": "t2", "instrument": "ETH", "direction": "SHORT",
            "entry_price": 2000.0, "quantity": 0.05, "stop_loss": 2050.0,
            "tp1_price": 1970.0, "tp2_price": 1940.0, "take_profit": 1940.0,
            "tp1_hit": False, "notional": 100.0, "leverage": 1,
            "initial_margin": 100.0, "liquidation_price": 2200.0, "funding_rate_hr": 0.0,
        },
    ]
    broker.rehydrate(open_trades)
    assert len(broker.positions) == 2
    assert "t1" in broker.positions
    assert "t2" in broker.positions


def test_rehydrated_position_exits_at_stop_loss():
    """After rehydration, check_exits must close a position that hits SL."""
    broker = PaperBroker(initial_balance=200.0)
    broker.rehydrate([
        {
            "id": "t1", "instrument": "BTC", "direction": "LONG",
            "entry_price": 100.0, "quantity": 1.0, "stop_loss": 95.0,
            "tp1_price": 110.0, "tp2_price": 120.0, "take_profit": 120.0,
            "tp1_hit": False, "notional": 100.0, "leverage": 1,
            "initial_margin": 100.0, "liquidation_price": 80.0, "funding_rate_hr": 0.0,
        }
    ])
    closures = broker.check_exits("BTC", current_price=94.0)
    assert len(closures) == 1
    trade_id, reason, exit_price, pnl = closures[0]
    assert reason == "SL"
    assert exit_price == pytest.approx(95.0)
    assert pnl == pytest.approx((95.0 - 100.0) * 1.0)
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
python -m pytest tests/broker/test_paper_broker.py -v
```

Expected: `AttributeError: 'PaperBroker' object has no attribute 'rehydrate'`.

- [ ] **Step 3: Add `rehydrate()` to PaperBroker**

Open `backend/broker/paper_broker.py`. After the `disconnect` method (line ~42), add:

```python
    def rehydrate(self, open_trades: list[dict]) -> None:
        """Reconstruct in-memory positions from DB rows after a bot restart."""
        for t in open_trades:
            trade_id = str(t["id"])
            self.positions[trade_id] = PaperPosition(
                trade_id=trade_id,
                coin=str(t["instrument"]),
                direction=str(t["direction"]),
                entry_price=float(t["entry_price"]),
                quantity=float(t["quantity"]),
                initial_quantity=float(t["quantity"]),
                stop_loss=float(t["stop_loss"]),
                tp1=float(t.get("tp1_price") or t.get("take_profit", 0)),
                tp2=float(t.get("tp2_price") or t.get("take_profit", 0)),
                notional=float(t.get("notional") or 0),
                leverage=int(t.get("leverage") or 1),
                initial_margin=float(t.get("initial_margin") or 0),
                liquidation_price=float(t.get("liquidation_price") or 0),
                funding_rate_hr=float(t.get("funding_rate_hr") or 0),
                tp1_hit=bool(t.get("tp1_hit") or False),
            )
        logger.info(f"Rehydrated {len(open_trades)} open position(s) from DB")
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
python -m pytest tests/broker/test_paper_broker.py -v
```

Expected: all 4 tests `PASSED`.

- [ ] **Step 5: Wire rehydrate() into TradingBot.initialize()**

Open `backend/bot.py`. In `TradingBot.initialize()`, after `await self._broker.connect()` (around line 61), add:

```python
        await self._broker.connect()

        open_trades = self._duckdb_store.list_open_trades()
        self._broker.rehydrate(open_trades)
        if open_trades:
            logger.info(f"Restored {len(open_trades)} open position(s) from previous session")
```

- [ ] **Step 6: Run the full test suite**

```bash
python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/broker/paper_broker.py backend/bot.py tests/broker/__init__.py tests/broker/test_paper_broker.py
git commit -m "fix(broker): rehydrate open positions on bot restart

Closes #2"
```

---

## Task 3: Reserve margin on position open; enforce in QualityFilter (closes #3)

**Files:**
- Modify: `backend/broker/paper_broker.py`
- Modify: `backend/engine/quality_filter.py`
- Modify: `backend/scanner/coin_scanner.py`
- Extend: `tests/broker/test_paper_broker.py`
- Extend: `tests/engine/test_quality_filter.py`

Three coordinated changes: (a) deduct margin from balance on open, return it on close; (b) QualityFilter rejects when balance < new position margin; (c) CoinScanner sizes the position before calling QualityFilter so the margin is known.

**Sub-task 3a — margin reservation in PaperBroker**

- [ ] **Step 1: Add margin tests to test_paper_broker.py**

Append to `tests/broker/test_paper_broker.py`:

```python
def test_open_position_deducts_initial_margin_from_balance():
    broker = PaperBroker(initial_balance=200.0)
    asyncio.get_event_loop().run_until_complete(broker.connect())
    broker.open_position(
        coin="HYPE", direction="LONG", entry=48.0, quantity=6.0,
        stop_loss=47.0, tp1=49.0, tp2=50.0,
        notional=288.0, leverage=3, initial_margin=96.0,
        liquidation_price=32.0, funding_rate_hr=0.0,
    )
    assert broker.balance == pytest.approx(200.0 - 96.0)


def test_close_position_returns_margin_plus_pnl():
    broker = PaperBroker(initial_balance=200.0)
    asyncio.get_event_loop().run_until_complete(broker.connect())
    trade_id = broker.open_position(
        coin="HYPE", direction="LONG", entry=48.0, quantity=6.0,
        stop_loss=47.0, tp1=49.0, tp2=50.0,
        notional=288.0, leverage=3, initial_margin=96.0,
        liquidation_price=32.0, funding_rate_hr=0.0,
    )
    pnl = 12.0
    broker._close_full(trade_id, pnl)
    # balance = (200 - 96) + 12 + 96 = 212
    assert broker.balance == pytest.approx(200.0 + pnl)


def test_tp1_partial_returns_half_margin():
    broker = PaperBroker(initial_balance=200.0)
    asyncio.get_event_loop().run_until_complete(broker.connect())
    broker.open_position(
        coin="BTC", direction="LONG", entry=100.0, quantity=2.0,
        stop_loss=95.0, tp1=110.0, tp2=120.0,
        notional=200.0, leverage=1, initial_margin=200.0,
        liquidation_price=80.0, funding_rate_hr=0.0,
    )
    # balance is 0 after open (200 - 200)
    assert broker.balance == pytest.approx(0.0)

    closures = broker.check_exits("BTC", current_price=111.0)
    tp1_closure = next((c for c in closures if c[1] == "TP1_PARTIAL"), None)
    assert tp1_closure is not None

    # After TP1: half margin (100) returned + partial PnL
    # partial PnL = (110 - 100) * 1.0 = 10
    # balance = 0 + 100 + 10 = 110
    assert broker.balance == pytest.approx(100.0 + (110.0 - 100.0) * 1.0)


def test_rehydrate_deducts_margin_for_restored_positions():
    """Rehydrated positions represent committed capital; balance must reflect reserved margin."""
    broker = PaperBroker(initial_balance=200.0)
    broker.rehydrate([
        {
            "id": "t1", "instrument": "HYPE", "direction": "LONG",
            "entry_price": 48.0, "quantity": 6.0, "stop_loss": 48.0,
            "tp1_price": 49.0, "tp2_price": 50.0, "take_profit": 50.0,
            "tp1_hit": True, "notional": 289.0, "leverage": 3,
            "initial_margin": 96.45, "liquidation_price": 32.0, "funding_rate_hr": 0.0,
        }
    ])
    assert broker.balance == pytest.approx(200.0 - 96.45)
```

- [ ] **Step 2: Run the new margin tests — confirm they fail**

```bash
python -m pytest tests/broker/test_paper_broker.py::test_open_position_deducts_initial_margin_from_balance tests/broker/test_paper_broker.py::test_close_position_returns_margin_plus_pnl tests/broker/test_paper_broker.py::test_tp1_partial_returns_half_margin -v
```

Expected: all 3 `FAILED`.

- [ ] **Step 3: Update open_position to deduct margin**

In `backend/broker/paper_broker.py`, update `open_position`:

```python
    def open_position(self, *, coin: str, direction: str, entry: float, quantity: float,
                      stop_loss: float, tp1: float, tp2: float, notional: float, leverage: int,
                      initial_margin: float, liquidation_price: float, funding_rate_hr: float) -> str:
        trade_id = str(uuid.uuid4())
        self.balance -= initial_margin          # ← deduct margin upfront
        self.positions[trade_id] = PaperPosition(
            trade_id=trade_id, coin=coin, direction=direction, entry_price=entry,
            quantity=quantity, initial_quantity=quantity, stop_loss=stop_loss, tp1=tp1, tp2=tp2,
            notional=notional, leverage=leverage, initial_margin=initial_margin,
            liquidation_price=liquidation_price, funding_rate_hr=funding_rate_hr,
        )
        logger.info(f"OPENED {direction} {coin} qty={quantity:.4f} entry={entry:.4f} SL={stop_loss:.4f} margin=${initial_margin:.2f} balance=${self.balance:.2f}")
        return trade_id
```

- [ ] **Step 4: Update _close_full to return margin**

In `backend/broker/paper_broker.py`, update `_close_full`:

```python
    def _close_full(self, trade_id: str, pnl: float) -> None:
        pos = self.positions.pop(trade_id, None)
        if pos is None:
            return
        self.balance += pnl + pos.initial_margin   # ← return margin on close
        logger.info(f"CLOSED {pos.direction} {pos.coin} pnl=${pnl:.2f} margin_returned=${pos.initial_margin:.2f} balance=${self.balance:.2f}")
```

- [ ] **Step 5: Update TP1 partial in check_exits to return half margin**

In `backend/broker/paper_broker.py`, inside `check_exits`, find the TP1 partial block and update it:

```python
            if hit_tp1:
                half = pos.initial_quantity * 0.5
                if pos.direction == "LONG":
                    pnl_partial = (pos.tp1 - pos.entry_price) * half
                else:
                    pnl_partial = (pos.entry_price - pos.tp1) * half
                half_margin = pos.initial_margin * 0.5
                pos.quantity -= half
                pos.tp1_hit = True
                pos.stop_loss = pos.entry_price     # move to breakeven
                pos.initial_margin = half_margin    # remaining position holds half margin
                self.balance += pnl_partial + half_margin   # ← return half margin
                closures.append((trade_id, "TP1_PARTIAL", pos.tp1, pnl_partial))
```

- [ ] **Step 6: Update rehydrate() to deduct margin for restored positions**

In `backend/broker/paper_broker.py`, update `rehydrate()` to deduct `initial_margin` from `self.balance` for each restored position. Without this, a bot restart resets the balance illusion: the sizer will size against the full initial balance even though capital is already committed.

```python
    def rehydrate(self, open_trades: list[dict]) -> None:
        """Reconstruct in-memory positions from DB rows after a bot restart."""
        for t in open_trades:
            trade_id = str(t["id"])
            margin = float(t.get("initial_margin") or 0)
            self.balance -= margin                          # ← deduct committed capital
            self.positions[trade_id] = PaperPosition(
                trade_id=trade_id,
                coin=str(t["instrument"]),
                direction=str(t["direction"]),
                entry_price=float(t["entry_price"]),
                quantity=float(t["quantity"]),
                initial_quantity=float(t["quantity"]),
                stop_loss=float(t["stop_loss"]),
                tp1=float(t.get("tp1_price") or t.get("take_profit", 0)),
                tp2=float(t.get("tp2_price") or t.get("take_profit", 0)),
                notional=float(t.get("notional") or 0),
                leverage=int(t.get("leverage") or 1),
                initial_margin=float(t.get("initial_margin") or 0),
                liquidation_price=float(t.get("liquidation_price") or 0),
                funding_rate_hr=float(t.get("funding_rate_hr") or 0),
                tp1_hit=bool(t.get("tp1_hit") or False),
            )
        logger.info(f"Rehydrated {len(open_trades)} open position(s) from DB")
```

This replaces the `rehydrate()` written in Task 2 Step 3 — the only difference is the `self.balance -= margin` line.

- [ ] **Step 7: Run the margin tests — confirm they pass**

```bash
python -m pytest tests/broker/test_paper_broker.py -v
```

Expected: all tests `PASSED` (including `test_rehydrate_deducts_margin_for_restored_positions`).

**Sub-task 3b — QualityFilter margin check**

- [ ] **Step 8: Add margin tests to test_quality_filter.py**

Append to `tests/engine/test_quality_filter.py`:

```python
def test_rejects_when_balance_less_than_position_margin():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(
        open_trades_count=0, daily_pnl=0, balance=50.0, confidence=80.0,
        position_margin=100.0,
    ) is False


def test_accepts_when_balance_equals_position_margin():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(
        open_trades_count=0, daily_pnl=0, balance=100.0, confidence=80.0,
        position_margin=100.0,
    ) is True


def test_existing_tests_still_pass_with_default_margin():
    """position_margin defaults to 0 — existing callers need no change."""
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=2, daily_pnl=-10, balance=500, confidence=70) is True
```

- [ ] **Step 9: Run the new QualityFilter tests — confirm they fail**

```bash
python -m pytest tests/engine/test_quality_filter.py -v
```

Expected: `FAILED — TypeError: accept() got an unexpected keyword argument 'position_margin'`.

- [ ] **Step 10: Update QualityFilter.accept()**

Replace `backend/engine/quality_filter.py` with:

```python
"""Final gate before paper-executing a signal."""

from dataclasses import dataclass


@dataclass
class QualityFilter:
    daily_loss_limit_pct: float
    max_open_trades: int
    min_confidence_pct: float

    def accept(
        self,
        *,
        open_trades_count: int,
        daily_pnl: float,
        balance: float,
        confidence: float,
        position_margin: float = 0.0,
    ) -> bool:
        if confidence < self.min_confidence_pct:
            return False
        if open_trades_count >= self.max_open_trades:
            return False
        if balance > 0 and (daily_pnl / balance) <= -self.daily_loss_limit_pct:
            return False
        if balance < position_margin:
            return False
        return True
```

- [ ] **Step 11: Run the QualityFilter tests — confirm they pass**

```bash
python -m pytest tests/engine/test_quality_filter.py -v
```

Expected: all 7 tests `PASSED`.

**Sub-task 3c — CoinScanner: size first, then quality check**

- [ ] **Step 12: Update scan() in coin_scanner.py**

Open `backend/scanner/coin_scanner.py`. Swap steps 7 (quality gate) and 8 (position sizing) so margin is known before calling `quality_filter.accept()`. The new order in `scan()`:

```python
        # 7. Position sizing (must happen before quality check to know margin)
        max_lev = self.fetcher.get_max_leverage(self.coin)
        funding = self.fetcher.fetch_funding_rate(self.coin)
        position = self.position_sizer.size(
            balance=balance, entry=signal.entry_price, stop_loss=signal.stop_loss,
            direction=signal.direction, max_leverage_for_coin=max_lev, funding_rate_hr=funding,
        )

        # 8. Quality gate (now includes margin check)
        if not self.quality_filter.accept(
            open_trades_count=open_trades, daily_pnl=daily_pnl, balance=balance,
            confidence=confidence, position_margin=position.initial_margin,
        ):
            logger.info(
                f"[{self.coin}] signal rejected by quality filter "
                f"(confidence={confidence:.1f}, margin_needed=${position.initial_margin:.2f}, balance=${balance:.2f})"
            )
            return None

        # 9. Chart PNG
```

Also remove the old step 7 block (the quality gate that was before sizing). The balance variable is already set from `bot_state` earlier in the method — no change needed there.

- [ ] **Step 13: Run the full test suite**

```bash
python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 14: Commit**

```bash
git add backend/broker/paper_broker.py backend/engine/quality_filter.py backend/scanner/coin_scanner.py tests/broker/test_paper_broker.py tests/engine/test_quality_filter.py
git commit -m "fix(broker): reserve margin on open, return on close; enforce in QualityFilter

Closes #3"
```

---

## Task 4: Trade lifecycle events — DB, API, and UI timeline (closes #4)

**Files:**
- Modify: `backend/data/duckdb_store.py`
- Modify: `backend/engine/order_manager.py`
- Modify: `backend/api_server.py`
- Modify: `frontend/src/lib/api.js`
- Modify: `frontend/src/pages/TradeDetail.jsx`
- Create: `tests/data/test_duckdb_store_events.py`

**Sub-task 4a — trade_events table in DuckDB**

- [ ] **Step 1: Create the event store test file**

```python
# tests/data/test_duckdb_store_events.py
import os
import tempfile
import pytest
from backend.data.duckdb_store import DuckDBStore


@pytest.fixture
def store():
    with tempfile.NamedTemporaryFile(suffix=".duckdb", delete=False) as f:
        path = f.name
    s = DuckDBStore(path)
    yield s
    s.close()
    os.unlink(path)


def test_insert_and_list_tp1_event(store):
    store.insert_trade_event({
        "id": "evt-1",
        "trade_id": "trade-abc",
        "event_type": "TP1_PARTIAL",
        "price": 48.9425,
        "pnl_partial": 3.5,
        "timestamp": "2026-05-20T10:00:00",
    })
    events = store.list_events_for_trade("trade-abc")
    assert len(events) == 1
    assert events[0]["event_type"] == "TP1_PARTIAL"
    assert events[0]["price"] == pytest.approx(48.9425)
    assert events[0]["pnl_partial"] == pytest.approx(3.5)


def test_insert_sl_moved_event(store):
    store.insert_trade_event({
        "id": "evt-2",
        "trade_id": "trade-abc",
        "event_type": "SL_MOVED",
        "price": 48.193,
        "pnl_partial": None,
        "timestamp": "2026-05-20T10:00:01",
    })
    events = store.list_events_for_trade("trade-abc")
    assert len(events) == 1
    assert events[0]["event_type"] == "SL_MOVED"


def test_list_events_returns_only_events_for_given_trade(store):
    store.insert_trade_event({
        "id": "evt-a", "trade_id": "trade-1", "event_type": "TP1_PARTIAL",
        "price": 50.0, "pnl_partial": 5.0, "timestamp": "2026-05-20T10:00:00",
    })
    store.insert_trade_event({
        "id": "evt-b", "trade_id": "trade-2", "event_type": "TP1_PARTIAL",
        "price": 60.0, "pnl_partial": 8.0, "timestamp": "2026-05-20T10:01:00",
    })
    assert len(store.list_events_for_trade("trade-1")) == 1
    assert len(store.list_events_for_trade("trade-2")) == 1
    assert len(store.list_events_for_trade("trade-9")) == 0


def test_events_ordered_by_timestamp(store):
    store.insert_trade_event({
        "id": "evt-2", "trade_id": "t1", "event_type": "SL_MOVED",
        "price": 48.193, "pnl_partial": None, "timestamp": "2026-05-20T10:00:02",
    })
    store.insert_trade_event({
        "id": "evt-1", "trade_id": "t1", "event_type": "TP1_PARTIAL",
        "price": 48.9425, "pnl_partial": 3.5, "timestamp": "2026-05-20T10:00:00",
    })
    events = store.list_events_for_trade("t1")
    assert events[0]["event_type"] == "TP1_PARTIAL"
    assert events[1]["event_type"] == "SL_MOVED"
```

Also check that `DuckDBStore` has a `close()` method — look for it. If missing, add one in the store:

```python
    def close(self) -> None:
        self.conn.close()
```

- [ ] **Step 2: Run the event tests — confirm they fail**

```bash
python -m pytest tests/data/test_duckdb_store_events.py -v
```

Expected: `AttributeError: 'DuckDBStore' object has no attribute 'insert_trade_event'`.

- [ ] **Step 3: Add trade_events table to DuckDBStore._create_tables()**

In `backend/data/duckdb_store.py`, inside `_create_tables()`, after the `strategy_configs` table block, add:

```python
            self.conn.execute("""
            CREATE TABLE IF NOT EXISTS trade_events (
                id          VARCHAR PRIMARY KEY,
                trade_id    VARCHAR NOT NULL,
                event_type  VARCHAR NOT NULL,
                price       DOUBLE,
                pnl_partial DOUBLE,
                timestamp   TIMESTAMP NOT NULL
            )
            """)
```

- [ ] **Step 4: Add insert_trade_event and list_events_for_trade methods to DuckDBStore**

In `backend/data/duckdb_store.py`, after the `get_trade_chart_flags` method, add:

```python
    def insert_trade_event(self, event: dict) -> None:
        """Insert a lifecycle event for a trade."""
        with self._lock:
            self.conn.execute(
                "INSERT INTO trade_events (id, trade_id, event_type, price, pnl_partial, timestamp) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                [
                    event["id"],
                    event["trade_id"],
                    event["event_type"],
                    event.get("price"),
                    event.get("pnl_partial"),
                    event["timestamp"],
                ],
            )

    def list_events_for_trade(self, trade_id: str) -> list[dict]:
        """Return lifecycle events for a trade, ordered by timestamp."""
        with self._lock:
            df = self.conn.execute(
                "SELECT * FROM trade_events WHERE trade_id = ? ORDER BY timestamp ASC",
                [trade_id],
            ).fetchdf()
        if df.empty:
            return []
        return df.to_dict("records")
```

Also ensure `close()` exists in `DuckDBStore`. Search for it — if absent, add near the bottom of the class:

```python
    def close(self) -> None:
        self.conn.close()
```

- [ ] **Step 5: Run the event tests — confirm they pass**

```bash
python -m pytest tests/data/test_duckdb_store_events.py -v
```

Expected: all 4 tests `PASSED`.

**Sub-task 4b — emit events from OrderManager**

- [ ] **Step 6: Add event emission to check_open_trades in order_manager.py**

In `backend/engine/order_manager.py`, update the TP1_PARTIAL branch in `check_open_trades()`. After the existing `store.update_trade` call, insert two events:

```python
            if reason == "TP1_PARTIAL":
                self.store.update_trade(trade_id, {
                    "tp1_hit": True,
                    "stop_loss": trade["entry_price"],
                })
                import uuid as _uuid
                from datetime import datetime, timezone
                now_iso = datetime.now(timezone.utc).isoformat()
                self.store.insert_trade_event({
                    "id": str(_uuid.uuid4()),
                    "trade_id": trade_id,
                    "event_type": "TP1_PARTIAL",
                    "price": exit_price,
                    "pnl_partial": pnl,
                    "timestamp": now_iso,
                })
                self.store.insert_trade_event({
                    "id": str(_uuid.uuid4()),
                    "trade_id": trade_id,
                    "event_type": "SL_MOVED",
                    "price": float(trade["entry_price"]),
                    "pnl_partial": None,
                    "timestamp": now_iso,
                })
                continue
```

Move the `import uuid` and `import datetime` to the top of the file (they may already be there — check first, only add if missing).

- [ ] **Step 7: Run the full test suite**

```bash
python -m pytest tests/ -v
```

Expected: all tests pass.

**Sub-task 4c — API endpoint**

- [ ] **Step 8: Add GET /trades/{trade_id}/events to api_server.py**

In `backend/api_server.py`, after the `get_trade` endpoint (around line 390), add:

```python
@app.get("/trades/{trade_id}/events")
async def get_trade_events(trade_id: str):
    store = get_store()
    if store is None:
        return []
    events = store.list_events_for_trade(trade_id)
    return _clean(events)
```

- [ ] **Step 9: Verify the endpoint manually**

Start the API server:

```bash
python -m uvicorn backend.api_server:app --port 8090 --reload
```

In a second terminal:

```bash
curl -s http://localhost:8090/trades/some-trade-id/events | python3 -m json.tool
```

Expected: `[]` (empty list — no events for a random id) with HTTP 200.

Stop the server with Ctrl+C.

**Sub-task 4d — Frontend: add getTradeEvents and timeline UI**

- [ ] **Step 10: Add getTradeEvents to api.js**

Open `frontend/src/lib/api.js`. After the `getTrade` method, add:

```javascript
  async getTradeEvents(tradeId) {
    const res = await fetch(`${this.base}/trades/${tradeId}/events`);
    if (!res.ok) return [];
    return res.json();
  },
```

- [ ] **Step 11: Add events state and fetch to TradeDetail.jsx**

Open `frontend/src/pages/TradeDetail.jsx`. Find the state declarations (around line 51) and add:

```jsx
  const [events, setEvents] = useState([]);
```

Find the `useEffect` that calls `api.getTrade(id)` (around line 54) and extend it to also fetch events:

```jsx
  useEffect(() => {
    api.getTrade(id)
      .then(t => { setTrade(t); setLoading(false); })
      .catch(() => setLoading(false));
    api.getTradeEvents(id)
      .then(evts => setEvents(evts || []))
      .catch(() => {});
  }, [id]);
```

- [ ] **Step 12: Add the EventChip component and timeline section to TradeDetail.jsx**

After the `PnlRow` component definition (around line 47), add the `EventChip` component:

```jsx
function EventChip({ eventType, price, pnlPartial, timestamp }) {
  const configs = {
    TP1_PARTIAL: { label: 'TP1 Hit', color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)' },
    SL_MOVED:    { label: 'SL → Breakeven', color: '#60a5fa', bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.2)' },
    TP2_HIT:     { label: 'TP2 Hit', color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)' },
    SL_HIT:      { label: 'Stopped Out', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' },
  };
  const cfg = configs[eventType] || { label: eventType, color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)' };
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, marginTop: 5, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: cfg.color,
            background: cfg.bg, border: `1px solid ${cfg.border}`,
            padding: '2px 8px', borderRadius: 4,
          }}>
            {cfg.label}
            {pnlPartial != null && ` · ${pnlPartial >= 0 ? '+' : ''}$${parseFloat(pnlPartial).toFixed(2)}`}
          </span>
          <span style={{ fontSize: 11, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
            {price != null ? `@ $${parseFloat(price).toFixed(4)}` : ''}
          </span>
        </div>
        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
          {timestamp ? new Date(timestamp).toLocaleString() : ''}
        </div>
      </div>
    </div>
  );
}
```

Then, inside the `TradeDetail` return JSX, add the timeline section after the existing cards (before the closing `</div>`). Find a logical place — after the chart or after the trade stats card — and add:

```jsx
      {events.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <CardHeader>
            <CardTitle style={{ fontSize: 14, color: '#94a3b8' }}>Trade Events</CardTitle>
          </CardHeader>
          <CardContent>
            {events.map(evt => (
              <EventChip
                key={evt.id}
                eventType={evt.event_type}
                price={evt.price}
                pnlPartial={evt.pnl_partial}
                timestamp={evt.timestamp}
              />
            ))}
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 13: Run the frontend dev server and verify the timeline**

```bash
cd frontend && npm run dev
```

Open the browser to the TradeDetail page for any trade that has events. Verify the timeline section appears with the correct chips. Open a trade with no events — confirm the section is hidden (empty events array).

- [ ] **Step 14: Run the full test suite one final time**

```bash
cd /Users/hash/Documents/GitHub/ProjectHermes && python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 15: Commit**

```bash
git add backend/data/duckdb_store.py backend/engine/order_manager.py backend/api_server.py frontend/src/lib/api.js frontend/src/pages/TradeDetail.jsx tests/data/test_duckdb_store_events.py
git commit -m "feat(events): trade lifecycle event log — DB, API, and timeline UI

Closes #4"
```

---

## Migration Note — one-time balance discontinuity

The existing open HYPE LONG position was opened by the pre-fix broker. Its margin ($96.45) was never deducted from `self.balance` at open time, so the DB bot state currently shows `balance = $209` (which includes that margin as if it were free capital).

After deploying Task 3:
- On first restart, `rehydrate()` will deduct $96.45 from `self.balance` (e.g. `209 - 96.45 = $112.55`).
- `_update_bot_state()` will then write `balance = $112.55` to the DB — a one-time drop of ~$96 that reflects reality, not a real loss.
- When the HYPE position eventually closes, margin is returned, and balance moves to `$112.55 + 96.45 + PnL`.

**Optional clean-slate path:** Manually close the open HYPE trade (set status CLOSED via DuckDB or the API) before restarting with the fix deployed. This avoids the visible balance correction in the UI.

---

## Completion Checklist

- [ ] Issue #1 closed — SL after TP1 writes entry_price, not tp1_price
- [ ] Issue #2 closed — bot restart rehydrates open positions
- [ ] Issue #3 closed — margin reserved on open, returned on close; QualityFilter enforces balance
- [ ] Issue #4 closed — trade_events table, API endpoint, TradeDetail timeline
- [ ] Full test suite passes
- [ ] No open regressions
