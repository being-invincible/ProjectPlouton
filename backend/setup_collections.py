"""
PocketBase Collection Schema Setup Script.

Run this AFTER starting PocketBase for the first time to create
all required collections via the PocketBase REST API.

Usage:
    1. Start PocketBase: cd pocketbase && ./pocketbase serve
    2. Create admin account at http://127.0.0.1:8090/_/
    3. Run: python setup_collections.py --email admin@example.com --password yourpassword
"""

import argparse
import httpx
import json
import sys

POCKETBASE_URL = "http://127.0.0.1:8090"

# ── Collection Schemas ──────────────────────────────────────────

COLLECTIONS = [
    {
        "name": "candles",
        "type": "base",
        "schema": [
            {"name": "timestamp", "type": "date", "required": True},
            {"name": "open", "type": "number", "required": True},
            {"name": "high", "type": "number", "required": True},
            {"name": "low", "type": "number", "required": True},
            {"name": "close", "type": "number", "required": True},
            {"name": "volume", "type": "number", "required": False},
            {"name": "instrument", "type": "text", "required": True},
            {"name": "timeframe", "type": "text", "required": True},
        ],
        "indexes": [
            "CREATE INDEX idx_candles_instrument_time ON candles (instrument, timestamp)",
        ],
    },
    {
        "name": "trades",
        "type": "base",
        "schema": [
            {"name": "timestamp", "type": "date", "required": True},
            {"name": "instrument", "type": "text", "required": True},
            {"name": "direction", "type": "text", "required": True},  # LONG / SHORT
            {"name": "entry_price", "type": "number", "required": True},
            {"name": "exit_price", "type": "number", "required": False},
            {"name": "quantity", "type": "number", "required": True},
            {"name": "stop_loss", "type": "number", "required": True},
            {"name": "take_profit", "type": "number", "required": True},
            {"name": "pnl", "type": "number", "required": False},
            {"name": "status", "type": "text", "required": True},  # OPEN / CLOSED / CANCELLED
            {"name": "strategy_name", "type": "text", "required": True},
            {"name": "signal_metadata", "type": "json", "required": False},
            {"name": "exit_timestamp", "type": "date", "required": False},
            {"name": "exit_reason", "type": "text", "required": False},  # SL_HIT / TP_HIT / MANUAL
        ],
        "indexes": [
            "CREATE INDEX idx_trades_status ON trades (status)",
            "CREATE INDEX idx_trades_timestamp ON trades (timestamp)",
            "CREATE INDEX idx_trades_instrument ON trades (instrument)",
        ],
    },
    {
        "name": "signals",
        "type": "base",
        "schema": [
            {"name": "timestamp", "type": "date", "required": True},
            {"name": "instrument", "type": "text", "required": True},
            {"name": "direction", "type": "text", "required": True},  # LONG / SHORT
            {"name": "strategy", "type": "text", "required": True},
            {"name": "entry_price", "type": "number", "required": True},
            {"name": "fib_levels", "type": "json", "required": False},
            {"name": "vwap_value", "type": "number", "required": False},
            {"name": "confidence", "type": "number", "required": False},
            {"name": "triggered_level", "type": "number", "required": False},
            {"name": "trend_direction", "type": "text", "required": False},  # UP / DOWN
        ],
        "indexes": [
            "CREATE INDEX idx_signals_timestamp ON signals (timestamp)",
        ],
    },
    {
        "name": "strategy_configs",
        "type": "base",
        "schema": [
            {"name": "strategy_name", "type": "text", "required": True},
            {"name": "display_name", "type": "text", "required": False},
            {"name": "params", "type": "json", "required": True},
            {"name": "is_active", "type": "bool", "required": True},
            {"name": "description", "type": "text", "required": False},
        ],
        "indexes": [
            "CREATE UNIQUE INDEX idx_strategy_configs_name ON strategy_configs (strategy_name)",
        ],
    },
    {
        "name": "bot_state",
        "type": "base",
        "schema": [
            {"name": "status", "type": "text", "required": True},  # RUNNING / STOPPED / ERROR
            {"name": "instrument", "type": "text", "required": True},
            {"name": "strategy", "type": "text", "required": True},
            {"name": "balance", "type": "number", "required": True},
            {"name": "initial_balance", "type": "number", "required": True},
            {"name": "daily_pnl", "type": "number", "required": False},
            {"name": "total_trades", "type": "number", "required": False},
            {"name": "winning_trades", "type": "number", "required": False},
            {"name": "last_updated", "type": "date", "required": False},
            {"name": "error_message", "type": "text", "required": False},
            {"name": "market_status", "type": "bool", "required": False},
            {"name": "market_display", "type": "text", "required": False},
        ],
    },
]

# Default Fibonacci strategy config to seed on first run
DEFAULT_FIB_CONFIG = {
    "strategy_name": "fibonacci_retracement",
    "display_name": "Fibonacci Retracement",
    "is_active": True,
    "description": "Enters trades when price retraces to key Fibonacci levels (38.2%, 61.8%) within a VWAP-confirmed trend.",
    "params": {
        "lookback_period": 20,
        "entry_levels": [0.382, 0.618],
        "stop_loss_level": 0.786,
        "risk_reward_ratio": 2.0,
        "timeframe": "5m",
        "risk_per_trade_pct": 1.0,
        "max_open_positions": 3,
        "max_daily_loss_pct": 5.0,
    },
}

DEFAULT_BOT_STATE = {
    "status": "STOPPED",
    "instrument": "GC=F",
    "strategy": "fibonacci_retracement",
    "balance": 500.0,
    "initial_balance": 500.0,
    "daily_pnl": 0.0,
    "total_trades": 0,
    "winning_trades": 0,
}


def authenticate(email: str, password: str) -> str:
    """Authenticate as admin and return the auth token."""
    resp = httpx.post(
        f"{POCKETBASE_URL}/api/admins/auth-with-password",
        json={"identity": email, "password": password},
    )
    if resp.status_code != 200:
        # Try the newer PocketBase v0.25+ endpoint
        resp = httpx.post(
            f"{POCKETBASE_URL}/api/collections/_superusers/auth-with-password",
            json={"identity": email, "password": password},
        )
    if resp.status_code != 200:
        print(f"❌ Auth failed: {resp.text}")
        sys.exit(1)
    token = resp.json()["token"]
    print(f"✅ Authenticated as admin")
    return token


def create_collection(token: str, collection: dict) -> None:
    """Create a PocketBase collection."""
    name = collection["name"]
    headers = {"Authorization": token}

    # Check if collection already exists
    resp = httpx.get(
        f"{POCKETBASE_URL}/api/collections/{name}",
        headers=headers,
    )
    if resp.status_code == 200:
        print(f"  ⏭️  Collection '{name}' already exists, skipping")
        return

    payload = {
        "name": name,
        "type": collection.get("type", "base"),
        "fields": collection.get("schema", []),
        "indexes": collection.get("indexes", []),
        "listRule": "",   # Public read access (no auth needed for dashboard)
        "viewRule": "",
        "createRule": "",  # Bot writes directly
        "updateRule": "",
        "deleteRule": "",
    }

    resp = httpx.post(
        f"{POCKETBASE_URL}/api/collections",
        headers=headers,
        json=payload,
    )

    if resp.status_code == 200:
        print(f"  ✅ Created collection: {name}")
    else:
        print(f"  ❌ Failed to create '{name}': {resp.text}")


def seed_defaults(token: str) -> None:
    """Seed default strategy config and bot state."""
    headers = {"Authorization": token}

    # Seed Fibonacci strategy config
    resp = httpx.get(
        f"{POCKETBASE_URL}/api/collections/strategy_configs/records",
        headers=headers,
        params={"filter": f"strategy_name='fibonacci_retracement'"},
    )
    if resp.status_code == 200 and resp.json().get("totalItems", 0) == 0:
        resp = httpx.post(
            f"{POCKETBASE_URL}/api/collections/strategy_configs/records",
            headers=headers,
            json=DEFAULT_FIB_CONFIG,
        )
        if resp.status_code == 200:
            print("  ✅ Seeded default Fibonacci strategy config")
        else:
            print(f"  ❌ Failed to seed strategy config: {resp.text}")
    else:
        print("  ⏭️  Fibonacci strategy config already exists")

    # Seed bot state
    resp = httpx.get(
        f"{POCKETBASE_URL}/api/collections/bot_state/records",
        headers=headers,
    )
    if resp.status_code == 200 and resp.json().get("totalItems", 0) == 0:
        resp = httpx.post(
            f"{POCKETBASE_URL}/api/collections/bot_state/records",
            headers=headers,
            json=DEFAULT_BOT_STATE,
        )
        if resp.status_code == 200:
            print("  ✅ Seeded default bot state ($500 balance)")
        else:
            print(f"  ❌ Failed to seed bot state: {resp.text}")
    else:
        print("  ⏭️  Bot state already exists")


def main():
    global POCKETBASE_URL
    parser = argparse.ArgumentParser(description="Setup PocketBase collections for TradingBot")
    parser.add_argument("--email", required=True, help="PocketBase admin email")
    parser.add_argument("--password", required=True, help="PocketBase admin password")
    parser.add_argument("--url", default=POCKETBASE_URL, help="PocketBase URL")
    args = parser.parse_args()

    POCKETBASE_URL = args.url

    print(f"\n🔧 Setting up PocketBase collections at {POCKETBASE_URL}\n")

    token = authenticate(args.email, args.password)

    print("\n📦 Creating collections...")
    for collection in COLLECTIONS:
        create_collection(token, collection)

    print("\n🌱 Seeding default data...")
    seed_defaults(token)

    print("\n✅ PocketBase setup complete!\n")
    print(f"   Admin UI: {POCKETBASE_URL}/_/")
    print(f"   API:      {POCKETBASE_URL}/api/")
    print()


if __name__ == "__main__":
    main()
