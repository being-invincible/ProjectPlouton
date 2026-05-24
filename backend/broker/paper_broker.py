"""Paper broker for Hermes v2 — tracks notional, simulates two-stage TP, BE move after TP1."""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class PaperPosition:
    trade_id: str
    coin: str
    direction: str               # LONG / SHORT
    entry_price: float
    quantity: float
    stop_loss: float
    tp1: float
    tp2: float
    initial_quantity: float      # original size before TP1 partial
    notional: float
    leverage: int
    initial_margin: float
    liquidation_price: float
    funding_rate_hr: float
    tp1_hit: bool = False
    pnl_realized: float = 0.0   # cumulative realized pnl (TP1 partial, etc.)
    opened_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class PaperBroker:
    def __init__(self, initial_balance: float):
        self.initial_balance = initial_balance
        self.balance = initial_balance
        self.positions: Dict[str, PaperPosition] = {}

    async def connect(self) -> None:
        logger.info(f"Paper broker connected — balance ${self.balance:.2f}")

    async def disconnect(self) -> None:
        logger.info("Paper broker disconnected")

    def rehydrate(self, open_trades: list[dict]) -> None:
        """Reconstruct in-memory positions from DB rows after a bot restart.

        The DB `balance` field already reflects margin deductions from the previous
        session (saved by _update_bot_state → broker.balance). Do NOT deduct margin
        again here — that would double-count and show a far-too-low balance until
        each position closes and returns its margin.
        """
        for t in open_trades:
            trade_id  = str(t["id"])
            margin    = float(t.get("initial_margin") or 0)
            qty       = float(t["quantity"])
            tp1_hit   = bool(t.get("tp1_hit") or False)
            direction = str(t["direction"])
            entry     = float(t["entry_price"])
            tp1_price = float(t.get("tp1_price") or t.get("take_profit", 0))
            initial_qty = qty * 2 if tp1_hit else qty

            # Reconstruct already-realized pnl so TP2/SL reports include TP1 profit.
            if tp1_hit and tp1_price:
                half = initial_qty * 0.5
                pnl_realized = (tp1_price - entry) * half if direction == "LONG" \
                               else (entry - tp1_price) * half
            else:
                pnl_realized = 0.0

            self.positions[trade_id] = PaperPosition(
                trade_id=trade_id,
                coin=str(t["instrument"]),
                direction=direction,
                entry_price=entry,
                quantity=qty,
                initial_quantity=initial_qty,
                stop_loss=float(t["stop_loss"]),
                tp1=tp1_price,
                tp2=float(t.get("tp2_price") or t.get("take_profit", 0)),
                notional=float(t.get("notional") or 0),
                leverage=int(t.get("leverage") or 1),
                initial_margin=margin,
                liquidation_price=float(t.get("liquidation_price") or 0),
                funding_rate_hr=float(t.get("funding_rate_hr") or 0),
                tp1_hit=tp1_hit,
                pnl_realized=pnl_realized,
            )
        logger.info(f"Rehydrated {len(open_trades)} open position(s) from DB")

    def open_position(self, *, coin: str, direction: str, entry: float, quantity: float,
                      stop_loss: float, tp1: float, tp2: float, notional: float, leverage: int,
                      initial_margin: float, liquidation_price: float, funding_rate_hr: float) -> str:
        trade_id = str(uuid.uuid4())
        self.balance -= initial_margin          # deduct margin upfront
        self.positions[trade_id] = PaperPosition(
            trade_id=trade_id, coin=coin, direction=direction, entry_price=entry,
            quantity=quantity, initial_quantity=quantity, stop_loss=stop_loss, tp1=tp1, tp2=tp2,
            notional=notional, leverage=leverage, initial_margin=initial_margin,
            liquidation_price=liquidation_price, funding_rate_hr=funding_rate_hr,
        )
        logger.info(f"OPENED {direction} {coin} qty={quantity:.4f} entry={entry:.4f} SL={stop_loss:.4f} margin=${initial_margin:.2f} balance=${self.balance:.2f}")
        return trade_id

    def check_exits(self, coin: str, current_price: float) -> list[tuple[str, str, float, float]]:
        """Returns list of (trade_id, exit_reason, exit_price, realized_pnl) for closures this tick."""
        closures = []
        for trade_id, pos in list(self.positions.items()):
            if pos.coin != coin:
                continue

            # SL check first (worst case)
            if pos.direction == "LONG" and current_price <= pos.stop_loss:
                pnl_sl = (pos.stop_loss - pos.entry_price) * pos.quantity
                total_pnl = pos.pnl_realized + pnl_sl
                closures.append((trade_id, "SL", pos.stop_loss, total_pnl))
                self._close_full(trade_id, pnl_sl)
                continue
            if pos.direction == "SHORT" and current_price >= pos.stop_loss:
                pnl_sl = (pos.entry_price - pos.stop_loss) * pos.quantity
                total_pnl = pos.pnl_realized + pnl_sl
                closures.append((trade_id, "SL", pos.stop_loss, total_pnl))
                self._close_full(trade_id, pnl_sl)
                continue

            # TP1 — partial close 50%, move SL to BE
            if not pos.tp1_hit:
                hit_tp1 = (pos.direction == "LONG" and current_price >= pos.tp1) or \
                          (pos.direction == "SHORT" and current_price <= pos.tp1)
                if hit_tp1:
                    half = pos.initial_quantity * 0.5
                    if pos.direction == "LONG":
                        pnl_partial = (pos.tp1 - pos.entry_price) * half
                    else:
                        pnl_partial = (pos.entry_price - pos.tp1) * half
                    half_margin = pos.initial_margin * 0.5
                    pos.quantity -= half
                    pos.tp1_hit = True
                    pos.stop_loss = pos.entry_price     # move to breakeven
                    pos.initial_margin = half_margin    # remaining position holds half margin
                    pos.pnl_realized += pnl_partial     # accumulate for full-trade pnl reporting
                    self.balance += pnl_partial + half_margin   # return half margin + profit
                    closures.append((trade_id, "TP1_PARTIAL", pos.tp1, pnl_partial))

            # TP2 — close remainder; report TOTAL trade pnl (TP1 + TP2)
            hit_tp2 = (pos.direction == "LONG" and current_price >= pos.tp2) or \
                      (pos.direction == "SHORT" and current_price <= pos.tp2)
            if hit_tp2:
                if pos.direction == "LONG":
                    pnl_tp2 = (pos.tp2 - pos.entry_price) * pos.quantity
                else:
                    pnl_tp2 = (pos.entry_price - pos.tp2) * pos.quantity
                total_pnl = pos.pnl_realized + pnl_tp2
                closures.append((trade_id, "TP2", pos.tp2, total_pnl))
                self._close_full(trade_id, pnl_tp2)
        return closures

    def _close_full(self, trade_id: str, pnl: float) -> None:
        pos = self.positions.pop(trade_id, None)
        if pos is None:
            return
        self.balance += pnl + pos.initial_margin   # return margin on close
        logger.info(f"CLOSED {pos.direction} {pos.coin} pnl=${pnl:.2f} margin_returned=${pos.initial_margin:.2f} balance=${self.balance:.2f}")

    def check_exits_candle(self, coin: str, high: float, low: float) -> list[tuple[str, str, float, float]]:
        """OHLC-aware exit check for backfill replay.

        Uses candle low for SL (LONG) / high for SL (SHORT) — simulates worst-case wick.
        Uses candle high for TP (LONG) / low for TP (SHORT).
        SL is evaluated before TP within a candle (conservative assumption).
        """
        closures = []
        for trade_id, pos in list(self.positions.items()):
            if pos.coin != coin:
                continue

            if pos.direction == "LONG":
                sl_hit   = low  <= pos.stop_loss
                tp1_hit  = high >= pos.tp1
                tp2_hit  = high >= pos.tp2
                pnl_sl   = (pos.stop_loss - pos.entry_price) * pos.quantity
            else:
                sl_hit   = high >= pos.stop_loss
                tp1_hit  = low  <= pos.tp1
                tp2_hit  = low  <= pos.tp2
                pnl_sl   = (pos.entry_price - pos.stop_loss) * pos.quantity

            if sl_hit:
                total_pnl = pos.pnl_realized + pnl_sl
                closures.append((trade_id, "SL", pos.stop_loss, total_pnl))
                self._close_full(trade_id, pnl_sl)
                continue

            if not pos.tp1_hit and tp1_hit:
                half = pos.initial_quantity * 0.5
                pnl_partial = (pos.tp1 - pos.entry_price) * half if pos.direction == "LONG" \
                              else (pos.entry_price - pos.tp1) * half
                half_margin = pos.initial_margin * 0.5
                pos.quantity      -= half
                pos.tp1_hit        = True
                pos.stop_loss      = pos.entry_price
                pos.initial_margin = half_margin
                pos.pnl_realized  += pnl_partial
                self.balance      += pnl_partial + half_margin
                closures.append((trade_id, "TP1_PARTIAL", pos.tp1, pnl_partial))

            if pos.tp1_hit and tp2_hit:
                pnl_tp2 = (pos.tp2 - pos.entry_price) * pos.quantity if pos.direction == "LONG" \
                          else (pos.entry_price - pos.tp2) * pos.quantity
                total_pnl = pos.pnl_realized + pnl_tp2
                closures.append((trade_id, "TP2", pos.tp2, total_pnl))
                self._close_full(trade_id, pnl_tp2)

        return closures

    def update_positions(self, coin: str, current_price: float) -> list[tuple[str, str, float, float]]:
        """Convenience entry — same as check_exits."""
        return self.check_exits(coin, current_price)
