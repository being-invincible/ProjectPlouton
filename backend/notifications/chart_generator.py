"""TradingView-style chart PNG renderer using plotly + kaleido."""

from typing import Optional

import pandas as pd
import plotly.graph_objects as go


BG          = "#131722"
GRID        = "#1e2230"
CANDLE_UP   = "#26a69a"
CANDLE_DOWN = "#ef5350"
TEXT_DIM    = "#787b86"
TEXT_BRIGHT = "#d1d4dc"

COLOR_0       = "#787b86"
COLOR_236     = "#ef5350"
COLOR_382     = "#ffc107"
COLOR_50      = "#4caf50"
COLOR_618     = "#26a69a"
COLOR_786     = "#2196f3"
GOLDEN_GOLD   = "#ffd700"

BAND_0_236    = "rgba(183, 28, 28, 0.10)"
BAND_236_382  = "rgba(230, 81, 0, 0.10)"
BAND_382_50   = "rgba(51, 105, 30, 0.10)"
BAND_GOLDEN   = "rgba(255, 215, 0, 0.18)"
BAND_618_786  = "rgba(0, 96, 100, 0.10)"
BAND_786_100  = "rgba(13, 71, 161, 0.10)"


class ChartGenerator:
    def __init__(self, width: int = 1600, height: int = 800):
        self.width = width
        self.height = height

    def render(
        self,
        df: pd.DataFrame,
        signal,
        confidence: float,
        exit_price: Optional[float] = None,
        exit_timestamp: Optional[pd.Timestamp] = None,
        exit_reason: Optional[str] = None,
    ) -> bytes:
        swing_low = signal.swing_low
        swing_high = signal.swing_high
        rng = swing_high - swing_low

        levels = {
            "0":     swing_low,
            "0.236": swing_low + 0.236 * rng,
            "0.382": swing_low + 0.382 * rng,
            "0.5":   swing_low + 0.5 * rng,
            "0.618": swing_low + 0.618 * rng,
            "0.786": swing_low + 0.786 * rng,
            "1":     swing_high,
        }

        fig = go.Figure()

        fig.add_trace(go.Candlestick(
            x=df.index,
            open=df["Open"], high=df["High"], low=df["Low"], close=df["Close"],
            increasing=dict(line=dict(color=CANDLE_UP), fillcolor=CANDLE_UP),
            decreasing=dict(line=dict(color=CANDLE_DOWN), fillcolor=CANDLE_DOWN),
            name="Price",
            showlegend=False,
        ))

        x0, x1 = df.index[0], df.index[-1]
        shapes = []

        # Golden pocket is direction-aware:
        # LONG: price pulled back from swing_high, pocket is 50–61.8% retrace = levels 0.382–0.5 from bottom
        # SHORT: price bounced from swing_low, pocket is 50–61.8% retrace = levels 0.5–0.618 from bottom
        if signal.direction == "LONG":
            gp_upper = swing_low + 0.500 * rng
            gp_lower = swing_low + 0.382 * rng
            bands = [
                ("0",     "0.236", BAND_0_236),
                ("0.236", "0.382", BAND_236_382),
                ("0.382", "0.5",   BAND_GOLDEN),
                ("0.5",   "0.618", BAND_382_50),
                ("0.618", "0.786", BAND_618_786),
                ("0.786", "1",     BAND_786_100),
            ]
        else:
            gp_upper = swing_low + 0.618 * rng
            gp_lower = swing_low + 0.500 * rng
            bands = [
                ("0",     "0.236", BAND_0_236),
                ("0.236", "0.382", BAND_236_382),
                ("0.382", "0.5",   BAND_382_50),
                ("0.5",   "0.618", BAND_GOLDEN),
                ("0.618", "0.786", BAND_618_786),
                ("0.786", "1",     BAND_786_100),
            ]
        for lo, hi, color in bands:
            shapes.append(dict(
                type="rect", xref="x", yref="y",
                x0=x0, x1=x1, y0=levels[lo], y1=levels[hi],
                fillcolor=color, line=dict(width=0), layer="below",
            ))

        line_specs = [
            ("0",     COLOR_0,   "solid"),
            ("0.236", COLOR_236, "dash"),
            ("0.382", COLOR_382, "dash"),
            ("0.5",   COLOR_50,  "solid"),
            ("0.618", COLOR_618, "solid"),
            ("0.786", COLOR_786, "dash"),
            ("1",     COLOR_0,   "solid"),
        ]
        for label, color, dash in line_specs:
            price = levels[label]
            fig.add_hline(y=price, line=dict(color=color, width=1.5, dash=dash),
                          annotation_text=f"{label} ({price:.4f})",
                          annotation_position="left",
                          annotation_font=dict(color=color, size=10))

        fig.add_hline(y=gp_upper, line=dict(color=GOLDEN_GOLD, width=2))
        fig.add_hline(y=gp_lower, line=dict(color=GOLDEN_GOLD, width=2))
        fig.add_annotation(
            x=df.index[int(len(df) * 0.92)],
            y=(gp_upper + gp_lower) / 2,
            text="<b>GOLDEN POCKET</b>",
            showarrow=False,
            font=dict(color=GOLDEN_GOLD, size=14),
        )

        shapes.append(dict(
            type="line", xref="x", yref="y",
            x0=df.index[0], x1=df.index[-1],
            y0=swing_low, y1=swing_high,
            line=dict(color=TEXT_DIM, width=1, dash="dash"),
            layer="below",
        ))

        for price, color, label, dash in [
            (signal.entry_price, "#2196f3", f"{signal.direction} @ {signal.entry_price:.4f}", "solid"),
            (signal.stop_loss,   "#ef4444", f"SL @ {signal.stop_loss:.4f}", "dash"),
            (signal.tp1,         "#26a69a", f"TP1 (1:1.5) @ {signal.tp1:.4f}", "dash"),
            (signal.tp2,         "#00e676", f"TP2 (1.618 ext) @ {signal.tp2:.4f}", "dash"),
        ]:
            fig.add_hline(y=price, line=dict(color=color, width=1.5, dash=dash),
                          annotation_text=label, annotation_position="right",
                          annotation_font=dict(color=color, size=10))

        if exit_price is not None and exit_timestamp is not None:
            fig.add_trace(go.Scatter(
                x=[exit_timestamp], y=[exit_price],
                mode="markers+text",
                marker=dict(symbol="x", size=14, color="#f59e0b", line=dict(width=2)),
                text=[f" EXIT: {exit_reason}"],
                textposition="middle right",
                textfont=dict(color="#f59e0b", size=11),
                showlegend=False,
            ))

        title = f"<b>{signal.coin}/USDC</b> &nbsp; · &nbsp; Golden Pocket {signal.direction} &nbsp; · &nbsp; Confidence {confidence:.0f}%"
        if exit_reason:
            title += f" &nbsp; · &nbsp; <b>{exit_reason}</b>"

        fig.update_layout(
            title=dict(text=title, font=dict(color=TEXT_BRIGHT, size=14), x=0.02, xanchor="left"),
            paper_bgcolor=BG,
            plot_bgcolor=BG,
            xaxis=dict(
                gridcolor=GRID, color=TEXT_DIM,
                rangeslider=dict(visible=False),
                showspikes=False,
            ),
            yaxis=dict(
                gridcolor=GRID, color=TEXT_DIM,
                side="right",
            ),
            shapes=shapes,
            margin=dict(l=80, r=120, t=50, b=40),
            width=self.width, height=self.height,
            font=dict(family="Trebuchet MS, sans-serif"),
        )

        return fig.to_image(format="png", engine="kaleido")
