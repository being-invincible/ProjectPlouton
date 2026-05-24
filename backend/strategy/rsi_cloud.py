"""
RSI with cloud-highlight overlay (inevitrade-style "Innovate Trade Pro Plus").

Standard Wilder RSI(14) plus per-bar tags:
  * "overbought"  → RSI >= upper_band (default 70)
  * "oversold"    → RSI <= lower_band (default 30)
  * "neutral"     → in between
The "cloud" is the contiguous range where price prints in one of those zones
— the frontend can shade those bar ranges so the user sees "this whole region
is overvalued, look for SHORT setups here."

Returns a list aligned with the candle DataFrame:
    {"time": iso8601, "rsi": float, "zone": "overbought"|"oversold"|"neutral"}

Plus aggregated "zones": contiguous bar ranges grouped by zone (for shading).
"""

from __future__ import annotations

from typing import List

import pandas as pd


def compute_rsi(closes: pd.Series, period: int = 14) -> pd.Series:
    """Wilder RSI — exponential smoothing of gains/losses."""
    delta = closes.diff()
    gain = delta.clip(lower=0).fillna(0)
    loss = (-delta.clip(upper=0)).fillna(0)

    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50.0)


def compute_rsi_with_zones(
    df: pd.DataFrame,
    period: int = 14,
    upper: float = 70.0,
    lower: float = 30.0,
) -> dict:
    """Return per-bar RSI + collapsed zone ranges for cloud shading."""
    close_col = "Close" if "Close" in df.columns else "close"
    rsi = compute_rsi(df[close_col], period=period)

    points: List[dict] = []
    zones: List[dict] = []
    cur_zone: str | None = None
    cur_start_ts = None
    cur_start_idx = None

    times = df.index.to_list()
    for i, ts in enumerate(times):
        val = float(rsi.iloc[i])
        if val >= upper:
            z = "overbought"
        elif val <= lower:
            z = "oversold"
        else:
            z = "neutral"
        points.append({"time": _iso(ts), "rsi": val, "zone": z})

        if z != cur_zone:
            if cur_zone in ("overbought", "oversold") and cur_start_ts is not None:
                zones.append({
                    "kind": cur_zone,
                    "start_time": _iso(cur_start_ts),
                    "end_time": _iso(times[i - 1]),
                    "start_index": cur_start_idx,
                    "end_index": i - 1,
                })
            cur_zone = z
            cur_start_ts = ts
            cur_start_idx = i
    # Flush trailing zone
    if cur_zone in ("overbought", "oversold") and cur_start_ts is not None:
        zones.append({
            "kind": cur_zone,
            "start_time": _iso(cur_start_ts),
            "end_time": _iso(times[-1]),
            "start_index": cur_start_idx,
            "end_index": len(times) - 1,
        })

    return {"points": points, "zones": zones, "params": {"period": period, "upper": upper, "lower": lower}}


def _iso(ts) -> str:
    if isinstance(ts, str):
        return ts
    if hasattr(ts, "isoformat"):
        return ts.isoformat()
    return str(ts)
