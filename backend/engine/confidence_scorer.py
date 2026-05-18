"""Heuristic v1 confidence scoring for golden pocket signals. v2 (historical) hooks in later."""

import pandas as pd


class ConfidenceScorer:
    """Returns 0-95 confidence score for a Signal given context."""

    W_MTF       = 25
    W_SLOPE     = 20
    W_PATTERN   = 20
    W_VOLUME    = 15
    W_EMA       = 10
    W_ATR_SANE  = 10

    def score(self, signal, df: pd.DataFrame, mtf_trend: dict) -> float:
        """Aggregate weighted heuristics into a single 0-95 score."""
        score = 0.0
        score += self._mtf_alignment(mtf_trend, signal.direction) * self.W_MTF
        score += self._slope_strength(mtf_trend) * self.W_SLOPE
        score += self._candle_pattern(df, signal.direction) * self.W_PATTERN
        score += self._volume_signal(df) * self.W_VOLUME
        score += self._ema_confluence(df, signal) * self.W_EMA
        score += self._atr_sanity(signal) * self.W_ATR_SANE
        return max(0.0, min(95.0, score))

    def _mtf_alignment(self, mtf: dict, direction: str) -> float:
        wanted = "UP" if direction == "LONG" else "DOWN"
        aligned = sum(1 for tf in ("1h", "15m", "5m") if mtf.get(tf, {}).get("trend") == wanted)
        return {3: 1.0, 2: 0.6, 1: 0.0, 0: 0.0}.get(aligned, 0.0)

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
