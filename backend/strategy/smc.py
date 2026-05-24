"""
Smart Money Concepts (SMC) strategy.

Entry model (per Trading Mastery Framework):
  1. Market Structure — BOS/CHoCH on execution TF to determine directional bias
  2. Fair Value Gap  — 3-candle price imbalance as primary entry zone
  3. Order Block     — last institutional candle before a BOS impulse as fallback
  4. Liquidity Sweep — stop-hunt wick confirmation (not blocking, raises confidence)
  5. Premium/Discount — buy below 50% equilibrium, sell above (Golden Rule of Entry)
  6. RSI gate        — avoid entries into exhausted moves
"""

import logging
from dataclasses import dataclass
from typing import Literal, Optional

import pandas as pd

from backend.config import settings
from backend.strategy.atr import compute_atr
from backend.strategy.golden_pocket import Signal  # reuse compatible Signal dataclass

logger = logging.getLogger(__name__)


@dataclass
class Zone:
    """A price zone (FVG or Order Block) for potential entry."""
    upper: float
    lower: float
    kind: Literal["FVG", "OB"]
    idx: pd.Timestamp

    @property
    def midpoint(self) -> float:
        return (self.upper + self.lower) / 2


class SMCStrategy:
    """
    Smart Money Concepts strategy — BOS/CHoCH → discount/premium → FVG/OB → entry.

    Designed to run on the same execution timeframe as GoldenPocketStrategy (4h by default).
    Returns a Signal compatible with the existing ConfidenceScorer and OrderManager.
    """

    PIVOT_WINDOW = 3   # tighter window to detect recent structure shifts
    LOOKBACK = 80      # candles to scan for structure

    def analyze(self, df: pd.DataFrame, mtf_trend: dict, coin: str) -> Optional[Signal]:
        if len(df) < 50:
            return None

        # ── 1. Market structure on execution TF (BOS/CHoCH) ──────────────────
        # 4h structure is the primary bias for SMC. The 1d VMA trend is used only
        # as a confidence multiplier in the scorer, not a blocker here — it was
        # calibrated for the GP strategy and conflicts with SMC direction logic.
        direction = self._detect_structure_bias(df, coin)
        if direction is None:
            return None

        # ── 3. Swing extremes for premium/discount and SL/TP ─────────────────
        swing_high = float(df["High"].tail(self.LOOKBACK).max())
        swing_low = float(df["Low"].tail(self.LOOKBACK).min())
        if swing_high <= swing_low:
            logger.debug(f"[{coin}] SMC: invalid swing range")
            return None

        last_close = float(df["Close"].iloc[-1])
        rng = swing_high - swing_low

        # ── 4. Fibonacci Golden Zone gate (0.5–0.618 retracement pocket) ──────
        # Only enter when price is inside the golden pocket of the swing:
        #   LONG  — pullback in an uptrend retraces 0.5–0.618 down from the high
        #           → price between swing_low + 0.382·rng and swing_low + 0.5·rng
        #   SHORT — pullback in a downtrend retraces 0.5–0.618 up from the low
        #           → price between swing_low + 0.5·rng and swing_low + 0.618·rng
        if direction == "LONG":
            gz_lower = swing_low + 0.382 * rng   # 0.618 retracement level
            gz_upper = swing_low + 0.500 * rng   # 0.5 retracement level
        else:
            gz_lower = swing_low + 0.500 * rng   # 0.5 retracement level
            gz_upper = swing_low + 0.618 * rng   # 0.618 retracement level
        if not (gz_lower <= last_close <= gz_upper):
            logger.debug(
                f"[{coin}] SMC: {direction} not in Golden Zone "
                f"[{gz_lower:.4f}–{gz_upper:.4f}] close={last_close:.4f}"
            )
            return None

        # ── 5. ATR (needed for zone proximity check) ──────────────────────────
        atr_series = compute_atr(df, period=settings.atr_period)
        atr = float(atr_series.iloc[-1])

        # ── 6. Entry zone: FVG (preferred) → OB (fallback) → swing-based ────────
        # FVG/OB are searched within 3 ATR of current price (zone confirms confluence).
        # If neither is found we still fire — structure + discount/premium is the core
        # signal; zone only refines the SL anchor.
        fvg = self._detect_fvg(df, direction, atr)
        ob = self._detect_order_block(df, direction, atr)

        active_zone: Optional[Zone] = None
        for zone in [fvg, ob]:  # FVG preferred
            if zone is not None:
                active_zone = zone
                break

        if active_zone is None:
            logger.debug(f"[{coin}] SMC: {direction} no FVG/OB near price={last_close:.4f} — using swing SL")

        # ── 7. RSI gate ───────────────────────────────────────────────────────
        rsi = self._rsi(df)
        if direction == "LONG" and rsi > 65:
            logger.debug(f"[{coin}] SMC: RSI gate LONG fail: RSI={rsi:.1f} > 65")
            return None
        if direction == "SHORT" and rsi < 35:
            logger.debug(f"[{coin}] SMC: RSI gate SHORT fail: RSI={rsi:.1f} < 35")
            return None

        # ── 8. Liquidity sweep detection (non-blocking, logged) ───────────────
        swept = self._detect_liquidity_sweep(df, direction, swing_high, swing_low)
        if swept:
            logger.debug(f"[{coin}] SMC: liquidity sweep confirmed — high-quality setup")

        # ── 9. Entry, SL, TP ────────────────────────────────────────────────
        entry = last_close
        sl = self._stop_loss(entry, active_zone, direction, atr, swing_high, swing_low)
        tp1, tp2 = self._take_profits(entry, sl, swing_high, swing_low, direction)

        risk = abs(entry - sl)
        # SL must be at least 0.5 ATR away from entry to avoid degenerate setups.
        # (tp1 is always set to 1.5R so a separate R:R ratio check is redundant.)
        if risk < atr * 0.5:
            logger.debug(f"[{coin}] SMC: SL too tight (risk={risk:.4f} < 0.5×ATR={0.5*atr:.4f})")
            return None

        zone_label = f"{active_zone.kind}[{active_zone.lower:.4f}–{active_zone.upper:.4f}]" if active_zone else "swing"
        logger.debug(
            f"[{coin}] SMC: {direction} signal — zone={zone_label} "
            f"entry={entry:.4f} sl={sl:.4f} tp2={tp2:.4f} "
            f"RSI={rsi:.1f} swept={swept}"
        )

        # FVG = GP weight, OB = 38.2 weight, no zone = 38.2 (lower confidence)
        zone_name = "GP" if (active_zone and active_zone.kind == "FVG") else "38.2"

        return Signal(
            coin=coin,
            direction=direction,
            entry_price=entry,
            stop_loss=sl,
            tp1=tp1,
            tp2=tp2,
            fib_level_triggered=0.5 if active_zone.kind == "FVG" else 0.382,
            fib_zone_name=zone_name,
            swing_high=swing_high,
            swing_low=swing_low,
            atr=atr,
            rsi=rsi,
            timestamp=df.index[-1],
        )

    # ── Market Structure ──────────────────────────────────────────────────────

    def _detect_structure_bias(
        self, df: pd.DataFrame, coin: str
    ) -> Optional[Literal["LONG", "SHORT"]]:
        """
        Classify bias from the most recent pivot sequence:
          Bullish BOS  : HH + HL sequence → LONG
          Bearish BOS  : LH + LL sequence → SHORT
          Bullish CHoCH: was LH+LL, now HL formed AND price broke above last LH → LONG
          Bearish CHoCH: was HH+HL, now LH formed AND price broke below last HL → SHORT
        """
        recent = df.tail(self.LOOKBACK)
        closes = recent["Close"]
        n = len(closes)
        pw = self.PIVOT_WINDOW

        pivot_highs: list[tuple] = []
        pivot_lows: list[tuple] = []
        for i in range(pw, n - pw):
            c = float(closes.iloc[i])
            hood = closes.iloc[i - pw: i + pw + 1]
            if c >= float(hood.max()):
                pivot_highs.append((closes.index[i], c))
            if c <= float(hood.min()):
                pivot_lows.append((closes.index[i], c))

        if len(pivot_highs) < 2 or len(pivot_lows) < 2:
            logger.debug(f"[{coin}] SMC: insufficient pivots for structure detection")
            return None

        h1_ts, h1 = pivot_highs[-2]
        h2_ts, h2 = pivot_highs[-1]
        l1_ts, l1 = pivot_lows[-2]
        l2_ts, l2 = pivot_lows[-1]
        last_close = float(df["Close"].iloc[-1])

        # Bullish BOS: HH (h2 > h1) AND HL (l2 > l1) — trend continuation
        if h2 > h1 and l2 > l1:
            logger.debug(f"[{coin}] SMC: bullish BOS (HH+HL)")
            return "LONG"
        # Bearish BOS: LH (h2 < h1) AND LL (l2 < l1) — trend continuation
        if h2 < h1 and l2 < l1:
            logger.debug(f"[{coin}] SMC: bearish BOS (LH+LL)")
            return "SHORT"
        # Bullish CHoCH: LH formed (h2 < h1) BUT HL also formed (l2 > l1)
        # → bearish structure printing a higher low = first sign of reversal
        if h2 < h1 and l2 > l1:
            logger.debug(f"[{coin}] SMC: bullish CHoCH forming (LH+HL)")
            return "LONG"
        # Bearish CHoCH: HH formed (h2 > h1) BUT LL also forming (l2 < l1)
        # → bullish structure printing a lower low = first sign of reversal
        if h2 > h1 and l2 < l1:
            logger.debug(f"[{coin}] SMC: bearish CHoCH forming (HH+LL)")
            return "SHORT"

        logger.debug(f"[{coin}] SMC: structure unclear h1={h1:.4f} h2={h2:.4f} l1={l1:.4f} l2={l2:.4f}")
        return None

    # ── Fair Value Gap ────────────────────────────────────────────────────────

    def _detect_fvg(self, df: pd.DataFrame, direction: str, atr: float = 0.0) -> Optional[Zone]:
        """
        Scan for the most recent FVG that price is inside or approaching (within 1 ATR).
        Bullish FVG: candle[i-2].High < candle[i].Low (gap left on the way up)
        Bearish FVG: candle[i-2].Low > candle[i].High (gap left on the way down)
        """
        last_close = float(df["Close"].iloc[-1])
        tol = atr  # 1 ATR proximity tolerance
        # Scan up to 80 candles ago, exclude the last 2 (need confirmed candles)
        scan = df.iloc[max(0, len(df) - 80): len(df) - 1]

        for i in range(len(scan) - 1, 1, -1):  # newest first
            c1 = scan.iloc[i - 2]
            c3 = scan.iloc[i]
            if direction == "LONG":
                gap_lower = float(c1["High"])
                gap_upper = float(c3["Low"])
                if gap_upper > gap_lower and last_close <= gap_upper + tol and last_close >= gap_lower - tol:
                    return Zone(upper=gap_upper, lower=gap_lower,
                                kind="FVG", idx=scan.index[i])
            else:
                gap_upper = float(c1["Low"])
                gap_lower = float(c3["High"])
                if gap_upper > gap_lower and last_close >= gap_lower - tol and last_close <= gap_upper + tol:
                    return Zone(upper=gap_upper, lower=gap_lower,
                                kind="FVG", idx=scan.index[i])
        return None

    # ── Order Block ───────────────────────────────────────────────────────────

    def _detect_order_block(self, df: pd.DataFrame, direction: str, atr: float = 0.0) -> Optional[Zone]:
        """
        Order Block = last opposite-color candle before a strong BOS impulse move.
        Bullish OB: last bearish candle before a run of bullish candles breaking structure.
        Bearish OB: last bullish candle before a run of bearish candles breaking structure.
        Valid if price is inside or approaching the OB zone (within 1 ATR).
        """
        last_close = float(df["Close"].iloc[-1])
        tol = atr  # 1 ATR proximity tolerance
        scan = df.iloc[max(0, len(df) - 80): len(df) - 1]
        if len(scan) < 5:
            return None
        avg_body = float((scan["Close"] - scan["Open"]).abs().mean())

        for i in range(len(scan) - 4, 1, -1):
            candle = scan.iloc[i]
            body = abs(float(candle["Close"]) - float(candle["Open"]))
            if body < avg_body * 0.5:  # skip tiny/doji candles
                continue
            impulse = scan.iloc[i + 1: min(i + 4, len(scan))]

            if direction == "LONG":
                is_bearish = float(candle["Close"]) < float(candle["Open"])
                if not is_bearish or len(impulse) == 0:
                    continue
                has_impulse = float(impulse["Close"].max()) > float(candle["High"])
                if has_impulse:
                    ob_upper = float(candle["Open"])
                    ob_lower = float(candle["Low"])
                    if last_close <= ob_upper + tol and last_close >= ob_lower - tol:
                        return Zone(upper=ob_upper, lower=ob_lower,
                                    kind="OB", idx=scan.index[i])
            else:
                is_bullish = float(candle["Close"]) > float(candle["Open"])
                if not is_bullish or len(impulse) == 0:
                    continue
                has_impulse = float(impulse["Close"].min()) < float(candle["Low"])
                if has_impulse:
                    ob_upper = float(candle["High"])
                    ob_lower = float(candle["Close"])
                    if last_close >= ob_lower - tol and last_close <= ob_upper + tol:
                        return Zone(upper=ob_upper, lower=ob_lower,
                                    kind="OB", idx=scan.index[i])
        return None

    # ── Liquidity Sweep ───────────────────────────────────────────────────────

    def _detect_liquidity_sweep(
        self, df: pd.DataFrame, direction: str,
        swing_high: float, swing_low: float,
    ) -> bool:
        """
        LONG: a recent candle wicked below swing_low then closed back above (bull trap cleared).
        SHORT: a recent candle wicked above swing_high then closed back below (bear trap cleared).
        """
        recent = df.tail(5)
        last_close = float(df["Close"].iloc[-1])
        if direction == "LONG":
            return bool((recent["Low"] < swing_low * 0.999).any()) and last_close > swing_low
        return bool((recent["High"] > swing_high * 1.001).any()) and last_close < swing_high

    # ── RSI ───────────────────────────────────────────────────────────────────

    def _rsi(self, df: pd.DataFrame, period: int = 14) -> float:
        close = df["Close"]
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(period).mean()
        loss = (-delta.clip(upper=0)).rolling(period).mean()
        rs = gain / loss.replace(0, float("inf"))
        return float((100 - (100 / (1 + rs))).iloc[-1])

    # ── Risk Management ───────────────────────────────────────────────────────

    def _stop_loss(
        self, entry: float, zone: Optional[Zone], direction: str,
        atr: float, swing_high: float, swing_low: float,
    ) -> float:
        """SL just outside the entry zone (or swing extreme when no zone)."""
        if direction == "LONG":
            sl_swing = swing_low - 0.5 * atr
            if zone is not None:
                sl_zone = zone.lower - 1.0 * atr
                return min(sl_zone, sl_swing)
            return sl_swing
        else:
            sl_swing = swing_high + 0.5 * atr
            if zone is not None:
                sl_zone = zone.upper + 1.0 * atr
                return max(sl_zone, sl_swing)
            return sl_swing

    def _take_profits(
        self, entry: float, sl: float,
        swing_high: float, swing_low: float, direction: str,
    ) -> tuple[float, float]:
        """TP1 = 1.5R, TP2 = external liquidity (swing extreme + 0.618 extension)."""
        risk = abs(entry - sl)
        rng = swing_high - swing_low
        if direction == "LONG":
            tp1 = entry + 1.5 * risk
            tp2 = swing_high + 0.618 * rng
        else:
            tp1 = entry - 1.5 * risk
            tp2 = swing_low - 0.618 * rng
        return tp1, tp2
