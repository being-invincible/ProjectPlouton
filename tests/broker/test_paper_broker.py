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


def test_rehydrated_tp1_hit_position_does_not_fire_second_tp1():
    """A rehydrated position with tp1_hit=True must skip the TP1 check."""
    broker = PaperBroker(initial_balance=200.0)
    broker.rehydrate([
        {
            "id": "t1", "instrument": "BTC", "direction": "LONG",
            "entry_price": 100.0, "quantity": 1.0, "stop_loss": 100.0,
            "tp1_price": 110.0, "tp2_price": 120.0, "take_profit": 120.0,
            "tp1_hit": True,  # TP1 already fired — quantity is already halved
            "notional": 100.0, "leverage": 1,
            "initial_margin": 100.0, "liquidation_price": 80.0, "funding_rate_hr": 0.0,
        }
    ])
    # Price crosses TP1 level — must NOT fire TP1_PARTIAL again
    closures = broker.check_exits("BTC", current_price=111.0)
    tp1_closures = [c for c in closures if c[1] == "TP1_PARTIAL"]
    assert tp1_closures == [], "TP1_PARTIAL must not fire again for a rehydrated tp1_hit position"


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
