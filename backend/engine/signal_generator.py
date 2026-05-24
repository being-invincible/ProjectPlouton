"""
Signal Generator — orchestrates indicator calculation and signal emission.

Connects the strategy engine to the order pipeline:
    MTF Check → Strategy.analyze(df) → Signal → Risk Manager → Order Manager

The MTF (Multi-Timeframe) gate ensures signals are only emitted when
the macro trend (1h anchor, 15m confirmation) aligns with the execution
timeframe (5m). This eliminates counter-trend trades.
"""

import logging
from typing import Optional

import pandas as pd

from strategy.base import Strategy, Signal

logger = logging.getLogger(__name__)


class SignalGenerator:
    """Orchestrates strategy analysis with MTF trend gating."""

    def __init__(self, strategy: Strategy, instrument: str = "", duckdb_store=None):
        self.strategy = strategy
        self.instrument = instrument
        self._db = duckdb_store
        self._last_mtf_trend: dict | None = None

    def process(
        self,
        df: pd.DataFrame,
        mtf_trend: dict | None = None,
    ) -> Optional[Signal]:
        """
        Run the strategy on the latest market data, gated by MTF trend.

        Args:
            df: OHLCV DataFrame (execution timeframe)
            mtf_trend: Multi-timeframe trend data from DuckDB.

        Returns:
            Signal if the strategy triggers AND MTF agrees, else None
        """
        df.attrs["instrument"] = self.instrument

        # ── MTF Gate ─────────────────────────────────────────────
        if mtf_trend:
            self._last_mtf_trend = mtf_trend
            stacked = mtf_trend.get("stacked", False)
            direction = mtf_trend.get("direction", "MIXED")

            if not stacked:
                logger.info(
                    f"MTF gate: BLOCKED (trends not stacked) | "
                    f"1h={mtf_trend.get('1h', {}).get('trend', '?')} "
                    f"15m={mtf_trend.get('15m', {}).get('trend', '?')} "
                    f"5m={mtf_trend.get('5m', {}).get('trend', '?')}"
                )
                return None

            logger.info(
                f"MTF gate: PASS ({direction}) | "
                f"1h={mtf_trend.get('1h', {}).get('trend', '?')} "
                f"(slope={mtf_trend.get('1h', {}).get('slope', 0) * 100:.2f}%) "
                f"15m={mtf_trend.get('15m', {}).get('trend', '?')} "
                f"5m={mtf_trend.get('5m', {}).get('trend', '?')}"
            )

        # ── Strategy Analysis ────────────────────────────────────
        signal = self.strategy.analyze(df)

        if signal is not None:
            # If MTF is available, validate signal direction matches macro
            if mtf_trend and mtf_trend.get("stacked"):
                macro_dir = mtf_trend["direction"]
                if signal.direction == "LONG" and macro_dir == "DOWN":
                    logger.info("Signal LONG rejected: macro trend is DOWN")
                    return None
                if signal.direction == "SHORT" and macro_dir == "UP":
                    logger.info("Signal SHORT rejected: macro trend is UP")
                    return None

            logger.info(
                f"Signal generated: {signal.direction} {signal.instrument} "
                f"@ {signal.entry_price:.2f} | "
                f"Fib {signal.triggered_level} | "
                f"Trend: {signal.trend_direction}"
            )
            self._store_signal(signal)
        else:
            logger.debug("No signal generated on this candle")

        return signal

    def _store_signal(self, signal: Signal) -> None:
        """Persist signal to DuckDB."""
        if not self._db:
            return
        try:
            self._db.create_signal(signal.to_dict())
        except Exception as e:
            logger.warning(f"Failed to store signal in DuckDB: {e}")

    def update_strategy_params(self, params: dict) -> None:
        """Hot-reload strategy parameters."""
        self.strategy = type(self.strategy)(params=params)
        logger.info(f"Strategy params reloaded for {self.strategy.name()}")
