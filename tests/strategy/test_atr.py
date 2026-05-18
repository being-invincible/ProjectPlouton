"""Tests for ATR (Average True Range) calculation."""

import numpy as np
import pandas as pd
import pytest

from backend.strategy.atr import compute_atr


def _make_df(highs, lows, closes):
    return pd.DataFrame({"High": highs, "Low": lows, "Close": closes})


def test_atr_known_values():
    df = _make_df(
        highs= [10, 12, 11, 13, 14],
        lows=  [ 9, 10, 10, 11, 12],
        closes=[ 9, 11, 10, 12, 13],
    )
    atr = compute_atr(df, period=3)
    # Wilder's smoothed ATR should be ~2.074 at last row
    assert atr.iloc[-1] == pytest.approx(2.074, abs=0.01)


def test_atr_returns_series_same_length():
    df = _make_df(highs=[10]*20, lows=[9]*20, closes=[9.5]*20)
    atr = compute_atr(df, period=14)
    assert len(atr) == 20
    # Flat data → ATR should be 1.0 (high-low)
    assert atr.iloc[-1] == pytest.approx(1.0)


def test_atr_handles_short_series_gracefully():
    df = _make_df(highs=[10, 11], lows=[9, 10], closes=[9, 10])
    atr = compute_atr(df, period=14)
    # Series shorter than period → still returns same length
    assert len(atr) == 2
