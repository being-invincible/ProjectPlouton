"""Application settings loaded from .env with sensible defaults."""

from typing import List
from zoneinfo import ZoneInfo
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Coins (Hyperliquid perp symbols, comma-separated in .env)
    coins: List[str] = Field(default_factory=lambda: ["BTC", "ETH", "SOL", "XRP", "BNB", "SUI", "TAO", "LINK", "HYPE", "ADA"])

    @field_validator("coins", mode="before")
    @classmethod
    def split_coins(cls, v):
        if isinstance(v, str):
            return [c.strip().upper() for c in v.split(",") if c.strip()]
        return v

    # Paper trading
    paper_balance: float = 500.0
    risk_per_trade_pct: float = 0.01
    max_open_trades: int = 6
    daily_loss_limit_pct: float = 0.15

    # Strategy selection: "golden_pocket" | "smc"
    strategy_name: str = "golden_pocket"

    # Strategy
    min_confidence_pct: float = 40.0
    execution_tf_default: str = "4h"
    confirmation_tf: str = "1h"
    trend_tf: str = "1d"
    atr_period: int = 14
    atr_sl_multiplier: float = 1.5
    min_slope_pct: float = 0.002

    # Chart
    chart_candles_before_signal: int = 400
    chart_candles_after_signal: int = 100
    chart_width_px: int = 1600
    chart_height_px: int = 800

    # Discord
    discord_webhook_url: str = ""

    # User timezone (display only)
    timezone: str = "UTC"

    @property
    def tz_info(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    # Legacy (kept temporarily so existing code doesn't crash mid-migration)
    instrument: str = "BTC"
    timeframe: str = "5m"
    trading_mode: str = "paper"
    force_market_open: bool = False


settings = Settings()
