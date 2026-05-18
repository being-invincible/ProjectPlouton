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
        """Scan all coins in parallel. Returns list of trade_ids executed this cycle."""
        results = await asyncio.gather(
            *(s.scan() for s in self.scanners),
            return_exceptions=True,
        )
        trade_ids: List[str] = []
        for s, r in zip(self.scanners, results):
            if isinstance(r, Exception):
                logger.error(f"[{s.coin}] scan raised: {r}")
            elif r is not None:
                trade_ids.append(r)
        return trade_ids
