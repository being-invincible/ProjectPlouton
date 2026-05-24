"""Orchestrates 10 CoinScanner instances using asyncio.gather."""

import asyncio
import logging
from typing import List

from backend.scanner.coin_scanner import CoinScanner

logger = logging.getLogger(__name__)


class AsyncRunner:
    def __init__(self, scanners: List[CoinScanner]):
        self.scanners = scanners

    async def run_one_cycle(self) -> List[str]:
        """Scan all coins sequentially so each scanner sees up-to-date open-trade state.
        Running in parallel was a race: all scanners read open_trades before any trade
        was written, so multiple could pass the quality filter in the same cycle.
        """
        trade_ids: List[str] = []
        for s in self.scanners:
            try:
                result = await s.scan()
                if result is not None:
                    trade_ids.append(result)
            except Exception as e:
                logger.error(f"[{s.coin}] scan raised: {e}")
        return trade_ids
