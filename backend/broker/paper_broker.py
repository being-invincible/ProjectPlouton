"""
Paper Broker — local trading simulator.

Simulates order execution with configurable slippage.
Maintains an in-memory portfolio starting with $500 (configurable).
All trades are recorded to PocketBase.
"""

import logging
import random
from typing import Optional

from broker.base import Broker, Position
from config import settings

logger = logging.getLogger(__name__)


class PaperBroker(Broker):
    """Local paper trading simulator."""

    def __init__(
        self,
        initial_balance: float | None = None,
        slippage_pct: float = 0.05,
    ):
        """
        Args:
            initial_balance: Starting balance (default: from settings, $500)
            slippage_pct: Simulated slippage percentage (0.05 = 0.05%)
        """
        self.initial_balance = initial_balance or settings.paper_balance
        self.balance = self.initial_balance
        self.slippage_pct = slippage_pct
        self.positions: list[Position] = []
        self._connected = False

    async def connect(self) -> None:
        """Initialize the paper broker."""
        self._connected = True
        logger.info(
            f"📝 Paper broker connected | "
            f"Balance: ${self.balance:.2f} | "
            f"Slippage: {self.slippage_pct}%"
        )

    async def disconnect(self) -> None:
        """Disconnect paper broker."""
        self._connected = False
        logger.info("📝 Paper broker disconnected")

    async def place_order(
        self,
        direction: str,
        quantity: float,
        price: float,
        stop_loss: float,
        take_profit: float,
    ) -> float:
        """
        Simulate order execution with slippage.

        Returns the simulated fill price.
        """
        # Simulate slippage
        slippage = price * (self.slippage_pct / 100)
        if direction == "LONG":
            fill_price = price + (slippage * random.uniform(0, 1))
        else:
            fill_price = price - (slippage * random.uniform(0, 1))

        fill_price = round(fill_price, 2)

        # Track position
        position = Position(
            instrument=settings.instrument,
            direction=direction,
            quantity=quantity,
            entry_price=fill_price,
            current_price=fill_price,
            unrealized_pnl=0.0,
        )
        self.positions.append(position)

        logger.info(
            f"📝 Paper order filled: {direction} {quantity} "
            f"@ ${fill_price:.2f} (slippage: ${abs(fill_price - price):.2f})"
        )

        return fill_price

    async def close_position(
        self,
        direction: str,
        quantity: float,
        price: float,
    ) -> float:
        """Simulate closing a position."""
        # Simulate slippage on exit
        slippage = price * (self.slippage_pct / 100)
        if direction == "LONG":
            # Selling to close long — slippage works against us
            fill_price = price - (slippage * random.uniform(0, 1))
        else:
            # Buying to close short — slippage works against us
            fill_price = price + (slippage * random.uniform(0, 1))

        fill_price = round(fill_price, 2)

        # Remove from tracked positions (first match)
        for i, pos in enumerate(self.positions):
            if pos.direction == direction and pos.quantity == quantity:
                # Calculate P&L
                if direction == "LONG":
                    pnl = (fill_price - pos.entry_price) * quantity
                else:
                    pnl = (pos.entry_price - fill_price) * quantity

                self.balance += pnl
                self.positions.pop(i)

                logger.info(
                    f"📝 Paper position closed: {direction} {quantity} "
                    f"@ ${fill_price:.2f} | P&L: ${pnl:+.2f} | "
                    f"Balance: ${self.balance:.2f}"
                )
                break

        return fill_price

    async def get_positions(self) -> list[Position]:
        """Return all open paper positions."""
        return self.positions.copy()

    async def get_account_balance(self) -> float:
        """Return current paper balance."""
        return self.balance

    def is_connected(self) -> bool:
        """Check if paper broker is initialized."""
        return self._connected

    def update_positions(self, current_price: float) -> None:
        """Update unrealized P&L for all open positions."""
        for pos in self.positions:
            pos.current_price = current_price
            if pos.direction == "LONG":
                pos.unrealized_pnl = (
                    (current_price - pos.entry_price) * pos.quantity
                )
            else:
                pos.unrealized_pnl = (
                    (pos.entry_price - current_price) * pos.quantity
                )
