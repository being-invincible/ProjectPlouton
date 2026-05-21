"""Heuristic v1 confidence scoring for golden pocket signals. v2 (historical) hooks in later."""

import pandas as pd


class ConfidenceScorer:
    """Returns 0-95 confidence score for a Signal given context."""

    W_MTF       = 20
    W_SLOPE     = 18
    W_PATTERN   = 18
    W_VOLUME    = 14
    W_EMA       = 10
    W_ATR_SANE  = 10
    W_RSI       = 10   # RSI confirmation from QuantInsti best practices

    def score(self, signal, df: pd.DataFrame, mtf_trend: dict) -> float:
        """Aggregate weighted heuristics into a single 0-95 score."""
        score = 0.0
        score += self._mtf_alignment(mtf_trend, signal.direction) * self.W_MTF
        score += self._slope_strength(mtf_trend) * self.W_SLOPE
        score += self._candle_pattern(df, signal.direction) * self.W_PATTERN
        score += self._volume_signal(df) * self.W_VOLUME
        score += self._ema_confluence(df, signal) * self.W_EMA
        score += self._atr_sanity(signal) * self.W_ATR_SANE
        score += self._rsi_score(signal) * self.W_RSI
        # GP zone scores higher than 38.2% (deeper retracement = stronger support)
        if getattr(signal, "fib_zone_name", "GP") == "38.2":
            score *= 0.92
        return max(0.0, min(95.0, score))

    def _mtf_alignment(self, mtf: dict, direction: str) -> float:
        wanted   = "UP"   if direction == "LONG" else "DOWN"
        opposite = "DOWN" if direction == "LONG" else "UP"
        tf_1h  = mtf.get("1h",  {}).get("trend")
        tf_15m = mtf.get("15m", {}).get("trend")
        tf_5m  = mtf.get("5m",  {}).get("trend")
        # 1h sets the primary trend — must align.
        if tf_1h != wanted:
            return 0.0
        # Classic golden pocket: 1h with us, 15m retracing, 5m bouncing back.
        if tf_15m == opposite and tf_5m == wanted:
            return 1.0
        # All three aligned (momentum entry, less ideal for retracement but valid).
        if tf_15m == wanted and tf_5m == wanted:
            return 0.9
        # 1h aligned, 15m retracing, 5m not yet confirmed.
        if tf_15m == opposite:
            return 0.65
        # 1h and 15m aligned, 5m lagging.
        return 0.7

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

    def _rsi_score(self, signal) -> float:
        """
        Score RSI confirmation quality.
        LONG: RSI 30-45 = ideal oversold zone (1.0), 45-55 = acceptable (0.5)
        SHORT: RSI 55-70 = ideal overbought zone (1.0), 45-55 = acceptable (0.5)
        """
        rsi = getattr(signal, "rsi", 50.0)
        if signal.direction == "LONG":
            if rsi <= 30:
                return 0.8   # extremely oversold can mean momentum still down
            if rsi <= 40:
                return 1.0
            if rsi <= 50:
                return 0.7
            return 0.3       # 50-55 passed the gate but weak confirmation
        else:
            if rsi >= 70:
                return 0.8
            if rsi >= 60:
                return 1.0
            if rsi >= 50:
                return 0.7
            return 0.3

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
