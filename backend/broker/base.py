"""
Abstract Broker interface.

All broker adapters (paper, IBKR, Zerodha) implement this interface.
The order manager interacts only with this interface, making
broker-swapping seamless.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class Position:
    """Represents an open position."""

    instrument: str
    direction: str          # "LONG" or "SHORT"
    quantity: float
    entry_price: float
    current_price: float
    unrealized_pnl: float


class Broker(ABC):
    """Abstract broker interface for paper and live trading."""

    @abstractmethod
    async def connect(self) -> None:
        """Establish connection to the broker."""
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """Disconnect from the broker."""
        ...

    @abstractmethod
    async def place_order(
        self,
        direction: str,
        quantity: float,
        price: float,
        stop_loss: float,
        take_profit: float,
    ) -> float:
        """
        Place an order with the broker.

        Args:
            direction: "LONG" or "SHORT"
            quantity: Number of units/contracts
            price: Desired entry price
            stop_loss: Stop loss price
            take_profit: Take profit price

        Returns:
            Actual fill price
        """
        ...

    @abstractmethod
    async def close_position(
        self,
        direction: str,
        quantity: float,
        price: float,
    ) -> float:
        """
        Close an open position.

        Returns:
            Actual fill price
        """
        ...

    @abstractmethod
    async def get_positions(self) -> list[Position]:
        """Get all open positions."""
        ...

    @abstractmethod
    async def get_account_balance(self) -> float:
        """Get current account balance."""
        ...

    @abstractmethod
    def is_connected(self) -> bool:
        """Check if broker connection is active."""
        ...
