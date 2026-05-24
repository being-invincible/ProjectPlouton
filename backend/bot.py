"""Plouton main bot loop — async 10-coin crypto scanner."""

import asyncio
import logging
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.config import settings
from backend.data.duckdb_store import DuckDBStore
from backend.data.hyperliquid_fetcher import HyperliquidFetcher
from backend.data.hyperliquid_ws import HyperliquidWebSocket
from backend.strategy.golden_pocket import GoldenPocketStrategy
from backend.strategy.smc import SMCStrategy
from backend.strategy.fib_golden_zone import FibGoldenZoneStrategy
from backend.engine.confidence_scorer import ConfidenceScorer
from backend.engine.position_sizer import PositionSizer
from backend.engine.quality_filter import QualityFilter
from backend.engine.order_manager import OrderManager
from backend.broker.paper_broker import PaperBroker
from backend.notifications.chart_generator import ChartGenerator
from backend.notifications.discord_notifier import DiscordNotifier
from backend.scanner.coin_scanner import CoinScanner
from backend.scanner.async_runner import AsyncRunner

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
# Show per-coin filter reasons from the strategy
logging.getLogger("backend.strategy.golden_pocket").setLevel(logging.DEBUG)
logger = logging.getLogger("Plouton")


class TradingBot:
    """Plouton trading bot — wraps the async scanner loop."""

    def __init__(self):
        self._duckdb_store: DuckDBStore | None = None
        self._broker: PaperBroker | None = None
        self._order_mgr: OrderManager | None = None
        self._runner: AsyncRunner | None = None
        self._ws: HyperliquidWebSocket | None = None

    async def initialize(self) -> None:
        db_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "data", "tradingbot.duckdb"
        )
        self._duckdb_store = DuckDBStore(db_path)

        fetcher = HyperliquidFetcher()

        # WebSocket: start it, seed buffers from a single REST snapshot, then
        # subsequent reads come from the live in-memory buffer (tick-by-tick).
        self._ws = HyperliquidWebSocket(coins=settings.coins, timeframes=["1m", "5m", "15m", "1h", "4h"])
        fetcher.attach_ws(self._ws)
        await self._ws.start()
        ws_ready = await self._ws.wait_connected(timeout=15)
        if ws_ready:
            logger.info("Hyperliquid WS live — seeding buffers from REST in background")
            asyncio.create_task(self._seed_ws_buffers(fetcher), name="ws-seed")
        else:
            logger.warning("Hyperliquid WS did not connect in 15s — falling back to REST polling")

        if settings.strategy_name == "smc":
            strategy = SMCStrategy()
            logging.getLogger("backend.strategy.smc").setLevel(logging.DEBUG)
            logger.info("Strategy: SMC (BOS/CHoCH + FVG/OB + Liquidity)")
        elif settings.strategy_name in ("fibgz", "fib_golden_zone"):
            strategy = FibGoldenZoneStrategy()
            logging.getLogger("backend.strategy.fib_golden_zone").setLevel(logging.DEBUG)
            logger.info("Strategy: Fib Golden Zone (fractal swings + EMA/swap confluence + engulfing)")
        else:
            strategy = GoldenPocketStrategy()
            logger.info("Strategy: Golden Pocket (Fibonacci retracement)")
        scorer = ConfidenceScorer()
        sizer = PositionSizer(risk_per_trade_pct=settings.risk_per_trade_pct)
        qf = QualityFilter(
            daily_loss_limit_pct=settings.daily_loss_limit_pct,
            max_open_trades=settings.max_open_trades,
            min_confidence_pct=settings.min_confidence_pct,
        )
        chart_gen = ChartGenerator(width=settings.chart_width_px, height=settings.chart_height_px)
        discord = DiscordNotifier(webhook_url=settings.discord_webhook_url)

        # Use DB-persisted balance if available so dashboard settings survive restarts.
        # Fall back to settings.paper_balance only on a fresh install (no DB record yet).
        saved_state = self._duckdb_store.get_bot_state() or {}
        saved_balance = float(saved_state.get("balance") or 0) or settings.paper_balance

        self._broker = PaperBroker(initial_balance=saved_balance)
        await self._broker.connect()

        open_trades = self._duckdb_store.list_open_trades()
        self._broker.rehydrate(open_trades)
        if open_trades:
            logger.info(f"Restored {len(open_trades)} open position(s) from previous session")

        self._order_mgr = OrderManager(
            broker=self._broker,
            duckdb_store=self._duckdb_store,
            discord=discord,
            chart_generator=chart_gen,
            fetcher=fetcher,
        )

        scanners = [
            CoinScanner(
                coin=coin, fetcher=fetcher, strategy=strategy,
                confidence_scorer=scorer, position_sizer=sizer, chart_generator=chart_gen,
                discord=discord, duckdb_store=self._duckdb_store, paper_broker=self._broker,
                order_manager=self._order_mgr, quality_filter=qf,
            )
            for coin in settings.coins
        ]
        self._runner = AsyncRunner(scanners)

        if open_trades:
            await self._order_mgr.backfill_missed_exits()

        startup_update = {
            "status": "RUNNING",
            "trading_mode": "paper",
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
        # Preserve initial_balance if already set; only write it on first-ever run.
        if not float(saved_state.get("initial_balance") or 0):
            startup_update["initial_balance"] = saved_balance
        self._duckdb_store.update_bot_state(startup_update)
        logger.info(f"Plouton initialized — coins: {', '.join(settings.coins)}")

    async def _seed_ws_buffers(self, fetcher) -> None:
        """Backfill the WS rolling buffer with REST snapshots, off the event loop."""
        import pandas as _pd

        def _fetch(coin: str, tf: str):
            try:
                return fetcher._exchange.fetch_ohlcv(
                    fetcher._to_ccxt_symbol(coin), timeframe=tf, limit=500
                )
            except Exception as exc:
                logger.warning(f"WS seed REST failed for {coin}/{tf}: {exc}")
                return None

        for coin in settings.coins:
            for tf in ["1m", "5m", "15m", "1h", "4h"]:
                rows = await asyncio.to_thread(_fetch, coin, tf)
                if not rows:
                    continue
                df = _pd.DataFrame(rows, columns=["ts_ms", "Open", "High", "Low", "Close", "Volume"])
                df["Timestamp"] = _pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
                df = df.set_index("Timestamp").drop(columns=["ts_ms"])
                if self._ws:
                    self._ws.seed_buffer(coin, tf, df)
        logger.info("WS buffers seeded for all coins/timeframes")

    async def _heartbeat_loop(self) -> None:
        """Write heartbeat every 30s so the UI recovers quickly after macOS sleep."""
        while True:
            await asyncio.sleep(30)
            if self._duckdb_store:
                try:
                    self._duckdb_store.update_bot_state({
                        "last_heartbeat": datetime.now(timezone.utc).isoformat()
                    })
                except Exception:
                    pass

    async def run(self) -> None:
        if self._duckdb_store is None or self._runner is None:
            raise RuntimeError("Call initialize() before run()")
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        try:
            while True:
                cycle_start = datetime.now(timezone.utc)
                logger.info(f"--- cycle start {cycle_start.isoformat()} ---")

                await self._order_mgr.check_open_trades()

                trade_ids = await self._runner.run_one_cycle()
                if trade_ids:
                    logger.info(f"executed {len(trade_ids)} trades this cycle: {trade_ids}")

                await asyncio.sleep(300)
        except KeyboardInterrupt:
            logger.info("Stopped by user")
        finally:
            heartbeat_task.cancel()
            if self._ws:
                await self._ws.stop()
            if self._broker:
                await self._broker.disconnect()
            if self._duckdb_store:
                self._duckdb_store.update_bot_state({"status": "STOPPED"})
                self._duckdb_store.close()


async def main() -> None:
    bot = TradingBot()
    await bot.initialize()
    await bot.run()


if __name__ == "__main__":
    asyncio.run(main())
