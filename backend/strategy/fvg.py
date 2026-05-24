"""
Fair Value Gap (FVG) detection.

A Fair Value Gap is a 3-bar imbalance left behind by aggressive price action:
  * Bullish FVG: bar1.high < bar3.low  → middle bar pierced upward so fast
                  that bar1 and bar3 never overlapped. The gap zone
                  [bar1.high, bar3.low] is "unfilled" liquidity that price
                  often returns to. Used as a LONG re-entry magnet.
  * Bearish FVG: bar1.low > bar3.high  → mirrored, marks a SHORT entry zone.

We tag each FVG with:
  * "filled": True if any later bar has traded through the entire gap zone.
  * "mitigated": True if any later bar has touched the gap edge (partial fill).

For trade planning, the freshest UNFILLED FVG in the trend direction is the
prime entry zone.

Returns chronological list:
    {"time": iso8601 (bar3 timestamp), "kind": "BULL"|"BEAR",
     "top": float, "bottom": float, "filled": bool, "mitigated": bool,
     "index": int (of bar3)}
"""

from __future__ import annotations

from typing import List

import pandas as pd


def detect_fvg(df: pd.DataFrame, min_size_atr: float = 0.25) -> List[dict]:
    """Scan for 3-bar FVGs across the whole frame.

    Args:
        df: OHLCV indexed by Timestamp. Accepts lower-case column variants.
        min_size_atr: gap height must be >= min_size_atr * ATR to count
                      (filters microscopic imbalances). 0.25 is reasonable
                      noise floor; raise to 0.5+ for cleaner zones only.
    """
    if df is None or len(df) < 3:
        return []

    high_col = "High" if "High" in df.columns else "high"
    low_col = "Low" if "Low" in df.columns else "low"
    highs = df[high_col].to_numpy()
    lows = df[low_col].to_numpy()
    times = df.index.to_list()
    n = len(df)

    # ATR (Wilder) for size gate — keep inline to avoid circular imports.
    closes = df["Close"].to_numpy() if "Close" in df.columns else df["close"].to_numpy()
    tr = []
    for i in range(n):
        if i == 0:
            tr.append(highs[i] - lows[i])
        else:
            tr.append(max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            ))
    period = 14
    atr_arr = [None] * n
    if n >= period:
        first = sum(tr[:period]) / period
        atr_arr[period - 1] = first
        for i in range(period, n):
            atr_arr[i] = (atr_arr[i - 1] * (period - 1) + tr[i]) / period

    fvgs: List[dict] = []
    for i in range(2, n):
        b1_high, b1_low = highs[i - 2], lows[i - 2]
        b3_high, b3_low = highs[i], lows[i]
        atr_here = atr_arr[i] or 0.0
        min_size = min_size_atr * atr_here if atr_here else 0.0

        if b1_high < b3_low:
            gap = b3_low - b1_high
            if gap >= min_size:
                top, bottom = float(b3_low), float(b1_high)
                fvgs.append({
                    "time": _iso(times[i]),
                    "kind": "BULL",
                    "top": top,
                    "bottom": bottom,
                    # Consequential encroachment (CE) — midpoint where inevitrade
                    # waits for price to react before entering.
                    "midpoint": (top + bottom) / 2.0,
                    "index": int(i),
                    "filled": False,
                    "mitigated": False,
                })
        elif b1_low > b3_high:
            gap = b1_low - b3_high
            if gap >= min_size:
                top, bottom = float(b1_low), float(b3_high)
                fvgs.append({
                    "time": _iso(times[i]),
                    "kind": "BEAR",
                    "top": top,
                    "bottom": bottom,
                    "midpoint": (top + bottom) / 2.0,
                    "index": int(i),
                    "filled": False,
                    "mitigated": False,
                })

    # Post-process fill / mitigation by walking forward.
    for fvg in fvgs:
        start = fvg["index"] + 1
        top, bottom = fvg["top"], fvg["bottom"]
        for j in range(start, n):
            bar_low, bar_high = lows[j], highs[j]
            # Mitigation: touched the zone at all.
            if bar_low <= top and bar_high >= bottom:
                fvg["mitigated"] = True
            # Fill: bar traded through the entire zone.
            if fvg["kind"] == "BULL" and bar_low <= bottom:
                fvg["filled"] = True
                break
            if fvg["kind"] == "BEAR" and bar_high >= top:
                fvg["filled"] = True
                break

    return fvgs


def _iso(ts) -> str:
    if isinstance(ts, str):
        return ts
    if hasattr(ts, "isoformat"):
        return ts.isoformat()
    return str(ts)
