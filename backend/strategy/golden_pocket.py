"""Golden Pocket Fibonacci strategy — fires only on 50%-61.8% retracement zone."""

from dataclasses import dataclass
from typing import Dict, Optional, Literal

import pandas as pd

from backend.config import settings
from backend.strategy.atr import compute_atr


@dataclass
class Swing:
    high: float
    low: float
    high_idx: pd.Timestamp
    low_idx: pd.Timestamp
    direction: Literal["UP", "DOWN"]


@dataclass
class GoldenPocketZone:
    upper: float  # 50% level
    lower: float  # 61.8% level


@dataclass
class Signal:
    coin: str
    direction: Literal["LONG", "SHORT"]
    entry_price: float
    stop_loss: float
    tp1: float
    tp2: float
    fib_level_triggered: float  # 0.5 or 0.618
    swing_high: float
    swing_low: float
    atr: float
    timestamp: pd.Timestamp


class GoldenPocketStrategy:
    """Detects retracements into the 50%-61.8% Fib zone in a trending market."""

    def detect_swing(self, df: pd.DataFrame, lookback: int = 100, pivot_window: int = 5) -> Optional[Swing]:
        """
        Find the most recent dominant swing using pivot points on close prices.

        Uses pivot detection rather than global argmax/argmin so the result
        reflects the most recent local reversal, not the background trend
        dominating a wide lookback window. Close prices are used instead of
        wicks to avoid spike-candle distortion of the Fibonacci range.
        """
        recent = df.tail(lookback)
        closes = recent["Close"]
        n = len(closes)

        pivot_highs: list[tuple] = []
        pivot_lows: list[tuple] = []

        for i in range(pivot_window, n - pivot_window):
            center = float(closes.iloc[i])
            neighborhood = closes.iloc[i - pivot_window: i + pivot_window + 1]
            if center >= float(neighborhood.max()):
                pivot_highs.append((closes.index[i], center))
            if center <= float(neighborhood.min()):
                pivot_lows.append((closes.index[i], center))

        if not pivot_highs or not pivot_lows:
            return None

        last_high_ts, last_high = pivot_highs[-1]
        last_low_ts, last_low = pivot_lows[-1]
        direction = "DOWN" if last_high_ts > last_low_ts else "UP"
        return Swing(
            high=last_high,
            low=last_low,
            high_idx=last_high_ts,
            low_idx=last_low_ts,
            direction=direction,
        )

    def golden_pocket_zone(self, swing_low: float, swing_high: float, direction: str) -> GoldenPocketZone:
        """Return the price zone bounded by 50% and 61.8% retracement."""
        rng = swing_high - swing_low
        if direction == "UP":
            upper = swing_high - 0.5 * rng
            lower = swing_high - 0.618 * rng
        else:
            upper = swing_low + 0.618 * rng
            lower = swing_low + 0.5 * rng
        return GoldenPocketZone(upper=upper, lower=lower)

    def _stop_loss(self, entry: float, atr: float, swing_high: float, swing_low: float, direction: str) -> float:
        """Hybrid SL — whichever is FURTHER from entry: 78.6% Fib break or 1.5*ATR offset."""
        rng = swing_high - swing_low
        if direction == "LONG":
            sl_fib_break = swing_high - 0.786 * rng
            sl_atr = entry - settings.atr_sl_multiplier * atr
            return min(sl_fib_break, sl_atr)  # lower = further from entry
        else:
            sl_fib_break = swing_low + 0.786 * rng
            sl_atr = entry + settings.atr_sl_multiplier * atr
            return max(sl_fib_break, sl_atr)  # higher = further from entry

    def _take_profits(self, entry: float, stop_loss: float, swing_high: float, swing_low: float, direction: str) -> tuple[float, float]:
        """TP1 = 1.5 R:R, TP2 = 1.618 Fib extension of the swing."""
        risk = abs(entry - stop_loss)
        rng = swing_high - swing_low
        if direction == "LONG":
            tp1 = entry + 1.5 * risk
            tp2 = swing_high + 0.618 * rng
        else:
            tp1 = entry - 1.5 * risk
            tp2 = swing_low - 0.618 * rng
        return tp1, tp2

    def analyze(self, df: pd.DataFrame, mtf_trend: Dict, coin: str) -> Optional[Signal]:
        """Return a Signal if a clean golden pocket setup is present, else None."""
        if len(df) < 50:
            return None

        trend_1h = mtf_trend.get("1h", {}).get("trend")
        trend_15m = mtf_trend.get("15m", {}).get("trend")
        slope_1h = abs(mtf_trend.get("1h", {}).get("slope", 0))

        if trend_1h not in ("UP", "DOWN"):
            return None
        # Do NOT require 15m to match 1h — golden pocket is a retracement entry.
        # By definition, when price pulls back to the 50-61.8% zone, 15m VMA slopes
        # against the primary trend. Requiring agreement here eliminates all entries.
        if slope_1h < settings.min_slope_pct:
            return None

        direction: Literal["LONG", "SHORT"] = "LONG" if trend_1h == "UP" else "SHORT"

        swing = self.detect_swing(df)
        if swing is None:
            return None
        zone = self.golden_pocket_zone(swing.low, swing.high, swing.direction)

        last_close = float(df["Close"].iloc[-1])
        last_high  = float(df["High"].iloc[-1])
        last_low   = float(df["Low"].iloc[-1])

        if direction == "LONG":
            if swing.direction != "UP":
                return None
            # Accept wick touch into zone (low dipped in) or close inside zone
            if not (zone.lower <= last_low <= zone.upper or zone.lower <= last_close <= zone.upper):
                return None
        else:
            if swing.direction != "DOWN":
                return None
            # Accept wick touch into zone (high reached in) or close inside zone
            if not (zone.lower <= last_high <= zone.upper or zone.lower <= last_close <= zone.upper):
                return None

        atr_series = compute_atr(df, period=settings.atr_period)
        atr = float(atr_series.iloc[-1])

        # Quality gate: swing range must be meaningfully larger than noise.
        # For synthetic O=H=L=C candles ATR→0, so gate only when ATR is non-trivial.
        swing_range = swing.high - swing.low
        if atr > 0 and swing_range < 1.5 * atr:
            return None

        entry = last_close
        sl = self._stop_loss(entry, atr, swing.high, swing.low, direction)
        tp1, tp2 = self._take_profits(entry, sl, swing.high, swing.low, direction)

        fib_triggered = 0.5 if abs(last_close - zone.upper) < abs(last_close - zone.lower) else 0.618

        return Signal(
            coin=coin,
            direction=direction,
            entry_price=entry,
            stop_loss=sl,
            tp1=tp1,
            tp2=tp2,
            fib_level_triggered=fib_triggered,
            swing_high=swing.high,
            swing_low=swing.low,
            atr=atr,
            timestamp=df.index[-1],
        )
