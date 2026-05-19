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
from backend.strategy.golden_pocket import GoldenPocketStrategy
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
logger = logging.getLogger("Plouton")


async def main() -> None:
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "tradingbot.duckdb")
    store = DuckDBStore(db_path)

    fetcher = HyperliquidFetcher()
    strategy = GoldenPocketStrategy()
    scorer = ConfidenceScorer()
    sizer = PositionSizer(risk_per_trade_pct=settings.risk_per_trade_pct)
    qf = QualityFilter(
        daily_loss_limit_pct=settings.daily_loss_limit_pct,
        max_open_trades=settings.max_open_trades,
        min_confidence_pct=settings.min_confidence_pct,
    )
    chart_gen = ChartGenerator(width=settings.chart_width_px, height=settings.chart_height_px)
    discord = DiscordNotifier(webhook_url=settings.discord_webhook_url)

    broker = PaperBroker(initial_balance=settings.paper_balance)
    await broker.connect()
    order_mgr = OrderManager(broker=broker, duckdb_store=store, discord=discord, chart_generator=chart_gen, fetcher=fetcher)

    scanners = [
        CoinScanner(
            coin=coin, fetcher=fetcher, strategy=strategy,
            confidence_scorer=scorer, position_sizer=sizer, chart_generator=chart_gen,
            discord=discord, duckdb_store=store, paper_broker=broker,
            order_manager=order_mgr, quality_filter=qf,
        )
        for coin in settings.coins
    ]
    runner = AsyncRunner(scanners)

    store.update_bot_state({
        "status": "RUNNING",
        "trading_mode": "paper",
        "initial_balance": settings.paper_balance,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    })

    logger.info(f"Plouton started — coins: {', '.join(settings.coins)}")

    try:
        while True:
            cycle_start = datetime.now(timezone.utc)
            logger.info(f"--- cycle start {cycle_start.isoformat()} ---")

            await order_mgr.check_open_trades()

            trade_ids = await runner.run_one_cycle()
            if trade_ids:
                logger.info(f"executed {len(trade_ids)} trades this cycle: {trade_ids}")

            store.update_bot_state({"last_heartbeat": datetime.now(timezone.utc).isoformat()})

            await asyncio.sleep(300)
    except KeyboardInterrupt:
        logger.info("Stopped by user")
    finally:
        await broker.disconnect()
        store.update_bot_state({"status": "STOPPED"})
        store.close()


if __name__ == "__main__":
    asyncio.run(main())
