"""
Market data fetcher.

Fetches OHLCV candle data from yfinance (development) with a pluggable
interface for future broker API data sources.

Also persists fetched candles to PocketBase so the React dashboard
(Chart page) can display them.
"""

import logging
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from config import settings
from pocketbase_client import pb

logger = logging.getLogger(__name__)

# Exchange timezone for CME Gold Futures
CME_TZ = ZoneInfo("America/New_York")


class MarketDataFetcher:
    """Fetches market data from yfinance (dev) or broker API (prod)."""

    # Map our timeframe strings to yfinance intervals
    TIMEFRAME_MAP = {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "30m": "30m",
        "1h": "1h",
        "1d": "1d",
    }

    # yfinance limits: 1m=7d, 5m=60d, 15m=60d, 30m=60d, 1h=730d, 1d=unlimited
    MAX_PERIOD_DAYS = {
        "1m": 7,
        "5m": 60,
        "15m": 60,
        "30m": 60,
        "1h": 730,
        "1d": 3650,
    }

    def __init__(
        self,
        instrument: str | None = None,
        timeframe: str | None = None,
    ):
        self.instrument = instrument or settings.instrument
        self.timeframe = timeframe or settings.timeframe

    def fetch_latest(
        self,
        periods: int = 500,
        instrument: str | None = None,
        timeframe: str | None = None,
    ) -> pd.DataFrame:
        """
        Fetch the most recent candles.

        Args:
            periods: Approximate number of candles to fetch (default 500
                     for meaningful trend context)
            instrument: Override instrument symbol
            timeframe: Override timeframe

        Returns:
            DataFrame with columns: Open, High, Low, Close, Volume
            Index: DatetimeIndex (UTC)
        """
        symbol = instrument or self.instrument
        tf = timeframe or self.timeframe
        interval = self.TIMEFRAME_MAP.get(tf, tf)

        # Calculate how many days of data we need
        max_days = self.MAX_PERIOD_DAYS.get(tf, 60)
        minutes_per_candle = self._timeframe_to_minutes(tf)
        trading_minutes_per_day = 23 * 60  # Futures trade ~23h/day
        days_needed = max(
            1,
            int((periods * minutes_per_candle) / trading_minutes_per_day) + 2,
        )
        days_needed = min(days_needed, max_days)

        ticker = yf.Ticker(symbol)
        df = ticker.history(
            period=f"{days_needed}d",
            interval=interval,
            auto_adjust=True,
        )

        if df.empty:
            raise ValueError(
                f"No data returned for {symbol} with interval {interval}. "
                f"Check if the symbol is valid and market is open."
            )

        # Standardize column names
        df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
        df.index.name = "Timestamp"

        # Keep only the requested number of periods
        if len(df) > periods:
            df = df.tail(periods)

        return df

    def fetch_multi_timeframe(
        self,
        instrument: str | None = None,
    ) -> dict[str, pd.DataFrame]:
        """
        Fetch candles for all analysis timeframes with MAXIMUM history.

        yfinance limits:
        - 5m:  up to 60 days  (~16,500 candles)
        - 15m: up to 60 days  (~5,500 candles)
        - 1h:  up to 730 days (~12,000 candles)

        DuckDB stores the full history; each cycle only fetches the
        latest chunk and DuckDB deduplicates via INSERT OR REPLACE.

        Returns:
            Dict mapping timeframe -> DataFrame
        """
        symbol = instrument or self.instrument
        # Max candles per TF based on yfinance limits
        timeframes = {
            "5m":  16000,  # ~60 trading days
            "15m": 5500,   # ~60 trading days
            "1h":  12000,  # ~730 trading days
        }

        result = {}
        for tf, periods in timeframes.items():
            try:
                df = self.fetch_latest(
                    periods=periods,
                    instrument=symbol,
                    timeframe=tf,
                )
                result[tf] = df
                logger.info(
                    f"Fetched {len(df)} candles for {symbol}/{tf} "
                    f"(range: {df.index[0]} -> {df.index[-1]})"
                )
            except Exception as e:
                logger.warning(f"Failed to fetch {tf} data: {e}")

        return result

    def fetch_historical(
        self,
        start_date: str,
        end_date: str | None = None,
        instrument: str | None = None,
        timeframe: str | None = None,
    ) -> pd.DataFrame:
        """
        Fetch historical candle data for backtesting.

        Args:
            start_date: Start date string (YYYY-MM-DD)
            end_date: End date string (YYYY-MM-DD), defaults to today
            instrument: Override instrument symbol
            timeframe: Override timeframe

        Returns:
            DataFrame with OHLCV columns
        """
        symbol = instrument or self.instrument
        tf = timeframe or self.timeframe
        interval = self.TIMEFRAME_MAP.get(tf, tf)

        ticker = yf.Ticker(symbol)
        df = ticker.history(
            start=start_date,
            end=end_date,
            interval=interval,
            auto_adjust=True,
        )

        if df.empty:
            raise ValueError(
                f"No historical data for {symbol} from {start_date} to {end_date}"
            )

        df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
        df.index.name = "Timestamp"
        return df

    @staticmethod
    def _timeframe_to_minutes(timeframe: str) -> int:
        """Convert timeframe string to minutes."""
        mapping = {
            "1m": 1, "5m": 5, "15m": 15, "30m": 30,
            "1h": 60, "4h": 240, "1d": 1440,
        }
        return mapping.get(timeframe, 5)

    def store_candles(
        self,
        df: pd.DataFrame,
        instrument: str | None = None,
        timeframe: str | None = None,
    ) -> int:
        """
        Persist fetched candles to PocketBase for the frontend Chart page.

        Uses timestamp+instrument+timeframe as a composite key to avoid
        duplicates. Existing candles are skipped.

        Args:
            df: DataFrame with OHLCV data and DatetimeIndex
            instrument: Symbol override
            timeframe: Timeframe override

        Returns:
            Number of new candles stored
        """
        symbol = instrument or self.instrument
        tf = timeframe or self.timeframe
        stored = 0

        for ts, row in df.iterrows():
            # Normalize to UTC ISO format for PocketBase consistency
            if ts.tzinfo:
                ts_utc = ts.astimezone(timezone.utc)
            else:
                ts_utc = ts.replace(tzinfo=timezone.utc)
            
            ts_str = ts_utc.strftime("%Y-%m-%d %H:%M:%S.000Z")

            # Check if this candle already exists
            try:
                # Use exact string match for normalized UTC timestamp
                existing = pb.get_first_record(
                    "candles",
                    filter_str=(
                        f"instrument='{symbol}' && "
                        f"timeframe='{tf}' && "
                        f"timestamp='{ts_str}'"
                    ),
                )
                if existing:
                    continue  # Already stored, skip
            except Exception:
                pass  # Collection might be empty, proceed to create

            try:
                pb.create_record("candles", {
                    "timestamp": ts_str,
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": float(row["Volume"]) if "Volume" in row else 0,
                    "instrument": symbol,
                    "timeframe": tf,
                })
                stored += 1
            except Exception as e:
                logger.warning(f"Failed to store candle {ts_str}: {e}")

        if stored > 0:
            logger.info(f"Stored {stored} new candles to PocketBase")
        else:
            logger.debug("No new candles to store (all already exist)")

        return stored

    @staticmethod
    def _format_countdown(delta: timedelta) -> str:
        """Format a timedelta as a compact countdown string."""
        total_seconds = max(0, int(delta.total_seconds()))
        days = total_seconds // 86400
        hours = (total_seconds % 86400) // 3600
        minutes = (total_seconds % 3600) // 60

        parts = []
        if days > 0:
            parts.append(f"{days}d")
        if hours > 0 or days > 0:
            parts.append(f"{hours}h")
        parts.append(f"{minutes}m")
        return " ".join(parts)

    @staticmethod
    def _next_market_open_et(now_et: datetime) -> datetime:
        """Compute the next regular CME open in ET timezone."""
        weekday = now_et.weekday()  # Mon=0 ... Sun=6
        candidate = now_et.replace(hour=18, minute=0, second=0, microsecond=0)

        # Daily maintenance break Mon-Thu 5pm-6pm ET.
        if weekday in {0, 1, 2, 3} and 17 <= now_et.hour < 18:
            return candidate

        # Friday after 5pm -> Sunday 6pm.
        if weekday == 4 and now_et.hour >= 17:
            return (candidate + timedelta(days=2))

        # Saturday -> Sunday 6pm.
        if weekday == 5:
            return (candidate + timedelta(days=1))

        # Sunday before 6pm -> Sunday 6pm.
        if weekday == 6 and now_et.hour < 18:
            return candidate

        # Fallback for any closed edge case.
        if now_et < candidate:
            return candidate
        return candidate + timedelta(days=1)

    @staticmethod
    def is_market_open_actual() -> bool:
        """
        Check if CME Gold Futures (GC) market is currently open.

        CME Gold Futures trading hours (ET):
        - Sunday 6:00 PM -> Friday 5:00 PM
        - Daily maintenance break: 5:00 PM -> 6:00 PM ET

        If settings.force_market_open is True, always returns True
        (for paper trading testing during off-hours).

        Returns:
            True if market is expected to be open
        """
        now = datetime.now(CME_TZ)
        weekday = now.weekday()  # Mon=0, Sun=6
        hour = now.hour

        # Saturday: fully closed
        if weekday == 5:
            return False

        # Sunday: opens at 6:00 PM ET
        if weekday == 6:
            return hour >= 18

        # Friday: closes at 5:00 PM ET
        if weekday == 4:
            if hour >= 17:
                return False

        # Mon-Thu: daily maintenance break 5:00 PM - 6:00 PM ET
        if 17 <= hour < 18:
            return False

        return True

    @staticmethod
    def is_market_open(force_market_open: bool | None = None) -> bool:
        """Effective market-open check (actual schedule OR force override)."""
        force_open = settings.force_market_open if force_market_open is None else force_market_open
        if force_open:
            return True
        return MarketDataFetcher.is_market_open_actual()

    @staticmethod
    def get_market_hours_display(
        user_tz: ZoneInfo | None = None,
        force_market_open: bool | None = None,
    ) -> dict:
        """
        Get market hours information in the user's timezone.

        Returns a dict with market schedule info converted to the user's
        local timezone for dashboard display.

        Args:
            user_tz: User's timezone (defaults to settings.tz_info)

        Returns:
            Dict with market hours info:
            - is_open: bool
            - exchange_tz: str (e.g. "America/New_York")
            - user_tz: str (e.g. "Pacific/Auckland")
            - next_open: str (ISO format in user tz)
            - next_close: str (ISO format in user tz)
            - exchange_time: str (current exchange time)
            - user_time: str (current user time)
        """
        tz = user_tz or settings.tz_info
        now_et = datetime.now(CME_TZ)
        now_user = datetime.now(tz)
        force_open = settings.force_market_open if force_market_open is None else force_market_open
        actual_open = MarketDataFetcher.is_market_open_actual()
        is_open = actual_open or force_open

        # Calculate next open/close in ET, then convert to user tz
        weekday = now_et.weekday()
        hour = now_et.hour

        if actual_open:
            # Market is open — find next close
            if weekday == 4:  # Friday — closes at 5 PM
                next_close = now_et.replace(hour=17, minute=0, second=0, microsecond=0)
            else:
                # Next maintenance break at 5 PM
                next_close = now_et.replace(hour=17, minute=0, second=0, microsecond=0)
                if hour >= 17:
                    next_close += timedelta(days=1)
            next_close_user = next_close.astimezone(tz)
            close_countdown = MarketDataFetcher._format_countdown(next_close - now_et)
            next_event = f"Closes {next_close_user.strftime('%a %I:%M %p %Z')} (in {close_countdown})"
        else:
            next_open = MarketDataFetcher._next_market_open_et(now_et)
            next_open_user = next_open.astimezone(tz)
            open_countdown = MarketDataFetcher._format_countdown(next_open - now_et)
            if force_open:
                next_event = (
                    f"Force-open mode · Actual opens "
                    f"{next_open_user.strftime('%a %I:%M %p %Z')} (in {open_countdown})"
                )
            else:
                next_event = f"Opens {next_open_user.strftime('%a %I:%M %p %Z')} (in {open_countdown})"

        return {
            "is_open": is_open,
            "actual_open": actual_open,
            "force_open": force_open,
            "exchange_tz": "America/New_York",
            "user_tz": str(tz),
            "exchange_time": now_et.strftime("%Y-%m-%d %H:%M:%S %Z"),
            "user_time": now_user.strftime("%Y-%m-%d %H:%M:%S %Z"),
            "next_event": next_event,
        }

    def get_latest_candle_time(self, df: pd.DataFrame) -> str | None:
        """
        Get the timestamp of the latest candle in a fetched DataFrame.

        Used to detect stale data -- if this doesn't change between
        cycles, the market is likely closed or yfinance is caching.

        Returns:
            ISO timestamp string of the latest candle, or None
        """
        if df.empty:
            return None
        return str(df.index[-1])
