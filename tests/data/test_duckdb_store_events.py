import os
import tempfile
import pytest
from backend.data.duckdb_store import DuckDBStore


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "test.duckdb")
        s = DuckDBStore(path)
        yield s
        s.close()


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
