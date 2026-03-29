"""
Technical indicators for the trading strategy engine.

Implements VWAP, swing point detection, and Fibonacci retracement
level calculations using only pandas/numpy (no external TA library).
"""

import pandas as pd
import numpy as np
from typing import Optional


def calculate_vwap(df: pd.DataFrame) -> pd.Series:
    """
    Calculate Volume Weighted Average Price (VWAP).

    Used for trend identification:
    - Price > VWAP → bullish trend
    - Price < VWAP → bearish trend

    Args:
        df: DataFrame with 'High', 'Low', 'Close', 'Volume' columns

    Returns:
        Series of VWAP values
    """
    typical_price = (df["High"] + df["Low"] + df["Close"]) / 3
    cumulative_tp_vol = (typical_price * df["Volume"]).cumsum()
    cumulative_vol = df["Volume"].cumsum()

    # Avoid division by zero
    vwap = cumulative_tp_vol / cumulative_vol.replace(0, np.nan)
    return vwap.fillna(typical_price)


def find_swing_points(
    df: pd.DataFrame,
    lookback: int = 20,
) -> dict:
    """
    Detect swing high and swing low within a lookback period.

    A swing high is the highest high in the lookback window.
    A swing low is the lowest low in the lookback window.

    Args:
        df: DataFrame with 'High' and 'Low' columns
        lookback: Number of candles to look back

    Returns:
        dict with keys:
        - 'swing_high': float — the highest price
        - 'swing_low': float — the lowest price
        - 'swing_high_idx': index of the swing high candle
        - 'swing_low_idx': index of the swing low candle
    """
    if len(df) < lookback:
        lookback = len(df)

    recent = df.tail(lookback)

    swing_high_idx = recent["High"].idxmax()
    swing_low_idx = recent["Low"].idxmin()

    return {
        "swing_high": recent["High"].max(),
        "swing_low": recent["Low"].min(),
        "swing_high_idx": swing_high_idx,
        "swing_low_idx": swing_low_idx,
    }


def calculate_fibonacci_levels(
    swing_high: float,
    swing_low: float,
    trend: str = "UP",
) -> dict[float, float]:
    """
    Calculate Fibonacci retracement levels.

    For an UPTREND: levels are calculated from high → low (pullback)
        Level price = High - (High - Low) * ratio

    For a DOWNTREND: levels are calculated from low → high (pullback)
        Level price = Low + (High - Low) * ratio

    Args:
        swing_high: The swing high price
        swing_low: The swing low price
        trend: "UP" or "DOWN" — determines calculation direction

    Returns:
        Dict mapping Fibonacci ratio → price level
        {0.0: ..., 0.236: ..., 0.382: ..., 0.5: ..., 0.618: ..., 0.786: ..., 1.0: ...}
    """
    diff = swing_high - swing_low

    ratios = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]

    if trend == "UP":
        # In uptrend, retracement goes from high downward
        # 0.0 = swing high (start of retracement)
        # 1.0 = swing low (full retracement)
        levels = {ratio: swing_high - (diff * ratio) for ratio in ratios}
    else:
        # In downtrend, retracement goes from low upward
        # 0.0 = swing low (start of retracement)
        # 1.0 = swing high (full retracement)
        levels = {ratio: swing_low + (diff * ratio) for ratio in ratios}

    return levels


def detect_trend(df: pd.DataFrame, vwap: pd.Series | None = None) -> str:
    """
    Detect the current trend using VWAP and price action.

    Args:
        df: DataFrame with OHLCV data
        vwap: Pre-calculated VWAP series (optional)

    Returns:
        "UP" or "DOWN"
    """
    if vwap is None:
        vwap = calculate_vwap(df)

    current_close = df["Close"].iloc[-1]
    current_vwap = vwap.iloc[-1]

    # Additional confirmation: check if recent closes are trending
    recent_closes = df["Close"].tail(5)
    close_trend = recent_closes.iloc[-1] > recent_closes.iloc[0]

    if current_close > current_vwap and close_trend:
        return "UP"
    elif current_close < current_vwap and not close_trend:
        return "DOWN"
    else:
        # Default to VWAP position when signals conflict
        return "UP" if current_close > current_vwap else "DOWN"


def is_at_fib_level(
    price: float,
    fib_levels: dict[float, float],
    target_ratios: list[float],
    tolerance_pct: float = 0.3,
) -> tuple[bool, float | None]:
    """
    Check if a price is near a target Fibonacci level.

    Args:
        price: Current price to check
        fib_levels: Dict of fib ratio → price level
        target_ratios: Which Fibonacci ratios to check (e.g., [0.382, 0.618])
        tolerance_pct: How close price must be to the level (as % of price)

    Returns:
        Tuple of (is_at_level, matched_ratio or None)
    """
    for ratio in target_ratios:
        level_price = fib_levels.get(ratio)
        if level_price is None:
            continue

        tolerance = price * (tolerance_pct / 100)
        if abs(price - level_price) <= tolerance:
            return True, ratio

    return False, None


def detect_bounce(
    df: pd.DataFrame,
    fib_level_price: float,
    trend: str,
    candles_to_check: int = 3,
) -> bool:
    """
    Detect if price has bounced off a Fibonacci level.

    For UPTREND (LONG entry): price touches fib level and closes above it
    For DOWNTREND (SHORT entry): price touches fib level and closes below it

    Args:
        df: Recent candle data
        fib_level_price: The Fibonacci price level to check
        trend: "UP" or "DOWN"
        candles_to_check: How many recent candles to check for the bounce

    Returns:
        True if a bounce pattern is detected
    """
    recent = df.tail(candles_to_check)

    if trend == "UP":
        # For uptrend bounce: low went near/below fib level, but close is above
        touched = recent["Low"].min() <= fib_level_price * 1.003
        closed_above = recent["Close"].iloc[-1] > fib_level_price
        return touched and closed_above
    else:
        # For downtrend bounce: high went near/above fib level, but close is below
        touched = recent["High"].max() >= fib_level_price * 0.997
        closed_below = recent["Close"].iloc[-1] < fib_level_price
        return touched and closed_below
