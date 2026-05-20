"""OrderManager — wires Signal → PaperBroker, persists chart blobs and bot state."""

import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


class OrderManager:
    def __init__(self, *, broker, duckdb_store, discord, chart_generator, fetcher):
        self.broker = broker
        self.store = duckdb_store
        self.discord = discord
        self.chart_generator = chart_generator
        self.fetcher = fetcher

    async def execute_with_chart(self, *, signal, position, confidence: float, chart_png: bytes) -> str:
        """Open paper position, persist trade row including chart blob."""
        trade_id = self.broker.open_position(
            coin=signal.coin, direction=signal.direction, entry=signal.entry_price,
            quantity=position.quantity, stop_loss=signal.stop_loss,
            tp1=signal.tp1, tp2=signal.tp2,
            notional=position.notional, leverage=position.suggested_leverage,
            initial_margin=position.initial_margin, liquidation_price=position.liquidation_price,
            funding_rate_hr=position.funding_rate_hr,
        )

        self.store.insert_trade({
            "id": trade_id,
            "instrument": signal.coin,
            "direction": signal.direction,
            "entry_price": signal.entry_price,
            "stop_loss": signal.stop_loss,
            "take_profit": signal.tp2,
            "tp1_price": signal.tp1,
            "tp2_price": signal.tp2,
            "tp1_hit": False,
            "quantity": position.quantity,
            "status": "OPEN",
            "timestamp": signal.timestamp.isoformat(),
            "strategy_name": "golden_pocket",
            "confidence": confidence,
            "leverage": position.suggested_leverage,
            "notional": position.notional,
            "initial_margin": position.initial_margin,
            "liquidation_price": position.liquidation_price,
            "funding_rate_hr": position.funding_rate_hr,
            "swing_high": signal.swing_high,
            "swing_low": signal.swing_low,
            "fib_level_triggered": signal.fib_level_triggered,
            "trade_type": "paper",
            "chart_initial_png": chart_png,
        })

        self._update_bot_state()
        return trade_id

    async def check_open_trades(self) -> None:
        """Fetch current price for each coin with open trades, check exits, persist closures with chart."""
        open_trades = self.store.list_open_trades()
        coins_with_open = {t["instrument"] for t in open_trades}

        for coin in coins_with_open:
            try:
                df = self.fetcher.fetch_ohlcv(coin, "5m", limit=1)
            except Exception as e:
                logger.warning(f"check_open_trades fetch failed for {coin}: {e}")
                continue
            current_price = float(df["Close"].iloc[-1])

            closures = self.broker.check_exits(coin, current_price)
            for trade_id, reason, exit_price, pnl in closures:
                trade = self.store.get_trade(trade_id)

                if reason == "TP1_PARTIAL":
                    self.store.update_trade(trade_id, {
                        "tp1_hit": True,
                        "stop_loss": trade["entry_price"],
                    })
                    continue

                final_chart = await self._regenerate_chart_for_trade(trade, exit_price, reason)

                pnl_pct = (pnl / float(trade.get("initial_margin", 1.0))) * 100 if trade.get("initial_margin") else 0.0

                self.store.update_trade(trade_id, {
                    "status": "CLOSED",
                    "exit_price": exit_price,
                    "exit_reason": reason,
                    "pnl": pnl,
                    "chart_final_png": final_chart,
                })

                duration = self._format_duration(trade.get("timestamp"))
                await self.discord.send_close(
                    coin=trade["instrument"], direction=trade["direction"],
                    pnl=pnl, pnl_pct=pnl_pct, exit_reason=reason,
                    confidence_at_entry=float(trade.get("confidence", 0)),
                    duration_str=duration, png_bytes=final_chart or b"",
                )

        self._update_bot_state()

    async def _regenerate_chart_for_trade(self, trade: dict, exit_price: float, reason: str) -> bytes:
        from backend.strategy.golden_pocket import Signal
        import pandas as pd

        coin = trade["instrument"]
        try:
            df = self.fetcher.fetch_ohlcv(coin, "5m", limit=500)
        except Exception as e:
            logger.warning(f"chart regen fetch failed for {coin}: {e}")
            return b""

        sig = Signal(
            coin=coin, direction=trade["direction"],
            entry_price=float(trade["entry_price"]),
            stop_loss=float(trade["stop_loss"]),
            tp1=float(trade.get("tp1_price") or trade.get("take_profit", 0)),
            tp2=float(trade.get("tp2_price") or trade.get("take_profit", 0)),
            fib_level_triggered=float(trade.get("fib_level_triggered") or 0.5),
            swing_high=float(trade.get("swing_high") or df["High"].max()),
            swing_low=float(trade.get("swing_low") or df["Low"].min()),
            atr=1.0,
            timestamp=pd.Timestamp(str(trade["timestamp"])),
        )

        confidence = float(trade.get("confidence", 0))
        return self.chart_generator.render(
            df=df, signal=sig, confidence=confidence,
            exit_price=exit_price, exit_timestamp=df.index[-1], exit_reason=reason,
        )

    def _update_bot_state(self) -> None:
        """Recompute and persist balance + win counts."""
        trades = self.store.list_all_trades()
        closed = [t for t in trades if t.get("status") == "CLOSED"]
        total_pnl = sum(float(t.get("pnl") or 0) for t in closed)
        wins = sum(1 for t in closed if float(t.get("pnl") or 0) > 0)

        self.store.update_bot_state({
            "balance": self.broker.balance,
            "initial_balance": self.broker.initial_balance,
            "total_trades": len(closed),
            "winning_trades": wins,
            "daily_pnl": total_pnl,
            "last_updated": datetime.now(timezone.utc).isoformat(),
        })

    @staticmethod
    def _format_duration(start_iso) -> str:
        if not start_iso:
            return "?"
        try:
            start = datetime.fromisoformat(str(start_iso).replace("Z", "+00:00"))
            delta = datetime.now(timezone.utc) - start
            mins = int(delta.total_seconds() // 60)
            return f"{mins // 60}h {mins % 60}m"
        except Exception:
            return "?"
