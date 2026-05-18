"""Smoke test for chart_generator — PNG bytes are produced and non-empty."""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.notifications.chart_generator import ChartGenerator


@dataclass
class FakeSignal:
    coin: str = "BTC"
    direction: str = "LONG"
    entry_price: float = 100.0
    stop_loss: float = 95.0
    tp1: float = 107.5
    tp2: float = 120.0
    fib_level_triggered: float = 0.5
    swing_high: float = 110.0
    swing_low: float = 90.0
    atr: float = 1.5
    timestamp: pd.Timestamp = pd.Timestamp("2026-05-17 14:32", tz="UTC")


def _make_df(n=500):
    base = 100.0
    rng = np.random.RandomState(42)
    closes = base + np.cumsum(rng.randn(n) * 0.5)
    idx = pd.date_range("2026-05-15", periods=n, freq="5min", tz="UTC")
    return pd.DataFrame({
        "Open": closes - 0.1,
        "High": closes + 0.3,
        "Low": closes - 0.3,
        "Close": closes,
        "Volume": rng.randint(500, 1500, n).astype(float),
    }, index=idx)


def test_chart_generator_produces_png_bytes():
    df = _make_df()
    gen = ChartGenerator(width=1600, height=800)
    png = gen.render(df=df, signal=FakeSignal(), confidence=72.0)
    assert isinstance(png, bytes)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(png) > 5_000


def test_chart_generator_with_exit_marker():
    df = _make_df()
    gen = ChartGenerator(width=1600, height=800)
    png = gen.render(
        df=df,
        signal=FakeSignal(),
        confidence=72.0,
        exit_price=105.0,
        exit_timestamp=df.index[-50],
        exit_reason="TP1",
    )
    assert isinstance(png, bytes)
    assert len(png) > 5_000
