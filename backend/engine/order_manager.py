"""
Order Manager — executes validated orders through the broker adapter.

Handles:
- Placing orders via the broker interface
- Recording trades in DuckDB
- Updating bot state (balance, trade counts)
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from strategy.base import Signal
from engine.risk_manager import ValidatedOrder
from broker.base import Broker

logger = logging.getLogger(__name__)


class OrderManager:
    """Manages order execution and trade recording."""

    def __init__(self, broker: Broker, duckdb_store=None):
        self.broker = broker
        self._db = duckdb_store

    async def execute(self, order: ValidatedOrder) -> Optional[str]:
        """
        Execute a validated order through the broker.

        Returns:
            Trade record ID if successful, None if failed
        """
        signal = order.signal

        try:
            # Place order with broker
            fill_price = await self.broker.place_order(
                direction=signal.direction,
                quantity=order.quantity,
                price=signal.entry_price,
                stop_loss=signal.stop_loss,
                take_profit=signal.take_profit,
            )

            # Record the trade in DuckDB
            trade_id = "unknown"
            if self._db:
                trade_id = self._db.create_trade({
                    "timestamp": signal.timestamp,
                    "instrument": signal.instrument,
                    "direction": signal.direction,
                    "entry_price": fill_price,
                    "quantity": order.quantity,
                    "stop_loss": signal.stop_loss,
                    "take_profit": signal.take_profit,
                    "status": "OPEN",
                    "strategy_name": signal.strategy,
                })

                # Update bot state
                self._update_bot_state_trade_opened()

            logger.info(
                f"Trade opened: {signal.direction} {order.quantity} "
                f"@ {fill_price:.2f} | ID: {trade_id}"
            )
            return trade_id

        except Exception as e:
            logger.error(f"Failed to execute order: {e}")
            return None

    async def check_and_close_trades(self, current_price: float) -> None:
        """
        Check all open trades for stop loss or take profit hits.
        """
        if not self._db:
            return

        try:
            open_trades = self._db.get_open_trades()
        except Exception as e:
            logger.error(f"Failed to fetch open trades: {e}")
            return

        for trade in open_trades:
            direction = trade["direction"]
            stop_loss = trade["stop_loss"]
            take_profit = trade["take_profit"]

            exit_reason = None

            if direction == "LONG":
                if current_price <= stop_loss:
                    exit_reason = "SL_HIT"
                elif current_price >= take_profit:
                    exit_reason = "TP_HIT"
            else:  # SHORT
                if current_price >= stop_loss:
                    exit_reason = "SL_HIT"
                elif current_price <= take_profit:
                    exit_reason = "TP_HIT"

            if exit_reason:
                await self._close_trade(trade, current_price, exit_reason)

    async def _close_trade(
        self,
        trade: dict,
        exit_price: float,
        exit_reason: str,
    ) -> None:
        """Close an open trade and update records."""
        entry_price = trade["entry_price"]
        quantity = trade["quantity"]
        direction = trade["direction"]

        # Calculate P&L
        if direction == "LONG":
            pnl = (exit_price - entry_price) * quantity
        else:
            pnl = (entry_price - exit_price) * quantity

        now = datetime.now(timezone.utc).isoformat()

        try:
            # Update trade record in DuckDB
            if self._db:
                self._db.update_trade(trade["id"], {
                    "exit_price": exit_price,
                    "pnl": round(pnl, 2),
                    "status": "CLOSED",
                    "exit_timestamp": now,
                    "exit_reason": exit_reason,
                })

                # Update bot state
                self._update_bot_state_trade_closed(pnl)

            # Close position with broker
            await self.broker.close_position(
                direction=direction,
                quantity=quantity,
                price=exit_price,
            )

            result = "WIN" if pnl >= 0 else "LOSS"
            logger.info(
                f"[{result}] Trade closed ({exit_reason}): "
                f"{direction} @ {exit_price:.2f} | "
                f"P&L: ${pnl:+.2f}"
            )

        except Exception as e:
            logger.error(f"Failed to close trade {trade['id']}: {e}")

    def _update_bot_state_trade_opened(self) -> None:
        """Increment total_trades counter in bot state."""
        if not self._db:
            return
        try:
            state = self._db.get_bot_state()
            if state:
                self._db.update_bot_state({
                    "total_trades": (state.get("total_trades") or 0) + 1,
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            logger.warning(f"Failed to update bot state: {e}")

    def _update_bot_state_trade_closed(self, pnl: float) -> None:
        """Update balance and stats after trade closure."""
        if not self._db:
            return
        try:
            state = self._db.get_bot_state()
            if state:
                new_balance = (state.get("balance") or 0) + pnl
                winning = state.get("winning_trades") or 0
                if pnl > 0:
                    winning += 1

                self._db.update_bot_state({
                    "balance": round(new_balance, 2),
                    "daily_pnl": round(
                        (state.get("daily_pnl") or 0) + pnl, 2
                    ),
                    "winning_trades": winning,
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            logger.warning(f"Failed to update bot state: {e}")
