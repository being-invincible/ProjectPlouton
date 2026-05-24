"""
ATR-drawdown ZigZag pivot detection.

Definition (per user request):
  * A pivot HIGH is the *highest* bar before an aggressive move DOWN — formally,
    the running maximum is "confirmed" as a pivot the moment price drops at
    least `atr_mult * ATR` BELOW that maximum. No fixed bar lookback.
  * Mirrored for pivot LOW: running minimum confirmed when price rallies
    `atr_mult * ATR` ABOVE that minimum.
  * After confirmation, the algorithm flips direction and starts hunting for
    the opposite-kind pivot from the most extreme bar seen since the flip.

Why ATR (not %, not bar count):
  * % is wrong because $1 move means different things at $77k BTC vs $2.30 SUI.
  * Bar count is wrong because trends move at different speeds — a real swing
    can take 3 bars or 300. A bar threshold either misses fast swings or
    smears slow ones into noise.
  * ATR auto-adapts to the instrument AND the regime — high-vol periods need
    a bigger drawdown to count as a reversal, low-vol periods need less.

The "confirmation line" exposed to the UI is the price level the market must
cross to confirm the latest tentative pivot — for a tentative HIGH it's
(current_max - atr_mult * ATR); cross below and the high becomes final.

Returns pivots in chronological order:
    {"time": iso8601, "price": float, "kind": "HIGH"|"LOW",
     "index": int, "confirmed": bool, "atr_at_pivot": float}
"""

from __future__ import annotations

from typing import List, Optional

import pandas as pd

from backend.strategy.atr import compute_atr


def compute_zigzag(
    df: pd.DataFrame,
    atr_period: int = 14,
    atr_mult: float = 2.0,
    # Legacy kwargs kept so existing callers don't break — ignored.
    depth: int | None = None,
    deviation_pct: float | None = None,
) -> List[dict]:
    """Detect alternating swing high/low pivots using an ATR-drawdown rule.

    Args:
        df: OHLCV DataFrame indexed by Timestamp. Accepts both 'High'/'high' etc.
        atr_period: lookback for ATR (default 14, classic Wilder).
        atr_mult: how many ATRs price must move against the current extreme
                  before that extreme is locked in as a pivot.
    """
    if df is None or df.empty or len(df) < atr_period + 2:
        return []

    high_col = "High" if "High" in df.columns else "high"
    low_col = "Low" if "Low" in df.columns else "low"
    df_norm = df.rename(columns={high_col: "High", low_col: "Low"}) if high_col == "high" else df

    atr = compute_atr(df_norm, period=atr_period)

    highs = df_norm["High"].to_numpy()
    lows = df_norm["Low"].to_numpy()
    atr_arr = atr.to_numpy()
    times = df_norm.index.to_list()
    n = len(df_norm)

    pivots: List[dict] = []

    # Seed direction from first non-NaN ATR bar onward — start by assuming
    # we're hunting BOTH a high and a low, take whichever fires first.
    start_idx = atr_period
    if start_idx >= n:
        return []

    current_max = highs[start_idx]
    current_max_idx = start_idx
    current_min = lows[start_idx]
    current_min_idx = start_idx
    # state: "SEEK_BOTH" until first pivot confirmed.
    # After a HIGH is locked: state = "TRACK_HIGH" — we're tracking the running
    # MAX so future drops can confirm it; once price drops `threshold` from the
    # max we lock a new HIGH? No — once that high is locked we're TRACKING_LOW
    # (looking for next bottom). Actually simpler:
    #   * Going UP — extend running max; lock max as HIGH when price drops threshold.
    #   * Going DOWN — extend running min; lock min as LOW when price rallies threshold.
    # `state` records which extreme we're currently tracking.
    state = "SEEK_BOTH"  # "TRACK_HIGH" after LOW locked, "TRACK_LOW" after HIGH locked

    for i in range(start_idx + 1, n):
        atr_i = atr_arr[i] if not pd.isna(atr_arr[i]) else atr_arr[start_idx]
        threshold = atr_mult * atr_i

        # Extend running max while we're hunting a HIGH.
        if state in ("SEEK_BOTH", "TRACK_HIGH"):
            if highs[i] > current_max:
                current_max = highs[i]
                current_max_idx = i

        # Extend running min while we're hunting a LOW.
        if state in ("SEEK_BOTH", "TRACK_LOW"):
            if lows[i] < current_min:
                current_min = lows[i]
                current_min_idx = i

        # Lock pivot HIGH: we were tracking up; price has now dropped >= threshold
        # from the running max → the max is confirmed as a HIGH and we flip to
        # tracking for the next LOW.
        fired_this_iter = False
        if state in ("SEEK_BOTH", "TRACK_HIGH"):
            if (current_max - lows[i]) >= threshold:
                # Only fire if no pivot OR last pivot was a LOW (alternation).
                if not pivots or pivots[-1]["kind"] == "LOW":
                    pivots.append({
                        "time": _iso(times[current_max_idx]),
                        "price": float(current_max),
                        "kind": "HIGH",
                        "index": int(current_max_idx),
                        "confirmed": True,
                        "atr_at_pivot": float(atr_arr[current_max_idx]) if not pd.isna(atr_arr[current_max_idx]) else float(atr_i),
                    })
                    state = "TRACK_LOW"
                    # Start tracking the next LOW from the current bar — the
                    # pivot HIGH is locked, so the next pivot LOW must be a
                    # NEW low printed AFTER the high (not the low of the same
                    # bar that printed the high).
                    current_min = lows[i]
                    current_min_idx = i
                    fired_this_iter = True
                elif current_max > pivots[-1]["price"]:
                    # Same direction but more extreme — overwrite previous HIGH.
                    pivots[-1] = {
                        "time": _iso(times[current_max_idx]),
                        "price": float(current_max),
                        "kind": "HIGH",
                        "index": int(current_max_idx),
                        "confirmed": True,
                        "atr_at_pivot": float(atr_arr[current_max_idx]) if not pd.isna(atr_arr[current_max_idx]) else float(atr_i),
                    }
                    state = "TRACK_LOW"
                    current_min = lows[i]
                    current_min_idx = i
                    fired_this_iter = True
        if fired_this_iter:
            continue

        if state in ("SEEK_BOTH", "TRACK_LOW"):
            if (highs[i] - current_min) >= threshold:
                if not pivots or pivots[-1]["kind"] == "HIGH":
                    pivots.append({
                        "time": _iso(times[current_min_idx]),
                        "price": float(current_min),
                        "kind": "LOW",
                        "index": int(current_min_idx),
                        "confirmed": True,
                        "atr_at_pivot": float(atr_arr[current_min_idx]) if not pd.isna(atr_arr[current_min_idx]) else float(atr_i),
                    })
                    state = "TRACK_HIGH"
                    current_max = highs[i]
                    current_max_idx = i
                elif current_min < pivots[-1]["price"]:
                    pivots[-1] = {
                        "time": _iso(times[current_min_idx]),
                        "price": float(current_min),
                        "kind": "LOW",
                        "index": int(current_min_idx),
                        "confirmed": True,
                        "atr_at_pivot": float(atr_arr[current_min_idx]) if not pd.isna(atr_arr[current_min_idx]) else float(atr_i),
                    }
                    state = "TRACK_HIGH"
                    current_max = highs[i]
                    current_max_idx = i

    # Tentative tail pivot — whichever extreme we're currently tracking, not yet
    # confirmed (price hasn't moved threshold yet).
    if pivots:
        last_kind = pivots[-1]["kind"]
        if last_kind == "LOW" and current_max_idx > pivots[-1]["index"]:
            pivots.append({
                "time": _iso(times[current_max_idx]),
                "price": float(current_max),
                "kind": "HIGH",
                "index": int(current_max_idx),
                "confirmed": False,
                "atr_at_pivot": float(atr_arr[current_max_idx]) if not pd.isna(atr_arr[current_max_idx]) else 0.0,
            })
        elif last_kind == "HIGH" and current_min_idx > pivots[-1]["index"]:
            pivots.append({
                "time": _iso(times[current_min_idx]),
                "price": float(current_min),
                "kind": "LOW",
                "index": int(current_min_idx),
                "confirmed": False,
                "atr_at_pivot": float(atr_arr[current_min_idx]) if not pd.isna(atr_arr[current_min_idx]) else 0.0,
            })

    return pivots


def confirmation_price(pivots: List[dict], df: pd.DataFrame, atr_mult: float = 2.0) -> Optional[float]:
    """Price level the market must cross to confirm the latest tentative pivot.

    For a tentative HIGH: confirmation level = high - atr_mult * ATR_at_that_bar.
    Cross BELOW that level and the high is locked. Mirrored for LOW.
    Returns None if the latest pivot is already confirmed (or no pivots exist).
    """
    if not pivots:
        return None
    last = pivots[-1]
    if last.get("confirmed"):
        return None
    atr_val = float(last.get("atr_at_pivot") or 0.0)
    if atr_val <= 0:
        return None
    if last["kind"] == "HIGH":
        return last["price"] - atr_mult * atr_val
    return last["price"] + atr_mult * atr_val


def _iso(ts) -> str:
    if isinstance(ts, str):
        return ts
    if hasattr(ts, "isoformat"):
        return ts.isoformat()
    return str(ts)
