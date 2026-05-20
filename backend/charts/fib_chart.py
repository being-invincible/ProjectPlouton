"""
Fibonacci retracement chart generator.

Produces a TradingView-style dark-theme PNG showing:
- Candlestick OHLC chart
- Swing high / swing low markers
- Fibonacci retracement levels (0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%)
- Golden Pocket zone shaded (50%–61.8%)
- Entry, Stop Loss, TP1, TP2 horizontal lines
- Direction annotation (LONG / SHORT)
"""

from __future__ import annotations

import io
from typing import Optional

import pandas as pd
import plotly.graph_objects as go


BG         = "#0f172a"
BG_PANEL   = "#1e293b"
GRID       = "rgba(255,255,255,0.05)"
TEXT       = "#94a3b8"
TEXT_LIGHT = "#cbd5e1"

GREEN  = "#10b981"
RED    = "#ef4444"
BLUE   = "#3b82f6"
AMBER  = "#fbbf24"
PURPLE = "#a78bfa"

FIB_LEVELS = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
FIB_LINE_COLORS = {
    0.0:   "rgba(148,163,184,0.4)",
    0.236: "rgba(148,163,184,0.4)",
    0.382: "rgba(251,191,36,0.6)",
    0.5:   "rgba(59,130,246,0.7)",
    0.618: "rgba(139,92,246,0.7)",
    0.786: "rgba(148,163,184,0.4)",
    1.0:   "rgba(148,163,184,0.4)",
}
FIB_TEXT_COLORS = {
    0.0:   "#94a3b8",
    0.236: "#94a3b8",
    0.382: "#fbbf24",
    0.5:   "#60a5fa",
    0.618: "#a78bfa",
    0.786: "#94a3b8",
    1.0:   "#94a3b8",
}


def _fib_price(high: float, low: float, level: float, direction: str) -> float:
    """
    For a DOWN swing (SHORT entry): price retraces UP from low.
      level 0.0 = low, level 1.0 = high
    For an UP swing (LONG entry): price retraces DOWN from high.
      level 0.0 = high, level 1.0 = low
    """
    if direction == "SHORT":
        return low + (high - low) * level
    else:
        return high - (high - low) * level


def generate_fib_chart(
    candles: pd.DataFrame,
    trade: dict,
    *,
    window_bars: int = 120,
    title_suffix: str = "",
) -> bytes:
    """
    Generate a Fibonacci analysis chart PNG.

    Parameters
    ----------
    candles : DataFrame with columns [timestamp, open, high, low, close, volume]
    trade   : dict with keys: instrument, direction, entry_price, stop_loss,
              tp1_price, tp2_price, swing_high, swing_low, timestamp
    window_bars : candles to show around the trade entry
    title_suffix : appended to chart title (e.g. "— Entry" or "— Exit")

    Returns
    -------
    PNG bytes
    """
    direction   = trade.get("direction", "SHORT")
    entry_price = float(trade.get("entry_price", 0))
    stop_loss   = float(trade.get("stop_loss", 0))
    tp1         = trade.get("tp1_price")
    tp2         = trade.get("tp2_price")
    swing_high  = trade.get("swing_high")
    swing_low   = trade.get("swing_low")
    instrument  = trade.get("instrument", "")
    ts_raw      = trade.get("timestamp", "")

    # Parse trade timestamp
    try:
        trade_ts = pd.Timestamp(ts_raw).tz_localize(None) if pd.Timestamp(ts_raw).tzinfo else pd.Timestamp(ts_raw)
    except Exception:
        trade_ts = None

    # Ensure candles sorted ascending
    df = candles.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"]).dt.tz_localize(None)
    df = df.sort_values("timestamp").reset_index(drop=True)

    # Slice window around the trade entry
    if trade_ts is not None:
        idx = df["timestamp"].searchsorted(trade_ts)
        start = max(0, idx - int(window_bars * 0.7))
        end   = min(len(df), idx + int(window_bars * 0.3))
        df = df.iloc[start:end].reset_index(drop=True)

    if df.empty:
        df = candles.tail(window_bars).copy()

    # ── Candles ───────────────────────────────────────────────────
    fig = go.Figure()

    fig.add_trace(go.Candlestick(
        x=df["timestamp"],
        open=df["open"], high=df["high"],
        low=df["low"],   close=df["close"],
        name="Price",
        increasing=dict(line=dict(color=GREEN, width=1), fillcolor="rgba(16,185,129,0.7)"),
        decreasing=dict(line=dict(color=RED,   width=1), fillcolor="rgba(239,68,68,0.7)"),
        whiskerwidth=0.3,
    ))

    x_range = [df["timestamp"].iloc[0], df["timestamp"].iloc[-1]]

    def hline(y: float, color: str, dash: str, width: float, label: str, label_side: str = "right"):
        fig.add_shape(type="line",
                      x0=x_range[0], x1=x_range[1], y0=y, y1=y,
                      line=dict(color=color, width=width, dash=dash),
                      layer="above")
        xpos = x_range[1] if label_side == "right" else x_range[0]
        fig.add_annotation(
            x=xpos, y=y, text=label,
            showarrow=False, xanchor="left" if label_side == "right" else "right",
            yanchor="middle",
            font=dict(size=10, color=color),
            bgcolor="rgba(15,23,42,0.8)",
            bordercolor=color, borderwidth=1, borderpad=3,
        )

    # ── Fibonacci retracement lines ───────────────────────────────
    if swing_high is not None and swing_low is not None:
        sh, sl = float(swing_high), float(swing_low)

        # Swing markers
        fig.add_trace(go.Scatter(
            x=[df["timestamp"].iloc[len(df)//4]], y=[sh],
            mode="markers+text",
            marker=dict(size=10, color=AMBER, symbol="triangle-down"),
            text=[f"Swing H  {sh:.4f}"], textposition="top center",
            textfont=dict(color=AMBER, size=10),
            showlegend=False,
        ))
        fig.add_trace(go.Scatter(
            x=[df["timestamp"].iloc[len(df)//4]], y=[sl],
            mode="markers+text",
            marker=dict(size=10, color=PURPLE, symbol="triangle-up"),
            text=[f"Swing L  {sl:.4f}"], textposition="bottom center",
            textfont=dict(color=PURPLE, size=10),
            showlegend=False,
        ))

        # Golden Pocket zone (50%–61.8%)
        gp_upper = _fib_price(sh, sl, 0.5,   direction)
        gp_lower = _fib_price(sh, sl, 0.618, direction)
        gp_y0, gp_y1 = min(gp_upper, gp_lower), max(gp_upper, gp_lower)
        fig.add_shape(
            type="rect",
            x0=x_range[0], x1=x_range[1], y0=gp_y0, y1=gp_y1,
            fillcolor="rgba(251,191,36,0.10)",
            line=dict(color="rgba(251,191,36,0.25)", width=1),
            layer="below",
        )
        fig.add_annotation(
            x=x_range[0], y=(gp_y0 + gp_y1) / 2,
            text="⬛ Golden Pocket",
            showarrow=False, xanchor="right",
            font=dict(size=9, color=AMBER),
        )

        # Fib level lines
        for lvl in FIB_LEVELS:
            price = _fib_price(sh, sl, lvl, direction)
            line_color = FIB_LINE_COLORS[lvl]
            text_color = FIB_TEXT_COLORS[lvl]
            label = f"Fib {lvl*100:.1f}%  {price:.4f}"
            fig.add_shape(type="line",
                          x0=x_range[0], x1=x_range[1], y0=price, y1=price,
                          line=dict(color=line_color, width=1, dash="dot"),
                          layer="below")
            fig.add_annotation(
                x=x_range[0], y=price, text=label,
                showarrow=False, xanchor="right",
                yanchor="middle",
                font=dict(size=9, color=text_color),
            )

    # ── Key price levels ──────────────────────────────────────────
    hline(entry_price, BLUE,  "solid",  2.0, f"Entry  {entry_price:.4f}")
    hline(stop_loss,   RED,   "dash",   1.5, f"SL  {stop_loss:.4f}")
    if tp1:
        hline(float(tp1), GREEN, "dash",  1.2, f"TP1  {float(tp1):.4f}")
    if tp2:
        hline(float(tp2), GREEN, "solid", 2.0, f"TP2  {float(tp2):.4f}")

    # ── Direction badge ───────────────────────────────────────────
    arrow = "▼ SHORT" if direction == "SHORT" else "▲ LONG"
    badge_color = RED if direction == "SHORT" else GREEN
    fig.add_annotation(
        x=0.01, y=0.97, xref="paper", yref="paper",
        text=arrow, showarrow=False, xanchor="left", yanchor="top",
        font=dict(size=14, color=badge_color, family="monospace"),
        bgcolor="rgba(15,23,42,0.85)",
        bordercolor=badge_color, borderwidth=1.5, borderpad=6,
    )

    # ── Layout ────────────────────────────────────────────────────
    title = f"{instrument} · {direction} · Golden Pocket Fibonacci"
    if title_suffix:
        title += f"  —  {title_suffix}"

    fig.update_layout(
        title=dict(text=title, font=dict(color=TEXT_LIGHT, size=14), x=0.01),
        paper_bgcolor=BG,
        plot_bgcolor=BG_PANEL,
        font=dict(color=TEXT, family="Inter, system-ui, sans-serif"),
        xaxis=dict(
            showgrid=True, gridcolor=GRID, gridwidth=1,
            showline=False, zeroline=False,
            tickfont=dict(size=10, color=TEXT),
            rangeslider=dict(visible=False),
            type="date",
        ),
        yaxis=dict(
            showgrid=True, gridcolor=GRID, gridwidth=1,
            showline=False, zeroline=False,
            tickfont=dict(size=10, color=TEXT),
            side="right",
        ),
        margin=dict(l=80, r=110, t=50, b=40),
        height=520, width=1100,
        showlegend=False,
        hovermode="x unified",
    )

    buf = io.BytesIO()
    fig.write_image(buf, format="png", scale=1.5)
    return buf.getvalue()
