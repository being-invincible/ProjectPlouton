"""Heuristic v1 confidence scoring for golden pocket signals. v2 (historical) hooks in later."""

import pandas as pd

from backend.strategy.fvg import detect_fvg
from backend.strategy.structure import detect_structure
from backend.strategy.rsi_cloud import compute_rsi
from backend.strategy.fib_extensions import detect_5wave


class ConfidenceScorer:
    """Returns 0-95 confidence score for a Signal given context.

    Base heuristics (golden pocket): MTF, slope, candle pattern, volume, EMA, ATR.
    Inevitrade-style confluence boosts (added on top, then clamped):
      * CHoCH agreeing with entry direction within last ~20 bars (+8)
      * RSI in matching zone — oversold for LONG, overbought for SHORT (+6)
      * Unmitigated FVG within 0.5 * ATR of entry, in entry direction (+8)
      * 5-wave Fibonacci harmony — price at 1.618/2.618/3.618 of wave 1 (+5)
    """

    W_MTF       = 25
    W_SLOPE     = 20
    W_PATTERN   = 20
    W_VOLUME    = 15
    W_EMA       = 10
    W_ATR_SANE  = 10

    # Confluence bonuses
    B_CHOCH     = 8
    B_RSI_ZONE  = 6
    B_FVG_NEAR  = 8
    B_FIB_HARM  = 5
    B_1M_FIB    = 6   # 1m golden pocket touched same direction as 5m setup

    def score(self, signal, df: pd.DataFrame, mtf_trend: dict,
              df_1m: pd.DataFrame | None = None) -> float:
        """Aggregate weighted heuristics into a single 0-95 score."""
        score = 0.0
        score += self._mtf_alignment(mtf_trend, signal.direction) * self.W_MTF
        score += self._slope_strength(mtf_trend) * self.W_SLOPE
        score += self._candle_pattern(df, signal.direction) * self.W_PATTERN
        score += self._volume_signal(df) * self.W_VOLUME
        score += self._ema_confluence(df, signal) * self.W_EMA
        score += self._atr_sanity(signal) * self.W_ATR_SANE

        # ── Inevitrade-style confluences (additive bonuses) ──
        score += self._choch_confluence(df, signal.direction) * self.B_CHOCH
        score += self._rsi_zone_confluence(df, signal.direction) * self.B_RSI_ZONE
        score += self._fvg_near_entry(df, signal) * self.B_FVG_NEAR
        score += self._fib_harmony(df, signal) * self.B_FIB_HARM

        if df_1m is not None and len(df_1m) >= 50:
            score += self._fib_1m_confluence(df_1m, signal) * self.B_1M_FIB

        return max(0.0, min(95.0, score))

    # ── Inevitrade confluences ──────────────────────────────────────

    def _choch_confluence(self, df: pd.DataFrame, direction: str) -> float:
        """1.0 if a CHoCH in our direction printed in the last 20 bars."""
        try:
            events = detect_structure(df)
        except Exception:
            return 0.0
        if not events:
            return 0.0
        wanted = "CHOCH_UP" if direction == "LONG" else "CHOCH_DOWN"
        recent = events[-3:]
        n = len(df)
        for ev in recent:
            if ev["kind"] == wanted and (n - ev["index"]) <= 20:
                return 1.0
        return 0.0

    def _rsi_zone_confluence(self, df: pd.DataFrame, direction: str) -> float:
        """1.0 if RSI in matching zone — oversold for LONG, overbought for SHORT.
        0.5 if RSI within 5 points of the band edge ("approaching")."""
        try:
            close_col = "Close" if "Close" in df.columns else "close"
            rsi = compute_rsi(df[close_col]).iloc[-1]
        except Exception:
            return 0.0
        if direction == "LONG":
            if rsi <= 30:
                return 1.0
            if rsi <= 35:
                return 0.5
        else:
            if rsi >= 70:
                return 1.0
            if rsi >= 65:
                return 0.5
        return 0.0

    def _fvg_near_entry(self, df: pd.DataFrame, signal) -> float:
        """1.0 if an unmitigated FVG sits within 0.5 * ATR of entry in entry direction."""
        try:
            fvgs = detect_fvg(df, min_size_atr=0.2)
        except Exception:
            return 0.0
        if not fvgs or signal.atr <= 0:
            return 0.0
        atr = signal.atr
        entry = signal.entry_price
        wanted_kind = "BULL" if signal.direction == "LONG" else "BEAR"
        # Latest unmitigated FVG of the right kind near entry.
        for fvg in reversed(fvgs[-15:]):
            if fvg["kind"] != wanted_kind or fvg.get("filled"):
                continue
            mid = fvg.get("midpoint")
            if mid is None:
                continue
            if abs(entry - mid) <= 0.5 * atr:
                return 1.0
            if abs(entry - mid) <= 1.0 * atr:
                return 0.5
        return 0.0

    def _fib_1m_confluence(self, df_1m: pd.DataFrame, signal) -> float:
        """1.0 if the 1m chart also shows a golden-pocket setup matching the 5m direction.

        Uses 1m ZigZag to find the latest swing, computes its 50%-61.8% zone, and
        returns 1.0 if the current 5m entry price sits inside the 1m golden pocket.
        Catches setups where a 5m retracement is also being defended on the 1m
        chart — strong micro-timeframe confirmation.
        """
        try:
            from backend.strategy.zigzag import compute_zigzag
            pivots = [p for p in compute_zigzag(df_1m) if p.get("confirmed")]
        except Exception:
            return 0.0
        if len(pivots) < 2:
            return 0.0
        last_high = next((p for p in reversed(pivots) if p["kind"] == "HIGH"), None)
        last_low = next((p for p in reversed(pivots) if p["kind"] == "LOW"), None)
        if last_high is None or last_low is None:
            return 0.0
        swing_high = last_high["price"]
        swing_low = last_low["price"]
        rng = swing_high - swing_low
        if rng <= 0:
            return 0.0
        gp_lower = swing_low + 0.5 * rng
        gp_upper = swing_low + 0.618 * rng
        if gp_lower <= signal.entry_price <= gp_upper:
            return 1.0
        # Partial credit if within 25% of zone width above/below.
        zone_w = gp_upper - gp_lower
        if abs(signal.entry_price - gp_lower) <= 0.25 * zone_w or abs(signal.entry_price - gp_upper) <= 0.25 * zone_w:
            return 0.5
        return 0.0

    def _fib_harmony(self, df: pd.DataFrame, signal) -> float:
        """1.0 when current price sits within 0.3 * wave1 of any 1.618/2.618/3.618 level."""
        try:
            setup = detect_5wave(df)
        except Exception:
            return 0.0
        if not setup:
            return 0.0
        wave1 = setup.get("wave1_size", 0)
        if wave1 <= 0:
            return 0.0
        entry = signal.entry_price
        for proj in setup.get("projections", []):
            if abs(entry - proj["price"]) <= 0.3 * wave1:
                return 1.0
        return 0.0

    def _mtf_alignment(self, mtf: dict, direction: str) -> float:
        wanted   = "UP"   if direction == "LONG" else "DOWN"
        opposite = "DOWN" if direction == "LONG" else "UP"
        tf_4h  = mtf.get("4h",  {}).get("trend")
        tf_1h  = mtf.get("1h",  {}).get("trend")
        tf_15m = mtf.get("15m", {}).get("trend")
        tf_5m  = mtf.get("5m",  {}).get("trend")

        # 4h is now a SOFT signal — boost when it agrees, neutralise when it doesn't.
        # Base score derives from 1h/15m/5m alignment.
        if tf_1h == wanted and tf_15m == opposite and tf_5m == wanted:
            base = 1.0   # classic retrace bounce
        elif tf_1h == wanted and tf_15m == wanted and tf_5m == wanted:
            base = 0.85  # momentum entry, all aligned
        elif tf_1h == wanted and tf_15m == opposite:
            base = 0.65  # retrace, 5m not yet confirmed
        elif tf_1h == wanted:
            base = 0.55  # only 1h with us
        elif tf_15m == wanted and tf_5m == wanted:
            # NY-style: 1h still flips but 15m/5m caught the impulse — valid setup
            base = 0.5
        else:
            base = 0.2

        # 4h confluence multiplier: +20% if 4h agrees, -20% if it disagrees.
        if tf_4h == wanted:
            base = min(1.0, base * 1.2)
        elif tf_4h == opposite:
            base = base * 0.8
        return base

    def _slope_strength(self, mtf: dict) -> float:
        slope = abs(mtf.get("1h", {}).get("slope", 0.0))
        if slope < 0.002:
            return 0.0
        if slope >= 0.01:
            return 1.0
        return (slope - 0.002) / (0.01 - 0.002)

    def _candle_pattern(self, df: pd.DataFrame, direction: str) -> float:
        """Engulfing/hammer = 1.0, pin = 0.75, doji = 0.4, nothing = 0."""
        if len(df) < 2:
            return 0.0
        last = df.iloc[-1]
        prev = df.iloc[-2]
        body = abs(last["Close"] - last["Open"])
        rng = last["High"] - last["Low"]
        if rng <= 0:
            return 0.0
        upper_wick = last["High"] - max(last["Close"], last["Open"])
        lower_wick = min(last["Close"], last["Open"]) - last["Low"]

        prev_body = abs(prev["Close"] - prev["Open"])
        if body > prev_body * 1.5:
            if direction == "LONG" and last["Close"] > last["Open"] and last["Close"] > prev["Open"]:
                return 1.0
            if direction == "SHORT" and last["Close"] < last["Open"] and last["Close"] < prev["Open"]:
                return 1.0

        if body < rng * 0.35:
            if direction == "LONG" and lower_wick > body * 2:
                return 1.0
            if direction == "SHORT" and upper_wick > body * 2:
                return 1.0
            if direction == "LONG" and lower_wick > body:
                return 0.75
            if direction == "SHORT" and upper_wick > body:
                return 0.75

        if body < rng * 0.1:
            return 0.4
        return 0.0

    def _volume_signal(self, df: pd.DataFrame) -> float:
        if len(df) < 20:
            return 0.0
        avg = df["Volume"].iloc[-21:-1].mean()
        last = df["Volume"].iloc[-1]
        if avg <= 0:
            return 0.0
        ratio = last / avg
        if ratio >= 1.5:
            return 1.0
        if ratio <= 0.5:
            return 0.0
        return (ratio - 0.5) / 1.0

    def _ema_confluence(self, df: pd.DataFrame, signal) -> float:
        if len(df) < 200:
            return 0.0
        ema50 = df["Close"].ewm(span=50, adjust=False).mean().iloc[-1]
        ema200 = df["Close"].ewm(span=200, adjust=False).mean().iloc[-1]
        threshold = 0.5 * signal.atr
        if abs(signal.entry_price - ema50) < threshold or abs(signal.entry_price - ema200) < threshold:
            return 1.0
        return 0.0

    def _atr_sanity(self, signal) -> float:
        rng = signal.swing_high - signal.swing_low
        if signal.atr <= 0:
            return 0.0
        ratio = rng / signal.atr
        if ratio >= 3.0:
            return 1.0
        if ratio < 1.5:
            return 0.0
        return (ratio - 1.5) / 1.5
