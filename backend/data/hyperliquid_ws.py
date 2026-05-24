"""
Hyperliquid WebSocket client — streams live candle updates.

Subscribes to the `candle` channel for each (coin, timeframe) pair and
maintains an in-memory rolling buffer of the most recent N candles per
(coin, tf). REST stays the primary source for historical backfill; this
layer pushes tick-by-tick updates so the scanner / UI never wait the
full 5-minute polling interval.

Hyperliquid WS docs: wss://api.hyperliquid.xyz/ws
Subscription payload:
    {"method": "subscribe", "subscription": {"type": "candle", "coin": "BTC", "interval": "5m"}}
Message format:
    {"channel": "candle", "data": {"t": <open_ms>, "T": <close_ms>, "s": "BTC",
                                    "i": "5m", "o": "...", "c": "...", "h": "...",
                                    "l": "...", "v": "...", "n": <trades>}}
"""

import asyncio
import json
import logging
import ssl
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Callable, Dict, Optional

import certifi
import pandas as pd
import websockets


def _build_ssl_context() -> ssl.SSLContext:
    """SSL context using certifi's CA bundle. Python 3.14 on macOS lacks system certs."""
    return ssl.create_default_context(cafile=certifi.where())

logger = logging.getLogger(__name__)

WS_URL = "wss://api.hyperliquid.xyz/ws"
BUFFER_SIZE = 1000  # rolling candles kept per (coin, tf)


class HyperliquidWebSocket:
    """Async WebSocket client maintaining live candle buffers per (coin, timeframe)."""

    def __init__(self, coins: list[str], timeframes: list[str] | None = None):
        self.coins = coins
        self.timeframes = timeframes or ["1m", "5m", "15m", "1h"]
        # Pre-populate so `coin in self._buffers` and `tf in inner` both work.
        self._buffers: Dict[str, Dict[str, deque]] = {
            c: {tf: deque(maxlen=BUFFER_SIZE) for tf in self.timeframes} for c in coins
        }
        self._last_candle: Dict[str, Dict[str, dict]] = {c: {} for c in coins}
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._task: Optional[asyncio.Task] = None
        self._connected_event = asyncio.Event()
        self._stop = asyncio.Event()
        # callbacks fired on each completed candle: (coin, tf, candle_dict)
        self._listeners: list[Callable[[str, str, dict], None]] = []

    def add_listener(self, cb: Callable[[str, str, dict], None]) -> None:
        self._listeners.append(cb)

    def get_latest_candles(self, coin: str, tf: str, periods: int = 500) -> pd.DataFrame:
        """Return rolling buffer as DataFrame indexed by UTC Timestamp."""
        buf = self._buffers.get(coin, {}).get(tf)
        if not buf:
            return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
        rows = list(buf)[-periods:]
        df = pd.DataFrame(rows)
        df["Timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.set_index("Timestamp")[["open", "high", "low", "close", "volume"]]
        df.columns = ["Open", "High", "Low", "Close", "Volume"]
        return df

    def get_latest_price(self, coin: str) -> Optional[float]:
        """Last close price from the smallest available timeframe."""
        for tf in self.timeframes:
            candle = self._last_candle.get(coin, {}).get(tf)
            if candle:
                return float(candle["close"])
        return None

    def seed_buffer(self, coin: str, tf: str, df: pd.DataFrame) -> None:
        """Backfill the rolling buffer with REST candles before WS connects."""
        if df is None or df.empty:
            return
        buf = self._buffers[coin][tf]
        buf.clear()
        last = None
        for ts, row in df.iterrows():
            candle = {
                "timestamp": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": float(row["Volume"]),
                "open_ms": int(pd.Timestamp(ts).timestamp() * 1000),
                "close_ms": int(pd.Timestamp(ts).timestamp() * 1000),
            }
            buf.append(candle)
            last = candle
        if last is not None:
            self._last_candle[coin][tf] = last

    async def start(self) -> None:
        """Connect + auto-reconnect loop. Returns immediately after spawning the task."""
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="hyperliquid-ws")

    async def stop(self) -> None:
        self._stop.set()
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()

    async def wait_connected(self, timeout: float = 10.0) -> bool:
        try:
            await asyncio.wait_for(self._connected_event.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False

    async def _run(self) -> None:
        """Connect with exponential backoff. macOS sleep / network drop safe."""
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with websockets.connect(
                    WS_URL,
                    ping_interval=30,
                    ping_timeout=10,
                    close_timeout=5,
                    max_size=2**22,
                    ssl=_build_ssl_context(),
                ) as ws:
                    self._ws = ws
                    backoff = 1.0
                    await self._subscribe_all(ws)
                    self._connected_event.set()
                    logger.info(
                        f"Hyperliquid WS connected — {len(self.coins)} coins × {len(self.timeframes)} TFs"
                    )
                    async for raw in ws:
                        if self._stop.is_set():
                            break
                        try:
                            await self._handle_message(raw)
                        except Exception as exc:
                            logger.warning(f"WS message handler error: {exc}")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._connected_event.clear()
                logger.warning(f"Hyperliquid WS dropped: {exc} — reconnect in {backoff:.1f}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60.0)

    async def _subscribe_all(self, ws) -> None:
        for coin in self.coins:
            for tf in self.timeframes:
                payload = {
                    "method": "subscribe",
                    "subscription": {"type": "candle", "coin": coin, "interval": tf},
                }
                await ws.send(json.dumps(payload))

    async def _handle_message(self, raw: str | bytes) -> None:
        msg = json.loads(raw)
        channel = msg.get("channel")
        if channel != "candle":
            return
        data = msg.get("data")
        if not data:
            return
        coin = data.get("s")
        tf = data.get("i")
        if coin not in self._buffers or tf not in self.timeframes:
            return
        candle = {
            "timestamp": datetime.fromtimestamp(int(data["t"]) / 1000, tz=timezone.utc).isoformat(),
            "open": float(data["o"]),
            "high": float(data["h"]),
            "low": float(data["l"]),
            "close": float(data["c"]),
            "volume": float(data["v"]),
            "open_ms": int(data["t"]),
            "close_ms": int(data["T"]),
        }
        buf = self._buffers[coin][tf]
        last = self._last_candle[coin].get(tf)
        if last and last["open_ms"] == candle["open_ms"]:
            # update in place — same candle, new tick
            if buf:
                buf[-1] = candle
        else:
            buf.append(candle)
        self._last_candle[coin][tf] = candle
        for cb in self._listeners:
            try:
                cb(coin, tf, candle)
            except Exception as exc:
                logger.debug(f"WS listener error: {exc}")
