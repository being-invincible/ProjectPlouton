"""
Risk Manager — validates signals against risk rules before execution.

Controls:
- Position sizing based on account balance and risk percentage
- Maximum open positions
- Daily loss limits
- Stop loss and take profit validation
"""

import logging
from dataclasses import dataclass
from typing import Optional

from strategy.base import Signal

logger = logging.getLogger(__name__)


@dataclass
class ValidatedOrder:
    """A signal that has passed risk validation, ready for execution."""

    signal: Signal
    quantity: float         # Position size (number of contracts/units)
    risk_amount: float      # Dollar amount at risk
    account_balance: float  # Balance at time of validation


class RiskManager:
    """Validates trading signals against risk management rules."""

    def __init__(self, params: dict | None = None, duckdb_store=None):
        p = params or {}
        self.risk_per_trade_pct: float = p.get("risk_per_trade_pct", 1.0)
        self.max_open_positions: int = p.get("max_open_positions", 3)
        self.max_daily_loss_pct: float = p.get("max_daily_loss_pct", 5.0)
        self._db = duckdb_store

    def validate(self, signal: Signal) -> Optional[ValidatedOrder]:
        """
        Validate a signal against risk rules.

        Returns:
            ValidatedOrder if approved, None if rejected
        """
        # Get current bot state from DuckDB
        bot_state = self._get_bot_state()
        if bot_state is None:
            logger.error("Cannot validate: bot state not found")
            return None

        balance = bot_state.get("balance") or 0
        initial_balance = bot_state.get("initial_balance") or 500
        daily_pnl = bot_state.get("daily_pnl") or 0

        # Check 1: Max open positions
        open_trades = self._count_open_trades()
        if open_trades >= self.max_open_positions:
            logger.warning(
                f"Rejected: {open_trades} open positions "
                f"(max: {self.max_open_positions})"
            )
            return None

        # Check 2: Daily loss limit
        max_daily_loss = initial_balance * (self.max_daily_loss_pct / 100)
        if daily_pnl < 0 and abs(daily_pnl) >= max_daily_loss:
            logger.warning(
                f"Rejected: daily loss ${abs(daily_pnl):.2f} "
                f"exceeds limit ${max_daily_loss:.2f}"
            )
            return None

        # Check 3: Stop loss sanity
        risk_per_unit = abs(signal.entry_price - signal.stop_loss)
        if risk_per_unit <= 0:
            logger.warning("Rejected: invalid stop loss (zero risk)")
            return None

        # Check 4: Calculate position size
        risk_amount = balance * (self.risk_per_trade_pct / 100)
        quantity = risk_amount / risk_per_unit

        # Ensure minimum viable quantity
        if quantity < 0.001:
            logger.warning(
                f"Rejected: calculated quantity too small ({quantity:.6f})"
            )
            return None

        # Round to reasonable precision
        quantity = round(quantity, 4)

        logger.info(
            f"Risk approved: {signal.direction} {quantity} units | "
            f"Risk: ${risk_amount:.2f} ({self.risk_per_trade_pct}%) | "
            f"SL: {signal.stop_loss:.2f} | TP: {signal.take_profit:.2f}"
        )

        return ValidatedOrder(
            signal=signal,
            quantity=quantity,
            risk_amount=risk_amount,
            account_balance=balance,
        )

    def _get_bot_state(self) -> Optional[dict]:
        """Fetch current bot state from DuckDB."""
        if not self._db:
            return None
        try:
            return self._db.get_bot_state()
        except Exception as e:
            logger.error(f"Failed to fetch bot state: {e}")
            return None

    def _count_open_trades(self) -> int:
        """Count currently open trades."""
        if not self._db:
            return 0
        try:
            return self._db.count_open_trades()
        except Exception as e:
            logger.error(f"Failed to count open trades: {e}")
            return 0

    def update_params(self, params: dict) -> None:
        """Hot-reload risk parameters."""
        self.risk_per_trade_pct = params.get(
            "risk_per_trade_pct", self.risk_per_trade_pct
        )
        self.max_open_positions = params.get(
            "max_open_positions", self.max_open_positions
        )
        self.max_daily_loss_pct = params.get(
            "max_daily_loss_pct", self.max_daily_loss_pct
        )
        logger.info("Risk manager params reloaded")
