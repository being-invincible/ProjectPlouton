"""ATR (Average True Range) — Wilder's smoothing."""

import pandas as pd


def compute_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Return ATR series aligned to df.index. Uses Wilder's smoothing."""
    high = df["High"]
    low = df["Low"]
    close = df["Close"]

    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    tr.iloc[0] = high.iloc[0] - low.iloc[0]  # first row has no prev close

    # True Wilder's smoothing: SMA seed for the first `period` bars,
    # then recursive ATR[i] = (ATR[i-1] * (period-1) + TR[i]) / period.
    # Note: ewm(alpha=1/period) only approximates this asymptotically.
    atr = pd.Series(index=tr.index, dtype=float)
    sma = tr.rolling(window=period).mean()
    atr.iloc[:period] = sma.iloc[:period]
    for i in range(period, len(tr)):
        atr.iloc[i] = (atr.iloc[i - 1] * (period - 1) + tr.iloc[i]) / period
    return atr
