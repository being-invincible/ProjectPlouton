"""Tests for CoinScanner — per-coin pipeline."""

from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from backend.scanner.coin_scanner import CoinScanner


def _df(n=200, base=100.0):
    rng = np.random.RandomState(7)
    closes = base + np.cumsum(rng.randn(n) * 0.5)
    idx = pd.date_range("2026-05-15", periods=n, freq="5min", tz="UTC")
    return pd.DataFrame({"Open": closes, "High": closes+0.3, "Low": closes-0.3, "Close": closes, "Volume": rng.randint(500,1500,n).astype(float)}, index=idx)


@pytest.mark.asyncio
async def test_scan_no_signal_returns_none(monkeypatch):
    fake_fetcher = MagicMock()
    fake_fetcher.fetch_multi_timeframe.return_value = {"5m": _df(), "15m": _df(), "1h": _df()}
    fake_fetcher.get_max_leverage.return_value = 20
    fake_fetcher.fetch_funding_rate.return_value = 0.0

    fake_strategy = MagicMock()
    fake_strategy.analyze.return_value = None

    fake_store = MagicMock()
    fake_store.compute_mtf_trend.return_value = {"1h": {"trend": "UP", "slope": 0.005}, "15m": {"trend": "UP", "slope": 0.004}}

    scanner = CoinScanner(coin="BTC", fetcher=fake_fetcher, strategy=fake_strategy,
                           confidence_scorer=MagicMock(), position_sizer=MagicMock(),
                           chart_generator=MagicMock(), discord=AsyncMock(),
                           duckdb_store=fake_store, paper_broker=MagicMock(),
                           order_manager=AsyncMock(), quality_filter=MagicMock())
    result = await scanner.scan()
    assert result is None
