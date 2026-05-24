"""
Golden Pocket + 38.2% Fibonacci strategy.
"""
import logging
from dataclasses import dataclass
from typing import Dict, Literal, Optional

import pandas as pd

from backend.config import settings
from backend.strategy.atr import compute_atr
from backend.strategy.zigzag import compute_zigzag
from backend.strategy.structure import detect_structure
from backend.strategy.fvg import detect_fvg

logger = logging.getLogger(__name__)


@dataclass
class Swing:
    high: float
    low: float
    high_idx: pd.Timestamp
    low_idx: pd.Timestamp
    direction: Literal["UP", "DOWN"]


@dataclass
class FibZone:
    upper: float
    lower: float
    name: str  # "GP" | "38.2"


@dataclass
class Signal:
    coin: str
    direction: Literal["LONG", "SHORT"]
    entry_price: float
    stop_loss: float
    tp1: float
    tp2: float
    fib_level_triggered: float   # 0.382 or 0.618
    fib_zone_name: str           # "38.2" or "GP"
    swing_high: float
    swing_low: float
    atr: float
    rsi: float
    timestamp: pd.Timestamp


class GoldenPocketStrategy:
    """Detects retracements into the 38.2% or 50–61.8% Fib zone in a trending market."""

    # ── Swing detection ───────────────────────────────────────────────────────

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

    # ── Fibonacci zones ───────────────────────────────────────────────────────

    def _zones(self, swing: Swing) -> list:
        """
        Return both valid entry zones ordered by preference (GP first):

        Zone B — Golden Pocket (50%–61.8%): deep retracement, higher R:R
        Zone A — 38.2% band (23.6%–50%):   shallow retracement in strong trends
        """
        rng = swing.high - swing.low
        if swing.direction == "UP":
            gp   = FibZone(upper=swing.high - 0.500 * rng,
                           lower=swing.high - 0.618 * rng, name="GP")
            z382 = FibZone(upper=swing.high - 0.236 * rng,
                           lower=swing.high - 0.500 * rng, name="38.2")
        else:
            gp   = FibZone(upper=swing.low + 0.618 * rng,
                           lower=swing.low + 0.500 * rng, name="GP")
            z382 = FibZone(upper=swing.low + 0.500 * rng,
                           lower=swing.low + 0.236 * rng, name="38.2")
        return [gp, z382]

    def golden_pocket_zone(self, swing_low: float, swing_high: float, direction: str) -> FibZone:
        """Return the 50%–61.8% zone as a FibZone (used by API endpoints)."""
        rng = swing_high - swing_low
        return FibZone(upper=swing_low + 0.618 * rng, lower=swing_low + 0.500 * rng, name="GP")

    # ── RSI ──────────────────────────────────────────────────────────────────

    def _rsi(self, df: pd.DataFrame, period: int = 14) -> float:
        close = df["Close"]
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(period).mean()
        loss = (-delta.clip(upper=0)).rolling(period).mean()
        rs = gain / loss.replace(0, float("inf"))
        rsi_series = 100 - (100 / (1 + rs))
        return float(rsi_series.iloc[-1])

    # ── Stop loss / take profits ──────────────────────────────────────────────

    def _stop_loss(self, entry: float, atr: float,
                   swing_high: float, swing_low: float, direction: str) -> float:
        """SL below/above 0.382 Fib level with 0.5*ATR buffer — structural invalidation."""
        rng = swing_high - swing_low
        if direction == "LONG":
            fib_0382 = swing_low + 0.382 * rng
            return fib_0382 - 0.5 * atr
        else:
            fib_0382 = swing_high - 0.382 * rng
            return fib_0382 + 0.5 * atr

    def _take_profits(self, entry: float, stop_loss: float,
                      swing_high: float, swing_low: float, direction: str) -> tuple:
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

    # ── Confluence helpers ────────────────────────────────────────────────────

    def _zone_recently_touched(self, df: pd.DataFrame, zone: FibZone,
                                direction: str, lookback: int = 6) -> bool:
        """True if any of the last `lookback` bars wicked into the zone."""
        recent = df.tail(lookback)
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

    def _nearby_fvg(self, df: pd.DataFrame, zone: FibZone, direction: str,
                    atr: float, atr_mult: float = 2.5) -> bool:
        """True if an unmitigated FVG of matching kind sits within atr_mult*ATR of the zone."""
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

    # ── Main analysis ─────────────────────────────────────────────────────────

    def analyze(self, df: pd.DataFrame, mtf_trend: Dict, coin: str) -> Optional[Signal]:
        """Return a Signal when ALL of these line up:

          1. SMA20 vs SMA50 picks direction + separation + slope guards.
          2. Confirmed ZigZag swing pair detected.
          3. Swing direction matches retracement scenario.
          4. Price has touched the GP or 38.2% zone in last 6 bars.
          5. Bounce confirmation — close not slicing through zone floor/ceiling.
          6. RSI gate (LONG: RSI < 55, SHORT: RSI > 45).
          7. ATR sanity — swing range ≥ 1.5× ATR.
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
            logger.debug(f"[{coin}] no swing detected")
            return None

        if swing.high <= swing.low:
            logger.debug(f"[{coin}] invalid swing: high={swing.high:.4f} <= low={swing.low:.4f}")
            return None

        # Swing direction must match a retracement scenario for our entry.
        if direction == "LONG" and swing.direction != "DOWN":
            logger.debug(f"[{coin}] swing direction mismatch: swing={swing.direction} need DOWN for LONG")
            return None
        if direction == "SHORT" and swing.direction != "UP":
            logger.debug(f"[{coin}] swing direction mismatch: swing={swing.direction} need UP for SHORT")
            return None

        last_close = float(df["Close"].iloc[-1])
        last_high = float(df["High"].iloc[-1])
        last_low = float(df["Low"].iloc[-1])

        # Check both zones — GP first (preferred), then 38.2%
        active_zone: Optional[FibZone] = None
        for zone in self._zones(swing):
            if direction == "LONG":
                touched = last_low <= zone.upper and last_low >= zone.lower * 0.98
                in_zone = zone.lower <= last_close <= zone.upper
            else:
                touched = last_high >= zone.lower and last_high <= zone.upper * 1.02
                in_zone = zone.lower <= last_close <= zone.upper
            if touched or in_zone:
                active_zone = zone
                break

        if active_zone is None:
            gp = self._zones(swing)[0]
            logger.debug(
                f"[{coin}] {direction} not in zone: close={last_close:.4f} "
                f"GP=[{gp.lower:.4f}–{gp.upper:.4f}] swing=[{swing.low:.4f}–{swing.high:.4f}]"
            )
            return None

        # Bounce confirmation — close must not pierce through zone floor/ceiling.
        if direction == "LONG" and last_close < active_zone.lower:
            logger.debug(f"[{coin}] bounce fail LONG: close={last_close:.4f} < zone.lower={active_zone.lower:.4f}")
            return None
        if direction == "SHORT" and last_close > active_zone.upper:
            logger.debug(f"[{coin}] bounce fail SHORT: close={last_close:.4f} > zone.upper={active_zone.upper:.4f}")
            return None

        atr_series = compute_atr(df, period=settings.atr_period)
        atr = float(atr_series.iloc[-1])

        swing_range = swing.high - swing.low
        if atr > 0 and swing_range < 1.5 * atr:
            logger.debug(f"[{coin}] ATR sanity fail: swing_range={swing_range:.4f} < 1.5*ATR={1.5*atr:.4f}")
            return None

        rsi = self._rsi(df)
        if direction == "LONG" and rsi > 55:
            logger.debug(f"[{coin}] RSI gate LONG fail: RSI={rsi:.1f} > 55")
            return None
        if direction == "SHORT" and rsi < 45:
            logger.debug(f"[{coin}] RSI gate SHORT fail: RSI={rsi:.1f} < 45")
            return None

        entry = last_close
        sl    = self._stop_loss(entry, atr, swing.high, swing.low, direction)
        tp1, tp2 = self._take_profits(entry, sl, swing.high, swing.low, direction)
        fib_level = 0.382 if active_zone.name == "38.2" else 0.618

        logger.info(
            f"[{coin}] {direction} SIGNAL zone={active_zone.name} "
            f"entry={entry:.4f} SL={sl:.4f} TP1={tp1:.4f}"
        )

        return Signal(
            coin=coin,
            direction=direction,
            entry_price=entry,
            stop_loss=sl,
            tp1=tp1,
            tp2=tp2,
            fib_level_triggered=fib_level,
            fib_zone_name=active_zone.name,
            swing_high=swing.high,
            swing_low=swing.low,
            atr=atr,
            rsi=rsi,
            timestamp=df.index[-1],
        )
