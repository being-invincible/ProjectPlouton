"""
Main Trading Bot Loop.

Orchestrates:
1. Initialize DuckDB store (sole data layer)
2. Connect to broker
3. Fetch multi-timeframe market data
4. Run strategy analysis with MTF gating
5. Execute trades via risk manager -> order manager
6. Monitor open trades for SL/TP
7. Sleep until next candle
"""

import asyncio
import logging
import sys
import os
from datetime import datetime, timezone

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import settings
from data.market_data import MarketDataFetcher
from strategy.fibonacci import FibonacciRetracement
from engine.signal_generator import SignalGenerator
from engine.risk_manager import RiskManager
from engine.order_manager import OrderManager
from broker.paper_broker import PaperBroker

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("TradingBot")


def _local_now() -> str:
    """Return the current time in the user's configured timezone."""
    return datetime.now(settings.tz_info).strftime("%Y-%m-%d %H:%M:%S %Z")


class TradingBot:
    """Main trading bot that orchestrates the entire pipeline."""

    def __init__(self):
        self.running = False
        self.data_fetcher: MarketDataFetcher | None = None
        self.signal_generator: SignalGenerator | None = None
        self.risk_manager: RiskManager | None = None
        self.order_manager: OrderManager | None = None
        self.broker: PaperBroker | None = None
        self._last_candle_time: str | None = None  # Stale data detection
        self._duckdb_store = None  # DuckDB analytics store (optional)
        self._force_market_open = settings.force_market_open
        self._trading_mode = settings.trading_mode

    async def initialize(self) -> None:
        """Initialize all components — DuckDB is the sole data layer."""
        logger.info("Initializing Trading Bot...")
        logger.info(
            f"Local timezone: {settings.timezone} | "
            f"Local time: {_local_now()}"
        )

        # Initialize DuckDB store (required)
        from data.duckdb_store import DuckDBStore
        db_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "data", "tradingbot.duckdb"
        )
        self._duckdb_store = DuckDBStore(db_path)
        logger.info(f"DuckDB store initialized: {db_path}")

        # Seed runtime flags so UI and bot start in the same mode.
        self._duckdb_store.update_bot_state({
            "force_market_open": bool(settings.force_market_open),
            "trading_mode": settings.trading_mode,
        })

        # Load strategy config from DuckDB
        strategy_params = self._load_strategy_params()

        # Initialize components — all wired to DuckDB
        self.data_fetcher = MarketDataFetcher(
            instrument=settings.instrument,
            timeframe=settings.timeframe,
        )

        strategy = FibonacciRetracement(params=strategy_params)

        self.signal_generator = SignalGenerator(
            strategy=strategy,
            instrument=settings.instrument,
            duckdb_store=self._duckdb_store,
        )

        self.risk_manager = RiskManager(
            params=strategy_params,
            duckdb_store=self._duckdb_store,
        )

        self.broker = PaperBroker(
            initial_balance=settings.paper_balance,
        )
        await self.broker.connect()

        self.order_manager = OrderManager(
            broker=self.broker,
            duckdb_store=self._duckdb_store,
        )

        # Update bot state
        self._update_bot_state("RUNNING")

        # Log market hours in user's timezone
        market_info = MarketDataFetcher.get_market_hours_display(
            force_market_open=self._force_market_open,
        )
        logger.info(
            f"Bot initialized | "
            f"Instrument: {settings.instrument} | "
            f"Strategy: {strategy.display_name()} | "
            f"Timeframe: {settings.timeframe} | "
            f"Balance: ${settings.paper_balance:.2f}"
        )
        logger.info(
            f"Market status: {'OPEN' if market_info['is_open'] else 'CLOSED'} | "
            f"Exchange time: {market_info['exchange_time']} | "
            f"Your time: {market_info['user_time']} | "
            f"{market_info['next_event']}"
        )
        if settings.force_market_open:
            logger.info(
                "FORCE_MARKET_OPEN=true -- bot will trade even when market is closed "
                "(using cached/delayed data)"
            )

    async def run(self) -> None:
        """Main bot loop."""
        self.running = True
        sleep_seconds = self._timeframe_to_seconds(settings.timeframe)

        logger.info(
            f"Bot loop started | "
            f"Cycle interval: {sleep_seconds}s ({settings.timeframe})"
        )

        while self.running:
            self._sync_runtime_settings()
            self._touch_heartbeat()

            # Check if market is open before running a cycle
            if not MarketDataFetcher.is_market_open(
                force_market_open=self._force_market_open,
            ):
                market_info = MarketDataFetcher.get_market_hours_display(
                    force_market_open=self._force_market_open,
                )
                logger.info(
                    f"Market is closed (CME Gold Futures). "
                    f"Exchange time: {market_info['exchange_time']} | "
                    f"Your time ({settings.timezone}): {market_info['user_time']}. "
                    f"Sleeping 5 minutes before re-checking..."
                )
                self._update_bot_state("WAITING", error_message="Market closed")
                await asyncio.sleep(300)  # Check every 5 min
                continue

            try:
                await self._cycle()
            except KeyboardInterrupt:
                logger.info("Bot stopped by user")
                break
            except Exception as e:
                logger.error(f"Bot cycle error: {e}", exc_info=True)
                self._update_bot_state("ERROR", error_message=str(e))

            # Sleep until next candle
            logger.debug(f"Sleeping {sleep_seconds}s until next cycle...")
            await asyncio.sleep(sleep_seconds)

        await self.shutdown()

    async def _cycle(self) -> None:
        """
        Single bot cycle: MTF fetch → DuckDB store → trend analysis → trade.

        Pipeline:
        1. Fetch 5m/15m/1h candles (deep history)
        2. Store ALL timeframes to DuckDB
        3. Store 5m to PocketBase (for UI chart)
        4. Compute MTF trend via DuckDB SQL (VMA slope stacking)
        5. Only run strategy if MTF trends are stacked
        6. Execute trade if signal passes risk manager
        """
        cycle_time = _local_now()
        logger.info(f"--- Cycle start: {cycle_time} ---")

        # Reload strategy params (picks up Settings page changes)
        strategy_params = self._load_strategy_params()
        self.signal_generator.update_strategy_params(strategy_params)
        self.risk_manager.update_params(strategy_params)

        # ── Step 1: Fetch multi-timeframe data ───────────────────
        logger.info(f"Fetching MTF data for {settings.instrument}...")
        try:
            mtf_data = self.data_fetcher.fetch_multi_timeframe()
        except Exception as e:
            logger.warning(f"MTF fetch failed: {e}")
            return

        if not mtf_data:
            logger.warning("No MTF data received, skipping cycle")
            return

        # Get the execution timeframe (5m)
        df = mtf_data.get(settings.timeframe)
        if df is None or df.empty:
            logger.warning(f"No {settings.timeframe} data, skipping cycle")
            return

        current_price = float(df["Close"].iloc[-1])
        latest_time = self.data_fetcher.get_latest_candle_time(df)
        logger.info(
            f"{settings.instrument} | "
            f"Price: ${current_price:.2f} | "
            f"5m: {len(mtf_data.get('5m', []))} candles | "
            f"15m: {len(mtf_data.get('15m', []))} candles | "
            f"1h: {len(mtf_data.get('1h', []))} candles | "
            f"Latest: {latest_time}"
        )

        # ── Step 2: Store ALL timeframes to DuckDB ───────────────
        mtf_trend = None
        if self._duckdb_store:
            for tf, tf_df in mtf_data.items():
                try:
                    self._duckdb_store.store_candles(
                        tf_df,
                        instrument=settings.instrument,
                        timeframe=tf,
                        asset_class="futures",
                    )
                except Exception as e:
                    logger.warning(f"DuckDB store failed for {tf}: {e}")

            # ── Step 3: Compute MTF trend via DuckDB SQL ─────────
            try:
                mtf_trend = self._duckdb_store.compute_mtf_trend(
                    instrument=settings.instrument,
                )
                logger.info(
                    f"MTF Analysis | "
                    f"1h: {mtf_trend.get('1h', {}).get('trend', '?')} "
                    f"(slope={mtf_trend.get('1h', {}).get('slope', 0):.4f}%) | "
                    f"15m: {mtf_trend.get('15m', {}).get('trend', '?')} "
                    f"(slope={mtf_trend.get('15m', {}).get('slope', 0):.4f}%) | "
                    f"5m: {mtf_trend.get('5m', {}).get('trend', '?')} "
                    f"(slope={mtf_trend.get('5m', {}).get('slope', 0):.4f}%) | "
                    f"Stacked: {mtf_trend.get('stacked', False)} | "
                    f"Direction: {mtf_trend.get('direction', 'MIXED')}"
                )
            except Exception as e:
                logger.warning(f"MTF trend computation failed: {e}")

            # Compute and store indicators for all TFs
            for tf in mtf_data:
                try:
                    self._duckdb_store.compute_and_store_indicators(
                        instrument=settings.instrument,
                        timeframe=tf,
                    )
                except Exception as e:
                    logger.warning(f"Indicator computation failed for {tf}: {e}")

        # No more PocketBase writes — DuckDB has everything

        # -- Stale data detection --
        if latest_time == self._last_candle_time:
            logger.info(
                "Data hasn't changed since last cycle "
                "(market may be closed or yfinance caching). "
                "Skipping analysis."
            )
            self._update_bot_state("RUNNING")
            return
        self._last_candle_time = latest_time

        # Check open trades for SL/TP hits
        await self.order_manager.check_and_close_trades(current_price)

        # Update paper broker positions
        self.broker.update_positions(current_price)

        # ── Step 5: Run strategy analysis with MTF gate ──────────
        signal = self.signal_generator.process(df, mtf_trend=mtf_trend)

        if signal:
            # Validate through risk manager
            validated = self.risk_manager.validate(signal)

            if validated:
                # Execute the trade
                trade_id = await self.order_manager.execute(validated)
                if trade_id:
                    logger.info(f"Trade executed: {trade_id}")
            else:
                logger.info("Signal rejected by risk manager")

        # Update bot state timestamp
        self._update_bot_state("RUNNING")

    async def shutdown(self) -> None:
        """Clean shutdown."""
        self.running = False
        logger.info("Shutting down bot...")

        if self.broker:
            await self.broker.disconnect()

        if self._duckdb_store:
            self._duckdb_store.close()
            logger.info("DuckDB store closed")

        self._touch_heartbeat()
        self._update_bot_state("STOPPED")
        logger.info("Bot stopped")

    def _sync_runtime_settings(self) -> None:
        """Apply runtime-modifiable settings from DuckDB bot_state."""
        if not self._duckdb_store:
            return

        try:
            state = self._duckdb_store.get_bot_state() or {}
        except Exception:
            return

        runtime_instrument = state.get("instrument") or settings.instrument
        self._force_market_open = bool(state.get("force_market_open", settings.force_market_open))
        self._trading_mode = str(state.get("trading_mode", settings.trading_mode)).lower()

        if self._trading_mode == "live":
            logger.warning("LIVE mode selected in settings, but only paper broker is implemented; continuing in paper execution")

        if self.data_fetcher and self.data_fetcher.instrument != runtime_instrument:
            logger.info(f"Instrument switched: {self.data_fetcher.instrument} -> {runtime_instrument}")
            self.data_fetcher.instrument = runtime_instrument

        if self.signal_generator and self.signal_generator.instrument != runtime_instrument:
            self.signal_generator.instrument = runtime_instrument

    def _touch_heartbeat(self) -> None:
        if not self._duckdb_store:
            return
        try:
            self._duckdb_store.update_bot_state({
                "last_heartbeat": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass

    def _load_strategy_params(self) -> dict:
        """Load strategy params from DuckDB, fall back to defaults."""
        if self._duckdb_store:
            try:
                config = self._duckdb_store.get_active_strategy()
                if config:
                    return config.get("params", {})
            except Exception as e:
                logger.warning(f"Using default params (DuckDB error: {e})")

        return FibonacciRetracement().get_default_params()

    def _update_bot_state(
        self,
        status: str,
        error_message: str = "",
    ) -> None:
        """Update bot state in DuckDB."""
        if not self._duckdb_store:
            return
        try:
            market_info = MarketDataFetcher.get_market_hours_display(
                force_market_open=self._force_market_open,
            )
            self._duckdb_store.update_bot_state({
                "status": status,
                "instrument": self.data_fetcher.instrument if self.data_fetcher else settings.instrument,
                "strategy": "fibonacci_retracement",
                "trading_mode": self._trading_mode,
                "balance": self.broker.balance if self.broker else settings.paper_balance,
                "initial_balance": settings.paper_balance,
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "last_heartbeat": datetime.now(timezone.utc).isoformat(),
                "error_message": error_message,
                "force_market_open": self._force_market_open,
                "market_status": market_info.get("actual_open", False),
                "market_status_effective": market_info.get("is_open", False),
                "market_display": market_info.get("next_event", ""),
            })
        except Exception:
            pass  # Non-critical

    @staticmethod
    def _timeframe_to_seconds(timeframe: str) -> int:
        """Convert timeframe to seconds for sleep interval."""
        mapping = {
            "1m": 60, "5m": 300, "15m": 900,
            "30m": 1800, "1h": 3600, "1d": 86400,
        }
        return mapping.get(timeframe, 300)


async def main():
    """Entry point for the trading bot."""
    bot = TradingBot()
    try:
        await bot.initialize()
        await bot.run()
    except KeyboardInterrupt:
        await bot.shutdown()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        await bot.shutdown()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
