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

    def open_position(self, *, coin: str, direction: str, entry: float, quantity: float,
                      stop_loss: float, tp1: float, tp2: float, notional: float, leverage: int,
                      initial_margin: float, liquidation_price: float, funding_rate_hr: float) -> str:
        trade_id = str(uuid.uuid4())
        self.positions[trade_id] = PaperPosition(
            trade_id=trade_id, coin=coin, direction=direction, entry_price=entry,
            quantity=quantity, initial_quantity=quantity, stop_loss=stop_loss, tp1=tp1, tp2=tp2,
            notional=notional, leverage=leverage, initial_margin=initial_margin,
            liquidation_price=liquidation_price, funding_rate_hr=funding_rate_hr,
        )
        logger.info(f"OPENED {direction} {coin} qty={quantity:.4f} entry={entry:.4f} SL={stop_loss:.4f}")
        return trade_id

    def check_exits(self, coin: str, current_price: float) -> list[tuple[str, str, float, float]]:
        """Returns list of (trade_id, exit_reason, exit_price, realized_pnl) for closures this tick."""
        closures = []
        for trade_id, pos in list(self.positions.items()):
            if pos.coin != coin:
                continue

            # SL check first (worst case)
            if pos.direction == "LONG" and current_price <= pos.stop_loss:
                pnl = (pos.stop_loss - pos.entry_price) * pos.quantity
                closures.append((trade_id, "SL", pos.stop_loss, pnl))
                self._close_full(trade_id, pnl)
                continue
            if pos.direction == "SHORT" and current_price >= pos.stop_loss:
                pnl = (pos.entry_price - pos.stop_loss) * pos.quantity
                closures.append((trade_id, "SL", pos.stop_loss, pnl))
                self._close_full(trade_id, pnl)
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
                    pos.quantity -= half
                    pos.tp1_hit = True
                    pos.stop_loss = pos.entry_price  # move to BE
                    self.balance += pnl_partial
                    closures.append((trade_id, "TP1_PARTIAL", pos.tp1, pnl_partial))

            # TP2 — close remainder
            hit_tp2 = (pos.direction == "LONG" and current_price >= pos.tp2) or \
                      (pos.direction == "SHORT" and current_price <= pos.tp2)
            if hit_tp2:
                if pos.direction == "LONG":
                    pnl = (pos.tp2 - pos.entry_price) * pos.quantity
                else:
                    pnl = (pos.entry_price - pos.tp2) * pos.quantity
                closures.append((trade_id, "TP2", pos.tp2, pnl))
                self._close_full(trade_id, pnl)
        return closures

    def _close_full(self, trade_id: str, pnl: float) -> None:
        pos = self.positions.pop(trade_id, None)
        if pos is None:
            return
        self.balance += pnl
        logger.info(f"CLOSED {pos.direction} {pos.coin} pnl=${pnl:.2f} balance=${self.balance:.2f}")

    def update_positions(self, coin: str, current_price: float) -> list[tuple[str, str, float, float]]:
        """Convenience entry — same as check_exits."""
        return self.check_exits(coin, current_price)
