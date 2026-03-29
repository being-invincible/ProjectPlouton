"""
Fibonacci Retracement Trading Strategy.

Entry logic:
1. Detect trend via VWAP (price > VWAP = uptrend)
2. Find swing high/low within lookback period
3. Calculate Fibonacci retracement levels
4. Enter LONG when uptrend pulls back to 38.2% or 61.8% and bounces
5. Enter SHORT when downtrend rallies to 38.2% or 61.8% and reverses
6. Stop loss at 78.6% level, take profit via risk:reward ratio
"""

import pandas as pd
from typing import Optional

from strategy.base import Strategy, Signal
from strategy.indicators import (
    calculate_vwap,
    find_swing_points,
    calculate_fibonacci_levels,
    detect_trend,
    is_at_fib_level,
    detect_bounce,
)


class FibonacciRetracement(Strategy):
    """Fibonacci Retracement strategy with VWAP trend confirmation."""

    def __init__(self, params: dict | None = None):
        """
        Initialize with strategy parameters.

        Args:
            params: Strategy parameters (from PocketBase strategy_configs).
                    Falls back to defaults if not provided.
        """
        p = params or self.get_default_params()
        self.lookback_period: int = p.get("lookback_period", 20)
        self.entry_levels: list[float] = p.get("entry_levels", [0.382, 0.618])
        self.stop_loss_level: float = p.get("stop_loss_level", 0.786)
        self.risk_reward_ratio: float = p.get("risk_reward_ratio", 2.0)
        self.timeframe: str = p.get("timeframe", "5m")
        self.tolerance_pct: float = p.get("tolerance_pct", 0.3)
        self.bounce_candles: int = p.get("bounce_candles", 3)

    def name(self) -> str:
        return "fibonacci_retracement"

    def display_name(self) -> str:
        return "Fibonacci Retracement"

    def get_default_params(self) -> dict:
        return {
            "lookback_period": 20,
            "entry_levels": [0.382, 0.618],
            "stop_loss_level": 0.786,
            "risk_reward_ratio": 2.0,
            "timeframe": "5m",
            "tolerance_pct": 0.3,
            "bounce_candles": 3,
            "risk_per_trade_pct": 1.0,
            "max_open_positions": 3,
            "max_daily_loss_pct": 5.0,
        }

    def analyze(self, df: pd.DataFrame) -> Optional[Signal]:
        """
        Analyze the latest candle data for a Fibonacci retracement entry.

        Flow:
        1. Calculate VWAP → determine trend
        2. Find swing high/low in lookback window
        3. Calculate Fibonacci levels for the detected trend
        4. Check if current price is near a target fib level
        5. Confirm bounce pattern
        6. Calculate stop loss and take profit
        7. Return Signal or None

        Args:
            df: DataFrame with OHLCV columns, minimum `lookback_period` rows

        Returns:
            Signal if entry conditions are met, None otherwise
        """
        if len(df) < self.lookback_period:
            return None

        # Step 1: Trend detection via VWAP
        vwap = calculate_vwap(df)
        trend = detect_trend(df, vwap)

        # Step 2: Find swing points
        swings = find_swing_points(df, self.lookback_period)
        swing_high = swings["swing_high"]
        swing_low = swings["swing_low"]

        # Need meaningful price range
        if swing_high <= swing_low or (swing_high - swing_low) < 0.01:
            return None

        # Step 3: Calculate Fibonacci levels
        fib_levels = calculate_fibonacci_levels(swing_high, swing_low, trend)

        # Step 4: Check if current price is at a target fib level
        current_price = df["Close"].iloc[-1]
        at_level, matched_ratio = is_at_fib_level(
            price=current_price,
            fib_levels=fib_levels,
            target_ratios=self.entry_levels,
            tolerance_pct=self.tolerance_pct,
        )

        if not at_level or matched_ratio is None:
            return None

        # Step 5: Confirm bounce
        fib_level_price = fib_levels[matched_ratio]
        has_bounce = detect_bounce(
            df, fib_level_price, trend, self.bounce_candles
        )

        if not has_bounce:
            return None

        # Step 6: Calculate entry, stop loss, and take profit
        entry_price = current_price
        direction = "LONG" if trend == "UP" else "SHORT"

        # Stop loss at the configured fib level
        stop_loss_price = fib_levels[self.stop_loss_level]

        # Take profit using risk:reward ratio
        risk = abs(entry_price - stop_loss_price)
        reward = risk * self.risk_reward_ratio

        if direction == "LONG":
            take_profit = entry_price + reward
        else:
            take_profit = entry_price - reward

        # Confidence based on which fib level was hit
        # 61.8% (golden ratio) is stronger than 38.2%
        confidence = 0.7 if matched_ratio == 0.618 else 0.5

        # Step 7: Build the signal
        timestamp = str(df.index[-1])

        return Signal(
            timestamp=timestamp,
            instrument=df.attrs.get("instrument", "UNKNOWN"),
            direction=direction,
            strategy=self.name(),
            entry_price=entry_price,
            stop_loss=stop_loss_price,
            take_profit=take_profit,
            confidence=confidence,
            fib_levels=fib_levels,
            vwap_value=float(vwap.iloc[-1]),
            triggered_level=matched_ratio,
            trend_direction=trend,
        )
