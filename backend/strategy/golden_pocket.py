"""Golden Pocket Fibonacci strategy — fires only on 50%-61.8% retracement zone."""

import logging
from dataclasses import dataclass
from typing import Dict, Optional, Literal

import pandas as pd

logger = logging.getLogger(__name__)

from backend.config import settings
from backend.strategy.atr import compute_atr
from backend.strategy.zigzag import compute_zigzag
from backend.strategy.structure import detect_structure
from backend.strategy.fvg import detect_fvg


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

    def detect_swing(self, df: pd.DataFrame, lookback: int = 200) -> Optional[Swing]:
        """
        Find the most recent dominant swing using ATR-drawdown ZigZag pivots.

        This is the same logic that drives the visible ZigZag overlay on the
        chart — what the trader SEES is what the bot uses. The "swing" passed
        to the Fibonacci calculation is the most recent CONFIRMED HIGH + LOW
        pair (tentative pivots are ignored so we never trade off an
        unconfirmed reversal). `direction` is "DOWN" when the high is more
        recent than the low (we're in a retrace down → look for LONG entry).
        """
        recent = df.tail(lookback)
        pivots = compute_zigzag(
            recent,
            atr_period=settings.zigzag_atr_period,
            atr_mult=settings.zigzag_atr_mult,
        )
        # Drop tentative tail — only act on confirmed reversals.
        confirmed = [p for p in pivots if p.get("confirmed")]
        if len(confirmed) < 2:
            return None
        last_high = next((p for p in reversed(confirmed) if p["kind"] == "HIGH"), None)
        last_low = next((p for p in reversed(confirmed) if p["kind"] == "LOW"), None)
        if last_high is None or last_low is None:
            return None

        high_ts = recent.index[last_high["index"]]
        low_ts = recent.index[last_low["index"]]
        direction = "DOWN" if last_high["index"] > last_low["index"] else "UP"
        return Swing(
            high=float(last_high["price"]),
            low=float(last_low["price"]),
            high_idx=high_ts,
            low_idx=low_ts,
            direction=direction,
        )

    def golden_pocket_zone(self, swing_low: float, swing_high: float, direction: str) -> GoldenPocketZone:
        """Return the price zone bounded by the 50% and 61.8% Fibonacci levels (measured from swing low)."""
        rng = swing_high - swing_low
        lower = swing_low + 0.5 * rng    # 50% level
        upper = swing_low + 0.618 * rng  # 61.8% level
        return GoldenPocketZone(upper=upper, lower=lower)

    def _stop_loss(self, entry: float, atr: float, swing_high: float, swing_low: float, direction: str) -> float:
        """SL below/above 0.382 Fib level with 0.5*ATR buffer — structural invalidation."""
        rng = swing_high - swing_low
        if direction == "LONG":
            fib_0382 = swing_low + 0.382 * rng
            return fib_0382 - 0.5 * atr
        else:
            fib_0382 = swing_high - 0.382 * rng
            return fib_0382 + 0.5 * atr

    def _take_profits(self, entry: float, stop_loss: float, swing_high: float, swing_low: float, direction: str) -> tuple[float, None]:
        """Single TP — 38.2% of the way between 1.272 and 1.414 Fib extensions."""
        rng = swing_high - swing_low
        if direction == "LONG":
            fib_1272 = swing_high + 0.272 * rng
            fib_1414 = swing_high + 0.414 * rng
            tp1 = fib_1272 + 0.382 * (fib_1414 - fib_1272)
        else:
            fib_1272 = swing_low - 0.272 * rng
            fib_1414 = swing_low - 0.414 * rng
            tp1 = fib_1272 - 0.382 * (fib_1272 - fib_1414)
        return tp1, None

    def _zone_recently_touched(self, df: pd.DataFrame, zone: GoldenPocketZone,
                                direction: str, lookback: int = 6) -> bool:
        """True if any of the last `lookback` bars wicked into the golden pocket.

        Required because price often pierces the zone for a single bar then bounces
        — without this tolerance the bot only fires when CLOSE lands in a 0.027%-wide
        window, which essentially never happens.
        """
        recent = df.tail(lookback)
        # LONG: price retracing down into the zone — check lows touched zone.
        # SHORT: price retracing up into the zone — check highs touched zone.
        for _, row in recent.iterrows():
            if direction == "LONG":
                if float(row["Low"]) <= zone.upper and float(row["High"]) >= zone.lower:
                    return True
            else:
                if float(row["High"]) >= zone.lower and float(row["Low"]) <= zone.upper:
                    return True
        return False

    def _recent_structure_signal(self, df: pd.DataFrame, direction: str,
                                  lookback: int = 20) -> bool:
        """True if a CHoCH or BOS in entry direction printed in the last `lookback` bars."""
        try:
            events = detect_structure(df)
        except Exception:
            return False
        if not events:
            return False
        n = len(df)
        wanted = ("CHOCH_UP", "BOS_UP") if direction == "LONG" else ("CHOCH_DOWN", "BOS_DOWN")
        for ev in events[-5:]:
            if ev["kind"] in wanted and (n - ev["index"]) <= lookback:
                return True
        return False

    def _nearby_fvg(self, df: pd.DataFrame, zone: GoldenPocketZone, direction: str,
                    atr: float, atr_mult: float = 2.5) -> bool:
        """True if an unmitigated FVG in entry direction sits within atr_mult*ATR of the zone.

        2.5 chosen empirically: tight enough to keep the FVG as a real confluence,
        loose enough that perfectly-aligned setups happen multiple times per day
        across 10 coins. Tune down if too many low-quality entries appear.
        """
        try:
            fvgs = detect_fvg(df, min_size_atr=0.2)
        except Exception:
            return False
        if not fvgs:
            return False
        wanted_kind = "BULL" if direction == "LONG" else "BEAR"
        zone_mid = (zone.lower + zone.upper) / 2.0
        max_dist = max(atr_mult * atr, 1e-9)
        for fvg in reversed(fvgs[-20:]):
            if fvg["kind"] != wanted_kind or fvg.get("filled"):
                continue
            fvg_mid = fvg.get("midpoint", (fvg["top"] + fvg["bottom"]) / 2.0)
            if abs(fvg_mid - zone_mid) <= max_dist:
                return True
        return False

    def analyze(self, df: pd.DataFrame, mtf_trend: Dict, coin: str) -> Optional[Signal]:
        """Return a Signal when ALL of these line up:

          1. SMA20 vs SMA50 picks direction (existing trend filter).
          2. Confirmed ZigZag swing pair detected.
          3. Price has touched the 50%-61.8% golden pocket zone in last 6 bars.
          4. CHoCH or BOS in entry direction printed in last 20 bars
             (structural confirmation that the trend break is real).
          5. Unmitigated FVG of matching kind sits within 1*ATR of the zone
             (confluence — the inevitrade entry magnet).

        These four gates together replace the old "close inside zone right now"
        check, which was so narrow (~0.03% wide window) that the bot essentially
        never fired.
        """
        if len(df) < 50:
            return None

        closes = df["Close"]
        sma20 = float(closes.iloc[-20:].mean())
        sma50 = float(closes.iloc[-50:].mean())

        if sma20 == sma50:
            return None

        # Guard 1: SMA separation
        separation_pct = abs(sma20 - sma50) / sma50
        if separation_pct < 0.001:
            return None

        # Guard 2: SMA50 slope must be trending
        if len(closes) >= 55:
            sma50_prev = float(closes.iloc[-55:-5].mean())
            sma50_slope = (sma50 - sma50_prev) / sma50_prev
            if sma20 > sma50 and sma50_slope < 0.0002:
                return None
            if sma20 < sma50 and sma50_slope > -0.0002:
                return None

        direction: Literal["LONG", "SHORT"] = "LONG" if sma20 > sma50 else "SHORT"

        swing = self.detect_swing(df)
        if swing is None:
            return None

        # Swing direction must match a retracement scenario for our entry.
        if direction == "LONG" and swing.direction != "DOWN":
            return None
        if direction == "SHORT" and swing.direction != "UP":
            return None

        zone = self.golden_pocket_zone(swing.low, swing.high, swing.direction)

        # Trigger 1: zone touched in last 6 bars.
        if not self._zone_recently_touched(df, zone, direction):
            logger.info(f"[{coin}] {direction} setup found but zone {zone.lower:.4f}-{zone.upper:.4f} not touched in last 6 bars")
            return None

        # Trigger 2: CHoCH or BOS in our direction recently.
        if not self._recent_structure_signal(df, direction):
            logger.info(f"[{coin}] {direction} setup: zone touched but no recent CHoCH/BOS confirmation")
            return None

        atr_series = compute_atr(df, period=settings.atr_period)
        atr = float(atr_series.iloc[-1])

        # Trigger 3: FVG confluence near zone.
        if not self._nearby_fvg(df, zone, direction, atr):
            logger.info(f"[{coin}] {direction} setup: structure confirmed but no nearby FVG (within {atr:.4f} of zone)")
            return None

        logger.info(f"[{coin}] {direction} SIGNAL — zone touched + CHoCH/BOS + FVG confluence")

        # Quality gate: swing range must be meaningfully larger than noise.
        swing_range = swing.high - swing.low
        if atr > 0 and swing_range < 1.5 * atr:
            return None

        last_close = float(df["Close"].iloc[-1])
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
            tp2=None,
            fib_level_triggered=fib_triggered,
            swing_high=swing.high,
            swing_low=swing.low,
            atr=atr,
            timestamp=df.index[-1],
        )
