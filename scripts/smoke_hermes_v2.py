"""End-to-end smoke: one cycle for one coin (BTC), no Discord, verify trade + chart persistence."""

import asyncio
import os
import sys

sys.path.insert(0, ".")

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


async def main() -> None:
    db = "backend/data/tradingbot.duckdb"
    store = DuckDBStore(db)
    fetcher = HyperliquidFetcher()
    strategy = GoldenPocketStrategy()
    scorer = ConfidenceScorer()
    sizer = PositionSizer(risk_per_trade_pct=settings.risk_per_trade_pct)
    qf = QualityFilter(
        daily_loss_limit_pct=settings.daily_loss_limit_pct,
        max_open_trades=settings.max_open_trades,
        min_confidence_pct=0,  # smoke: accept any
    )
    chart_gen = ChartGenerator(width=1600, height=800)
    discord = DiscordNotifier(webhook_url="")  # silenced
    broker = PaperBroker(initial_balance=settings.paper_balance)
    await broker.connect()
    order_mgr = OrderManager(broker=broker, duckdb_store=store, discord=discord, chart_generator=chart_gen, fetcher=fetcher)

    scanner = CoinScanner(
        coin="BTC", fetcher=fetcher, strategy=strategy, confidence_scorer=scorer,
        position_sizer=sizer, chart_generator=chart_gen, discord=discord,
        duckdb_store=store, paper_broker=broker, order_manager=order_mgr, quality_filter=qf,
    )

    trade_id = await scanner.scan()
    if trade_id:
        print(f"Trade executed: {trade_id}")
        t = store.get_trade(trade_id)
        png_size = len(t.get("chart_initial_png") or b"")
        print(f"Chart initial PNG bytes: {png_size}")
        assert png_size > 1000, "chart was not stored"
        print("OK")
    else:
        print("No signal this cycle — that's normal. Smoke ran without errors.")

    await broker.disconnect()
    store.close()


if __name__ == "__main__":
    asyncio.run(main())
