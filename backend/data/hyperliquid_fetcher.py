"""Hyperliquid OHLCV + market info fetcher via ccxt. No API key needed for public data."""

import logging
from typing import Dict, Optional

import ccxt
import pandas as pd

from backend.config import settings

logger = logging.getLogger(__name__)


class HyperliquidFetcher:
    """Wraps ccxt.hyperliquid for OHLCV and market metadata.

    Optionally backed by a live WebSocket buffer — when `ws_client` is set,
    fetch_ohlcv prefers the buffer (fresh tick data) and falls back to REST
    only when the buffer hasn't been populated yet for that (coin, tf).
    """

    def __init__(self) -> None:
        self._exchange = ccxt.hyperliquid({"enableRateLimit": True})
        self._markets_cache: Optional[Dict] = None
        self._ws_client = None  # set later via attach_ws()

    def attach_ws(self, ws_client) -> None:
        """Attach a live HyperliquidWebSocket so reads prefer the in-memory buffer."""
        self._ws_client = ws_client

    @staticmethod
    def _to_ccxt_symbol(coin: str) -> str:
        """Convert 'BTC' → 'BTC/USDC:USDC' (ccxt Hyperliquid perp format)."""
        if "/" in coin:
            return coin
        return f"{coin.upper()}/USDC:USDC"

    def fetch_ohlcv(self, coin: str, timeframe: str, limit: int = 500) -> pd.DataFrame:
        """Fetch OHLCV candles. Returns DataFrame with [Open, High, Low, Close, Volume] indexed by UTC Timestamp.

        Prefers the WebSocket buffer if it holds enough candles; otherwise hits REST.
        """
        if self._ws_client is not None:
            try:
                df = self._ws_client.get_latest_candles(coin, timeframe, periods=limit)
                if not df.empty and len(df) >= min(limit, 50):
                    return df
            except Exception as exc:
                logger.debug(f"WS buffer read failed for {coin}/{timeframe}: {exc}")
        symbol = self._to_ccxt_symbol(coin)
        rows = self._exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
        if not rows:
            raise ValueError(f"No OHLCV returned for {symbol}/{timeframe}")
        df = pd.DataFrame(rows, columns=["ts_ms", "Open", "High", "Low", "Close", "Volume"])
        df["Timestamp"] = pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
        df = df.set_index("Timestamp").drop(columns=["ts_ms"])
        return df

    def fetch_multi_timeframe(self, coin: str) -> Dict[str, pd.DataFrame]:
        """Fetch analysis TFs at maximum useful depth."""
        depths = {"1m": 200, "5m": 1000, "15m": 1000, "1h": 1000, "4h": 500}
        out: Dict[str, pd.DataFrame] = {}
        for tf, limit in depths.items():
            try:
                out[tf] = self.fetch_ohlcv(coin, tf, limit=limit)
            except Exception as e:
                logger.warning(f"Failed fetching {coin}/{tf}: {e}")
        return out

    def _ensure_markets(self) -> Dict:
        if self._markets_cache is None:
            self._markets_cache = self._exchange.load_markets()
        return self._markets_cache

    def get_max_leverage(self, coin: str) -> int:
        """Per-coin max leverage as published by Hyperliquid. Safe fallback = 5."""
        try:
            markets = self._ensure_markets()
            symbol = self._to_ccxt_symbol(coin)
            mkt = markets.get(symbol)
            if mkt and "limits" in mkt and "leverage" in mkt["limits"]:
                return int(mkt["limits"]["leverage"].get("max", 5))
        except Exception as e:
            logger.warning(f"Couldn't fetch max leverage for {coin}: {e}")
        return 5

    def fetch_funding_rate(self, coin: str) -> float:
        """Hourly funding rate as a fraction (0.0001 = 0.01%/hr). Returns 0.0 on failure."""
        try:
            symbol = self._to_ccxt_symbol(coin)
            info = self._exchange.fetch_funding_rate(symbol)
            return float(info.get("fundingRate", 0.0))
        except Exception as e:
            logger.warning(f"Couldn't fetch funding rate for {coin}: {e}")
            return 0.0
