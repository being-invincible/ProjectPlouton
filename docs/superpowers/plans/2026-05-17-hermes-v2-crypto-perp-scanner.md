# Hermes v2 — Crypto Perp Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Gold Futures bot to a 10-coin async crypto perpetual scanner on Hyperliquid, with golden pocket Fibonacci strategy, Discord notifications, TradingView-style chart snapshots saved on signal and close, Hyperliquid-aware position sizing, and ADHD-friendly in-app help tooltips.

**Architecture:** Async coin scanner runs all 10 coins in parallel each cycle. Per coin: fetch MTF data via ccxt → store in DuckDB → detect golden pocket setup → score confidence → size position with Hyperliquid mechanics → render TradingView-style chart PNG → send Discord embed → execute paper trade. On trade close: regenerate chart, send close alert, update bot state.

**Tech Stack:** Python 3.11 (asyncio), ccxt (Hyperliquid), plotly + kaleido (PNG charts), DuckDB (storage), FastAPI (API), React (dashboard), Discord webhooks.

**Reference spec:** `docs/superpowers/specs/2026-05-17-crypto-perp-scanner-design.md`

---

## Phases

- **Phase 1** (Tasks 1–5): Foundation — config, deps, schema, Hyperliquid fetcher
- **Phase 2** (Tasks 6–10): Strategy — ATR, golden pocket, confidence, quality, position sizer
- **Phase 3** (Tasks 11–12): Output — chart generator, Discord notifier
- **Phase 4** (Tasks 13–15): Orchestration — coin scanner, async runner, bot rewrite
- **Phase 5** (Tasks 16–17): Engine — paper broker upgrade, order manager fixes
- **Phase 6** (Tasks 18–22): Frontend & API — chart endpoint, HelpTooltip, TradeDetail fix, Settings tooltips
- **Phase 7** (Tasks 23–24): Docs & integration smoke

---

## Phase 1 — Foundation

### Task 1: Update dependencies

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Read current requirements**

Run: `cat backend/requirements.txt`

- [ ] **Step 2: Rewrite requirements.txt**

```text
# Core
pydantic>=2.5
pydantic-settings>=2.1
python-dotenv>=1.0

# Data — crypto via ccxt (replaces yfinance)
ccxt>=4.2
pandas>=2.1
pandas-ta>=0.3.14b
numpy>=1.26

# Storage
duckdb>=0.10

# API
fastapi>=0.110
uvicorn[standard]>=0.27
httpx>=0.27

# Charting
plotly>=5.20
kaleido==0.2.1  # plotly PNG export — pin: 1.0+ has known issues

# Notifications
aiohttp>=3.9

# Util
python-dateutil>=2.9
tzdata
```

- [ ] **Step 3: Install in venv**

Run: `./.venv/bin/pip install -r backend/requirements.txt`
Expected: Successfully installs ccxt, plotly, kaleido, aiohttp.

- [ ] **Step 4: Verify imports work**

Run: `./.venv/bin/python -c "import ccxt, plotly, kaleido, aiohttp; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt
git commit -m "deps: add ccxt, plotly, kaleido, aiohttp for Hermes v2"
```

---

### Task 2: Update settings.py with v2 config

**Files:**
- Modify: `backend/config/settings.py`
- Modify: `.env.example`

- [ ] **Step 1: Read current settings.py**

Run: `cat backend/config/settings.py`

- [ ] **Step 2: Rewrite settings.py**

```python
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
    risk_per_trade_pct: float = 0.03
    max_open_trades: int = 3
    daily_loss_limit_pct: float = 0.15

    # Strategy
    min_confidence_pct: float = 60.0
    execution_tf_default: str = "5m"
    confirmation_tf: str = "15m"
    trend_tf: str = "1h"
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
```

- [ ] **Step 3: Rewrite .env.example**

```text
# === Hermes v2 — Crypto Perp Scanner ===

# Coins (Hyperliquid perp symbols)
COINS=BTC,ETH,SOL,XRP,BNB,SUI,TAO,LINK,HYPE,ADA

# Paper trading
PAPER_BALANCE=500
RISK_PER_TRADE_PCT=0.03
MAX_OPEN_TRADES=3
DAILY_LOSS_LIMIT_PCT=0.15

# Strategy
MIN_CONFIDENCE_PCT=60
EXECUTION_TF_DEFAULT=5m
CONFIRMATION_TF=15m
TREND_TF=1h
ATR_PERIOD=14
ATR_SL_MULTIPLIER=1.5
MIN_SLOPE_PCT=0.002

# Chart
CHART_CANDLES_BEFORE_SIGNAL=400
CHART_CANDLES_AFTER_SIGNAL=100
CHART_WIDTH_PX=1600
CHART_HEIGHT_PX=800

# Discord
DISCORD_WEBHOOK_URL=

# Display
TIMEZONE=UTC
```

- [ ] **Step 4: Smoke test settings load**

Run: `./.venv/bin/python -c "from backend.config import settings; print(settings.coins, settings.risk_per_trade_pct)"`
Expected: `['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'SUI', 'TAO', 'LINK', 'HYPE', 'ADA'] 0.03`

- [ ] **Step 5: Commit**

```bash
git add backend/config/settings.py .env.example
git commit -m "config: replace single-instrument with 10-coin Hermes v2 settings"
```

---

### Task 3: Extend DuckDB schema with v2 columns

**Files:**
- Modify: `backend/data/duckdb_store.py`

- [ ] **Step 1: Read current schema setup**

Run: `grep -n "CREATE TABLE\|ALTER TABLE" backend/data/duckdb_store.py`

- [ ] **Step 2: Add migration function**

Add this method to the `DuckDBStore` class in `backend/data/duckdb_store.py` (after the existing `_ensure_schema` method):

```python
def _migrate_v2(self) -> None:
    """Idempotent migration to v2 schema — confidence, chart blobs, asset_class default."""
    # Trades table additions
    cols = self._conn.execute("PRAGMA table_info(trades)").fetchdf()
    existing = set(cols["name"].tolist()) if not cols.empty else set()

    if "confidence" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN confidence DOUBLE DEFAULT 0.0")
    if "chart_initial_png" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN chart_initial_png BLOB")
    if "chart_final_png" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN chart_final_png BLOB")
    if "tp1_price" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN tp1_price DOUBLE")
    if "tp2_price" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN tp2_price DOUBLE")
    if "tp1_hit" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN tp1_hit BOOLEAN DEFAULT FALSE")
    if "leverage" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN leverage DOUBLE DEFAULT 1.0")
    if "notional" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN notional DOUBLE DEFAULT 0.0")
    if "initial_margin" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN initial_margin DOUBLE DEFAULT 0.0")
    if "liquidation_price" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN liquidation_price DOUBLE")
    if "funding_rate_hr" not in existing:
        self._conn.execute("ALTER TABLE trades ADD COLUMN funding_rate_hr DOUBLE")

    # Make sure asset_class column on candles defaults to 'crypto'
    self._conn.execute(
        "UPDATE candles SET asset_class = 'crypto' WHERE asset_class IS NULL OR asset_class = 'futures'"
    )
```

- [ ] **Step 3: Call migration on init**

In `backend/data/duckdb_store.py`, find `__init__` and after the line that calls `_ensure_schema()`, add:

```python
        self._migrate_v2()
```

- [ ] **Step 4: Run migration**

Run: `./.venv/bin/python -c "from backend.data.duckdb_store import DuckDBStore; DuckDBStore('backend/data/tradingbot.duckdb'); print('migrated')"`
Expected: `migrated`

- [ ] **Step 5: Verify new columns exist**

Run: `./.venv/bin/python -c "from backend.data.duckdb_store import DuckDBStore; s=DuckDBStore('backend/data/tradingbot.duckdb'); print(s._conn.execute('PRAGMA table_info(trades)').fetchdf()['name'].tolist())"`
Expected: list includes `confidence`, `chart_initial_png`, `chart_final_png`, `tp1_price`, `tp2_price`, `tp1_hit`, `leverage`, `notional`, `initial_margin`, `liquidation_price`, `funding_rate_hr`.

- [ ] **Step 6: Commit**

```bash
git add backend/data/duckdb_store.py
git commit -m "db: add v2 trade columns (confidence, chart blobs, two-stage TP, HL sizing)"
```

---

### Task 4: Hyperliquid OHLCV fetcher (with test)

**Files:**
- Create: `backend/data/hyperliquid_fetcher.py`
- Create: `tests/data/test_hyperliquid_fetcher.py`
- Modify: `backend/__init__.py` (if needed for test discovery)

- [ ] **Step 1: Write the failing test**

Create `tests/data/test_hyperliquid_fetcher.py`:

```python
"""Tests for HyperliquidFetcher — verify symbol formatting and shape of returned data."""

import pandas as pd
import pytest
from unittest.mock import MagicMock, patch

from backend.data.hyperliquid_fetcher import HyperliquidFetcher


def _fake_ohlcv():
    # [timestamp_ms, open, high, low, close, volume]
    base_ts = 1700000000000
    rows = []
    for i in range(10):
        rows.append([base_ts + i * 300_000, 100.0 + i, 101.0 + i, 99.0 + i, 100.5 + i, 1000.0 + i])
    return rows


def test_symbol_formatting_appends_usdc_perp():
    f = HyperliquidFetcher()
    assert f._to_ccxt_symbol("BTC") == "BTC/USDC:USDC"
    assert f._to_ccxt_symbol("HYPE") == "HYPE/USDC:USDC"
    # Already-formatted symbol passes through:
    assert f._to_ccxt_symbol("ETH/USDC:USDC") == "ETH/USDC:USDC"


def test_fetch_ohlcv_returns_dataframe_with_expected_columns():
    fake_exchange = MagicMock()
    fake_exchange.fetch_ohlcv.return_value = _fake_ohlcv()

    with patch("backend.data.hyperliquid_fetcher.ccxt.hyperliquid", return_value=fake_exchange):
        f = HyperliquidFetcher()
        df = f.fetch_ohlcv("BTC", "5m", limit=10)

    assert isinstance(df, pd.DataFrame)
    assert list(df.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert len(df) == 10
    assert df.index.name == "Timestamp"
    assert df.index.tz is not None
    fake_exchange.fetch_ohlcv.assert_called_once_with("BTC/USDC:USDC", timeframe="5m", limit=10)


def test_fetch_multi_timeframe_calls_each_tf():
    fake_exchange = MagicMock()
    fake_exchange.fetch_ohlcv.return_value = _fake_ohlcv()

    with patch("backend.data.hyperliquid_fetcher.ccxt.hyperliquid", return_value=fake_exchange):
        f = HyperliquidFetcher()
        out = f.fetch_multi_timeframe("SOL")

    assert set(out.keys()) == {"5m", "15m", "1h"}
    assert fake_exchange.fetch_ohlcv.call_count == 3


def test_fetch_max_leverage_per_coin():
    fake_exchange = MagicMock()
    fake_exchange.load_markets.return_value = {
        "BTC/USDC:USDC": {"limits": {"leverage": {"max": 50}}},
        "SOL/USDC:USDC": {"limits": {"leverage": {"max": 20}}},
    }
    with patch("backend.data.hyperliquid_fetcher.ccxt.hyperliquid", return_value=fake_exchange):
        f = HyperliquidFetcher()
        assert f.get_max_leverage("BTC") == 50
        assert f.get_max_leverage("SOL") == 20
        # Unknown symbol falls back to safe default
        assert f.get_max_leverage("UNKNOWN") == 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/data/test_hyperliquid_fetcher.py -v`
Expected: ImportError or ModuleNotFoundError for `backend.data.hyperliquid_fetcher`.

- [ ] **Step 3: Write the fetcher**

Create `backend/data/hyperliquid_fetcher.py`:

```python
"""Hyperliquid OHLCV + market info fetcher via ccxt. No API key needed for public data."""

import logging
from datetime import timezone
from typing import Dict, Optional

import ccxt
import pandas as pd

from backend.config import settings

logger = logging.getLogger(__name__)


class HyperliquidFetcher:
    """Wraps ccxt.hyperliquid for OHLCV and market metadata."""

    def __init__(self) -> None:
        self._exchange = ccxt.hyperliquid({"enableRateLimit": True})
        self._markets_cache: Optional[Dict] = None

    @staticmethod
    def _to_ccxt_symbol(coin: str) -> str:
        """Convert 'BTC' → 'BTC/USDC:USDC' (ccxt Hyperliquid perp format)."""
        if "/" in coin:
            return coin
        return f"{coin.upper()}/USDC:USDC"

    def fetch_ohlcv(self, coin: str, timeframe: str, limit: int = 500) -> pd.DataFrame:
        """Fetch OHLCV candles. Returns DataFrame with [Open, High, Low, Close, Volume] indexed by UTC Timestamp."""
        symbol = self._to_ccxt_symbol(coin)
        rows = self._exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
        if not rows:
            raise ValueError(f"No OHLCV returned for {symbol}/{timeframe}")
        df = pd.DataFrame(rows, columns=["ts_ms", "Open", "High", "Low", "Close", "Volume"])
        df["Timestamp"] = pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
        df = df.set_index("Timestamp").drop(columns=["ts_ms"])
        return df

    def fetch_multi_timeframe(self, coin: str) -> Dict[str, pd.DataFrame]:
        """Fetch the three analysis TFs at maximum useful depth."""
        depths = {"5m": 1000, "15m": 1000, "1h": 1000}
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
```

- [ ] **Step 4: Add tests `__init__.py` so pytest discovers them**

Create `tests/__init__.py` and `tests/data/__init__.py` as empty files if they don't exist:

```bash
mkdir -p tests/data && touch tests/__init__.py tests/data/__init__.py
```

- [ ] **Step 5: Run tests, expect pass**

Run: `./.venv/bin/python -m pytest tests/data/test_hyperliquid_fetcher.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/data/hyperliquid_fetcher.py tests/data/test_hyperliquid_fetcher.py tests/__init__.py tests/data/__init__.py
git commit -m "feat(data): add Hyperliquid OHLCV fetcher via ccxt with tests"
```

---

### Task 5: Live smoke test of Hyperliquid fetcher

**Files:**
- Create: `scripts/smoke_hyperliquid.py`

- [ ] **Step 1: Write smoke script**

Create `scripts/smoke_hyperliquid.py`:

```python
"""One-shot smoke test: fetch real OHLCV for each configured coin and print latest candle."""

import sys
sys.path.insert(0, ".")

from backend.config import settings
from backend.data.hyperliquid_fetcher import HyperliquidFetcher


def main() -> None:
    f = HyperliquidFetcher()
    for coin in settings.coins:
        try:
            df = f.fetch_ohlcv(coin, "5m", limit=3)
            last = df.iloc[-1]
            max_lev = f.get_max_leverage(coin)
            print(f"{coin:6s}  close=${last['Close']:>12,.4f}  vol={last['Volume']:>12,.2f}  max_lev={max_lev}x")
        except Exception as e:
            print(f"{coin:6s}  FAIL: {e}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run smoke test**

Run: `./.venv/bin/python scripts/smoke_hyperliquid.py`
Expected: One line per coin with close price, volume, and max leverage. No FAILs. If a particular coin fails, note which (some symbols may not exist on HL; report to user).

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke_hyperliquid.py
git commit -m "test: smoke script for live Hyperliquid fetch"
```

---

## Phase 2 — Strategy

### Task 6: ATR indicator utility

**Files:**
- Create: `backend/strategy/atr.py`
- Create: `tests/strategy/test_atr.py`

- [ ] **Step 1: Write the failing test**

Create `tests/strategy/__init__.py` (empty) and `tests/strategy/test_atr.py`:

```python
"""Tests for ATR (Average True Range) calculation."""

import numpy as np
import pandas as pd
import pytest

from backend.strategy.atr import compute_atr


def _make_df(highs, lows, closes):
    return pd.DataFrame({"High": highs, "Low": lows, "Close": closes})


def test_atr_known_values():
    # 5 candles, period=3 — manually verified TR series
    df = _make_df(
        highs= [10, 12, 11, 13, 14],
        lows=  [ 9, 10, 10, 11, 12],
        closes=[ 9, 11, 10, 12, 13],
    )
    atr = compute_atr(df, period=3)
    # TR series: row 0 = 1 (10-9), row 1 = max(12-10, |12-9|, |10-9|) = 3
    # row 2 = max(11-10, |11-11|, |10-11|) = 1
    # row 3 = max(13-11, |13-10|, |11-10|) = 3
    # row 4 = max(14-12, |14-12|, |12-12|) = 2
    # Wilder's smoothing on 3-period: atr[2] = mean(1,3,1) = 1.667
    # atr[3] = (atr[2]*(3-1) + TR[3])/3 = (1.667*2 + 3)/3 = 2.111
    # atr[4] = (2.111*2 + 2)/3 = 2.074
    assert atr.iloc[-1] == pytest.approx(2.074, abs=0.01)


def test_atr_returns_series_same_length():
    df = _make_df(highs=[10]*20, lows=[9]*20, closes=[9.5]*20)
    atr = compute_atr(df, period=14)
    assert len(atr) == 20
    # Flat data → ATR should be 1.0 (high-low)
    assert atr.iloc[-1] == pytest.approx(1.0)


def test_atr_handles_short_series_gracefully():
    df = _make_df(highs=[10, 11], lows=[9, 10], closes=[9, 10])
    atr = compute_atr(df, period=14)
    # Series shorter than period → still returns same length, fills with NaN early
    assert len(atr) == 2
```

- [ ] **Step 2: Run test, expect failure**

Run: `./.venv/bin/python -m pytest tests/strategy/test_atr.py -v`
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement ATR**

Create `backend/strategy/atr.py`:

```python
"""ATR (Average True Range) — Wilder's smoothing."""

import pandas as pd


def compute_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Return ATR series aligned to df.index. Uses Wilder's smoothing."""
    high = df["High"]
    low = df["Low"]
    close = df["Close"]

    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    tr.iloc[0] = high.iloc[0] - low.iloc[0]  # first row has no prev close

    # Wilder smoothing: equivalent to EMA with alpha = 1/period
    atr = tr.ewm(alpha=1.0 / period, adjust=False).mean()
    return atr
```

- [ ] **Step 4: Run tests, expect pass**

Run: `./.venv/bin/python -m pytest tests/strategy/test_atr.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/strategy/atr.py tests/strategy/__init__.py tests/strategy/test_atr.py
git commit -m "feat(strategy): ATR utility with Wilder smoothing"
```

---

### Task 7: Golden Pocket strategy

**Files:**
- Create: `backend/strategy/golden_pocket.py`
- Create: `tests/strategy/test_golden_pocket.py`

- [ ] **Step 1: Write failing tests**

Create `tests/strategy/test_golden_pocket.py`:

```python
"""Tests for GoldenPocketStrategy — swing detection, golden pocket touch, signal generation."""

import numpy as np
import pandas as pd
import pytest

from backend.strategy.golden_pocket import GoldenPocketStrategy, Signal


def _make_df_from_closes(closes, start_ts="2026-01-01"):
    """Build OHLCV df where O=H=L=C (synthetic, clean ratios for testing)."""
    idx = pd.date_range(start=start_ts, periods=len(closes), freq="5min", tz="UTC")
    return pd.DataFrame({
        "Open": closes, "High": closes, "Low": closes, "Close": closes, "Volume": [1000.0] * len(closes),
    }, index=idx)


def test_detect_swing_high_and_low():
    # Rising 100→150, falling back to 130, on 5m
    closes = list(np.linspace(100, 150, 100)) + list(np.linspace(150, 130, 50))
    df = _make_df_from_closes(closes)
    s = GoldenPocketStrategy()
    swing = s.detect_swing(df, lookback=150)
    assert swing.high == pytest.approx(150.0, abs=0.5)
    assert swing.low == pytest.approx(100.0, abs=0.5)
    assert swing.direction == "UP"


def test_golden_pocket_zone_calculation_for_long():
    s = GoldenPocketStrategy()
    # Swing low 100, high 200, UP swing — retracement DOWN to 50%-61.8% = 150-138.20
    zone = s.golden_pocket_zone(swing_low=100.0, swing_high=200.0, direction="UP")
    assert zone.upper == pytest.approx(150.0, abs=0.01)   # 50% = 100 + (200-100)*0.5
    assert zone.lower == pytest.approx(138.20, abs=0.01)  # 61.8% = 100 + (200-100)*0.382


def test_price_inside_golden_pocket_triggers_long():
    s = GoldenPocketStrategy()
    # UP swing 100→200, retracement to 145 (inside golden pocket)
    closes = list(np.linspace(100, 200, 50)) + list(np.linspace(200, 145, 20))
    df = _make_df_from_closes(closes)
    mtf_trend = {"1h": {"trend": "UP", "slope": 0.005}, "15m": {"trend": "UP", "slope": 0.003}}
    signal = s.analyze(df, mtf_trend=mtf_trend, coin="BTC")
    assert signal is not None
    assert signal.direction == "LONG"
    assert 138.20 <= signal.entry_price <= 150.0


def test_no_signal_when_price_outside_golden_pocket():
    s = GoldenPocketStrategy()
    # Price only retraced to 180 (above golden pocket)
    closes = list(np.linspace(100, 200, 50)) + list(np.linspace(200, 180, 20))
    df = _make_df_from_closes(closes)
    mtf_trend = {"1h": {"trend": "UP", "slope": 0.005}, "15m": {"trend": "UP", "slope": 0.003}}
    assert s.analyze(df, mtf_trend=mtf_trend, coin="BTC") is None


def test_no_signal_when_mtf_disagrees():
    s = GoldenPocketStrategy()
    closes = list(np.linspace(100, 200, 50)) + list(np.linspace(200, 145, 20))
    df = _make_df_from_closes(closes)
    mtf_trend = {"1h": {"trend": "DOWN", "slope": -0.005}, "15m": {"trend": "UP", "slope": 0.003}}
    assert s.analyze(df, mtf_trend=mtf_trend, coin="BTC") is None
```

- [ ] **Step 2: Run tests, expect failure**

Run: `./.venv/bin/python -m pytest tests/strategy/test_golden_pocket.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement Golden Pocket strategy**

Create `backend/strategy/golden_pocket.py`:

```python
"""Golden Pocket Fibonacci strategy — fires only on 50%-61.8% retracement zone."""

from dataclasses import dataclass
from typing import Dict, Optional, Literal

import pandas as pd

from backend.config import settings
from backend.strategy.atr import compute_atr


@dataclass
class Swing:
    high: float
    low: float
    high_idx: pd.Timestamp
    low_idx: pd.Timestamp
    direction: Literal["UP", "DOWN"]  # whether swing went up (low→high) or down


@dataclass
class GoldenPocketZone:
    upper: float  # 50% level
    lower: float  # 61.8% level


@dataclass
class Signal:
    coin: str
    direction: Literal["LONG", "SHORT"]
    entry_price: float
    stop_loss: float
    tp1: float
    tp2: float
    fib_level_triggered: float  # 0.5 or 0.618
    swing_high: float
    swing_low: float
    atr: float
    timestamp: pd.Timestamp


class GoldenPocketStrategy:
    """Detects retracements into the 50%-61.8% Fib zone in a trending market."""

    GOLDEN_LOW = 0.382   # 1 - 0.618 → in retracement terms, deeper level
    GOLDEN_HIGH = 0.5    # 1 - 0.5  → shallower level

    def detect_swing(self, df: pd.DataFrame, lookback: int = 200) -> Swing:
        """Find the most recent dominant swing in the last `lookback` candles."""
        recent = df.tail(lookback)
        high_idx = recent["High"].idxmax()
        low_idx = recent["Low"].idxmin()
        high = float(recent.loc[high_idx, "High"])
        low = float(recent.loc[low_idx, "Low"])
        direction = "UP" if high_idx > low_idx else "DOWN"
        return Swing(high=high, low=low, high_idx=high_idx, low_idx=low_idx, direction=direction)

    def golden_pocket_zone(self, swing_low: float, swing_high: float, direction: str) -> GoldenPocketZone:
        """Return the price zone bounded by 50% and 61.8% retracement."""
        rng = swing_high - swing_low
        if direction == "UP":
            # Retracement DOWN from high → 50% = high - 0.5*rng, 61.8% = high - 0.618*rng
            upper = swing_high - 0.5 * rng
            lower = swing_high - 0.618 * rng
        else:
            # Retracement UP from low → 50% = low + 0.5*rng, 61.8% = low + 0.618*rng
            upper = swing_low + 0.618 * rng
            lower = swing_low + 0.5 * rng
        return GoldenPocketZone(upper=upper, lower=lower)

    def _stop_loss(self, entry: float, atr: float, swing_high: float, swing_low: float, direction: str) -> float:
        """Hybrid SL — whichever is FURTHER from entry: 78.6% Fib break or 1.5*ATR offset."""
        rng = swing_high - swing_low
        if direction == "LONG":
            sl_fib_break = swing_high - 0.786 * rng
            sl_atr = entry - settings.atr_sl_multiplier * atr
            return min(sl_fib_break, sl_atr)  # lower = further from entry
        else:
            sl_fib_break = swing_low + 0.786 * rng
            sl_atr = entry + settings.atr_sl_multiplier * atr
            return max(sl_fib_break, sl_atr)  # higher = further from entry

    def _take_profits(self, entry: float, stop_loss: float, swing_high: float, swing_low: float, direction: str) -> tuple[float, float]:
        """TP1 = 1.5 R:R, TP2 = 1.618 Fib extension of the swing."""
        risk = abs(entry - stop_loss)
        rng = swing_high - swing_low
        if direction == "LONG":
            tp1 = entry + 1.5 * risk
            tp2 = swing_high + 0.618 * rng
        else:
            tp1 = entry - 1.5 * risk
            tp2 = swing_low - 0.618 * rng
        return tp1, tp2

    def analyze(self, df: pd.DataFrame, mtf_trend: Dict, coin: str) -> Optional[Signal]:
        """Return a Signal if a clean golden pocket setup is present, else None."""
        if len(df) < 50:
            return None

        # MTF gate — 1h and 15m must agree
        trend_1h = mtf_trend.get("1h", {}).get("trend")
        trend_15m = mtf_trend.get("15m", {}).get("trend")
        slope_1h = abs(mtf_trend.get("1h", {}).get("slope", 0))

        if trend_1h not in ("UP", "DOWN"):
            return None
        if trend_15m != trend_1h:
            return None
        if slope_1h < settings.min_slope_pct:
            return None

        # Direction is set by trend, not swing
        direction: Literal["LONG", "SHORT"] = "LONG" if trend_1h == "UP" else "SHORT"

        swing = self.detect_swing(df, lookback=200)
        zone = self.golden_pocket_zone(swing.low, swing.high, swing.direction)

        # Last candle's close (body close requirement)
        last_close = float(df["Close"].iloc[-1])

        # Check that close sits inside the zone, and the candle direction matches the trade direction
        if direction == "LONG":
            if not (zone.lower <= last_close <= zone.upper):
                return None
            if swing.direction != "UP":  # swing must be UP for a LONG retracement entry
                return None
        else:
            if not (zone.lower <= last_close <= zone.upper):
                return None
            if swing.direction != "DOWN":
                return None

        # Quality gate: swing range must be ≥ 1.5× ATR
        atr_series = compute_atr(df, period=settings.atr_period)
        atr = float(atr_series.iloc[-1])
        if (swing.high - swing.low) < 1.5 * atr:
            return None

        entry = last_close
        sl = self._stop_loss(entry, atr, swing.high, swing.low, direction)
        tp1, tp2 = self._take_profits(entry, sl, swing.high, swing.low, direction)

        # Pick the closer Fib level for reporting (50% if closer to upper, 61.8% if closer to lower)
        fib_triggered = 0.5 if abs(last_close - zone.upper) < abs(last_close - zone.lower) else 0.618

        return Signal(
            coin=coin,
            direction=direction,
            entry_price=entry,
            stop_loss=sl,
            tp1=tp1,
            tp2=tp2,
            fib_level_triggered=fib_triggered,
            swing_high=swing.high,
            swing_low=swing.low,
            atr=atr,
            timestamp=df.index[-1],
        )
```

- [ ] **Step 4: Run tests, expect pass**

Run: `./.venv/bin/python -m pytest tests/strategy/test_golden_pocket.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/strategy/golden_pocket.py tests/strategy/test_golden_pocket.py
git commit -m "feat(strategy): golden pocket Fibonacci with hybrid SL and 2-stage TP"
```

---

### Task 8: Confidence scorer (heuristic v1)

**Files:**
- Create: `backend/engine/confidence_scorer.py`
- Create: `tests/engine/test_confidence_scorer.py`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/__init__.py` (empty) and `tests/engine/test_confidence_scorer.py`:

```python
"""Tests for ConfidenceScorer — heuristic v1."""

from dataclasses import dataclass

import pandas as pd
import pytest

from backend.engine.confidence_scorer import ConfidenceScorer


@dataclass
class FakeSignal:
    direction: str = "LONG"
    entry_price: float = 100.0
    stop_loss: float = 95.0
    swing_high: float = 110.0
    swing_low: float = 90.0
    atr: float = 1.5
    fib_level_triggered: float = 0.5


def _df_with_volume(volume_pattern):
    closes = [100.0] * len(volume_pattern)
    idx = pd.date_range("2026-01-01", periods=len(volume_pattern), freq="5min", tz="UTC")
    return pd.DataFrame({
        "Open": closes, "High": closes, "Low": closes, "Close": closes, "Volume": volume_pattern,
    }, index=idx)


def test_full_alignment_high_score():
    scorer = ConfidenceScorer()
    df = _df_with_volume([1000.0] * 19 + [2000.0])
    mtf = {"1h": {"trend": "UP", "slope": 0.012}, "15m": {"trend": "UP"}, "5m": {"trend": "UP"}}
    score = scorer.score(signal=FakeSignal(), df=df, mtf_trend=mtf)
    assert score > 70.0


def test_partial_alignment_lower_score():
    scorer = ConfidenceScorer()
    df = _df_with_volume([1000.0] * 20)
    mtf = {"1h": {"trend": "UP", "slope": 0.003}, "15m": {"trend": "DOWN"}, "5m": {"trend": "UP"}}
    score = scorer.score(signal=FakeSignal(), df=df, mtf_trend=mtf)
    assert score < 50.0


def test_score_capped_at_95():
    scorer = ConfidenceScorer()
    df = _df_with_volume([1000.0] * 19 + [3000.0])
    mtf = {"1h": {"trend": "UP", "slope": 0.05}, "15m": {"trend": "UP"}, "5m": {"trend": "UP"}}
    sig = FakeSignal(stop_loss=99.5)  # very tight SL — high confidence factor
    score = scorer.score(signal=sig, df=df, mtf_trend=mtf)
    assert score <= 95.0


def test_score_is_non_negative():
    scorer = ConfidenceScorer()
    df = _df_with_volume([1000.0] * 20)
    mtf = {"1h": {"trend": None, "slope": 0.0}}
    score = scorer.score(signal=FakeSignal(), df=df, mtf_trend=mtf)
    assert score >= 0.0
```

- [ ] **Step 2: Run test, expect failure**

Run: `./.venv/bin/python -m pytest tests/engine/test_confidence_scorer.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement scorer**

Create `backend/engine/confidence_scorer.py`:

```python
"""Heuristic v1 confidence scoring for golden pocket signals. v2 (historical) hooks in later."""

import pandas as pd


class ConfidenceScorer:
    """Returns 0-95 confidence score for a Signal given context."""

    # Weights — should sum to 100
    W_MTF       = 25
    W_SLOPE     = 20
    W_PATTERN   = 20
    W_VOLUME    = 15
    W_EMA       = 10
    W_ATR_SANE  = 10

    def score(self, signal, df: pd.DataFrame, mtf_trend: dict) -> float:
        """Aggregate weighted heuristics into a single 0-95 score."""
        score = 0.0
        score += self._mtf_alignment(mtf_trend, signal.direction) * self.W_MTF
        score += self._slope_strength(mtf_trend) * self.W_SLOPE
        score += self._candle_pattern(df, signal.direction) * self.W_PATTERN
        score += self._volume_signal(df) * self.W_VOLUME
        score += self._ema_confluence(df, signal) * self.W_EMA
        score += self._atr_sanity(signal) * self.W_ATR_SANE
        return max(0.0, min(95.0, score))

    # --- factors return 0.0–1.0 ---

    def _mtf_alignment(self, mtf: dict, direction: str) -> float:
        wanted = "UP" if direction == "LONG" else "DOWN"
        aligned = sum(1 for tf in ("1h", "15m", "5m") if mtf.get(tf, {}).get("trend") == wanted)
        return {3: 1.0, 2: 0.6, 1: 0.0, 0: 0.0}.get(aligned, 0.0)

    def _slope_strength(self, mtf: dict) -> float:
        slope = abs(mtf.get("1h", {}).get("slope", 0.0))
        # Linear scale: 0.2% → 0, 1% → 1.0
        if slope < 0.002:
            return 0.0
        if slope >= 0.01:
            return 1.0
        return (slope - 0.002) / (0.01 - 0.002)

    def _candle_pattern(self, df: pd.DataFrame, direction: str) -> float:
        """Engulfing/hammer = 1.0, pin = 0.75, doji = 0.4, nothing = 0."""
        if len(df) < 2:
            return 0.0
        last = df.iloc[-1]
        prev = df.iloc[-2]
        body = abs(last["Close"] - last["Open"])
        rng = last["High"] - last["Low"]
        if rng <= 0:
            return 0.0
        upper_wick = last["High"] - max(last["Close"], last["Open"])
        lower_wick = min(last["Close"], last["Open"]) - last["Low"]

        # Engulfing
        prev_body = abs(prev["Close"] - prev["Open"])
        if body > prev_body * 1.5:
            if direction == "LONG" and last["Close"] > last["Open"] and last["Close"] > prev["Open"]:
                return 1.0
            if direction == "SHORT" and last["Close"] < last["Open"] and last["Close"] < prev["Open"]:
                return 1.0

        # Hammer / inverted hammer (long lower or upper wick with small body)
        if body < rng * 0.35:
            if direction == "LONG" and lower_wick > body * 2:
                return 1.0
            if direction == "SHORT" and upper_wick > body * 2:
                return 1.0
            # Pin bar (smaller wick)
            if direction == "LONG" and lower_wick > body:
                return 0.75
            if direction == "SHORT" and upper_wick > body:
                return 0.75

        # Doji
        if body < rng * 0.1:
            return 0.4
        return 0.0

    def _volume_signal(self, df: pd.DataFrame) -> float:
        if len(df) < 21:
            return 0.0
        avg = df["Volume"].iloc[-21:-1].mean()
        last = df["Volume"].iloc[-1]
        if avg <= 0:
            return 0.0
        ratio = last / avg
        if ratio >= 1.5:
            return 1.0
        if ratio <= 0.5:
            return 0.0
        return (ratio - 0.5) / 1.0

    def _ema_confluence(self, df: pd.DataFrame, signal) -> float:
        if len(df) < 200:
            return 0.0
        ema50 = df["Close"].ewm(span=50, adjust=False).mean().iloc[-1]
        ema200 = df["Close"].ewm(span=200, adjust=False).mean().iloc[-1]
        threshold = 0.5 * signal.atr
        if abs(signal.entry_price - ema50) < threshold or abs(signal.entry_price - ema200) < threshold:
            return 1.0
        return 0.0

    def _atr_sanity(self, signal) -> float:
        rng = signal.swing_high - signal.swing_low
        if signal.atr <= 0:
            return 0.0
        ratio = rng / signal.atr
        if ratio >= 3.0:
            return 1.0
        if ratio < 1.5:
            return 0.0
        return (ratio - 1.5) / 1.5
```

- [ ] **Step 4: Run tests, expect pass**

Run: `./.venv/bin/python -m pytest tests/engine/test_confidence_scorer.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/engine/confidence_scorer.py tests/engine/__init__.py tests/engine/test_confidence_scorer.py
git commit -m "feat(engine): heuristic v1 confidence scorer"
```

---

### Task 9: Hyperliquid-aware position sizer

**Files:**
- Create: `backend/engine/position_sizer.py`
- Create: `tests/engine/test_position_sizer.py`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/test_position_sizer.py`:

```python
"""Tests for PositionSizer — Hyperliquid-aware sizing."""

import pytest
from backend.engine.position_sizer import PositionSizer, PositionInfo


def test_quantity_from_risk():
    sizer = PositionSizer(risk_per_trade_pct=0.03)
    info = sizer.size(balance=500.0, entry=100.0, stop_loss=95.0, direction="LONG", max_leverage_for_coin=20)
    # risk_amt = 15, stop_dist = 5 → qty = 3
    assert info.quantity == pytest.approx(3.0)
    assert info.notional == pytest.approx(300.0)
    assert info.risk_amount == pytest.approx(15.0)


def test_leverage_capped_by_coin_max():
    sizer = PositionSizer(risk_per_trade_pct=0.10)
    # balance 100, entry 100, sl 99 → risk 10, dist 1 → qty 10 → notional 1000 → suggested leverage 10x
    info = sizer.size(balance=100.0, entry=100.0, stop_loss=99.0, direction="LONG", max_leverage_for_coin=5)
    assert info.suggested_leverage == 5  # capped


def test_liquidation_price_long():
    sizer = PositionSizer(risk_per_trade_pct=0.03)
    info = sizer.size(balance=500.0, entry=100.0, stop_loss=95.0, direction="LONG", max_leverage_for_coin=20)
    assert info.liquidation_price < info.entry_price


def test_liquidation_price_short():
    sizer = PositionSizer(risk_per_trade_pct=0.03)
    info = sizer.size(balance=500.0, entry=100.0, stop_loss=105.0, direction="SHORT", max_leverage_for_coin=20)
    assert info.liquidation_price > info.entry_price


def test_zero_stop_distance_raises():
    sizer = PositionSizer(risk_per_trade_pct=0.03)
    with pytest.raises(ValueError):
        sizer.size(balance=500.0, entry=100.0, stop_loss=100.0, direction="LONG", max_leverage_for_coin=20)
```

- [ ] **Step 2: Run, expect failure**

Run: `./.venv/bin/python -m pytest tests/engine/test_position_sizer.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement sizer**

Create `backend/engine/position_sizer.py`:

```python
"""Hyperliquid-aware position sizing."""

import math
from dataclasses import dataclass


MAINTENANCE_MARGIN_PCT = 0.0125  # Hyperliquid default ~1.25%


@dataclass
class PositionInfo:
    quantity: float
    notional: float
    suggested_leverage: int
    initial_margin: float
    maintenance_margin: float
    liquidation_price: float
    risk_amount: float
    entry_price: float
    stop_loss: float
    direction: str
    funding_rate_hr: float = 0.0


class PositionSizer:
    def __init__(self, risk_per_trade_pct: float):
        self.risk_per_trade_pct = risk_per_trade_pct

    def size(
        self,
        balance: float,
        entry: float,
        stop_loss: float,
        direction: str,
        max_leverage_for_coin: int,
        funding_rate_hr: float = 0.0,
    ) -> PositionInfo:
        stop_distance = abs(entry - stop_loss)
        if stop_distance <= 0:
            raise ValueError("Stop distance cannot be zero")

        risk_amount = balance * self.risk_per_trade_pct
        quantity = risk_amount / stop_distance
        notional = quantity * entry

        # Suggested leverage = ceil(notional / balance), capped per coin
        raw_leverage = max(1, math.ceil(notional / balance))
        suggested_leverage = min(raw_leverage, max_leverage_for_coin)

        initial_margin = notional / suggested_leverage
        maintenance_margin = notional * MAINTENANCE_MARGIN_PCT

        # Liquidation: equity = margin minus loss. Liquidation when equity falls to maintenance margin.
        # Loss to liquidation = initial_margin - maintenance_margin
        # Liquidation price = entry ∓ (loss_per_unit) where loss_per_unit = loss / qty
        liquidation_loss = max(initial_margin - maintenance_margin, 0)
        loss_per_unit = liquidation_loss / quantity if quantity > 0 else 0
        if direction == "LONG":
            liquidation_price = entry - loss_per_unit
        else:
            liquidation_price = entry + loss_per_unit

        return PositionInfo(
            quantity=quantity,
            notional=notional,
            suggested_leverage=suggested_leverage,
            initial_margin=initial_margin,
            maintenance_margin=maintenance_margin,
            liquidation_price=liquidation_price,
            risk_amount=risk_amount,
            entry_price=entry,
            stop_loss=stop_loss,
            direction=direction,
            funding_rate_hr=funding_rate_hr,
        )
```

- [ ] **Step 4: Run tests, expect pass**

Run: `./.venv/bin/python -m pytest tests/engine/test_position_sizer.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/engine/position_sizer.py tests/engine/test_position_sizer.py
git commit -m "feat(engine): Hyperliquid-aware position sizer (notional, margin, liquidation)"
```

---

### Task 10: Daily-loss guard / quality gate

**Files:**
- Create: `backend/engine/quality_filter.py`
- Create: `tests/engine/test_quality_filter.py`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/test_quality_filter.py`:

```python
from backend.engine.quality_filter import QualityFilter


def test_passes_when_under_limits():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=2, daily_pnl=-10, balance=500, confidence=70) is True


def test_rejects_when_daily_loss_hit():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=0, daily_pnl=-100, balance=500, confidence=80) is False


def test_rejects_when_too_many_open_trades():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=3, daily_pnl=0, balance=500, confidence=80) is False


def test_rejects_low_confidence():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=0, daily_pnl=0, balance=500, confidence=55) is False
```

- [ ] **Step 2: Run, expect failure**

Run: `./.venv/bin/python -m pytest tests/engine/test_quality_filter.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `backend/engine/quality_filter.py`:

```python
"""Final gate before paper-executing a signal."""

from dataclasses import dataclass


@dataclass
class QualityFilter:
    daily_loss_limit_pct: float
    max_open_trades: int
    min_confidence_pct: float

    def accept(self, *, open_trades_count: int, daily_pnl: float, balance: float, confidence: float) -> bool:
        if confidence < self.min_confidence_pct:
            return False
        if open_trades_count >= self.max_open_trades:
            return False
        if balance > 0 and (daily_pnl / balance) <= -self.daily_loss_limit_pct:
            return False
        return True
```

- [ ] **Step 4: Run, expect pass**

Run: `./.venv/bin/python -m pytest tests/engine/test_quality_filter.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/engine/quality_filter.py tests/engine/test_quality_filter.py
git commit -m "feat(engine): quality filter — daily loss, max trades, min confidence gates"
```

---

## Phase 3 — Output

### Task 11: TradingView-style chart generator

**Files:**
- Create: `backend/notifications/chart_generator.py`
- Create: `backend/notifications/__init__.py` (empty)
- Create: `tests/notifications/__init__.py` (empty)
- Create: `tests/notifications/test_chart_generator.py`

- [ ] **Step 1: Write a smoke test that verifies a PNG is produced**

Create `tests/notifications/test_chart_generator.py`:

```python
"""Smoke test for chart_generator — PNG bytes are produced and non-empty."""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.notifications.chart_generator import ChartGenerator


@dataclass
class FakeSignal:
    coin: str = "BTC"
    direction: str = "LONG"
    entry_price: float = 100.0
    stop_loss: float = 95.0
    tp1: float = 107.5
    tp2: float = 120.0
    fib_level_triggered: float = 0.5
    swing_high: float = 110.0
    swing_low: float = 90.0
    atr: float = 1.5
    timestamp: pd.Timestamp = pd.Timestamp("2026-05-17 14:32", tz="UTC")


def _make_df(n=500):
    base = 100.0
    rng = np.random.RandomState(42)
    closes = base + np.cumsum(rng.randn(n) * 0.5)
    idx = pd.date_range("2026-05-15", periods=n, freq="5min", tz="UTC")
    return pd.DataFrame({
        "Open": closes - 0.1,
        "High": closes + 0.3,
        "Low": closes - 0.3,
        "Close": closes,
        "Volume": rng.randint(500, 1500, n).astype(float),
    }, index=idx)


def test_chart_generator_produces_png_bytes():
    df = _make_df()
    gen = ChartGenerator(width=1600, height=800)
    png = gen.render(df=df, signal=FakeSignal(), confidence=72.0)
    assert isinstance(png, bytes)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(png) > 5_000  # non-empty PNG


def test_chart_generator_with_exit_marker():
    df = _make_df()
    gen = ChartGenerator(width=1600, height=800)
    png = gen.render(
        df=df,
        signal=FakeSignal(),
        confidence=72.0,
        exit_price=105.0,
        exit_timestamp=df.index[-50],
        exit_reason="TP1",
    )
    assert isinstance(png, bytes)
    assert len(png) > 5_000
```

- [ ] **Step 2: Run, expect failure**

Run: `./.venv/bin/python -m pytest tests/notifications/test_chart_generator.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement chart generator**

Create `backend/notifications/__init__.py` (empty file).

Create `backend/notifications/chart_generator.py`:

```python
"""TradingView-style chart PNG renderer using plotly + kaleido."""

from dataclasses import dataclass
from typing import Optional

import pandas as pd
import plotly.graph_objects as go


# Color constants — match TradingView dark theme
BG          = "#131722"
GRID        = "#1e2230"
CANDLE_UP   = "#26a69a"
CANDLE_DOWN = "#ef5350"
TEXT_DIM    = "#787b86"
TEXT_BRIGHT = "#d1d4dc"

# Fib level colors
COLOR_0       = "#787b86"
COLOR_236     = "#ef5350"
COLOR_382     = "#ffc107"
COLOR_50      = "#4caf50"
COLOR_618     = "#26a69a"
COLOR_786     = "#2196f3"
GOLDEN_GOLD   = "#ffd700"

# Band fills (low opacity)
BAND_0_236    = "rgba(183, 28, 28, 0.10)"
BAND_236_382  = "rgba(230, 81, 0, 0.10)"
BAND_382_50   = "rgba(51, 105, 30, 0.10)"
BAND_GOLDEN   = "rgba(255, 215, 0, 0.18)"  # 50%→61.8% gold highlight
BAND_618_786  = "rgba(0, 96, 100, 0.10)"
BAND_786_100  = "rgba(13, 71, 161, 0.10)"


class ChartGenerator:
    def __init__(self, width: int = 1600, height: int = 800):
        self.width = width
        self.height = height

    def render(
        self,
        df: pd.DataFrame,
        signal,
        confidence: float,
        exit_price: Optional[float] = None,
        exit_timestamp: Optional[pd.Timestamp] = None,
        exit_reason: Optional[str] = None,
    ) -> bytes:
        swing_low = signal.swing_low
        swing_high = signal.swing_high
        rng = swing_high - swing_low

        # Fib level prices (using TradingView convention: 0 at swing low, 1 at swing high)
        levels = {
            "0":     swing_low,
            "0.236": swing_low + 0.236 * rng,
            "0.382": swing_low + 0.382 * rng,
            "0.5":   swing_low + 0.5 * rng,
            "0.618": swing_low + 0.618 * rng,
            "0.786": swing_low + 0.786 * rng,
            "1":     swing_high,
        }

        fig = go.Figure()

        # Candles
        fig.add_trace(go.Candlestick(
            x=df.index,
            open=df["Open"], high=df["High"], low=df["Low"], close=df["Close"],
            increasing=dict(line=dict(color=CANDLE_UP), fillcolor=CANDLE_UP),
            decreasing=dict(line=dict(color=CANDLE_DOWN), fillcolor=CANDLE_DOWN),
            name="Price",
            showlegend=False,
        ))

        # Band fills (between Fib levels) — shapes
        x0, x1 = df.index[0], df.index[-1]
        shapes = []

        bands = [
            ("0",     "0.236", BAND_0_236),
            ("0.236", "0.382", BAND_236_382),
            ("0.382", "0.5",   BAND_382_50),
            ("0.5",   "0.618", BAND_GOLDEN),    # GOLDEN POCKET
            ("0.618", "0.786", BAND_618_786),
            ("0.786", "1",     BAND_786_100),
        ]
        for lo, hi, color in bands:
            shapes.append(dict(
                type="rect", xref="x", yref="y",
                x0=x0, x1=x1, y0=levels[lo], y1=levels[hi],
                fillcolor=color, line=dict(width=0), layer="below",
            ))

        # Solid horizontal Fib lines with labels on left
        line_specs = [
            ("0",     COLOR_0,   "solid"),
            ("0.236", COLOR_236, "dash"),
            ("0.382", COLOR_382, "dash"),
            ("0.5",   COLOR_50,  "solid"),
            ("0.618", COLOR_618, "solid"),
            ("0.786", COLOR_786, "dash"),
            ("1",     COLOR_0,   "solid"),
        ]
        for label, color, dash in line_specs:
            price = levels[label]
            fig.add_hline(y=price, line=dict(color=color, width=1.5, dash=dash),
                          annotation_text=f"{label} ({price:.4f})",
                          annotation_position="left",
                          annotation_font=dict(color=color, size=10))

        # Golden pocket border (extra emphasis)
        fig.add_hline(y=levels["0.5"],   line=dict(color=GOLDEN_GOLD, width=2))
        fig.add_hline(y=levels["0.618"], line=dict(color=GOLDEN_GOLD, width=2))
        fig.add_annotation(
            x=df.index[int(len(df) * 0.92)],
            y=(levels["0.5"] + levels["0.618"]) / 2,
            text="<b>GOLDEN POCKET</b>",
            showarrow=False,
            font=dict(color=GOLDEN_GOLD, size=14),
        )

        # Diagonal swing connector (grey dashed, swing low → swing high)
        shapes.append(dict(
            type="line", xref="x", yref="y",
            x0=df.index[0], x1=df.index[-1],
            y0=swing_low, y1=swing_high,
            line=dict(color=TEXT_DIM, width=1, dash="dash"),
            layer="below",
        ))

        # Trade overlay — entry, SL, TP1, TP2
        for price, color, label, dash in [
            (signal.entry_price, "#2196f3", f"{signal.direction} @ {signal.entry_price:.4f}", "solid"),
            (signal.stop_loss,   "#ef4444", f"SL @ {signal.stop_loss:.4f}", "dash"),
            (signal.tp1,         "#26a69a", f"TP1 (1:1.5) @ {signal.tp1:.4f}", "dash"),
            (signal.tp2,         "#00e676", f"TP2 (1.618 ext) @ {signal.tp2:.4f}", "dash"),
        ]:
            fig.add_hline(y=price, line=dict(color=color, width=1.5, dash=dash),
                          annotation_text=label, annotation_position="right",
                          annotation_font=dict(color=color, size=10))

        # Exit marker if present
        if exit_price is not None and exit_timestamp is not None:
            fig.add_trace(go.Scatter(
                x=[exit_timestamp], y=[exit_price],
                mode="markers+text",
                marker=dict(symbol="x", size=14, color="#f59e0b", line=dict(width=2)),
                text=[f" EXIT: {exit_reason}"],
                textposition="middle right",
                textfont=dict(color="#f59e0b", size=11),
                showlegend=False,
            ))

        # Title bar
        title = f"<b>{signal.coin}/USDC</b> &nbsp; · &nbsp; Golden Pocket {signal.direction} &nbsp; · &nbsp; Confidence {confidence:.0f}%"
        if exit_reason:
            title += f" &nbsp; · &nbsp; <b>{exit_reason}</b>"

        fig.update_layout(
            title=dict(text=title, font=dict(color=TEXT_BRIGHT, size=14), x=0.02, xanchor="left"),
            paper_bgcolor=BG,
            plot_bgcolor=BG,
            xaxis=dict(
                gridcolor=GRID, color=TEXT_DIM,
                rangeslider=dict(visible=False),
                showspikes=False,
            ),
            yaxis=dict(
                gridcolor=GRID, color=TEXT_DIM,
                side="right",
            ),
            shapes=shapes,
            margin=dict(l=80, r=120, t=50, b=40),
            width=self.width, height=self.height,
            font=dict(family="Trebuchet MS, sans-serif"),
        )

        return fig.to_image(format="png", engine="kaleido")
```

- [ ] **Step 4: Run tests**

Run: `./.venv/bin/python -m pytest tests/notifications/test_chart_generator.py -v`
Expected: 2 passed. (Note: requires kaleido to be installed. If it complains about a missing Chromium dependency, run `./.venv/bin/python -m kaleido.scopes.plotly._scope` or upgrade pin.)

- [ ] **Step 5: Eyeball the chart manually**

Run:

```bash
./.venv/bin/python -c "
import numpy as np, pandas as pd
from dataclasses import dataclass
from backend.notifications.chart_generator import ChartGenerator

@dataclass
class S:
    coin='BTC'; direction='LONG'; entry_price=100.0; stop_loss=95.0
    tp1=107.5; tp2=120.0; fib_level_triggered=0.5
    swing_high=110.0; swing_low=90.0; atr=1.5
    timestamp=pd.Timestamp('2026-05-17',tz='UTC')

rng = np.random.RandomState(42)
closes = 100 + np.cumsum(rng.randn(500)*0.5)
idx = pd.date_range('2026-05-15', periods=500, freq='5min', tz='UTC')
df = pd.DataFrame({'Open':closes-0.1,'High':closes+0.3,'Low':closes-0.3,'Close':closes,'Volume':rng.randint(500,1500,500).astype(float)}, index=idx)

png = ChartGenerator().render(df=df, signal=S(), confidence=72.0)
open('/tmp/hermes_chart.png','wb').write(png)
print('Wrote /tmp/hermes_chart.png', len(png), 'bytes')
"
```

Open `/tmp/hermes_chart.png` and visually confirm: dark background, Fib lines at the right colors, golden pocket gold band clearly visible between 50% and 61.8%, entry/SL/TP1/TP2 lines on the right, "GOLDEN POCKET" label near the right margin.

- [ ] **Step 6: Commit**

```bash
git add backend/notifications/__init__.py backend/notifications/chart_generator.py tests/notifications/__init__.py tests/notifications/test_chart_generator.py
git commit -m "feat(chart): TradingView-style chart generator with golden pocket highlight"
```

---

### Task 12: Discord webhook notifier

**Files:**
- Create: `backend/notifications/discord_notifier.py`
- Create: `tests/notifications/test_discord_notifier.py`

- [ ] **Step 1: Write failing test**

Create `tests/notifications/test_discord_notifier.py`:

```python
"""Tests for DiscordNotifier — embed structure and POST shape."""

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from backend.notifications.discord_notifier import DiscordNotifier


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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_skips_when_webhook_url_empty():
    n = DiscordNotifier(webhook_url="")
    # Should not raise, just no-op
    await n.send_signal(
        signal=FakeSignal(), position=FakePos(), confidence=72.0, balance=500.0,
        mtf_summary="", png_bytes=b"", strategy_summary="",
    )
```

Add to top of `tests/notifications/test_discord_notifier.py`:

```python
pytestmark = pytest.mark.asyncio
```

Also install pytest-asyncio:

Run: `./.venv/bin/pip install pytest-asyncio`

And add `pytest-asyncio` to `backend/requirements.txt` (under test deps section if you want it grouped, or just append).

- [ ] **Step 2: Run, expect failure**

Run: `./.venv/bin/python -m pytest tests/notifications/test_discord_notifier.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement notifier**

Create `backend/notifications/discord_notifier.py`:

```python
"""Discord webhook notifier — posts embed + chart PNG attachment."""

import io
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
                {"name": "Fib Level", "value": f"{signal.fib_level_triggered*100:.1f}%", "inline": True},
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
            "footer": {"text": f"Paper trade · Hermes v2 · Balance ${balance:.2f}"},
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
            "footer": {"text": "Hermes v2"},
        }
        await self._post(payload={"embeds": [embed]}, png_bytes=png_bytes)

    async def _post(self, payload: dict, png_bytes: bytes) -> None:
        form = aiohttp.FormData()
        form.add_field("payload_json", _json_dumps(payload), content_type="application/json")
        if png_bytes:
            form.add_field("file", io.BytesIO(png_bytes), filename="chart.png", content_type="image/png")

        async with aiohttp.ClientSession() as session:
            async with session.post(self.webhook_url, data=form) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    logger.warning(f"Discord webhook failed {resp.status}: {body}")


def _json_dumps(d: dict) -> str:
    import json
    return json.dumps(d)
```

- [ ] **Step 4: Run tests, expect pass**

Run: `./.venv/bin/python -m pytest tests/notifications/test_discord_notifier.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/notifications/discord_notifier.py tests/notifications/test_discord_notifier.py backend/requirements.txt
git commit -m "feat(notify): Discord webhook notifier with embed + chart attachment"
```

---

## Phase 4 — Orchestration

### Task 13: CoinScanner — per-coin async unit

**Files:**
- Create: `backend/scanner/__init__.py` (empty)
- Create: `backend/scanner/coin_scanner.py`
- Create: `tests/scanner/__init__.py` (empty)
- Create: `tests/scanner/test_coin_scanner.py`

- [ ] **Step 1: Write failing test**

Create `tests/scanner/test_coin_scanner.py`:

```python
"""Tests for CoinScanner — per-coin pipeline."""

from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from backend.scanner.coin_scanner import CoinScanner


def _df(n=200, base=100.0):
    rng = np.random.RandomState(7)
    closes = base + np.cumsum(rng.randn(n) * 0.5)
    idx = pd.date_range("2026-05-15", periods=n, freq="5min", tz="UTC")
    return pd.DataFrame({"Open": closes, "High": closes+0.3, "Low": closes-0.3, "Close": closes, "Volume": rng.randint(500,1500,n).astype(float)}, index=idx)


@pytest.mark.asyncio
async def test_scan_no_signal_returns_none(monkeypatch):
    fake_fetcher = MagicMock()
    fake_fetcher.fetch_multi_timeframe.return_value = {"5m": _df(), "15m": _df(), "1h": _df()}
    fake_fetcher.get_max_leverage.return_value = 20
    fake_fetcher.fetch_funding_rate.return_value = 0.0

    fake_strategy = MagicMock()
    fake_strategy.analyze.return_value = None

    fake_store = MagicMock()
    fake_store.compute_mtf_trend.return_value = {"1h": {"trend": "UP", "slope": 0.005}, "15m": {"trend": "UP", "slope": 0.004}}

    scanner = CoinScanner(coin="BTC", fetcher=fake_fetcher, strategy=fake_strategy,
                           confidence_scorer=MagicMock(), position_sizer=MagicMock(),
                           chart_generator=MagicMock(), discord=AsyncMock(),
                           duckdb_store=fake_store, paper_broker=MagicMock(),
                           order_manager=AsyncMock(), quality_filter=MagicMock())
    result = await scanner.scan()
    assert result is None
```

- [ ] **Step 2: Run, expect failure**

Run: `./.venv/bin/python -m pytest tests/scanner/test_coin_scanner.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement CoinScanner**

Create `backend/scanner/__init__.py` (empty), then `backend/scanner/coin_scanner.py`:

```python
"""Per-coin async scanner — runs the full pipeline once."""

import logging
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)


class CoinScanner:
    def __init__(
        self,
        coin: str,
        fetcher,
        strategy,
        confidence_scorer,
        position_sizer,
        chart_generator,
        discord,
        duckdb_store,
        paper_broker,
        order_manager,
        quality_filter,
    ):
        self.coin = coin
        self.fetcher = fetcher
        self.strategy = strategy
        self.confidence_scorer = confidence_scorer
        self.position_sizer = position_sizer
        self.chart_generator = chart_generator
        self.discord = discord
        self.duckdb_store = duckdb_store
        self.paper_broker = paper_broker
        self.order_manager = order_manager
        self.quality_filter = quality_filter

    async def scan(self) -> Optional[str]:
        """One pipeline pass. Returns trade_id if a trade executed, else None."""
        # 1. Fetch MTF
        try:
            mtf_data = self.fetcher.fetch_multi_timeframe(self.coin)
        except Exception as e:
            logger.warning(f"[{self.coin}] fetch failed: {e}")
            return None
        if not mtf_data or settings.execution_tf_default not in mtf_data:
            return None

        # 2. Store all TFs to DuckDB
        for tf, tf_df in mtf_data.items():
            try:
                self.duckdb_store.store_candles(tf_df, instrument=self.coin, timeframe=tf, asset_class="crypto")
            except Exception as e:
                logger.warning(f"[{self.coin}] store {tf} failed: {e}")

        # 3. Compute MTF trend via DuckDB
        try:
            mtf_trend = self.duckdb_store.compute_mtf_trend(instrument=self.coin)
        except Exception as e:
            logger.warning(f"[{self.coin}] mtf trend failed: {e}")
            return None

        # 4. Choose execution TF (15m if 1h slope strong)
        exec_tf = settings.execution_tf_default
        slope_1h = abs(mtf_trend.get("1h", {}).get("slope", 0))
        if slope_1h >= 0.005:  # top quartile of typical 1h slopes
            exec_tf = "15m"

        exec_df = mtf_data.get(exec_tf)
        if exec_df is None or len(exec_df) < 50:
            return None

        # 5. Analyse
        signal = self.strategy.analyze(exec_df, mtf_trend=mtf_trend, coin=self.coin)
        if signal is None:
            return None

        # 6. Score confidence
        confidence = self.confidence_scorer.score(signal=signal, df=exec_df, mtf_trend=mtf_trend)

        # 7. Quality gate (open trades, daily loss, min confidence)
        open_trades = self.duckdb_store.count_open_trades()
        bot_state = self.duckdb_store.get_bot_state() or {}
        balance = float(bot_state.get("balance", settings.paper_balance))
        daily_pnl = float(bot_state.get("daily_pnl", 0.0))
        if not self.quality_filter.accept(open_trades_count=open_trades, daily_pnl=daily_pnl, balance=balance, confidence=confidence):
            logger.info(f"[{self.coin}] signal rejected by quality filter (confidence={confidence:.1f})")
            return None

        # 8. Position sizing
        max_lev = self.fetcher.get_max_leverage(self.coin)
        funding = self.fetcher.fetch_funding_rate(self.coin)
        position = self.position_sizer.size(
            balance=balance, entry=signal.entry_price, stop_loss=signal.stop_loss,
            direction=signal.direction, max_leverage_for_coin=max_lev, funding_rate_hr=funding,
        )

        # 9. Chart PNG
        try:
            png = self.chart_generator.render(df=exec_df, signal=signal, confidence=confidence)
        except Exception as e:
            logger.warning(f"[{self.coin}] chart render failed: {e}")
            png = b""

        # 10. Execute paper trade with chart
        trade_id = await self.order_manager.execute_with_chart(signal=signal, position=position, confidence=confidence, chart_png=png)

        # 11. Discord
        mtf_summary = (
            f"1h {'↑' if mtf_trend['1h']['trend']=='UP' else '↓'} {mtf_trend['1h']['trend']} "
            f"(slope {mtf_trend['1h']['slope']*100:.2f}%) · "
            f"15m {'↑' if mtf_trend['15m']['trend']=='UP' else '↓'} {mtf_trend['15m']['trend']} · "
            f"{exec_tf} in golden pocket"
        )
        strategy_summary = f"Swing high ${signal.swing_high:.4f} → low ${signal.swing_low:.4f} · ATR {signal.atr:.4f}"
        await self.discord.send_signal(
            signal=signal, position=position, confidence=confidence, balance=balance,
            mtf_summary=mtf_summary, strategy_summary=strategy_summary, png_bytes=png,
        )
        return trade_id
```

- [ ] **Step 4: Run, expect pass**

Run: `./.venv/bin/python -m pytest tests/scanner/test_coin_scanner.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/scanner/__init__.py backend/scanner/coin_scanner.py tests/scanner/__init__.py tests/scanner/test_coin_scanner.py
git commit -m "feat(scanner): per-coin async pipeline runner"
```

---

### Task 14: AsyncRunner — fan out to all coins

**Files:**
- Create: `backend/scanner/async_runner.py`

- [ ] **Step 1: Write AsyncRunner**

Create `backend/scanner/async_runner.py`:

```python
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
```

- [ ] **Step 2: Smoke test by importing**

Run: `./.venv/bin/python -c "from backend.scanner.async_runner import AsyncRunner; print(AsyncRunner)"`
Expected: `<class 'backend.scanner.async_runner.AsyncRunner'>`

- [ ] **Step 3: Commit**

```bash
git add backend/scanner/async_runner.py
git commit -m "feat(scanner): AsyncRunner orchestrator using asyncio.gather"
```

---

### Task 15: Rewrite bot.py main loop

**Files:**
- Modify: `backend/bot.py` (full rewrite)

- [ ] **Step 1: Rewrite bot.py**

Replace `backend/bot.py` entirely with:

```python
"""Hermes v2 main bot loop — async 10-coin crypto scanner."""

import asyncio
import logging
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.config import settings
from backend.data.duckdb_store import DuckDBStore
from backend.data.hyperliquid_fetcher import HyperliquidFetcher
from backend.strategy.golden_pocket import GoldenPocketStrategy
from backend.engine.confidence_scorer import ConfidenceScorer
from backend.engine.position_sizer import PositionSizer
from backend.engine.quality_filter import QualityFilter
from backend.engine.order_manager import OrderManager
from backend.broker.paper_broker import PaperBroker
from backend.notifications.chart_generator import ChartGenerator
from backend.notifications.discord_notifier import DiscordNotifier
from backend.scanner.coin_scanner import CoinScanner
from backend.scanner.async_runner import AsyncRunner

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("Hermes")


async def main() -> None:
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "tradingbot.duckdb")
    store = DuckDBStore(db_path)

    fetcher = HyperliquidFetcher()
    strategy = GoldenPocketStrategy()
    scorer = ConfidenceScorer()
    sizer = PositionSizer(risk_per_trade_pct=settings.risk_per_trade_pct)
    qf = QualityFilter(
        daily_loss_limit_pct=settings.daily_loss_limit_pct,
        max_open_trades=settings.max_open_trades,
        min_confidence_pct=settings.min_confidence_pct,
    )
    chart_gen = ChartGenerator(width=settings.chart_width_px, height=settings.chart_height_px)
    discord = DiscordNotifier(webhook_url=settings.discord_webhook_url)

    broker = PaperBroker(initial_balance=settings.paper_balance)
    await broker.connect()
    order_mgr = OrderManager(broker=broker, duckdb_store=store, discord=discord, chart_generator=chart_gen, fetcher=fetcher)

    scanners = [
        CoinScanner(
            coin=coin, fetcher=fetcher, strategy=strategy,
            confidence_scorer=scorer, position_sizer=sizer, chart_generator=chart_gen,
            discord=discord, duckdb_store=store, paper_broker=broker,
            order_manager=order_mgr, quality_filter=qf,
        )
        for coin in settings.coins
    ]
    runner = AsyncRunner(scanners)

    store.update_bot_state({
        "status": "RUNNING",
        "trading_mode": "paper",
        "initial_balance": settings.paper_balance,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    })

    logger.info(f"Hermes v2 started — coins: {', '.join(settings.coins)}")

    try:
        while True:
            cycle_start = datetime.now(timezone.utc)
            logger.info(f"--- cycle start {cycle_start.isoformat()} ---")

            # Monitor open trades for SL/TP
            await order_mgr.check_open_trades()

            # Run all 10 coins in parallel
            trade_ids = await runner.run_one_cycle()
            if trade_ids:
                logger.info(f"executed {len(trade_ids)} trades this cycle: {trade_ids}")

            store.update_bot_state({"last_heartbeat": datetime.now(timezone.utc).isoformat()})

            # Sleep until next 5m candle
            await asyncio.sleep(300)
    except KeyboardInterrupt:
        logger.info("Stopped by user")
    finally:
        await broker.disconnect()
        store.update_bot_state({"status": "STOPPED"})
        store.close()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Smoke test import path**

Run: `./.venv/bin/python -c "import backend.bot; print('OK')"`
Expected: `OK` (may complain about OrderManager.execute_with_chart not existing yet — fixed in Task 17).

- [ ] **Step 3: Commit**

```bash
git add backend/bot.py
git commit -m "feat(bot): rewrite main loop as async 10-coin Hermes v2 scanner"
```

---

## Phase 5 — Engine Updates

### Task 16: PaperBroker — two-stage TP, notional/margin tracking

**Files:**
- Modify: `backend/broker/paper_broker.py`

- [ ] **Step 1: Read current PaperBroker**

Run: `cat backend/broker/paper_broker.py`

- [ ] **Step 2: Update PaperBroker class**

Modify `backend/broker/paper_broker.py` — locate the `place_order` (or equivalent execution) method and the position tracking. Replace the body of the file with this v2 version (review existing for any methods to preserve):

```python
"""Paper broker for Hermes v2 — tracks notional, simulates two-stage TP, BE move after TP1."""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class PaperPosition:
    trade_id: str
    coin: str
    direction: str               # LONG / SHORT
    entry_price: float
    quantity: float
    stop_loss: float
    tp1: float
    tp2: float
    initial_quantity: float      # original size before TP1 partial
    notional: float
    leverage: int
    initial_margin: float
    liquidation_price: float
    funding_rate_hr: float
    tp1_hit: bool = False
    opened_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class PaperBroker:
    def __init__(self, initial_balance: float):
        self.initial_balance = initial_balance
        self.balance = initial_balance
        self.positions: Dict[str, PaperPosition] = {}

    async def connect(self) -> None:
        logger.info(f"Paper broker connected — balance ${self.balance:.2f}")

    async def disconnect(self) -> None:
        logger.info("Paper broker disconnected")

    def open_position(self, *, coin: str, direction: str, entry: float, quantity: float,
                      stop_loss: float, tp1: float, tp2: float, notional: float, leverage: int,
                      initial_margin: float, liquidation_price: float, funding_rate_hr: float) -> str:
        trade_id = str(uuid.uuid4())
        self.positions[trade_id] = PaperPosition(
            trade_id=trade_id, coin=coin, direction=direction, entry_price=entry,
            quantity=quantity, initial_quantity=quantity, stop_loss=stop_loss, tp1=tp1, tp2=tp2,
            notional=notional, leverage=leverage, initial_margin=initial_margin,
            liquidation_price=liquidation_price, funding_rate_hr=funding_rate_hr,
        )
        logger.info(f"OPENED {direction} {coin} qty={quantity:.4f} entry={entry:.4f} SL={stop_loss:.4f}")
        return trade_id

    def check_exits(self, coin: str, current_price: float) -> list[tuple[str, str, float, float]]:
        """Returns list of (trade_id, exit_reason, exit_price, realized_pnl) for closures this tick."""
        closures = []
        for trade_id, pos in list(self.positions.items()):
            if pos.coin != coin:
                continue

            # SL check first (worst case)
            if pos.direction == "LONG" and current_price <= pos.stop_loss:
                pnl = (pos.stop_loss - pos.entry_price) * pos.quantity
                closures.append((trade_id, "SL", pos.stop_loss, pnl))
                self._close_full(trade_id, pnl)
                continue
            if pos.direction == "SHORT" and current_price >= pos.stop_loss:
                pnl = (pos.entry_price - pos.stop_loss) * pos.quantity
                closures.append((trade_id, "SL", pos.stop_loss, pnl))
                self._close_full(trade_id, pnl)
                continue

            # TP1 — partial close 50%, move SL to BE
            if not pos.tp1_hit:
                hit_tp1 = (pos.direction == "LONG" and current_price >= pos.tp1) or \
                          (pos.direction == "SHORT" and current_price <= pos.tp1)
                if hit_tp1:
                    half = pos.initial_quantity * 0.5
                    if pos.direction == "LONG":
                        pnl_partial = (pos.tp1 - pos.entry_price) * half
                    else:
                        pnl_partial = (pos.entry_price - pos.tp1) * half
                    pos.quantity -= half
                    pos.tp1_hit = True
                    pos.stop_loss = pos.entry_price  # move to BE
                    self.balance += pnl_partial
                    closures.append((trade_id, "TP1_PARTIAL", pos.tp1, pnl_partial))

            # TP2 — close remainder
            hit_tp2 = (pos.direction == "LONG" and current_price >= pos.tp2) or \
                      (pos.direction == "SHORT" and current_price <= pos.tp2)
            if hit_tp2:
                if pos.direction == "LONG":
                    pnl = (pos.tp2 - pos.entry_price) * pos.quantity
                else:
                    pnl = (pos.entry_price - pos.tp2) * pos.quantity
                closures.append((trade_id, "TP2", pos.tp2, pnl))
                self._close_full(trade_id, pnl)
        return closures

    def _close_full(self, trade_id: str, pnl: float) -> None:
        pos = self.positions.pop(trade_id, None)
        if pos is None:
            return
        self.balance += pnl
        logger.info(f"CLOSED {pos.direction} {pos.coin} pnl=${pnl:.2f} balance=${self.balance:.2f}")

    def update_positions(self, coin: str, current_price: float) -> list[tuple[str, str, float, float]]:
        """Convenience entry — same as check_exits."""
        return self.check_exits(coin, current_price)
```

- [ ] **Step 3: Smoke import**

Run: `./.venv/bin/python -c "from backend.broker.paper_broker import PaperBroker; b=PaperBroker(500); print(b.balance)"`
Expected: `500`

- [ ] **Step 4: Commit**

```bash
git add backend/broker/paper_broker.py
git commit -m "feat(broker): v2 paper broker with two-stage TP, BE move, margin tracking"
```

---

### Task 17: OrderManager — chart snapshot on signal + close, bot state updates

**Files:**
- Modify: `backend/engine/order_manager.py`

- [ ] **Step 1: Read current OrderManager**

Run: `cat backend/engine/order_manager.py`

- [ ] **Step 2: Rewrite OrderManager**

Replace `backend/engine/order_manager.py` entirely with:

```python
"""OrderManager — wires Signal → PaperBroker, persists chart blobs and bot state."""

import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


class OrderManager:
    def __init__(self, *, broker, duckdb_store, discord, chart_generator, fetcher):
        self.broker = broker
        self.store = duckdb_store
        self.discord = discord
        self.chart_generator = chart_generator
        self.fetcher = fetcher

    async def execute_with_chart(self, *, signal, position, confidence: float, chart_png: bytes) -> str:
        """Open paper position, persist trade row including chart blob."""
        trade_id = self.broker.open_position(
            coin=signal.coin, direction=signal.direction, entry=signal.entry_price,
            quantity=position.quantity, stop_loss=signal.stop_loss,
            tp1=signal.tp1, tp2=signal.tp2,
            notional=position.notional, leverage=position.suggested_leverage,
            initial_margin=position.initial_margin, liquidation_price=position.liquidation_price,
            funding_rate_hr=position.funding_rate_hr,
        )

        self.store.insert_trade({
            "id": trade_id,
            "instrument": signal.coin,
            "direction": signal.direction,
            "entry_price": signal.entry_price,
            "stop_loss": signal.stop_loss,
            "take_profit": signal.tp2,           # legacy column
            "tp1_price": signal.tp1,
            "tp2_price": signal.tp2,
            "tp1_hit": False,
            "quantity": position.quantity,
            "status": "OPEN",
            "timestamp": signal.timestamp.isoformat(),
            "strategy_name": "golden_pocket",
            "signal_metadata": {
                "fib_level_triggered": signal.fib_level_triggered,
                "swing_high": signal.swing_high,
                "swing_low": signal.swing_low,
                "atr": signal.atr,
            },
            "confidence": confidence,
            "leverage": position.suggested_leverage,
            "notional": position.notional,
            "initial_margin": position.initial_margin,
            "liquidation_price": position.liquidation_price,
            "funding_rate_hr": position.funding_rate_hr,
            "chart_initial_png": chart_png,
        })

        self._update_bot_state()
        return trade_id

    async def check_open_trades(self) -> None:
        """Fetch current price for each coin with open trades, check exits, persist closures with chart."""
        open_trades = self.store.list_open_trades()
        coins_with_open = {t["instrument"] for t in open_trades}

        for coin in coins_with_open:
            try:
                df = self.fetcher.fetch_ohlcv(coin, "5m", limit=1)
            except Exception as e:
                logger.warning(f"check_open_trades fetch failed for {coin}: {e}")
                continue
            current_price = float(df["Close"].iloc[-1])

            closures = self.broker.check_exits(coin, current_price)
            for trade_id, reason, exit_price, pnl in closures:
                if reason == "TP1_PARTIAL":
                    self.store.update_trade(trade_id, {"tp1_hit": True, "stop_loss": exit_price})
                    continue

                # Full close: regenerate chart with exit marker
                trade = self.store.get_trade(trade_id)
                final_chart = await self._regenerate_chart_for_trade(trade, exit_price, reason)

                pnl_pct = (pnl / float(trade.get("initial_margin", 1.0))) * 100 if trade.get("initial_margin") else 0.0

                self.store.update_trade(trade_id, {
                    "status": "CLOSED",
                    "exit_price": exit_price,
                    "exit_reason": reason,
                    "pnl": pnl,
                    "chart_final_png": final_chart,
                    "closed_at": datetime.now(timezone.utc).isoformat(),
                })

                # Discord close alert
                duration = self._format_duration(trade.get("timestamp"))
                await self.discord.send_close(
                    coin=trade["instrument"], direction=trade["direction"],
                    pnl=pnl, pnl_pct=pnl_pct, exit_reason=reason,
                    confidence_at_entry=float(trade.get("confidence", 0)),
                    duration_str=duration, png_bytes=final_chart or b"",
                )

        self._update_bot_state()

    async def _regenerate_chart_for_trade(self, trade: dict, exit_price: float, reason: str) -> bytes:
        from backend.strategy.golden_pocket import Signal
        import pandas as pd

        coin = trade["instrument"]
        try:
            df = self.fetcher.fetch_ohlcv(coin, "5m", limit=500)
        except Exception as e:
            logger.warning(f"chart regen fetch failed for {coin}: {e}")
            return b""

        meta = trade.get("signal_metadata") or {}
        sig = Signal(
            coin=coin, direction=trade["direction"],
            entry_price=float(trade["entry_price"]),
            stop_loss=float(trade["stop_loss"]),
            tp1=float(trade.get("tp1_price", trade["take_profit"])),
            tp2=float(trade.get("tp2_price", trade["take_profit"])),
            fib_level_triggered=float(meta.get("fib_level_triggered", 0.5)),
            swing_high=float(meta.get("swing_high", df["High"].max())),
            swing_low=float(meta.get("swing_low", df["Low"].min())),
            atr=float(meta.get("atr", 1.0)),
            timestamp=pd.Timestamp(trade["timestamp"]),
        )

        confidence = float(trade.get("confidence", 0))
        return self.chart_generator.render(
            df=df, signal=sig, confidence=confidence,
            exit_price=exit_price, exit_timestamp=df.index[-1], exit_reason=reason,
        )

    def _update_bot_state(self) -> None:
        """Recompute and persist balance + win counts."""
        trades = self.store.list_all_trades()
        closed = [t for t in trades if t.get("status") == "CLOSED"]
        total_pnl = sum(float(t.get("pnl", 0)) for t in closed)
        wins = sum(1 for t in closed if float(t.get("pnl", 0)) > 0)
        today = datetime.now(timezone.utc).date().isoformat()
        daily_pnl = sum(float(t.get("pnl", 0)) for t in closed if str(t.get("closed_at", "")).startswith(today))

        self.store.update_bot_state({
            "balance": self.broker.balance,
            "initial_balance": self.broker.initial_balance,
            "total_pnl": total_pnl,
            "total_trades": len(closed),
            "winning_trades": wins,
            "daily_pnl": daily_pnl,
            "last_updated": datetime.now(timezone.utc).isoformat(),
        })

    @staticmethod
    def _format_duration(start_iso: Optional[str]) -> str:
        if not start_iso:
            return "?"
        try:
            start = datetime.fromisoformat(str(start_iso).replace("Z", "+00:00"))
            delta = datetime.now(timezone.utc) - start
            mins = int(delta.total_seconds() // 60)
            return f"{mins // 60}h {mins % 60}m"
        except Exception:
            return "?"
```

- [ ] **Step 3: Ensure DuckDBStore has the needed methods**

The OrderManager uses: `insert_trade`, `update_trade`, `get_trade`, `list_open_trades`, `list_all_trades`, `count_open_trades`. Verify or add them.

Run: `grep -n "def insert_trade\|def update_trade\|def get_trade\|def list_open_trades\|def list_all_trades\|def count_open_trades" backend/data/duckdb_store.py`

If any are missing, add them. Example additions for `backend/data/duckdb_store.py`:

```python
def insert_trade(self, row: dict) -> None:
    cols = list(row.keys())
    placeholders = ", ".join(["?"] * len(cols))
    col_list = ", ".join(cols)
    values = [row[c] for c in cols]
    # Serialize dicts (signal_metadata) to JSON
    import json
    values = [json.dumps(v) if isinstance(v, dict) else v for v in values]
    self._conn.execute(f"INSERT INTO trades ({col_list}) VALUES ({placeholders})", values)

def update_trade(self, trade_id: str, fields: dict) -> None:
    if not fields:
        return
    sets = ", ".join(f"{k} = ?" for k in fields.keys())
    values = list(fields.values()) + [trade_id]
    self._conn.execute(f"UPDATE trades SET {sets} WHERE id = ?", values)

def get_trade(self, trade_id: str) -> dict | None:
    row = self._conn.execute("SELECT * FROM trades WHERE id = ?", [trade_id]).fetchone()
    if not row:
        return None
    cols = [d[0] for d in self._conn.description]
    out = dict(zip(cols, row))
    import json
    if isinstance(out.get("signal_metadata"), str):
        try:
            out["signal_metadata"] = json.loads(out["signal_metadata"])
        except Exception:
            pass
    return out

def list_open_trades(self) -> list[dict]:
    rows = self._conn.execute("SELECT * FROM trades WHERE status = 'OPEN'").fetchall()
    cols = [d[0] for d in self._conn.description]
    return [dict(zip(cols, r)) for r in rows]

def list_all_trades(self) -> list[dict]:
    rows = self._conn.execute("SELECT * FROM trades").fetchall()
    cols = [d[0] for d in self._conn.description]
    return [dict(zip(cols, r)) for r in rows]

def count_open_trades(self) -> int:
    return self._conn.execute("SELECT COUNT(*) FROM trades WHERE status = 'OPEN'").fetchone()[0]
```

- [ ] **Step 4: Smoke import**

Run: `./.venv/bin/python -c "from backend.engine.order_manager import OrderManager; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/engine/order_manager.py backend/data/duckdb_store.py
git commit -m "feat(engine): OrderManager with chart snapshot + bot state recomputation on close"
```

---

## Phase 6 — Frontend & API

### Task 18: API endpoint to serve chart PNGs

**Files:**
- Modify: `backend/api_server.py`

- [ ] **Step 1: Read api_server.py**

Run: `cat backend/api_server.py | head -250`

- [ ] **Step 2: Add chart endpoint**

Append to `backend/api_server.py`:

```python
from fastapi.responses import Response


@app.get("/api/trades/{trade_id}/chart")
def get_trade_chart(trade_id: str, type: str = "final"):
    """Stream the saved chart PNG. type=initial|final, defaults to final (falls back to initial)."""
    store = get_store()
    trade = store.get_trade(trade_id)
    if not trade:
        return Response(status_code=404)

    if type == "initial":
        png = trade.get("chart_initial_png")
    else:
        png = trade.get("chart_final_png") or trade.get("chart_initial_png")

    if not png:
        return Response(status_code=404)
    if isinstance(png, memoryview):
        png = bytes(png)
    return Response(content=png, media_type="image/png")
```

- [ ] **Step 3: Smoke test the route loads**

Run: `./.venv/bin/python -c "from backend.api_server import app; print([r.path for r in app.routes if 'chart' in str(r.path)])"`
Expected: `['/api/trades/{trade_id}/chart']`

- [ ] **Step 4: Commit**

```bash
git add backend/api_server.py
git commit -m "feat(api): serve saved trade chart PNGs at /api/trades/{id}/chart"
```

---

### Task 19: HelpTooltip React component

**Files:**
- Create: `frontend/src/components/HelpTooltip.jsx`

- [ ] **Step 1: Create component**

Create `frontend/src/components/HelpTooltip.jsx`:

```jsx
import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

export default function HelpTooltip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setOpen(false)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#64748b', padding: 0, display: 'inline-flex', alignItems: 'center',
        }}
        aria-label="Help"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '120%', left: 0, zIndex: 10,
            background: '#1e293b', color: '#e2e8f0', fontSize: 12, lineHeight: 1.5,
            padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
            width: 280, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Smoke test by importing in main.jsx (don't render, just import)**

Run: `grep -q HelpTooltip frontend/src/main.jsx || echo "(not imported yet — fine, Settings.jsx will import in next task)"`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/HelpTooltip.jsx
git commit -m "feat(ui): HelpTooltip component for inline ? explanations"
```

---

### Task 20: Fix TradeDetail.jsx to show real chart

**Files:**
- Modify: `frontend/src/pages/TradeDetail.jsx`
- Modify: `frontend/src/lib/api.js`

- [ ] **Step 1: Add chart URL helper to api.js**

Edit `frontend/src/lib/api.js` — add this method to the `api` object:

```javascript
  /** Get URL for a stored trade chart PNG */
  tradeChartUrl(id, type = 'final') {
    return `${API_BASE}/trades/${id}/chart?type=${type}`;
  },
```

- [ ] **Step 2: Rewrite TradeDetail.jsx chart section**

Replace `frontend/src/pages/TradeDetail.jsx` entirely with:

```jsx
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, ArrowDownRight,
  Target, Shield, TrendingUp, BarChart3,
} from 'lucide-react';
import api from '../lib/api';
import { formatCurrency, formatPnL, formatDateTime } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';

function InfoRow({ label, value, icon: Icon, iconColor }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ fontSize: 13, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={14} style={{ color: iconColor }} />}
        {label}
      </span>
      <span style={{ fontSize: 13, color: '#cbd5e1' }}>{value}</span>
    </div>
  );
}

export default function TradeDetail() {
  const { id } = useParams();
  const [trade, setTrade] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState('final');

  useEffect(() => {
    api.getTrade(id).then(t => { setTrade(t); setLoading(false); });
  }, [id]);

  if (loading) {
    return <div style={{ padding: 24 }}><Skeleton className="h-96" /></div>;
  }
  if (!trade || !trade.id) {
    return <p style={{ padding: 24, color: '#94a3b8' }}>Trade not found</p>;
  }

  const pnl = formatPnL(trade.pnl);
  const meta = trade.signal_metadata || {};
  const hasInitial = !!trade.chart_initial_png;
  const hasFinal = !!trade.chart_final_png;
  const chartUrl = api.tradeChartUrl(id, chartType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/trades"><Button variant="secondary" size="sm"><ArrowLeft size={16} /></Button></Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
            {trade.instrument} · {trade.direction} · {trade.strategy_name}
          </h1>
          <p style={{ fontSize: 13, color: '#64748b' }}>{formatDateTime(trade.timestamp)}</p>
        </div>
        <Badge variant={trade.status === 'OPEN' ? 'info' : trade.pnl > 0 ? 'success' : 'danger'} dot>
          {trade.status === 'OPEN' ? 'Open' : trade.pnl > 0 ? 'Win' : 'Loss'}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={BarChart3} iconColor="#3b82f6">Price Chart & Analysis</CardTitle>
          {hasInitial && hasFinal && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant={chartType === 'final' ? 'primary' : 'secondary'} onClick={() => setChartType('final')}>Exit chart</Button>
              <Button size="sm" variant={chartType === 'initial' ? 'primary' : 'secondary'} onClick={() => setChartType('initial')}>Signal chart</Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {(hasInitial || hasFinal) ? (
            <img src={chartUrl} alt="Trade chart" style={{ width: '100%', height: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }} />
          ) : (
            <p style={{ color: '#64748b' }}>No chart available for this trade.</p>
          )}
        </CardContent>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <Card>
          <CardHeader><CardTitle icon={BarChart3} iconColor="#3b82f6">Trade Information</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Direction" value={
              <span style={{ color: trade.direction === 'LONG' ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                {trade.direction === 'LONG' ? <ArrowUpRight size={14} style={{ display: 'inline' }} /> : <ArrowDownRight size={14} style={{ display: 'inline' }} />}
                {trade.direction}
              </span>
            } />
            <InfoRow label="Entry" value={<span style={{ fontFamily: 'monospace' }}>{formatCurrency(trade.entry_price)}</span>} />
            <InfoRow label="Exit" value={<span style={{ fontFamily: 'monospace' }}>{trade.exit_price ? formatCurrency(trade.exit_price) : '—'}</span>} />
            <InfoRow label="Quantity" value={<span style={{ fontFamily: 'monospace' }}>{Number(trade.quantity).toFixed(4)}</span>} />
            <InfoRow label="P&L" value={<span style={{ fontFamily: 'monospace', color: pnl.className?.includes('emerald') ? '#10b981' : '#ef4444' }}>{trade.status === 'CLOSED' ? pnl.text : '—'}</span>} />
            <InfoRow label="Exit Reason" value={trade.exit_reason || '—'} />
            <InfoRow label="Confidence" value={<span style={{ color: '#fbbf24' }}>{Number(trade.confidence || 0).toFixed(0)}%</span>} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle icon={Target} iconColor="#a78bfa">Position Details</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Notional" value={<span style={{ fontFamily: 'monospace' }}>{formatCurrency(trade.notional)}</span>} />
            <InfoRow label="Leverage" value={<span style={{ fontFamily: 'monospace' }}>{Number(trade.leverage || 1).toFixed(0)}×</span>} />
            <InfoRow label="Initial Margin" value={<span style={{ fontFamily: 'monospace' }}>{formatCurrency(trade.initial_margin)}</span>} />
            <InfoRow label="Liquidation" value={<span style={{ fontFamily: 'monospace', color: '#ef4444' }}>{trade.liquidation_price ? formatCurrency(trade.liquidation_price) : '—'}</span>} />
            <InfoRow label="Stop Loss" icon={Shield} iconColor="#ef4444" value={<span style={{ fontFamily: 'monospace', color: '#ef4444' }}>{formatCurrency(trade.stop_loss)}</span>} />
            <InfoRow label="TP1" value={<span style={{ fontFamily: 'monospace', color: '#10b981' }}>{trade.tp1_price ? formatCurrency(trade.tp1_price) : '—'}</span>} />
            <InfoRow label="TP2" value={<span style={{ fontFamily: 'monospace', color: '#10b981' }}>{trade.tp2_price ? formatCurrency(trade.tp2_price) : '—'}</span>} />
            <InfoRow label="Funding/hr" value={<span style={{ fontFamily: 'monospace' }}>{((trade.funding_rate_hr || 0) * 100).toFixed(4)}%</span>} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Smoke test — start dev server**

Run: `cd frontend && npm run dev`
Expected: dev server starts. Manually open the app and visit a trade detail page if any trade rows exist. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/TradeDetail.jsx frontend/src/lib/api.js
git commit -m "fix(ui): replace fake-data chart with real saved PNG + initial/final toggle"
```

---

### Task 21: Add HelpTooltip on Settings page fields

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

- [ ] **Step 1: Read current Settings.jsx**

Run: `cat frontend/src/pages/Settings.jsx`

- [ ] **Step 2: Add HelpTooltip imports and apply to all technical fields**

In `frontend/src/pages/Settings.jsx`:

1. Add at top with other imports:

```jsx
import HelpTooltip from '../components/HelpTooltip';
```

2. Wherever there is a label like `<label>Risk per trade</label>`, change to:

```jsx
<label>Risk per trade <HelpTooltip text="Percentage of balance risked per trade. Higher = bigger position. Default 3% means a losing trade hits balance by 3% if SL is hit exactly." /></label>
```

3. Apply this pattern to each of the following fields (add the field if it doesn't exist yet):

| Field | Tooltip text |
|-------|--------------|
| Risk per trade | "Percentage of balance risked per trade. Higher = bigger position. Default 3% means a losing trade hits balance by 3% if SL is hit exactly." |
| Daily loss limit | "Bot pauses 24h if your total losses today exceed this percentage of balance. Default 15%." |
| Max open trades | "Maximum number of trades held concurrently across all coins." |
| Min confidence | "Signals scoring below this confidence percentage are filtered out before any trade is placed. 60% is the default." |
| Execution timeframe | "Default candle timeframe used for trade entry. Bot auto-uses 15m if the 1h trend is unusually strong." |
| ATR period | "Number of candles used for ATR (volatility) calculation. 14 is standard." |
| ATR SL multiplier | "Stop loss is placed at least this many ATRs from entry. Higher = wider stop, less likely to be wicked out." |
| Chart candles before signal | "How many historical candles to draw in the chart before the signal candle. More context = easier to spot patterns. Default 400." |
| Chart candles after signal | "Forward room for trade progression and exit marker. Default 100." |
| Discord webhook URL | "Paste a Discord webhook URL from any channel. Bot posts trade alerts there. Create one in Discord: Server Settings → Integrations → Webhooks → New." |
| Notional | "Total trade size in USD. If you buy 0.5 SOL at $145, notional = $72.50." |
| Liquidation Price | "Price at which Hyperliquid auto-closes your position because equity hit maintenance margin. Higher leverage = closer = more dangerous." |
| Funding Rate | "Hourly fee paid (or received) on perps to keep price aligned to spot. Positive = longs pay shorts." |
| Golden Pocket | "Fibonacci zone between 50% and 61.8% retracement. Highest reaction rate in trending crypto markets." |

- [ ] **Step 3: Smoke check by booting dev server and opening Settings**

Run: `cd frontend && npm run dev`
Open Settings page. Each technical field should now show a `?` icon. Click it — tooltip appears. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Settings.jsx
git commit -m "feat(ui): HelpTooltip on every Settings field — ADHD-friendly help"
```

---

### Task 22: Update frontend default instrument

**Files:**
- Modify: `frontend/src/lib/api.js`
- Modify: any frontend page with `GC=F` hardcoded

- [ ] **Step 1: Find hardcoded GC=F references**

Run: `grep -rn "GC=F" frontend/src`

- [ ] **Step 2: Replace each occurrence with BTC**

Edit each match: change `'GC=F'` → `'BTC'`.

- [ ] **Step 3: Verify none remain**

Run: `grep -rn "GC=F" frontend/src`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "fix(ui): replace GC=F default with BTC across frontend"
```

---

## Phase 7 — Docs & Smoke

### Task 23: Hyperliquid mechanics reference doc

**Files:**
- Create: `docs/hyperliquid-mechanics.md`

- [ ] **Step 1: Write doc**

Create `docs/hyperliquid-mechanics.md`:

```markdown
# Hyperliquid Perpetuals — Mechanics Cheat Sheet

Plain-English reference for the perp concepts the bot uses. Every concept here is also available as a `?` tooltip in the app.

## What is a Perpetual?

A perpetual ("perp") is a futures contract with no expiry date. You can hold it forever, but you pay or receive a **funding rate** every hour to keep its price tethered to the spot price.

## Margin

**Collateral:** USDC. All trades on Hyperliquid are margined in USDC.

**Notional value:** the total trade size. If you long 0.5 ETH at $3000, notional = $1500. This is what moves with price, not what you put up.

**Initial margin:** cash locked up to open the trade. With 10× leverage, you put up 1/10 of notional ($150 for the example above).

**Maintenance margin:** the minimum equity Hyperliquid requires to keep the trade open. ~1.25% of notional. If your equity falls below this, you get liquidated.

**Cross vs Isolated:**
- **Cross** (default on HL): all your USDC backs every open trade. One liquidation can drain everything.
- **Isolated:** each trade has its own margin pool. A liquidation only loses that trade's margin. **Hermes paper-trading simulates isolated.**

## Leverage

The bot suggests a leverage value but Hyperliquid lets you set it manually. Higher leverage = same trade size with less margin, but:
- closer liquidation price
- bigger funding cost (funding is paid on notional, not margin)

**Per-asset max leverage** (published by HL, fetched live by the bot):
- BTC/ETH: 50×
- SOL/XRP/LINK/ADA: 20×
- BNB/SUI/HYPE: 10×
- TAO: 5×

These can change — bot reads live from `exchange.load_markets()` at startup.

## Liquidation Price

Formula (approx): `liquidation = entry ∓ (initial_margin − maintenance_margin) / quantity`

(`−` for LONG, `+` for SHORT). The bot displays this in every alert and on the Trade Detail page so you know how much room the trade has.

## Funding Rate

Hourly. Paid by longs to shorts (or vice versa) to keep perp price close to spot. Annualised by ×24×365.

- Typical: 0.01%/hr → 87.6%/year if held
- Positive funding: longs pay shorts (price > spot, market is bullish)
- Negative funding: shorts pay longs (price < spot, market is bearish)

For paper trades this is informational only.

## The Golden Pocket

The 50%–61.8% Fibonacci retracement zone. Most reactions in trending crypto happen here. Hermes only trades this zone — no 38.2% entries.

**Why this zone**: combines the 50% psychological midpoint with the 61.8% Fibonacci ratio, creating a tight high-probability area for reversal. Above 50% = shallow retrace (less reliable); below 61.8% = trend potentially broken.

## ATR (Average True Range)

The average distance between high and low over the last 14 candles. Used by Hermes to size stop losses that respect each coin's volatility — HYPE moves much more than BTC per candle, so SL is set wider for HYPE.

## R:R (Risk to Reward)

Ratio of dollars risked to dollars potentially gained. 1:2 means risk $1 to make $2. A 40% win rate at 1:2 R:R is still profitable; 50% win rate at 1:1 is break-even.

Hermes uses two TPs:
- **TP1 at 1:1.5 R:R** — partial close (50% of position), SL moves to break-even
- **TP2 at 1.618 Fib extension** — runner

## Confidence Score

0–95%. Heuristic v1 sums weighted factors: MTF alignment + slope strength + candle pattern at level + volume + EMA confluence + ATR sanity. Cap at 95% — never "certain". After ≥50 closed paper trades, v2 replaces the heuristic with actual historical win rate of similar setups.
```

- [ ] **Step 2: Commit**

```bash
git add docs/hyperliquid-mechanics.md
git commit -m "docs: Hyperliquid mechanics plain-English reference"
```

---

### Task 24: End-to-end smoke test

**Files:**
- Create: `scripts/smoke_hermes_v2.py`

- [ ] **Step 1: Write end-to-end smoke**

Create `scripts/smoke_hermes_v2.py`:

```python
"""End-to-end smoke: one cycle for one coin (BTC), no Discord, verify trade + chart persistence."""

import asyncio
import os
import sys

sys.path.insert(0, ".")

from backend.config import settings
from backend.data.duckdb_store import DuckDBStore
from backend.data.hyperliquid_fetcher import HyperliquidFetcher
from backend.strategy.golden_pocket import GoldenPocketStrategy
from backend.engine.confidence_scorer import ConfidenceScorer
from backend.engine.position_sizer import PositionSizer
from backend.engine.quality_filter import QualityFilter
from backend.engine.order_manager import OrderManager
from backend.broker.paper_broker import PaperBroker
from backend.notifications.chart_generator import ChartGenerator
from backend.notifications.discord_notifier import DiscordNotifier
from backend.scanner.coin_scanner import CoinScanner


async def main() -> None:
    db = "backend/data/tradingbot.duckdb"
    store = DuckDBStore(db)
    fetcher = HyperliquidFetcher()
    strategy = GoldenPocketStrategy()
    scorer = ConfidenceScorer()
    sizer = PositionSizer(risk_per_trade_pct=settings.risk_per_trade_pct)
    qf = QualityFilter(
        daily_loss_limit_pct=settings.daily_loss_limit_pct,
        max_open_trades=settings.max_open_trades,
        min_confidence_pct=0,  # smoke: accept any
    )
    chart_gen = ChartGenerator(width=1600, height=800)
    discord = DiscordNotifier(webhook_url="")  # silenced
    broker = PaperBroker(initial_balance=settings.paper_balance)
    await broker.connect()
    order_mgr = OrderManager(broker=broker, duckdb_store=store, discord=discord, chart_generator=chart_gen, fetcher=fetcher)

    scanner = CoinScanner(
        coin="BTC", fetcher=fetcher, strategy=strategy, confidence_scorer=scorer,
        position_sizer=sizer, chart_generator=chart_gen, discord=discord,
        duckdb_store=store, paper_broker=broker, order_manager=order_mgr, quality_filter=qf,
    )

    trade_id = await scanner.scan()
    if trade_id:
        print(f"Trade executed: {trade_id}")
        t = store.get_trade(trade_id)
        png_size = len(t.get("chart_initial_png") or b"")
        print(f"Chart initial PNG bytes: {png_size}")
        assert png_size > 1000, "chart was not stored"
        print("OK")
    else:
        print("No signal this cycle — that's normal. Smoke ran without errors.")

    await broker.disconnect()
    store.close()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Run end-to-end smoke**

Run: `./.venv/bin/python scripts/smoke_hermes_v2.py`
Expected: Either `Trade executed: <uuid>` followed by `OK`, or `No signal this cycle — that's normal.` Either is success.

- [ ] **Step 3: Run full test suite**

Run: `./.venv/bin/python -m pytest tests/ -v`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke_hermes_v2.py
git commit -m "test: end-to-end smoke for Hermes v2 single-coin scan"
```

---

## Self-Review Checklist (Run This After Implementation)

Before declaring done, verify:

- [ ] `pytest tests/ -v` — all green
- [ ] `python scripts/smoke_hyperliquid.py` — all 10 coins return data
- [ ] `python scripts/smoke_hermes_v2.py` — no errors
- [ ] Open `/tmp/hermes_chart.png` — visually confirms TradingView look with golden pocket band visible
- [ ] `python backend/bot.py` runs at least one cycle without crashing
- [ ] Open frontend Trade Detail page — chart loads as PNG from API
- [ ] Open frontend Settings page — `?` tooltips appear and reveal text
- [ ] `.env.example` has all the new variables; nothing references `GC=F` or `INSTRUMENT` anywhere

---

## Spec Coverage Audit

Cross-check the design spec against the tasks above:

| Spec Section | Task(s) |
|---|---|
| 10 coins (Hyperliquid perps) | Task 2, 4 |
| Async parallel scanner | Task 13, 14, 15 |
| Golden pocket only (no 38.2% entry) | Task 7 |
| 5m default / 15m if 1h strong | Task 13 (`exec_tf` selection) |
| Hybrid SL (78.6% Fib break or 1.5× ATR) | Task 7 (`_stop_loss`) |
| Two-stage TP + BE move | Task 7 (`_take_profits`), Task 16 |
| Confidence score (heuristic v1) | Task 8 |
| Hyperliquid-aware sizing | Task 9 |
| Per-coin max leverage from HL | Task 4 (`get_max_leverage`), Task 13 |
| Quality filter (daily loss, max trades, min conf) | Task 10 |
| Chart PNG with TradingView style + golden pocket band | Task 11 |
| Chart snapshot on signal + close | Task 17 (`execute_with_chart`, `_regenerate_chart_for_trade`) |
| Discord webhook (signal + close) | Task 12 |
| API endpoint for chart serving | Task 18 |
| TradeDetail.jsx uses real chart | Task 20 |
| HelpTooltip component | Task 19 |
| Settings page tooltips | Task 21 |
| Hyperliquid docs | Task 23 |
| KPI/bot state fix on trade close | Task 17 (`_update_bot_state`) |
| Remove CME market hours | Task 15 (omitted in new bot.py) |
| Replace yfinance with ccxt | Task 1, 4 |
| 500-candle charts (400 before + 100 after) | Task 11 (renders entire passed df), Task 17 (fetches 500) |
| .env updates | Task 2 |

All sections covered.
