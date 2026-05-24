"""
Fibonacci Golden Zone Confluence strategy — Python port of the TradingView
Pine v6 strategy in reference/fib_golden_zone.pine.

Entry model:
  1. Fractal swings (5-bar) define the most recent impulse leg.
  2. Golden Zone = 0.5–0.618 retracement of that leg.
  3. Confluence — at least one of:
       • 50 EMA sits inside the Golden Zone, OR
       • a prior swap-zone fractal level sits inside the Golden Zone.
  4. Trend filter — price the right side of the 50 EMA (+ EMA sloped with trend).
  5. Trigger — an engulfing candle while price is inside the zone.
  6. Risk — SL at the swing extreme (or 78.6% fib) ± ATR buffer;
            TP at a reward:risk multiple (or the 1.618 extension).
"""

import logging
from typing import Literal, Optional

import pandas as pd

from backend.config import settings
from backend.strategy.atr import compute_atr
from backend.strategy.golden_pocket import Signal  # reuse compatible Signal dataclass

logger = logging.getLogger(__name__)


class FibGoldenZoneStrategy:
    """Golden Zone confluence — fractal swings + EMA/swap confluence + engulfing trigger."""

    # Pine input defaults
    FRAC_N            = 5      # fractal window (5 = 2 bars each side)
    MAX_BARS_SWING    = 40     # max bars a swing stays valid
    EMA_LEN           = 50
    REQUIRE_EMA_SLOPE = True
    ATR_LEN           = 14
    ATR_TOL_MULT      = 0.25   # confluence tolerance (× ATR)
    FIB_LOW           = 0.382  # Golden Zone start (retracement) — widened to catch shallow pullbacks
    FIB_HIGH          = 0.618  # Golden Zone end (retracement)
    ZONE_PROX_ATR     = 0.5    # treat price within this × ATR of the zone as "in zone"
    REQUIRE_ENGULF    = False  # OFF: fire as soon as price is in zone with confluence (more frequent)
    FULL_ENGULF       = False  # require wick engulf too (only if REQUIRE_ENGULF)
    STOP_BASIS        = "swing"  # "swing" | "fib786"
    STOP_BUF_ATR      = 0.25
    TP_BASIS          = "rr"     # "rr" | "ext1618"
    RR_TARGET         = 2.0
    ENABLE_EMA_CONF   = True
    ENABLE_SWAP_CONF  = True
    ALLOW_LONGS       = True
    ALLOW_SHORTS      = True

    def analyze(self, df: pd.DataFrame, mtf_trend: dict, coin: str) -> Optional[Signal]:
        n = len(df)
        half = self.FRAC_N // 2
        if n < max(self.EMA_LEN + 5, self.MAX_BARS_SWING + half + 3):
            return None

        high = df["High"].to_numpy(dtype=float)
        low = df["Low"].to_numpy(dtype=float)
        close = df["Close"].to_numpy(dtype=float)
        open_ = df["Open"].to_numpy(dtype=float)

        ema = df["Close"].ewm(span=self.EMA_LEN, adjust=False).mean().to_numpy()
        atr = float(compute_atr(df, period=self.ATR_LEN).iloc[-1])
        if atr <= 0:
            return None

        # ── 1. Fractal swings (non-repainting; center strictly extreme) ────────
        up_levels: list[tuple[int, float]] = []   # (center_bar, price)
        dn_levels: list[tuple[int, float]] = []
        # A fractal at center c is confirmed once c+half bars exist.
        for c in range(half, n - half):
            ch = high[c]
            if all(high[c - k] < ch and high[c + k] < ch for k in range(1, half + 1)):
                up_levels.append((c, ch))
            cl = low[c]
            if all(low[c - k] > cl and low[c + k] > cl for k in range(1, half + 1)):
                dn_levels.append((c, cl))

        if not up_levels or not dn_levels:
            logger.debug(f"[{coin}] FibGZ: no fractal swings yet")
            return None

        swing_high_bar, swing_high_price = up_levels[-1]
        swing_low_bar, swing_low_price = dn_levels[-1]
        cur_bar = n - 1

        # ── 2. Impulse validity + Golden Zone bounds ───────────────────────────
        long_valid = (
            swing_high_price > swing_low_price
            and swing_high_bar > swing_low_bar
            and (cur_bar - swing_high_bar) <= self.MAX_BARS_SWING
        )
        short_valid = (
            swing_high_price > swing_low_price
            and swing_low_bar > swing_high_bar
            and (cur_bar - swing_low_bar) <= self.MAX_BARS_SWING
        )
        if not long_valid and not short_valid:
            logger.debug(f"[{coin}] FibGZ: no valid impulse leg")
            return None

        direction: Literal["LONG", "SHORT"] = "LONG" if long_valid else "SHORT"
        rng = swing_high_price - swing_low_price
        tol = atr * self.ATR_TOL_MULT

        if direction == "LONG":
            gz_high = swing_high_price - self.FIB_LOW * rng    # 50% retr
            gz_low = swing_high_price - self.FIB_HIGH * rng    # 61.8% retr
            fib786 = swing_high_price - 0.786 * rng
        else:
            gz_low = swing_low_price + self.FIB_LOW * rng
            gz_high = swing_low_price + self.FIB_HIGH * rng
            fib786 = swing_low_price + 0.786 * rng

        if (direction == "LONG" and not self.ALLOW_LONGS) or (direction == "SHORT" and not self.ALLOW_SHORTS):
            return None

        # ── 3. Price must be interacting with (or approaching) the zone ────────
        # Proximity band: in a trend, price rarely retraces the full 50–61.8%,
        # so treat price within ZONE_PROX_ATR of the zone as "in zone".
        prox = atr * self.ZONE_PROX_ATR
        in_zone = (low[-1] <= gz_high + prox) and (high[-1] >= gz_low - prox)
        if not in_zone:
            logger.debug(
                f"[{coin}] FibGZ: {direction} price not in Golden Zone "
                f"[{gz_low:.4f}–{gz_high:.4f}] bar=[{low[-1]:.4f}-{high[-1]:.4f}]"
            )
            return None

        # ── 4. Confluence: 50 EMA in zone OR a swap-zone fractal in zone ───────
        ema_now = float(ema[-1])
        ema_conf = self.ENABLE_EMA_CONF and (gz_low - tol) <= ema_now <= (gz_high + tol)

        swap_conf = False
        if self.ENABLE_SWAP_CONF:
            if direction == "LONG":
                for bar, lvl in up_levels:
                    if bar < swing_low_bar and (gz_low - tol) <= lvl <= (gz_high + tol) and swing_high_price > lvl:
                        swap_conf = True
                        break
            else:
                for bar, lvl in dn_levels:
                    if bar < swing_high_bar and (gz_low - tol) <= lvl <= (gz_high + tol) and swing_low_price < lvl:
                        swap_conf = True
                        break

        if not (ema_conf or swap_conf):
            logger.debug(f"[{coin}] FibGZ: {direction} no EMA/swap confluence in zone")
            return None

        # ── 5. Trend filter ───────────────────────────────────────────────────
        ema_prev = float(ema[-2])
        if direction == "LONG":
            trend_ok = close[-1] > ema_now and (not self.REQUIRE_EMA_SLOPE or ema_now > ema_prev)
        else:
            trend_ok = close[-1] < ema_now and (not self.REQUIRE_EMA_SLOPE or ema_now < ema_prev)
        if not trend_ok:
            logger.debug(f"[{coin}] FibGZ: {direction} trend filter fail (close vs EMA / slope)")
            return None

        # ── 6. Engulfing trigger (current vs previous candle) ──────────────────
        if self.REQUIRE_ENGULF:
            o, c_, po, pc = open_[-1], close[-1], open_[-2], close[-2]
            wick_ok = (not self.FULL_ENGULF) or (high[-1] > high[-2] and low[-1] < low[-2])
            if direction == "LONG":
                engulf = (c_ > o) and (pc < po) and (c_ >= po) and (o <= pc) and wick_ok
            else:
                engulf = (c_ < o) and (pc > po) and (c_ <= po) and (o >= pc) and wick_ok
            if not engulf:
                logger.debug(f"[{coin}] FibGZ: {direction} no engulfing trigger this bar")
                return None

        # ── 7. Risk management ─────────────────────────────────────────────────
        entry = float(close[-1])
        if direction == "LONG":
            stop_ref = fib786 if self.STOP_BASIS == "fib786" else swing_low_price
            sl = stop_ref - self.STOP_BUF_ATR * atr
            risk = entry - sl
            ext1618 = swing_low_price + 1.618 * rng
            tp2 = ext1618 if self.TP_BASIS == "ext1618" else (entry + self.RR_TARGET * risk)
            tp1 = entry + 1.5 * risk
        else:
            stop_ref = fib786 if self.STOP_BASIS == "fib786" else swing_high_price
            sl = stop_ref + self.STOP_BUF_ATR * atr
            risk = sl - entry
            ext1618 = swing_high_price - 1.618 * rng
            tp2 = ext1618 if self.TP_BASIS == "ext1618" else (entry - self.RR_TARGET * risk)
            tp1 = entry - 1.5 * risk

        if risk <= 0 or risk < atr * 0.25:
            logger.debug(f"[{coin}] FibGZ: invalid/too-tight risk ({risk:.4f})")
            return None

        rsi = self._rsi(df)
        conf_label = "EMA" if ema_conf else "swap"
        logger.debug(
            f"[{coin}] FibGZ: {direction} signal — GZ[{gz_low:.4f}–{gz_high:.4f}] "
            f"conf={conf_label} entry={entry:.4f} sl={sl:.4f} tp2={tp2:.4f} RSI={rsi:.1f}"
        )

        return Signal(
            coin=coin,
            direction=direction,
            entry_price=entry,
            stop_loss=sl,
            tp1=tp1,
            tp2=tp2,
            fib_level_triggered=0.618,
            fib_zone_name="GP",
            swing_high=swing_high_price,
            swing_low=swing_low_price,
            atr=atr,
            rsi=rsi,
            timestamp=df.index[-1],
        )

    def _rsi(self, df: pd.DataFrame, period: int = 14) -> float:
        close = df["Close"]
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(period).mean()
        loss = (-delta.clip(upper=0)).rolling(period).mean()
        rs = gain / loss.replace(0, float("inf"))
        return float((100 - (100 / (1 + rs))).iloc[-1])
