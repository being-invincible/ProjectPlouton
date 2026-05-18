"""
DuckDB Analytics Store.

Provides an OLAP-optimized storage layer alongside PocketBase.
DuckDB is used for:
- Fast analytical queries across large candle datasets
- Pre-computed indicator storage
- Cross-instrument / cross-asset-class analytics
- Backtesting data access

PocketBase remains the primary CRUD store for the dashboard API.
DuckDB is a read-heavy companion for the trading engine.
"""

import logging
import os
import threading
from typing import Optional

import duckdb
import pandas as pd

logger = logging.getLogger(__name__)


class DuckDBStore:
    """Persistent DuckDB analytics store for the trading bot."""

    def __init__(self, db_path: str | None = None, read_only: bool = False):
        """
        Initialize DuckDB connection.

        Args:
            db_path: Path to the DuckDB database file.
                     Defaults to backend/data/tradingbot.duckdb
            read_only: Open the database in read-only mode.
        """
        if db_path is None:
            db_path = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "tradingbot.duckdb",
            )

        self.db_path = db_path
        self._lock = threading.RLock()
        self.conn = duckdb.connect(db_path, read_only=read_only)
        if not read_only:
            self._create_tables()
            self._migrate_v2()
        logger.info(f"DuckDB store opened: {db_path}")

    def _create_tables(self) -> None:
        """Create tables if they don't exist."""
        with self._lock:
            self.conn.execute("""
            CREATE TABLE IF NOT EXISTS candles (
                timestamp TIMESTAMP NOT NULL,
                open DOUBLE NOT NULL,
                high DOUBLE NOT NULL,
                low DOUBLE NOT NULL,
                close DOUBLE NOT NULL,
                volume DOUBLE DEFAULT 0,
                instrument VARCHAR NOT NULL,
                timeframe VARCHAR NOT NULL,
                asset_class VARCHAR DEFAULT 'futures',
                PRIMARY KEY (timestamp, instrument, timeframe)
            )
            """)

            self.conn.execute("""
            CREATE TABLE IF NOT EXISTS indicators (
                timestamp TIMESTAMP NOT NULL,
                instrument VARCHAR NOT NULL,
                timeframe VARCHAR NOT NULL,
                indicator_name VARCHAR NOT NULL,
                value DOUBLE NOT NULL,
                PRIMARY KEY (timestamp, instrument, timeframe, indicator_name)
            )
            """)

            self.conn.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id VARCHAR PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL,
                instrument VARCHAR NOT NULL,
                direction VARCHAR NOT NULL,
                entry_price DOUBLE NOT NULL,
                exit_price DOUBLE,
                quantity DOUBLE NOT NULL,
                stop_loss DOUBLE NOT NULL,
                take_profit DOUBLE NOT NULL,
                pnl DOUBLE,
                status VARCHAR NOT NULL,
                strategy_name VARCHAR NOT NULL,
                asset_class VARCHAR DEFAULT 'futures',
                exit_timestamp TIMESTAMP,
                exit_reason VARCHAR
            )
            """)

            self.conn.execute("""
            CREATE TABLE IF NOT EXISTS signals (
                id VARCHAR DEFAULT (uuid()),
                timestamp TIMESTAMP NOT NULL,
                instrument VARCHAR NOT NULL,
                direction VARCHAR NOT NULL,
                strategy VARCHAR NOT NULL,
                entry_price DOUBLE NOT NULL,
                confidence DOUBLE,
                triggered_level DOUBLE,
                trend_direction VARCHAR,
                asset_class VARCHAR DEFAULT 'futures'
            )
            """)

            self.conn.execute("""
            CREATE TABLE IF NOT EXISTS bot_state (
                id INTEGER PRIMARY KEY DEFAULT 1,
                status VARCHAR DEFAULT 'STOPPED',
                instrument VARCHAR DEFAULT 'GC=F',
                strategy VARCHAR DEFAULT 'fibonacci_retracement',
                trading_mode VARCHAR DEFAULT 'paper',
                balance DOUBLE DEFAULT 500.0,
                initial_balance DOUBLE DEFAULT 500.0,
                daily_pnl DOUBLE DEFAULT 0.0,
                total_trades INTEGER DEFAULT 0,
                winning_trades INTEGER DEFAULT 0,
                last_updated TIMESTAMP,
                last_heartbeat TIMESTAMP,
                error_message VARCHAR DEFAULT '',
                force_market_open BOOLEAN DEFAULT FALSE,
                market_status BOOLEAN DEFAULT FALSE,
                market_status_effective BOOLEAN DEFAULT FALSE,
                market_display VARCHAR DEFAULT ''
            )
            """)

            # Backward-compatible schema upgrades for existing DB files
            self.conn.execute("ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS trading_mode VARCHAR DEFAULT 'paper'")
            self.conn.execute("ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP")
            self.conn.execute("ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS force_market_open BOOLEAN DEFAULT FALSE")
            self.conn.execute("ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS market_status_effective BOOLEAN DEFAULT FALSE")

            self.conn.execute("""
            CREATE TABLE IF NOT EXISTS strategy_configs (
                id INTEGER PRIMARY KEY DEFAULT 1,
                strategy_name VARCHAR NOT NULL,
                display_name VARCHAR,
                params JSON NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                description VARCHAR DEFAULT ''
            )
            """)

        # Seed bot_state if empty
        count = self.conn.execute(
            "SELECT COUNT(*) FROM bot_state"
        ).fetchone()[0]
        if count == 0:
            self.conn.execute("""
                INSERT INTO bot_state (id, status, instrument, strategy, balance, initial_balance)
                VALUES (1, 'STOPPED', 'GC=F', 'fibonacci_retracement', 500.0, 500.0)
            """)

        # Seed default strategy config if empty
        count = self.conn.execute(
            "SELECT COUNT(*) FROM strategy_configs"
        ).fetchone()[0]
        if count == 0:
            self.conn.execute("""
                INSERT INTO strategy_configs
                    (id, strategy_name, display_name, is_active, description, params)
                VALUES (1, 'fibonacci_retracement', 'Fibonacci Retracement', TRUE,
                    'Enters trades when price retraces to key Fibonacci levels (38.2%, 61.8%) within a VWAP-confirmed trend.',
                    '{"lookback_period": 20, "entry_levels": [0.382, 0.618], "stop_loss_level": 0.786, "risk_reward_ratio": 2.0, "timeframe": "5m", "risk_per_trade_pct": 1.0, "max_open_positions": 3, "max_daily_loss_pct": 5.0}'
                )
            """)

    def _migrate_v2(self) -> None:
        """Idempotent migration to v2 schema — confidence, chart blobs, asset_class default."""
        cols = self.conn.execute("PRAGMA table_info(trades)").fetchdf()
        existing = set(cols["name"].tolist()) if not cols.empty else set()

        if "confidence" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN confidence DOUBLE DEFAULT 0.0")
        if "chart_initial_png" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN chart_initial_png BLOB")
        if "chart_final_png" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN chart_final_png BLOB")
        if "tp1_price" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN tp1_price DOUBLE")
        if "tp2_price" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN tp2_price DOUBLE")
        if "tp1_hit" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN tp1_hit BOOLEAN DEFAULT FALSE")
        if "leverage" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN leverage DOUBLE DEFAULT 1.0")
        if "notional" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN notional DOUBLE DEFAULT 0.0")
        if "initial_margin" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN initial_margin DOUBLE DEFAULT 0.0")
        if "liquidation_price" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN liquidation_price DOUBLE")
        if "funding_rate_hr" not in existing:
            self.conn.execute("ALTER TABLE trades ADD COLUMN funding_rate_hr DOUBLE")

        self.conn.execute(
            "UPDATE candles SET asset_class = 'crypto' WHERE asset_class IS NULL OR asset_class = 'futures'"
        )

    # ── Candle Operations ────────────────────────────────────────

    def store_candles(
        self,
        df: pd.DataFrame,
        instrument: str = "GC=F",
        timeframe: str = "5m",
        asset_class: str = "futures",
    ) -> int:
        """
        Bulk insert/update candles from a DataFrame.

        Uses INSERT OR REPLACE for upsert behavior.

        Args:
            df: DataFrame with OHLCV data and DatetimeIndex
            instrument: Instrument symbol
            timeframe: Candle timeframe
            asset_class: Asset class (futures, stocks, crypto)

        Returns:
            Number of rows inserted
        """
        if df.empty:
            return 0

        # Prepare data for insert
        records = []
        for ts, row in df.iterrows():
            records.append((
                pd.Timestamp(ts).to_pydatetime(),
                float(row["Open"]),
                float(row["High"]),
                float(row["Low"]),
                float(row["Close"]),
                float(row.get("Volume", 0)),
                instrument,
                timeframe,
                asset_class,
            ))

        # Use INSERT OR REPLACE for upsert
        self.conn.executemany("""
            INSERT OR REPLACE INTO candles
            (timestamp, open, high, low, close, volume,
             instrument, timeframe, asset_class)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, records)

        logger.debug(
            f"DuckDB: stored {len(records)} candles for "
            f"{instrument}/{timeframe}"
        )
        return len(records)

    def get_candles(
        self,
        instrument: str = "GC=F",
        timeframe: str = "5m",
        periods: int | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> pd.DataFrame:
        """
        Retrieve candles from DuckDB.

        Args:
            instrument: Instrument symbol
            timeframe: Candle timeframe
            periods: Number of most recent candles (overrides date range)
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)

        Returns:
            DataFrame with OHLCV data
        """
        query = """
            SELECT timestamp, open, high, low, close, volume
            FROM candles
            WHERE instrument = ? AND timeframe = ?
        """
        params = [instrument, timeframe]

        if start_date:
            query += " AND timestamp >= ?"
            params.append(start_date)
        if end_date:
            query += " AND timestamp <= ?"
            params.append(end_date)

        query += " ORDER BY timestamp DESC"

        if periods:
            query += f" LIMIT {periods}"

        df = self.conn.execute(query, params).fetchdf()

        if not df.empty:
            df = df.sort_values("timestamp")
            df = df.set_index("timestamp")
            df.columns = ["Open", "High", "Low", "Close", "Volume"]

        return df

    # ── Multi-Timeframe Trend Engine ──────────────────────────────

    def compute_mtf_trend(
        self,
        instrument: str = "GC=F",
    ) -> dict:
        """
        Compute trend direction across all stored timeframes using
        DuckDB SQL window functions.

        The MTF trend engine uses a VMA (Volume-weighted Moving Average)
        slope approach:
        1. For each TF, compute a 20-period VMA
        2. Compare current VMA to VMA 10 periods ago → slope
        3. Positive slope = UP, Negative slope = DOWN
        4. Stack all three TFs to determine trade eligibility

        Returns:
            {
                "1h":  {"trend": "UP"|"DOWN", "slope": float, "vma": float, "candles": int},
                "15m": {"trend": "UP"|"DOWN", "slope": float, "vma": float, "candles": int},
                "5m":  {"trend": "UP"|"DOWN", "slope": float, "vma": float, "candles": int},
                "stacked": True|False,       # All TFs agree?
                "direction": "UP"|"DOWN"|"MIXED",  # Consensus direction
            }
        """
        result = {}

        for tf in ["1h", "15m", "5m"]:
            try:
                row = self.conn.execute("""
                    WITH vma_calc AS (
                        SELECT
                            timestamp,
                            close,
                            volume,
                            -- VMA: volume-weighted moving average (20 periods)
                            SUM(close * volume) OVER w / NULLIF(SUM(volume) OVER w, 0)
                                AS vma_20,
                            ROW_NUMBER() OVER (
                                PARTITION BY instrument, timeframe
                                ORDER BY timestamp DESC
                            ) AS rn
                        FROM candles
                        WHERE instrument = ? AND timeframe = ?
                        WINDOW w AS (
                            PARTITION BY instrument, timeframe
                            ORDER BY timestamp
                            ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                        )
                    )
                    SELECT
                        curr.vma_20 AS current_vma,
                        prev.vma_20 AS prev_vma,
                        curr.close AS current_price,
                        (SELECT COUNT(*) FROM candles
                         WHERE instrument = ? AND timeframe = ?) AS total_candles
                    FROM vma_calc curr
                    JOIN vma_calc prev ON prev.rn = 11
                    WHERE curr.rn = 1
                """, [instrument, tf, instrument, tf]).fetchone()

                if row and row[0] is not None and row[1] is not None:
                    current_vma = row[0]
                    prev_vma = row[1]
                    current_price = row[2]
                    total_candles = row[3]

                    slope = (current_vma - prev_vma) / prev_vma * 100 if prev_vma != 0 else 0
                    trend = "UP" if slope > 0 else "DOWN"

                    result[tf] = {
                        "trend": trend,
                        "slope": round(slope, 4),
                        "vma": round(current_vma, 2),
                        "price": round(current_price, 2),
                        "candles": total_candles,
                    }
                else:
                    result[tf] = {
                        "trend": "UNKNOWN",
                        "slope": 0,
                        "vma": 0,
                        "price": 0,
                        "candles": 0,
                    }
            except Exception as e:
                logger.warning(f"MTF trend calc failed for {tf}: {e}")
                result[tf] = {
                    "trend": "UNKNOWN", "slope": 0, "vma": 0,
                    "price": 0, "candles": 0,
                }

        # Determine stack consensus
        trends = [v["trend"] for v in result.values() if v["trend"] != "UNKNOWN"]
        if len(trends) >= 2 and len(set(trends)) == 1:
            stacked = True
            direction = trends[0]
        else:
            stacked = False
            direction = "MIXED"

        result["stacked"] = stacked
        result["direction"] = direction

        return result

    def compute_and_store_indicators(
        self,
        instrument: str = "GC=F",
        timeframe: str = "5m",
    ) -> None:
        """
        Compute common indicators using DuckDB SQL and store them.

        Computes: SMA_20, SMA_50, VMA_20, VWAP
        Uses DuckDB window functions for efficient computation.
        """
        # SMA computations using window functions
        self.conn.execute("""
            INSERT OR REPLACE INTO indicators
                (timestamp, instrument, timeframe, indicator_name, value)
            SELECT
                timestamp,
                instrument,
                timeframe,
                'SMA_20',
                AVG(close) OVER (
                    PARTITION BY instrument, timeframe
                    ORDER BY timestamp
                    ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                )
            FROM candles
            WHERE instrument = ? AND timeframe = ?
        """, [instrument, timeframe])

        self.conn.execute("""
            INSERT OR REPLACE INTO indicators
                (timestamp, instrument, timeframe, indicator_name, value)
            SELECT
                timestamp,
                instrument,
                timeframe,
                'SMA_50',
                AVG(close) OVER (
                    PARTITION BY instrument, timeframe
                    ORDER BY timestamp
                    ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
                )
            FROM candles
            WHERE instrument = ? AND timeframe = ?
        """, [instrument, timeframe])

        # VMA (Volume-weighted Moving Average, 20 periods)
        self.conn.execute("""
            INSERT OR REPLACE INTO indicators
                (timestamp, instrument, timeframe, indicator_name, value)
            SELECT timestamp, instrument, timeframe, indicator_name, value FROM (
                SELECT
                    timestamp,
                    instrument,
                    timeframe,
                    'VMA_20' AS indicator_name,
                    SUM(close * volume) OVER (
                        PARTITION BY instrument, timeframe
                        ORDER BY timestamp
                        ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                    ) /
                    NULLIF(
                        SUM(volume) OVER (
                            PARTITION BY instrument, timeframe
                            ORDER BY timestamp
                            ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                        ), 0
                    ) AS value
                FROM candles
                WHERE instrument = ? AND timeframe = ?
            ) sub WHERE value IS NOT NULL
        """, [instrument, timeframe])

        # VWAP (cumulative session)
        self.conn.execute("""
            INSERT OR REPLACE INTO indicators
                (timestamp, instrument, timeframe, indicator_name, value)
            SELECT timestamp, instrument, timeframe, indicator_name, value FROM (
                SELECT
                    timestamp,
                    instrument,
                    timeframe,
                    'VWAP' AS indicator_name,
                    SUM((high + low + close) / 3.0 * volume) OVER (
                        PARTITION BY instrument, timeframe
                        ORDER BY timestamp
                        ROWS UNBOUNDED PRECEDING
                    ) /
                    NULLIF(
                        SUM(volume) OVER (
                            PARTITION BY instrument, timeframe
                            ORDER BY timestamp
                            ROWS UNBOUNDED PRECEDING
                        ), 0
                    ) AS value
                FROM candles
                WHERE instrument = ? AND timeframe = ?
            ) sub WHERE value IS NOT NULL
        """, [instrument, timeframe])

        logger.debug(
            f"DuckDB: computed indicators for {instrument}/{timeframe}"
        )

    def get_indicator_values(
        self,
        instrument: str = "GC=F",
        timeframe: str = "5m",
        indicator_name: str = "SMA_20",
        periods: int | None = None,
    ) -> pd.DataFrame:
        """
        Retrieve computed indicator values.

        Returns:
            DataFrame with timestamp and indicator value
        """
        query = """
            SELECT timestamp, value
            FROM indicators
            WHERE instrument = ?
              AND timeframe = ?
              AND indicator_name = ?
            ORDER BY timestamp DESC
        """
        params = [instrument, timeframe, indicator_name]

        if periods:
            query += f" LIMIT {periods}"

        df = self.conn.execute(query, params).fetchdf()
        if not df.empty:
            df = df.sort_values("timestamp")
            df = df.set_index("timestamp")
            df.columns = [indicator_name]
        return df

    # ── Analytics Queries ────────────────────────────────────────

    def query(self, sql: str, params: list | None = None) -> pd.DataFrame:
        """
        Run an ad-hoc SQL query and return results as DataFrame.

        Useful for custom analytics, backtesting queries, etc.

        Args:
            sql: SQL query string
            params: Optional query parameters

        Returns:
            DataFrame with query results
        """
        if params:
            return self.conn.execute(sql, params).fetchdf()
        return self.conn.execute(sql).fetchdf()

    def get_candle_count(
        self,
        instrument: str | None = None,
        timeframe: str | None = None,
    ) -> int:
        """Get total candle count, optionally filtered."""
        query = "SELECT COUNT(*) FROM candles WHERE 1=1"
        params = []

        if instrument:
            query += " AND instrument = ?"
            params.append(instrument)
        if timeframe:
            query += " AND timeframe = ?"
            params.append(timeframe)

        result = self.conn.execute(query, params).fetchone()
        return result[0] if result else 0

    def get_instruments(self) -> list[str]:
        """Get list of all instruments stored in DuckDB."""
        result = self.conn.execute(
            "SELECT DISTINCT instrument FROM candles ORDER BY instrument"
        ).fetchall()
        return [row[0] for row in result]

    def get_asset_classes(self) -> list[str]:
        """Get list of all asset classes stored."""
        result = self.conn.execute(
            "SELECT DISTINCT asset_class FROM candles ORDER BY asset_class"
        ).fetchall()
        return [row[0] for row in result]

    # ── Bot State CRUD ──────────────────────────────────────────

    def get_bot_state(self) -> dict | None:
        """Get current bot state."""
        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM bot_state ORDER BY id ASC LIMIT 1"
            ).fetchdf()
        if row.empty:
            return None
        return row.iloc[0].to_dict()

    def update_bot_state(self, data: dict) -> None:
        """Update bot state fields."""
        with self._lock:
            row = self.conn.execute("SELECT id FROM bot_state ORDER BY id ASC LIMIT 1").fetchone()
            if row is None:
                self.conn.execute("INSERT INTO bot_state (id) VALUES (1)")
                row_id = 1
            else:
                row_id = row[0]

        sets = []
        vals = []
        for k, v in data.items():
            if k == "id":
                continue
            sets.append(f"{k} = ?")
            vals.append(v)
        if not sets:
            return
        sql = f"UPDATE bot_state SET {', '.join(sets)} WHERE id = ?"
        vals.append(row_id)
        with self._lock:
            self.conn.execute(sql, vals)

    # ── Trade CRUD ──────────────────────────────────────────────

    def create_trade(self, data: dict) -> str:
        """Insert a trade record. Returns the trade ID."""
        import uuid
        trade_id = str(uuid.uuid4())[:16]
        self.conn.execute("""
            INSERT INTO trades
                (id, timestamp, instrument, direction, entry_price,
                 quantity, stop_loss, take_profit, status, strategy_name,
                 asset_class)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            trade_id,
            data.get("timestamp"),
            data.get("instrument"),
            data.get("direction"),
            data.get("entry_price"),
            data.get("quantity"),
            data.get("stop_loss"),
            data.get("take_profit"),
            data.get("status", "OPEN"),
            data.get("strategy_name"),
            data.get("asset_class", "futures"),
        ])
        return trade_id

    def update_trade(self, trade_id: str, data: dict) -> None:
        """Update a trade record."""
        sets = []
        vals = []
        for k, v in data.items():
            sets.append(f"{k} = ?")
            vals.append(v)
        if not sets:
            return
        vals.append(trade_id)
        sql = f"UPDATE trades SET {', '.join(sets)} WHERE id = ?"
        self.conn.execute(sql, vals)

    def get_open_trades(self) -> list[dict]:
        """Get all open trades."""
        df = self.conn.execute(
            "SELECT * FROM trades WHERE status = 'OPEN' ORDER BY timestamp"
        ).fetchdf()
        if df.empty:
            return []
        return df.to_dict("records")

    def count_open_trades(self) -> int:
        """Count open trades."""
        row = self.conn.execute(
            "SELECT COUNT(*) FROM trades WHERE status = 'OPEN'"
        ).fetchone()
        return row[0] if row else 0

    def get_trades(
        self, limit: int = 50, status: str | None = None, sort_desc: bool = True,
    ) -> list[dict]:
        """Get trades with optional filtering."""
        query = "SELECT * FROM trades"
        params = []
        if status:
            query += " WHERE status = ?"
            params.append(status)
        query += f" ORDER BY timestamp {'DESC' if sort_desc else 'ASC'}"
        query += f" LIMIT {limit}"
        df = self.conn.execute(query, params).fetchdf()
        if df.empty:
            return []
        return df.to_dict("records")

    def get_trade(self, trade_id: str) -> dict | None:
        """Get a single trade by ID."""
        df = self.conn.execute(
            "SELECT * FROM trades WHERE id = ?", [trade_id]
        ).fetchdf()
        if df.empty:
            return None
        return df.iloc[0].to_dict()

    # ── Signal CRUD ─────────────────────────────────────────────

    def create_signal(self, data: dict) -> None:
        """Insert a signal record."""
        self.conn.execute("""
            INSERT INTO signals
                (timestamp, instrument, direction, strategy,
                 entry_price, confidence, triggered_level,
                 trend_direction, asset_class)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            data.get("timestamp"),
            data.get("instrument"),
            data.get("direction"),
            data.get("strategy"),
            data.get("entry_price"),
            data.get("confidence"),
            data.get("triggered_level"),
            data.get("trend_direction"),
            data.get("asset_class", "futures"),
        ])

    def get_signals(self, limit: int = 50) -> list[dict]:
        """Get recent signals."""
        df = self.conn.execute(
            f"SELECT * FROM signals ORDER BY timestamp DESC LIMIT {limit}"
        ).fetchdf()
        if df.empty:
            return []
        return df.to_dict("records")

    # ── Strategy Config CRUD ────────────────────────────────────

    def get_active_strategy(self) -> dict | None:
        """Get the active strategy config."""
        df = self.conn.execute(
            "SELECT * FROM strategy_configs WHERE is_active = TRUE LIMIT 1"
        ).fetchdf()
        if df.empty:
            return None
        row = df.iloc[0].to_dict()
        # Parse JSON params
        if isinstance(row.get("params"), str):
            import json
            row["params"] = json.loads(row["params"])
        return row

    def get_strategy_configs(self) -> list[dict]:
        """Get all strategy configs."""
        df = self.conn.execute(
            "SELECT * FROM strategy_configs ORDER BY strategy_name"
        ).fetchdf()
        if df.empty:
            return []
        records = df.to_dict("records")
        import json
        for r in records:
            if isinstance(r.get("params"), str):
                r["params"] = json.loads(r["params"])
        return records

    def update_strategy_config(self, strategy_name: str, data: dict) -> None:
        """Update a strategy config."""
        import json
        sets = []
        vals = []
        for k, v in data.items():
            if k == "params" and isinstance(v, dict):
                sets.append(f"{k} = ?")
                vals.append(json.dumps(v))
            else:
                sets.append(f"{k} = ?")
                vals.append(v)
        if not sets:
            return
        vals.append(strategy_name)
        sql = f"UPDATE strategy_configs SET {', '.join(sets)} WHERE strategy_name = ?"
        self.conn.execute(sql, vals)

    # ── Lifecycle ────────────────────────────────────────────────

    def health_check(self) -> bool:
        """Check if DuckDB is working."""
        try:
            result = self.conn.execute("SELECT 1").fetchone()
            return result is not None and result[0] == 1
        except Exception:
            return False

    def close(self) -> None:
        """Close the DuckDB connection."""
        if self.conn:
            self.conn.close()
            logger.info("DuckDB store closed")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
