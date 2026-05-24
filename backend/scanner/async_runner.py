"""Orchestrates 10 CoinScanner instances using asyncio.gather."""

import asyncio
import logging
import traceback
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
        for s, r in zip(self.scanners, results):
            if isinstance(r, Exception):
                tb = "".join(traceback.format_exception(type(r), r, r.__traceback__))
                logger.error(f"[{s.coin}] scan raised: {r}\n{tb}")
            elif r is not None:
                trade_ids.append(r)
        return trade_ids
