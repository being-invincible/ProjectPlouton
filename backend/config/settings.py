"""
Application settings loaded from environment variables / .env file.
All trading parameters are configurable here and can be overridden
by PocketBase strategy_configs collection at runtime.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Literal
from zoneinfo import ZoneInfo
import os


def _detect_system_timezone() -> str:
    """Auto-detect timezone from the OS. Falls back to UTC."""
    try:
        # macOS/Linux: resolve /etc/localtime symlink
        real = os.path.realpath("/etc/localtime")
        # Path looks like .../zoneinfo/Europe/London
        parts = real.split("/zoneinfo/")
        if len(parts) == 2:
            return parts[1]
    except Exception:
        pass
    return "UTC"


class Settings(BaseSettings):
    """Global application settings."""

    # ── PocketBase ──────────────────────────────────────────────
    pocketbase_url: str = Field(
        default="http://127.0.0.1:8090",
        description="PocketBase server URL",
    )

    # ── Trading Mode ────────────────────────────────────────────
    trading_mode: Literal["paper", "live"] = Field(
        default="paper",
        description="Trading mode: 'paper' for simulation, 'live' for real trading",
    )

    # ── Instrument ──────────────────────────────────────────────
    instrument: str = Field(
        default="GC=F",
        description="Trading instrument symbol (e.g. GC=F for Gold Futures)",
    )

    # ── Timeframe ───────────────────────────────────────────────
    timeframe: str = Field(
        default="5m",
        description="Candle timeframe (1m, 5m, 15m, 1h, 1d)",
    )

    # ── Timezone ─────────────────────────────────────────────────
    timezone: str = Field(
        default_factory=_detect_system_timezone,
        description="User's local timezone (auto-detected from system, or set via TIMEZONE env var)",
    )

    # ── Market Hours Override ────────────────────────────────────
    force_market_open: bool = Field(
        default=False,
        description="Force market to be treated as open (for paper trading testing)",
    )

    # ── Paper Trading ───────────────────────────────────────────
    paper_balance: float = Field(
        default=500.0,
        description="Initial paper trading balance in USD",
    )

    @property
    def tz_info(self) -> ZoneInfo:
        """Return ZoneInfo object for the configured timezone."""
        return ZoneInfo(self.timezone)

    # ── Strategy Defaults (overridden by PocketBase at runtime) ─
    fib_lookback_period: int = Field(
        default=20,
        description="Number of candles to look back for swing points",
    )
    fib_entry_levels: list[float] = Field(
        default=[0.382, 0.618],
        description="Fibonacci levels that trigger entry signals",
    )
    fib_stop_loss_level: float = Field(
        default=0.786,
        description="Fibonacci level for stop loss placement",
    )
    risk_reward_ratio: float = Field(
        default=2.0,
        description="Risk:reward ratio (e.g. 2.0 means 1:2)",
    )
    risk_per_trade_pct: float = Field(
        default=1.0,
        description="Percentage of balance to risk per trade",
    )
    max_open_positions: int = Field(
        default=3,
        description="Maximum number of concurrent open positions",
    )
    max_daily_loss_pct: float = Field(
        default=5.0,
        description="Maximum daily loss as percentage of balance before stopping",
    )

    # ── Broker (future) ─────────────────────────────────────────
    ib_host: str = Field(default="127.0.0.1")
    ib_port: int = Field(default=7497)
    ib_client_id: int = Field(default=1)

    model_config = {
        "env_file": os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            ".env",
        ),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


# Singleton instance
settings = Settings()
