"""
Elliott-style 5-wave Fibonacci extensions.

Wave model assumed from confirmed ZigZag pivots:
  * BULL impulse: LOW(P0) → HIGH(P1) → LOW(P2) → HIGH(P3) → LOW(P4) → HIGH(P5)
  * BEAR impulse: HIGH(P0) → LOW(P1) → HIGH(P2) → LOW(P3) → HIGH(P4) → LOW(P5)

Wave 1 = |P1 - P0|.  Extensions are projected from P0:
   1.618 = P0 ± 1.618 * wave1   (target zone for wave 3 / 5 top)
   2.618 = P0 ± 2.618 * wave1
   3.618 = P0 ± 3.618 * wave1

The inevitrade thesis: if the current 5th wave top lands at 1.618/2.618/3.618
of wave 1, that's "Fibonacci harmony" — high-conviction reversal zone.

Returns the most recent candidate impulse + its projection levels:
    {
        "direction": "BULL"|"BEAR",
        "waves": [{p0..p5 dicts}],
        "wave1_size": float,
        "projections": [{"level": "1.618", "price": float, "hit": bool}, ...],
        "current_position": float,  # current price relative to wave1 size in multiples
    }
"""

from __future__ import annotations

from typing import Optional

import pandas as pd

from backend.strategy.zigzag import compute_zigzag


def detect_5wave(
    df: pd.DataFrame,
    atr_mult: float = 2.0,
    atr_period: int = 14,
) -> Optional[dict]:
    pivots = [p for p in compute_zigzag(df, atr_period=atr_period, atr_mult=atr_mult) if p.get("confirmed")]
    if len(pivots) < 6:
        return None

    # Use the last 6 pivots if they form a valid alternating sequence.
    last6 = pivots[-6:]
    kinds = [p["kind"] for p in last6]

    # BULL impulse: starts with LOW.
    if kinds == ["LOW", "HIGH", "LOW", "HIGH", "LOW", "HIGH"]:
        direction = "BULL"
    elif kinds == ["HIGH", "LOW", "HIGH", "LOW", "HIGH", "LOW"]:
        direction = "BEAR"
    else:
        return None

    p0, p1, p2, p3, p4, p5 = last6
    wave1 = abs(p1["price"] - p0["price"])
    if wave1 <= 0:
        return None

    sign = 1 if direction == "BULL" else -1
    proj_levels = [1.618, 2.618, 3.618]
    last_close = float(df["Close"].iloc[-1] if "Close" in df.columns else df["close"].iloc[-1])

    projections = []
    for lv in proj_levels:
        price = p0["price"] + sign * lv * wave1
        # "hit" — has the 5th wave actually reached or exceeded this level?
        if direction == "BULL":
            hit = p5["price"] >= price
        else:
            hit = p5["price"] <= price
        projections.append({"level": f"{lv:.3f}", "price": float(price), "hit": bool(hit)})

    current_position = ((last_close - p0["price"]) * sign) / wave1

    return {
        "direction": direction,
        "waves": last6,
        "wave1_size": float(wave1),
        "wave1_base_price": float(p0["price"]),
        "projections": projections,
        "current_position_mult": float(current_position),
    }
