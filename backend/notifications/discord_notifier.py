"""Discord webhook notifier — posts embed + chart PNG attachment."""

import io
import json
import logging
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)


class DiscordNotifier:
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url

    async def send_signal(
        self,
        *,
        signal,
        position,
        confidence: float,
        balance: float,
        mtf_summary: str,
        strategy_summary: str,
        png_bytes: bytes,
    ) -> None:
        if not self.webhook_url:
            logger.info("DISCORD_WEBHOOK_URL not set — skipping alert")
            return

        color = 0x10B981 if signal.direction == "LONG" else 0xEF4444
        emoji = "📈" if signal.direction == "LONG" else "📉"

        embed = {
            "title": f"{emoji} {signal.coin}/USDC — {signal.direction} (Golden Pocket)",
            "color": color,
            "fields": [
                {"name": "🎯 Confidence", "value": f"**{confidence:.0f}%**", "inline": True},
                {"name": "Fib Zone", "value": f"{getattr(signal, 'fib_zone_name', 'GP')} ({signal.fib_level_triggered*100:.1f}%)", "inline": True},
                {"name": "RSI", "value": f"{getattr(signal, 'rsi', 0):.1f}", "inline": True},
                {"name": "Risk", "value": f"${position.risk_amount:.2f}", "inline": True},
                {"name": "Entry", "value": f"`${signal.entry_price:,.4f}`", "inline": True},
                {"name": "Stop Loss", "value": f"`${signal.stop_loss:,.4f}`", "inline": True},
                {"name": "TP1 / TP2", "value": f"`${signal.tp1:,.4f}` / `${signal.tp2:,.4f}`", "inline": True},
                {"name": "Qty", "value": f"`{position.quantity:.4f}`", "inline": True},
                {"name": "Notional", "value": f"`${position.notional:,.2f}`", "inline": True},
                {"name": "Leverage", "value": f"`{position.suggested_leverage}×`", "inline": True},
                {"name": "Init Margin", "value": f"`${position.initial_margin:,.2f}`", "inline": True},
                {"name": "Liq Price", "value": f"`${position.liquidation_price:,.4f}`", "inline": True},
                {"name": "Funding/hr", "value": f"`{position.funding_rate_hr*100:.4f}%`", "inline": True},
                {"name": "MTF Trend", "value": mtf_summary, "inline": False},
                {"name": "Swing", "value": strategy_summary, "inline": False},
            ],
            "image": {"url": "attachment://chart.png"},
            "footer": {"text": f"Paper trade · Plouton · Balance ${balance:.2f}"},
        }
        await self._post(payload={"embeds": [embed]}, png_bytes=png_bytes)

    async def send_close(
        self,
        *,
        coin: str,
        direction: str,
        pnl: float,
        pnl_pct: float,
        exit_reason: str,
        confidence_at_entry: float,
        duration_str: str,
        png_bytes: bytes,
    ) -> None:
        if not self.webhook_url:
            return

        won = pnl > 0
        color = 0x10B981 if won else 0xEF4444
        emoji = "✅" if won else "❌"
        verdict = "WIN" if won else "LOSS"

        embed = {
            "title": f"{emoji} {coin}/USDC {direction} closed — {verdict} {'+' if pnl >= 0 else ''}${pnl:.2f}",
            "color": color,
            "fields": [
                {"name": "P&L", "value": f"{'+' if pnl >= 0 else ''}${pnl:.2f} ({pnl_pct:+.2f}%)", "inline": True},
                {"name": "Exit Reason", "value": exit_reason, "inline": True},
                {"name": "Duration", "value": duration_str, "inline": True},
                {"name": "Confidence (at entry)", "value": f"{confidence_at_entry:.0f}%", "inline": True},
            ],
            "image": {"url": "attachment://chart.png"},
            "footer": {"text": "Plouton"},
        }
        await self._post(payload={"embeds": [embed]}, png_bytes=png_bytes)

    async def _post(self, payload: dict, png_bytes: bytes) -> None:
        form = aiohttp.FormData()
        form.add_field("payload_json", json.dumps(payload), content_type="application/json")
        if png_bytes:
            form.add_field("file", io.BytesIO(png_bytes), filename="chart.png", content_type="image/png")

        async with aiohttp.ClientSession() as session:
            async with session.post(self.webhook_url, data=form) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    logger.warning(f"Discord webhook failed {resp.status}: {body}")
