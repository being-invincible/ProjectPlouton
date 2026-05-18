"""Tests for GoldenPocketStrategy — swing detection, golden pocket touch, signal generation."""

import numpy as np
import pandas as pd
import pytest

from backend.strategy.golden_pocket import GoldenPocketStrategy, Signal


def _make_df_from_closes(closes, start_ts="2026-01-01"):
    """Build OHLCV df where O=H=L=C (synthetic, clean ratios for testing)."""
    idx = pd.date_range(start=start_ts, periods=len(closes), freq="5min", tz="UTC")
    return pd.DataFrame({
        "Open": closes, "High": closes, "Low": closes, "Close": closes, "Volume": [1000.0] * len(closes),
    }, index=idx)


def test_detect_swing_high_and_low():
    closes = list(np.linspace(100, 150, 100)) + list(np.linspace(150, 130, 50))
    df = _make_df_from_closes(closes)
    s = GoldenPocketStrategy()
    swing = s.detect_swing(df, lookback=150)
    assert swing.high == pytest.approx(150.0, abs=0.5)
    assert swing.low == pytest.approx(100.0, abs=0.5)
    assert swing.direction == "UP"


def test_golden_pocket_zone_calculation_for_long():
    s = GoldenPocketStrategy()
    zone = s.golden_pocket_zone(swing_low=100.0, swing_high=200.0, direction="UP")
    assert zone.upper == pytest.approx(150.0, abs=0.01)   # 50%
    assert zone.lower == pytest.approx(138.20, abs=0.01)  # 61.8%


def test_price_inside_golden_pocket_triggers_long():
    s = GoldenPocketStrategy()
    closes = list(np.linspace(100, 200, 50)) + list(np.linspace(200, 145, 20))
    df = _make_df_from_closes(closes)
    mtf_trend = {"1h": {"trend": "UP", "slope": 0.005}, "15m": {"trend": "UP", "slope": 0.003}}
    signal = s.analyze(df, mtf_trend=mtf_trend, coin="BTC")
    assert signal is not None
    assert signal.direction == "LONG"
    assert 138.20 <= signal.entry_price <= 150.0


def test_no_signal_when_price_outside_golden_pocket():
    s = GoldenPocketStrategy()
    closes = list(np.linspace(100, 200, 50)) + list(np.linspace(200, 180, 20))
    df = _make_df_from_closes(closes)
    mtf_trend = {"1h": {"trend": "UP", "slope": 0.005}, "15m": {"trend": "UP", "slope": 0.003}}
    assert s.analyze(df, mtf_trend=mtf_trend, coin="BTC") is None


def test_no_signal_when_mtf_disagrees():
    s = GoldenPocketStrategy()
    closes = list(np.linspace(100, 200, 50)) + list(np.linspace(200, 145, 20))
    df = _make_df_from_closes(closes)
    mtf_trend = {"1h": {"trend": "DOWN", "slope": -0.005}, "15m": {"trend": "UP", "slope": 0.003}}
    assert s.analyze(df, mtf_trend=mtf_trend, coin="BTC") is None
