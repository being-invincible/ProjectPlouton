"""Per-coin async scanner — runs the full pipeline once."""

import logging
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)


class CoinScanner:
    def __init__(
        self,
        coin: str,
        fetcher,
        strategy,
        confidence_scorer,
        position_sizer,
        chart_generator,
        discord,
        duckdb_store,
        paper_broker,
        order_manager,
        quality_filter,
    ):
        self.coin = coin
        self.fetcher = fetcher
        self.strategy = strategy
        self.confidence_scorer = confidence_scorer
        self.position_sizer = position_sizer
        self.chart_generator = chart_generator
        self.discord = discord
        self.duckdb_store = duckdb_store
        self.paper_broker = paper_broker
        self.order_manager = order_manager
        self.quality_filter = quality_filter

    async def scan(self) -> Optional[str]:
        """One pipeline pass. Returns trade_id if a trade executed, else None."""
        # 1. Fetch MTF
        try:
            mtf_data = self.fetcher.fetch_multi_timeframe(self.coin)
        except Exception as e:
            logger.warning(f"[{self.coin}] fetch failed: {e}")
            return None
        if not mtf_data or settings.execution_tf_default not in mtf_data:
            return None

        # 2. Store all TFs to DuckDB
        for tf, tf_df in mtf_data.items():
            try:
                self.duckdb_store.store_candles(tf_df, instrument=self.coin, timeframe=tf, asset_class="crypto")
            except Exception as e:
                logger.warning(f"[{self.coin}] store {tf} failed: {e}")

        # 3. Compute MTF trend via DuckDB
        try:
            mtf_trend = self.duckdb_store.compute_mtf_trend(instrument=self.coin)
        except Exception as e:
            logger.warning(f"[{self.coin}] mtf trend failed: {e}")
            return None

        # 4. Choose execution TF (15m if 1h slope strong)
        exec_tf = settings.execution_tf_default
        slope_1h = abs(mtf_trend.get("1h", {}).get("slope", 0))
        if slope_1h >= 0.005:
            exec_tf = "15m"

        exec_df = mtf_data.get(exec_tf)
        if exec_df is None or len(exec_df) < 50:
            return None

        # 5. Analyse
        signal = self.strategy.analyze(exec_df, mtf_trend=mtf_trend, coin=self.coin)
        if signal is None:
            return None

        # 6. Score confidence
        confidence = self.confidence_scorer.score(signal=signal, df=exec_df, mtf_trend=mtf_trend)

        # 7. Position sizing (must happen before quality check to know margin)
        open_trades = self.duckdb_store.count_open_trades()
        bot_state = self.duckdb_store.get_bot_state() or {}
        balance = float(bot_state.get("balance", settings.paper_balance))
        daily_pnl = float(bot_state.get("daily_pnl", 0.0))
        max_lev = self.fetcher.get_max_leverage(self.coin)
        funding = self.fetcher.fetch_funding_rate(self.coin)
        position = self.position_sizer.size(
            balance=balance, entry=signal.entry_price, stop_loss=signal.stop_loss,
            direction=signal.direction, max_leverage_for_coin=max_lev, funding_rate_hr=funding,
        )

        # 8. Quality gate (now includes margin check)
        if not self.quality_filter.accept(
            open_trades_count=open_trades, daily_pnl=daily_pnl, balance=balance,
            confidence=confidence, position_margin=position.initial_margin,
        ):
            logger.info(
                f"[{self.coin}] signal rejected by quality filter "
                f"(confidence={confidence:.1f}, margin_needed=${position.initial_margin:.2f}, balance=${balance:.2f})"
            )
            return None

        # 9. Chart PNG
        try:
            png = self.chart_generator.render(df=exec_df, signal=signal, confidence=confidence)
        except Exception as e:
            logger.warning(f"[{self.coin}] chart render failed: {e}")
            png = b""

        # 10. Execute paper trade with chart
        trade_id = await self.order_manager.execute_with_chart(signal=signal, position=position, confidence=confidence, chart_png=png)

        # 11. Discord
        mtf_summary = (
            f"1h {'↑' if mtf_trend['1h']['trend']=='UP' else '↓'} {mtf_trend['1h']['trend']} "
            f"(slope {mtf_trend['1h']['slope']*100:.2f}%) · "
            f"15m {'↑' if mtf_trend['15m']['trend']=='UP' else '↓'} {mtf_trend['15m']['trend']} · "
            f"{exec_tf} in golden pocket"
        )
        strategy_summary = f"Swing high ${signal.swing_high:.4f} → low ${signal.swing_low:.4f} · ATR {signal.atr:.4f}"
        await self.discord.send_signal(
            signal=signal, position=position, confidence=confidence, balance=balance,
            mtf_summary=mtf_summary, strategy_summary=strategy_summary, png_bytes=png,
        )
        return trade_id
