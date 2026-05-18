"""Tests for DiscordNotifier — embed structure and POST shape."""

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from backend.notifications.discord_notifier import DiscordNotifier


pytestmark = pytest.mark.asyncio


@dataclass
class FakeSignal:
    coin: str = "SOL"
    direction: str = "LONG"
    entry_price: float = 145.20
    stop_loss: float = 138.40
    tp1: float = 155.40
    tp2: float = 162.30
    fib_level_triggered: float = 0.618
    swing_high: float = 158.90
    swing_low: float = 134.10
    atr: float = 1.5
    timestamp: pd.Timestamp = pd.Timestamp("2026-05-17 14:32", tz="UTC")


@dataclass
class FakePos:
    quantity: float = 0.735
    notional: float = 106.72
    suggested_leverage: int = 5
    initial_margin: float = 21.34
    maintenance_margin: float = 1.33
    liquidation_price: float = 137.20
    risk_amount: float = 15.0
    funding_rate_hr: float = 0.00012


async def test_send_signal_alert_posts_to_webhook_url():
    n = DiscordNotifier(webhook_url="https://discord.com/api/webhooks/X/Y")

    captured = {}

    class FakeResponse:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        status = 200
        async def text(self): return "ok"

    class FakeSession:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        def post(self, url, data=None, **kwargs):
            captured["url"] = url
            captured["data_type"] = type(data).__name__
            return FakeResponse()

    with patch("backend.notifications.discord_notifier.aiohttp.ClientSession", return_value=FakeSession()):
        await n.send_signal(
            signal=FakeSignal(), position=FakePos(), confidence=72.0, balance=500.0,
            mtf_summary="1h ↑ BULL", png_bytes=b"\x89PNG\r\n\x1a\nfake",
            strategy_summary="Swing low→high",
        )

    assert captured["url"] == "https://discord.com/api/webhooks/X/Y"
    assert captured["data_type"] == "FormData"


async def test_skips_when_webhook_url_empty():
    n = DiscordNotifier(webhook_url="")
    # Should not raise, just no-op
    await n.send_signal(
        signal=FakeSignal(), position=FakePos(), confidence=72.0, balance=500.0,
        mtf_summary="", png_bytes=b"", strategy_summary="",
    )
