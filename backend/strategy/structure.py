"""
Market structure: Break of Structure (BOS) + Change of Character (CHoCH).

Built on top of confirmed ZigZag pivots:
  * In an UPTREND (sequence of higher-highs + higher-lows), a fresh higher-high
    that breaks above the prior swing high is a BOS up — trend continuation.
  * A lower-low that breaks below the prior swing low while we're still in
    that uptrend is a CHoCH down — first warning that the trend may be
    flipping. Mirrored for downtrends.

The trick is "prior" — we need the last *opposite-kind* pivot's neighbour to
compare against, not just the most recent one.

Returns events in chronological order:
    {"time": iso8601, "kind": "BOS_UP"|"BOS_DOWN"|"CHOCH_UP"|"CHOCH_DOWN",
     "price": float, "broken_pivot_price": float, "index": int}
"""

from __future__ import annotations

from typing import List

import pandas as pd

from backend.strategy.zigzag import compute_zigzag


def label_pivots(
    df: pd.DataFrame,
    atr_mult: float = 2.0,
    atr_period: int = 14,
) -> List[dict]:
    """Tag each confirmed pivot with HH / HL / LH / LL relative to the prior
    same-kind pivot.

      * HH = HIGH whose price > prior HIGH (uptrend continuation)
      * LH = HIGH whose price < prior HIGH (downtrend rally / weakening)
      * HL = LOW  whose price > prior LOW  (uptrend support rising)
      * LL = LOW  whose price < prior LOW  (downtrend continuation)

    Returns chronological list:
        {"time", "price", "kind" ("HIGH"|"LOW"), "label" ("HH"|"HL"|"LH"|"LL"),
         "index", "confirmed"}

    A coherent HH+HL pair = uptrend; LH+LL = downtrend; mixed = consolidation.
    Frontend uses these labels in place of plain H/L arrow text.
    """
    pivots = [p for p in compute_zigzag(df, atr_period=atr_period, atr_mult=atr_mult) if p.get("confirmed")]
    if not pivots:
        return []

    out: List[dict] = []
    prior_high_price: float | None = None
    prior_low_price: float | None = None
    for p in pivots:
        label = None
        if p["kind"] == "HIGH":
            if prior_high_price is None:
                label = "H"
            elif p["price"] > prior_high_price:
                label = "HH"
            else:
                label = "LH"
            prior_high_price = p["price"]
        else:
            if prior_low_price is None:
                label = "L"
            elif p["price"] > prior_low_price:
                label = "HL"
            else:
                label = "LL"
            prior_low_price = p["price"]
        out.append({**p, "label": label})
    return out


def detect_structure(
    df: pd.DataFrame,
    atr_mult: float = 2.0,
    atr_period: int = 14,
) -> List[dict]:
    """Detect BOS + CHoCH events using confirmed ZigZag pivots.

    Trend state is inferred from the last 2 same-kind pivots:
      * Last HIGH > prior HIGH AND last LOW > prior LOW  → UP trend.
      * Last HIGH < prior HIGH AND last LOW < prior LOW  → DOWN trend.
      * Anything else → "MIXED", no event.

    A *new* confirmed pivot then either continues the trend (BOS) or
    contradicts it (CHoCH).
    """
    pivots = [p for p in compute_zigzag(df, atr_period=atr_period, atr_mult=atr_mult) if p.get("confirmed")]
    if len(pivots) < 4:
        return []

    events: List[dict] = []

    for i in range(3, len(pivots)):
        new_piv = pivots[i]
        # Find last two HIGHs and last two LOWs strictly before i.
        prior_highs = [p for p in pivots[:i] if p["kind"] == "HIGH"]
        prior_lows = [p for p in pivots[:i] if p["kind"] == "LOW"]
        if len(prior_highs) < 2 or len(prior_lows) < 2:
            continue
        last_high, prev_high = prior_highs[-1], prior_highs[-2]
        last_low, prev_low = prior_lows[-1], prior_lows[-2]

        if last_high["price"] > prev_high["price"] and last_low["price"] > prev_low["price"]:
            trend = "UP"
        elif last_high["price"] < prev_high["price"] and last_low["price"] < prev_low["price"]:
            trend = "DOWN"
        else:
            continue

        if new_piv["kind"] == "HIGH":
            if trend == "UP" and new_piv["price"] > last_high["price"]:
                events.append({
                    "time": new_piv["time"], "kind": "BOS_UP",
                    "price": new_piv["price"],
                    "broken_pivot_price": last_high["price"],
                    "index": new_piv["index"],
                })
            elif trend == "DOWN" and new_piv["price"] > last_high["price"]:
                events.append({
                    "time": new_piv["time"], "kind": "CHOCH_UP",
                    "price": new_piv["price"],
                    "broken_pivot_price": last_high["price"],
                    "index": new_piv["index"],
                })
        elif new_piv["kind"] == "LOW":
            if trend == "DOWN" and new_piv["price"] < last_low["price"]:
                events.append({
                    "time": new_piv["time"], "kind": "BOS_DOWN",
                    "price": new_piv["price"],
                    "broken_pivot_price": last_low["price"],
                    "index": new_piv["index"],
                })
            elif trend == "UP" and new_piv["price"] < last_low["price"]:
                events.append({
                    "time": new_piv["time"], "kind": "CHOCH_DOWN",
                    "price": new_piv["price"],
                    "broken_pivot_price": last_low["price"],
                    "index": new_piv["index"],
                })

    return events
